"""从爬取的竞品官网页面中提取结构化画像数据（三阶段 LLM 提取）

任务状态持久化到数据库，进程重启后可从 DB 恢复进行中的任务。
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CompetitorProfile, ProfileTemplate
from app.db.models import ProfileGenerationTask as ProfileGenerationTaskModel
from app.services.llm import LLMClient

logger = logging.getLogger(__name__)

_MAX_SUMMARY_CHARS = 300  # 每页摘要上限
_MAX_PAGE_TEXT_STAGE2 = 4000  # Stage 2 单页全文上限
_MAX_DIMENSION_TEXT = 12000  # Stage 2 单维度总输入上限
_CONFIDENCE_HIGH = 0.85
_CONFIDENCE_MEDIUM = 0.6
_CONFIDENCE_LOW = 0.3


# ---------------------------------------------------------------------------
# Stage 1: 页面摘要化 + 维度相关性标注
# ---------------------------------------------------------------------------

async def _stage1_summarize_pages(pages: list[dict], dimensions: list[dict], competitor_name: str) -> list[dict]:
    """
    对每页调用 LLM 提取摘要和维度相关性标签。
    返回 [{url, title, page_type, summary, relevant_dims: [dim_key, ...], confidence}, ...]
    """
    llm = LLMClient()
    dim_keys = [d["key"] for d in dimensions]
    dim_labels = {d["key"]: d["label"] for d in dimensions}

    system = (
        "你是一个信息提取助手。给定一段网页正文，请提取摘要并判断与哪些维度相关。\n"
        f"竞品名称：{competitor_name}\n"
        f"维度列表：{', '.join(f'{dim_labels.get(k, k)} (key={k})' for k in dim_keys)}\n\n"
        "要求：\n"
        "1. 提取 100-200 字的核心摘要，保留具体数字、名称、功能点；\n"
        "2. 判断该页面与哪些维度相关（可能多个），只从给定维度列表中选择；\n"
        "3. 评估摘要的可信度（high/medium/low）：high=官方声明/明确数据，medium=第三方报道，low=模糊/推测\n"
        '4. 输出 JSON：{"summary": "摘要", "relevant_dims": ["dim_key1", ...], "confidence": "high|medium|low"}'
    )

    async def _summarize(page: dict) -> dict:
        text = page.get("content_text", "").strip()
        if not text or len(text) < 50:
            return None
        text = text[:_MAX_SUMMARY_CHARS * 5]

        user = f"页面标题：{page.get('title', '')}\n页面URL：{page['url']}\n页面类型：{page.get('page_type', 'other')}\n\n正文：\n{text}"

        try:
            data = await llm.chat_json(system, user)
            summary = data.get("summary", "")[:_MAX_SUMMARY_CHARS]
            relevant = data.get("relevant_dims", [])
            conf = data.get("confidence", "low")
            return {
                "url": page["url"],
                "title": page.get("title", ""),
                "page_type": page.get("page_type", "other"),
                "summary": summary,
                "relevant_dims": [k for k in relevant if k in dim_keys],
                "confidence": conf,
            }
        except Exception as exc:
            logger.warning("stage1 summarize failed for %s: %s", page["url"], exc)
            return {
                "url": page["url"],
                "title": page.get("title", ""),
                "page_type": page.get("page_type", "other"),
                "summary": text[:_MAX_SUMMARY_CHARS],
                "relevant_dims": [],
                "confidence": "low",
            }

    # 批量并发（每批 5 页），避免并发请求过多
    results = []
    semaphore = asyncio.Semaphore(5)
    async def _bounded_summarize(page: dict):
        async with semaphore:
            return await _summarize(page)

    batch_results = await asyncio.gather(*[_bounded_summarize(p) for p in pages], return_exceptions=True)
    for r in batch_results:
        if isinstance(r, dict) and r is not None:
            results.append(r)

    return results


# ---------------------------------------------------------------------------
# Stage 2: 按维度提取结构化数据
# ---------------------------------------------------------------------------

async def _stage2_extract_dimension(
    dim_def: dict,
    page_summaries: list[dict],
    full_pages: dict[str, dict],
    competitor_name: str,
) -> dict:
    """
    对单个维度，从相关页面的摘要 + 完整正文中提取结构化字段值。
    返回 {field_key: {value, confidence, source_url}, ...}
    """
    llm = LLMClient()
    fields = dim_def.get("fields", [])
    if not fields:
        return {}

    # 找相关页面
    related = [p for p in page_summaries if dim_def["key"] in p.get("relevant_dims", [])]
    if not related:
        return {}

    # 取最相关的 3 页（按 confidence 排序：high > medium > low）
    conf_order = {"high": 0, "medium": 1, "low": 2}
    related.sort(key=lambda p: conf_order.get(p.get("confidence", "low"), 2))
    top_pages = related[:3]

    # 构建输入：摘要 + 对应页的完整正文（截断）
    page_contexts = []
    total_chars = 0
    for p in top_pages:
        ctx = f"【{p['title'] or p['url']}】\n{p['summary']}"
        full = full_pages.get(p["url"], {}).get("content_text", "")
        if full and total_chars + len(full) < _MAX_DIMENSION_TEXT:
            ctx += f"\n全文：{full[:_MAX_PAGE_TEXT_STAGE2]}"
        page_contexts.append(ctx)
        total_chars += len(ctx)

    fields_desc = "\n".join(
        f"- {f['label']}（{f['key']}，类型：{f['type']}）：需提取该字段的具体值"
        for f in fields
    )

    system = (
        f"你是一个竞品分析专家。竞品：{competitor_name}\n"
        f"当前分析维度：{dim_def['label']}（{dim_def['key']}）\n\n"
        f"需要提取的字段：\n{fields_desc}\n\n"
        "要求：\n"
        "1. 仅依据提供的材料提取，不得编造；\n"
        "2. 信息不足的字段标注「信息不足」；\n"
        "3. 多来源冲突时标注「存在差异：{来源A说X，来源B说Y}」；\n"
        "4. 每个字段标注可信度（high/medium/low）和来源 URL；\n"
        '5. 输出 JSON：{"fields": {"field_key": {"value": "...", "confidence": "high|medium|low", "source_url": "..."}}}'
    )

    user = "\n\n".join(page_contexts)

    try:
        data = await llm.chat_json(system, user)
        fields_data = data.get("fields", {})
        result = {}
        for f in fields:
            fk = f["key"]
            fd = fields_data.get(fk, {})
            if isinstance(fd, dict):
                result[fk] = {
                    "value": fd.get("value", "信息不足"),
                    "confidence": fd.get("confidence", "low"),
                    "source_url": fd.get("source_url", ""),
                }
            else:
                # LLM 可能直接返回字符串值
                result[fk] = {
                    "value": str(fd) if fd else "信息不足",
                    "confidence": "medium",
                    "source_url": top_pages[0]["url"] if top_pages else "",
                }
        return result
    except Exception as exc:
        logger.warning("stage2 extract dim %s failed: %s", dim_def["key"], exc)
        return {}


# ---------------------------------------------------------------------------
# 格式归一化
# ---------------------------------------------------------------------------

def _normalize_dimensions(
    raw_dimensions: dict,
    dim_label_map: dict[str, str] | None = None,
) -> dict:
    """将所有路径的维度数据归一化为 {field_key: {v, c, s}} 格式。

    处理三种输入：
      1. 纯文本字符串（research 路径）→ 包装为 {v, c: "medium", s: ""}
      2. {value, confidence, source_url} 对象（crawl Stage 2 输出）→ 改为 {v, c, s}
      3. 嵌套结构对象（product_intel 路径的 product_catalog 等）→ 保留原样，不归一化
      4. {"_info": "信息不足"}（product_intel 缺失维度）→ 转为 {v: "信息不足", c: "low", s: ""}
    """
    normalized = {}
    for dim_key, fields in raw_dimensions.items():
        if not isinstance(fields, dict):
            # 非 dict 值（如数组、字符串）保留原样
            normalized[dim_key] = fields
            continue
        normalized[dim_key] = {}
        for fk, fv in fields.items():
            if isinstance(fv, str):
                # 情况 1：纯文本 → 包装为对象
                normalized[dim_key][fk] = {
                    "v": fv if fv else "信息不足",
                    "c": "medium",
                    "s": "",
                }
            elif isinstance(fv, dict):
                if "v" in fv:
                    # 情况 2：已是 {v, c, s} 格式（crawl Stage 2 输出）
                    normalized[dim_key][fk] = {
                        "v": fv.get("v", "信息不足"),
                        "c": fv.get("c", fv.get("confidence", "medium")),
                        "s": fv.get("s", fv.get("source_url", "")),
                    }
                elif "_info" in fv:
                    # 情况 4：product_intel 的缺失标记
                    normalized[dim_key][fk] = {"v": "信息不足", "c": "low", "s": ""}
                else:
                    # 情况 3：嵌套结构对象（product_catalog、price_list 等）
                    # 这些是设计为结构化展示的维度，保留原始结构
                    normalized[dim_key][fk] = fv
            else:
                # 其他类型（数字、布尔值等）包装为对象
                normalized[dim_key][fk] = {"v": str(fv), "c": "medium", "s": ""}
    return normalized


# ---------------------------------------------------------------------------
# Stage 3: 聚合 + 冲突检测 + 置信度评分
# ---------------------------------------------------------------------------

def _stage3_aggregate(
    dim_results: dict[str, dict[str, Any]],
    competitor_name: str,
) -> tuple[dict[str, Any], str]:
    """聚合各维度提取结果，检测冲突，生成 summary。

    返回的字段值为 {v, c, s} 对象格式。
    """
    dimensions = {}
    conflict_count = 0
    high_count = 0
    total_fields = 0

    for dim_key, fields in dim_results.items():
        dim_data = {}
        for fk, fd in fields.items():
            val = fd.get("value", "信息不足")
            conf = fd.get("confidence", "low")
            src = fd.get("source_url", "")
            dim_data[fk] = {"v": val, "c": conf, "s": src}
            total_fields += 1
            if conf == "high":
                high_count += 1
            if isinstance(val, str) and val.startswith("存在差异"):
                conflict_count += 1

        dimensions[dim_key] = dim_data

    # 统计已填充字段数（v 不为空且不是"信息不足"）
    filled = sum(
        1
        for d in dimensions.values()
        for v in d.values()
        if isinstance(v, dict) and v.get("v", "") not in ("", "信息不足")
    )
    if total_fields == 0:
        summary = f"未能从官网提取到 {competitor_name} 的结构化信息，建议补充调研来源。"
    elif conflict_count > 0:
        summary = (
            f"已完成 {competitor_name} 的画像提取，"
            f"共 {filled}/{total_fields} 个字段有值，"
            f"{conflict_count} 个字段存在多来源差异，建议人工复核。"
        )
    else:
        summary = (
            f"已完成 {competitor_name} 的画像提取，"
            f"共 {filled}/{total_fields} 个字段有值，"
            f"其中 {high_count} 个字段置信度较高。"
        )

    return dimensions, summary


# ---------------------------------------------------------------------------
# 主函数：从爬取页面生成画像
# ---------------------------------------------------------------------------

async def generate_profile_from_crawl_data(
    competitor_id: str,
    template_id: str,
    user_id: str = "",
    on_progress=None,
) -> dict:
    """
    三阶段 LLM 提取：从 CompetitorPage 生成 CompetitorProfile。

    返回 {id, status, profile_data, source_refs, generation_source: "crawl"}
    """
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")

        dimensions = json.loads(template.dimensions)
        pages = (
            db.query(CompetitorPage)
            .filter(CompetitorPage.competitor_id == competitor_id, CompetitorPage.access_status == "success")
            .order_by(CompetitorPage.crawled_at.desc().nullslast())
            .all()
        )

        if not pages:
            raise ValueError("该竞品暂无爬取页面，请先执行爬取")

        # 转为 dict 列表
        page_dicts = [
            {
                "url": p.url,
                "title": p.title,
                "page_type": p.page_type,
                "content_text": p.content_text,
                "content_html": p.content_html,
            }
            for p in pages
        ]

        org_id = competitor.org_id
        competitor_name = competitor.name

    llm = LLMClient(user_id=user_id, org_id=org_id)

    # Stage 1: 页面摘要化
    if on_progress:
        on_progress("正在提取页面摘要（阶段 1/3）...")
    logger.info("extract profile stage1: %d pages for %s", len(page_dicts), competitor_id)
    summarized = await _stage1_summarize_pages(page_dicts, dimensions, competitor_name)

    if not summarized:
        raise ValueError("所有页面提取摘要失败，请检查爬取内容")

    # 建立 url -> full page 的映射
    full_pages = {p["url"]: p for p in page_dicts}

    # Stage 2: 按维度提取（并行）
    if on_progress:
        on_progress(f"正在逐维度提取结构化数据（阶段 2/3，共 {len(dimensions)} 个维度）...")
    logger.info("extract profile stage2: %d dimensions for %s", len(dimensions), competitor_id)
    dim_results: dict[str, dict[str, Any]] = {}

    # 维度间无依赖，并发执行（限制 3 路并发避免 LLM 限流）
    semaphore_stage2 = asyncio.Semaphore(3)
    completed_dims = {"count": 0}

    async def _extract_dim(dim: dict) -> tuple[str, dict]:
        async with semaphore_stage2:
            completed_dims["count"] += 1
            if on_progress:
                on_progress(f"正在提取维度「{dim['label']}」({completed_dims['count']}/{len(dimensions)})...")
            result = await _stage2_extract_dimension(dim, summarized, full_pages, competitor_name)
            return dim["key"], result

    dim_pairs = await asyncio.gather(
        *[_extract_dim(d) for d in dimensions],
        return_exceptions=True,
    )
    dim_results: dict[str, dict] = {}
    for dim, pair in zip(dimensions, dim_pairs):
        if isinstance(pair, Exception):
            logger.warning("stage2 dim '%s' failed: %s", dim["key"], pair)
            dim_results[dim["key"]] = {}  # 该维度标记为空，继续 Stage 3
        else:
            dim_results[dim["key"]] = pair[1]

    # Stage 3: 聚合
    if on_progress:
        on_progress("正在聚合结果（阶段 3/3）...")
    logger.info("extract profile stage3: aggregating")
    profile_data, summary = _stage3_aggregate(dim_results, competitor_name)

    # 构建 source_refs（引用具体页面）
    source_refs = [
        {
            "url": s["url"],
            "title": s["title"],
            "snippet": s["summary"][:200],
            "page_type": s["page_type"],
            "confidence": s["confidence"],
        }
        for s in summarized[:15]
    ]

    # 落库
    with SessionLocal() as db:
        profile = CompetitorProfile(
            org_id=org_id,
            user_id=user_id,
            competitor_id=competitor_id,
            template_id=template_id,
            template_version=template.version,
            profile_data=json.dumps({"dimensions": profile_data, "summary": summary}, ensure_ascii=False),
            source_refs=json.dumps(source_refs, ensure_ascii=False),
            status="draft",
            generation_source="crawl",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    result = {
        "id": profile.id,
        "status": profile.status,
        "profile_data": {"dimensions": profile_data, "summary": summary},
        "source_refs": source_refs,
        "generation_source": "crawl",
    }
    return result


# ---------------------------------------------------------------------------
# 后台任务模式（数据库持久化）
# ---------------------------------------------------------------------------

# 内存缓存：用于正在运行的任务快速访问（进程重启后需从 DB 恢复）
_EXTRACT_TASKS_MAX = 100  # 最大内存缓存数
_generation_tasks: dict[str, "ProfileGenerationTask"] = {}
_extract_lock = threading.Lock()


def _cleanup_generation_cache() -> None:
    """清理内存中已完成/失败的任务缓存"""
    with _extract_lock:
        to_remove = [
            tid for tid, task in _generation_tasks.items()
            if task.status in ("done", "error")
        ]
        for tid in to_remove:
            _generation_tasks.pop(tid, None)
        if to_remove:
            logger.info("cleaned %d extract tasks from memory cache", len(to_remove))


class ProfileGenerationTask:
    """画像提取任务（用于后台执行 + 状态跟踪）"""

    def __init__(self, task_id: str, competitor_id: str, template_id: str, user_id: str, org_id: str = ""):
        self.task_id = task_id
        self.competitor_id = competitor_id
        self.template_id = template_id
        self.user_id = user_id
        self.org_id = org_id
        self.status = "pending"
        self.current_step = ""
        self.result: dict | None = None
        self.error: str = ""
        self.created_at = utcnow()
        self.updated_at = utcnow()


def get_profile_generation_task(task_id: str) -> ProfileGenerationTask | None:
    """获取任务状态：优先内存，回退到数据库（支持进程重启恢复）"""
    with _extract_lock:
        if task_id in _generation_tasks:
            cached = _generation_tasks[task_id]
            # 如果缓存中的任务已完成/失败，允许 DB 覆盖（处理进程重启场景）
            if cached.status not in ("done", "error"):
                return cached
            # 否则释放锁，从 DB 重新加载
        if len(_generation_tasks) > _EXTRACT_TASKS_MAX:
            _cleanup_generation_cache()

    # 从数据库恢复
    with SessionLocal() as db:
        row = db.get(ProfileGenerationTaskModel, task_id)
        if not row:
            return None

        task = ProfileGenerationTask(
            task_id=row.id,
            competitor_id=row.competitor_id,
            template_id=row.template_id,
            user_id=row.user_id,
            org_id=row.org_id,
        )
        task.status = row.status
        task.current_step = row.current_step
        task.error = row.error
        task.created_at = row.created_at
        task.updated_at = row.updated_at
        if row.result:
            try:
                task.result = json.loads(row.result)
            except json.JSONDecodeError:
                task.result = None

        # 覆盖旧缓存（DB 是权威数据源）
        with _extract_lock:
            _generation_tasks[task_id] = task

        return task


def _db_write_retry(fn, retries: int = 5, delay: float = 3.0):
    last_err = None
    for attempt in range(retries):
        try:
            fn()
            return
        except Exception as exc:
            last_err = exc
            if "database is locked" in str(exc).lower() and attempt < retries - 1:
                logger.warning("DB locked, retry %d/%d in %.0fs", attempt + 1, retries, delay)
                time.sleep(delay)
            else:
                raise
    raise last_err  # type: ignore[misc]


def _persist_generation_task(task: ProfileGenerationTask) -> None:
    """将任务状态写入数据库（UPSERT），带 SQLite 锁重试"""
    def _do_persist() -> None:
        with SessionLocal() as db:
            row = db.get(ProfileGenerationTaskModel, task.task_id)
            if row:
                row.status = task.status
                row.current_step = task.current_step
                row.result = json.dumps(task.result, ensure_ascii=False) if task.result else ""
                row.error = task.error[:500]
                row.updated_at = utcnow()
            else:
                row = ProfileGenerationTaskModel(
                    id=task.task_id,
                    competitor_id=task.competitor_id,
                    template_id=task.template_id,
                    user_id=task.user_id,
                    org_id=task.org_id,
                    status=task.status,
                    current_step=task.current_step,
                    result=json.dumps(task.result, ensure_ascii=False) if task.result else "",
                    error=task.error[:500],
                )
                db.add(row)
            db.commit()

    _db_write_retry(_do_persist)


async def _run_profile_generation_task(task_id: str) -> None:
    task = _generation_tasks.get(task_id)
    if not task:
        return
    task.status = "running"
    task.current_step = "正在准备分析..."
    task.updated_at = utcnow()
    _persist_generation_task(task)

    def _on_progress(step: str) -> None:
        task.current_step = step
        task.updated_at = utcnow()
        _persist_generation_task(task)

    pregen_error = None
    try:
        # Use generate_profile (research -> product_intel -> crawl fallback chain)
        from app.services.profiles import generate_profile
        result = await generate_profile(
            task.competitor_id, task.template_id, user_id=task.user_id,
        )
        task.result = result

        # Pre-generate report and insights BEFORE marking done, so the
        # frontend can render all tabs without on-demand LLM calls.
        profile_id = result.get("id")
        if profile_id:
            try:
                _on_progress("正在生成画像报告…")
                from app.services.profile_report import generate_profile_report
                report_data = await generate_profile_report(profile_id, task.user_id, result.get("org_id", ""))
                report_markdown = report_data.get("report_markdown", "")
                source_index = report_data.get("source_index", [])
                quality = report_data.get("quality", {})

                _on_progress("正在分析洞察数据…")
                from app.services.profile_report import generate_profile_insights
                insights = await generate_profile_insights(profile_id, task.user_id, result.get("org_id", ""))

                # Persist pre-generated content into independent columns
                with SessionLocal() as db:
                    p = db.get(CompetitorProfile, profile_id)
                    if p:
                        raw = p.profile_data or "{}"
                        pd = json.loads(raw) if isinstance(raw, str) else dict(raw)
                        if report_markdown:
                            pd["report_markdown"] = report_markdown
                        if source_index:
                            pd["source_index"] = source_index
                        if quality:
                            pd["report_quality"] = quality
                        pd["insights"] = insights
                        p.profile_data = json.dumps(pd, ensure_ascii=False)
                        p.report_markdown = report_markdown or ""
                        p.insights_json = json.dumps(insights, ensure_ascii=False) if insights else ""
                        p.source_index_json = json.dumps(source_index, ensure_ascii=False) if source_index else "[]"
                        db.commit()
                        logger.info("pre-generated report+insights for profile %s", profile_id)
            except Exception as exc:
                logger.warning("pre-generation for profile %s failed: %s", profile_id, exc)
                pregen_error = str(exc)[:500]

        # Mark done only after report+insights pre-generation finishes
        task.status = "done"
        if pregen_error:
            task.current_step = "画像生成完成，但报告/洞察预生成失败"
            task.error = pregen_error
        else:
            task.current_step = "画像生成完成"
    except Exception as exc:
        logger.exception("extract task %s failed", task_id)
        task.error = str(exc)[:500]
        task.status = "error"
        task.current_step = ""
    finally:
        task.updated_at = utcnow()
        _persist_generation_task(task)
        # 延迟清理内存：确保 post-processing 完成后再清除
        with _extract_lock:
            _generation_tasks.pop(task_id, None)


def create_profile_generation_task(competitor_id: str, template_id: str, user_id: str, org_id: str = "") -> ProfileGenerationTask:
    """创建并启动后台提取任务（状态持久化到数据库）"""
    from app.db.models import _uuid
    task = ProfileGenerationTask(
        task_id=_uuid(),
        competitor_id=competitor_id,
        template_id=template_id,
        user_id=user_id,
        org_id=org_id,
    )
    with _extract_lock:
        _generation_tasks[task.task_id] = task
    # 立即持久化，确保进程崩溃后也能恢复
    _persist_generation_task(task)
    asyncio.get_running_loop().create_task(_run_profile_generation_task(task.task_id))
    return task


def recover_orphaned_generation_tasks() -> list[ProfileGenerationTask]:
    """从数据库恢复仍在运行但进程重启后丢失内存状态的任务，并重新启动它们"""
    recovered = []
    with SessionLocal() as db:
        stale = (
            db.query(ProfileGenerationTaskModel)
            .filter(ProfileGenerationTaskModel.status.in_(["pending", "running"]))
            .all()
        )
        for row in stale:
            # 幂等性检查：已有结果的任务不再重跑
            if row.result and row.result.strip():
                row.status = "done"
                db.commit()
                logger.info("skipping stale extract task %s — already has result", row.id)
                continue

            # 幂等性检查：任务已在内存中运行中，跳过
            with _extract_lock:
                in_memory = row.id in _generation_tasks and _generation_tasks[row.id].status in ("pending", "running")
            if in_memory:
                logger.info("skipping stale extract task %s — already in memory", row.id)
                continue
            task = ProfileGenerationTask(
                task_id=row.id,
                competitor_id=row.competitor_id,
                template_id=row.template_id,
                user_id=row.user_id,
                org_id=row.org_id,
            )
            task.status = row.status
            task.current_step = row.current_step
            task.error = row.error
            task.created_at = row.created_at
            task.updated_at = row.updated_at
            if row.result:
                try:
                    task.result = json.loads(row.result)
                except json.JSONDecodeError:
                    pass

            with _extract_lock:
                _generation_tasks[task.task_id] = task
            # 重新启动后台任务
            asyncio.get_running_loop().create_task(_run_profile_generation_task(task.task_id))
            recovered.append(task)
            logger.info("recovered stale extract task %s for competitor %s", task.task_id, task.competitor_id)

    return recovered
