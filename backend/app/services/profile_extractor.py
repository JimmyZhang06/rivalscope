"""从爬取的竞品官网页面中提取结构化画像数据（单次 LLM 直接提取）

任务状态持久化到数据库，进程重启后可从 DB 恢复进行中的任务。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from typing import Any

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CompetitorProfile, ProfileTemplate
from app.db.models import ProfileExtractTask as ProfileExtractTaskModel
from app.services.llm import LLMClient

logger = logging.getLogger(__name__)

# 页面类型优先级：值越小越优先（越有价值）
_PAGE_TYPE_PRIORITY: dict[str, int] = {
    "products": 0, "product": 0,
    "pricing": 1, "price": 1,
    "features": 2, "feature": 2,
    "solutions": 3,
    "about": 4,
    "customers": 5, "case_studies": 5, "case_study": 5,
    "enterprise": 6,
    "technology": 7,
    "company": 8,
    "docs": 9, "help": 9, "support": 9,
    "contact": 10, "faq": 10,
    "security": 11, "privacy": 11, "terms": 11,
    "home": 12,
    "news": 13, "press": 13,
    "other": 99,
}
_MAX_PAGES_DIRECT = 10       # 直接提取模式最多用多少页
_MAX_CHARS_PER_PAGE = 8000   # 每页正文截断


# ---------------------------------------------------------------------------
# 直接提取：单次 LLM 调用，跳过三阶段流水线
# ---------------------------------------------------------------------------

def _select_best_pages(
    competitor_id: str, limit: int = _MAX_PAGES_DIRECT
) -> list[CompetitorPage]:
    """按页面类型价值排序，选取最能提供画像信息的页面。"""
    with SessionLocal() as db:
        pages = (
            db.query(CompetitorPage)
            .filter(
                CompetitorPage.competitor_id == competitor_id,
                CompetitorPage.access_status == "success",
                CompetitorPage.content_text.isnot(None),
            )
            .order_by(CompetitorPage.crawled_at.desc().nullslast())
            .all()
        )
    if not pages:
        return []

    # 过滤掉完全没有内容的页面（content_text 为空或只有空白字符）
    pages = [p for p in pages if (p.content_text or "").strip()]
    if not pages:
        return []

    # 先按页面类型价值排序，同类型内按内容长度降序（内容多的优先）
    def _sort_key(p: CompetitorPage) -> tuple[int, int]:
        type_priority = _PAGE_TYPE_PRIORITY.get(p.page_type or "other", 99)
        content_len = len((p.content_text or "").strip())
        return (type_priority, -content_len)

    pages.sort(key=_sort_key)
    return pages[:limit]


def _build_pages_context(pages: list[CompetitorPage]) -> str:
    """把页面列表拼接成 LLM prompt 用的上下文文本。"""
    parts: list[str] = []
    for i, p in enumerate(pages, 1):
        text = (p.content_text or "").strip()[:_MAX_CHARS_PER_PAGE]
        parts.append(
            f"=== 页面 {i} ===\n"
            f"标题：{p.title or '(无标题)'}\n"
            f"URL：{p.url}\n"
            f"类型：{p.page_type or 'other'}\n"
            f"内容：\n{text}"
        )
    return "\n\n".join(parts)


async def extract_profile_direct(
    competitor_id: str,
    template_id: str,
    user_id: str = "",
    on_progress=None,
) -> dict:
    """直接从爬取页面提取画像：单次 LLM 调用，给足原始材料。

    这是目前主要的画像提取路径。相比三阶段流水线：
    - 不给 LLM 看压缩后的摘要（信息损失大），直接给页面原文
    - 主动选最有价值的页面（products/pricing/features 优先）
    - 一次 LLM 调用完成提取，调试最直接
    """
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")
        dimensions = json.loads(template.dimensions)
        org_id = competitor.org_id
        competitor_name = competitor.name

    best_pages = _select_best_pages(competitor_id)
    if not best_pages:
        raise ValueError("该竞品暂无成功的爬取页面，请先执行爬取")

    logger.info(
        "direct extract: %d pages for %s, template has %d dimensions",
        len(best_pages), competitor_id, len(dimensions),
    )

    llm = LLMClient(user_id=user_id, org_id=org_id)

    pages_text = _build_pages_context(best_pages)
    dims_spec = json.dumps(dimensions, ensure_ascii=False, indent=2)

    system = (
        f"你是一个竞品分析专家。给定一个竞品（{competitor_name}）的官网页面信息，"
        f"请按照指定的维度定义，提取结构化画像信息。\n\n"
        f"【维度定义】\n{dims_spec}\n\n"
        "提取规则：\n"
        "1. 每个字段仅依据提供的页面信息提取，信息不足的标注「信息不足」，不得编造；\n"
        "2. 页面标题（如「锂电池货架火灾监测」「分布式光纤测温」）本身就是产品/服务名称，"
        "请从标题列表中归纳产品体系；\n"
        "3. 如果页面描述（content）与页面标题重复，不要重复引用，标题本身已包含核心信息；\n"
        "4. 每个字段必须返回一个对象，包含 value（字符串值）、confidence（high/medium/low）、source（来源页面编号，如 p1）；\n"
        "   【重要】即使信息不足，也必须返回 {{\"value\": \"信息不足\", \"confidence\": \"low\", \"source\": \"\"}}，不能省略字段；\n"
        "5. 多来源冲突时 value 标注「存在差异：A说X，B说Y」；\n"
        "6. 输出严格 JSON，不要用代码块包裹，不要输出其他内容。\n\n"
        "【JSON 格式示例】\n"
        '{"dimensions": {"产品概况": {"产品名称": {"value": "光纤测温系统", "confidence": "high", "source": "p3"}, '
        '"产品类别": {"value": "光纤传感", "confidence": "high", "source": "p1"}}}, '
        '"summary": "明圣电气是一家专注于光纤传感技术的高科技企业...", '
        '"filled_count": 2, "total_fields": 4}'
    )

    user = (
        f"竞品：{competitor_name}\n"
        f"官网：{competitor.website or '未知'}\n"
        f"技术领域：{competitor.tech_focus or '未知'}\n\n"
        f"【官网页面内容（共 {len(best_pages)} 页）】\n"
        f"{pages_text}"
    )

    try:
        data = await llm.chat_json(system, user)
    except Exception as exc:
        logger.error("direct extract LLM failed for %s: %s", competitor_id, exc)
        raise ValueError(f"AI 提取失败：{exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("AI 返回了非结构化数据，请重试")

    dimensions_out = data.get("dimensions", {})
    summary = data.get("summary", "")

    # 确保所有维度都有输出（缺失的填充空结构）
    for dim_def in dimensions:
        dk = dim_def["key"]
        if dk not in dimensions_out:
            dimensions_out[dk] = {
                f["key"]: {"value": "信息不足", "confidence": "low", "source": ""}
                for f in dim_def.get("fields", [])
            }

    # 兼容 LLM 返回纯字符串的情况（规范化每个字段为 {value, confidence, source}）
    for dim_def in dimensions:
        dk = dim_def["key"]
        dv = dimensions_out.get(dk, {})
        for f in dim_def.get("fields", []):
            fk = f["key"]
            existing = dv.get(fk)
            if isinstance(existing, str):
                # LLM 返回了纯字符串，包装成标准结构
                if existing and existing != "信息不足":
                    dv[fk] = {"value": existing, "confidence": "medium", "source": ""}
                else:
                    dv[fk] = {"value": "信息不足", "confidence": "low", "source": ""}

    # 统计填充率（LLM 可能不返回这两个字段，做兜底计算）
    filled_count = data.get("filled_count") or 0
    total_fields = data.get("total_fields") or 0
    if not total_fields:
        total_fields = sum(len(d.get("fields", [])) for d in dimensions)
    if not filled_count or filled_count > total_fields:
        filled_count = sum(
            1 for d in dimensions_out.values()
            for v in (d.values() if isinstance(d, dict) else [])
            if isinstance(v, dict) and v.get("value", "信息不足") not in ("信息不足", "")
        )

    source_refs = [
        {
            "url": p.url,
            "title": p.title,
            "snippet": (p.content_text or "")[:200],
            "page_type": p.page_type,
            "confidence": "high",
        }
        for p in best_pages[:15]
    ]

    profile_data = {
        "dimensions": dimensions_out,
        "summary": summary or f"已完成 {competitor_name} 的画像提取（基于 {len(best_pages)} 个官网页面）。",
        "filled_count": filled_count,
        "total_fields": total_fields,
        "pages_used": len(best_pages),
        "pages_total": len(best_pages),
    }

    with SessionLocal() as db:
        profile = CompetitorProfile(
            org_id=org_id,
            user_id=user_id,
            competitor_id=competitor_id,
            template_id=template_id,
            profile_data=json.dumps(profile_data, ensure_ascii=False),
            source_refs=json.dumps(source_refs, ensure_ascii=False),
            status="draft",
            generation_source="crawl",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return {
        "id": profile.id,
        "status": profile.status,
        "profile_data": profile_data,
        "source_refs": source_refs,
        "generation_source": "crawl",
    }


# ---------------------------------------------------------------------------
# 后台任务模式（数据库持久化）
# ---------------------------------------------------------------------------

# 内存缓存：用于正在运行的任务快速访问（进程重启后需从 DB 恢复）
_EXTRACT_TASKS_MAX = 100  # 最大内存缓存数
_extract_tasks: dict[str, "ExtractTask"] = {}
_extract_lock = threading.Lock()


def _cleanup_extract_cache() -> None:
    """清理内存中已完成/失败的任务缓存"""
    with _extract_lock:
        to_remove = [
            tid for tid, task in _extract_tasks.items()
            if task.status in ("done", "error")
        ]
        for tid in to_remove:
            _extract_tasks.pop(tid, None)
        if to_remove:
            logger.info("cleaned %d extract tasks from memory cache", len(to_remove))


class ExtractTask:
    """画像提取任务（用于后台执行 + 状态跟踪）"""

    def __init__(self, task_id: str, competitor_id: str, template_id: str, user_id: str, org_id: str = "", crawl_only: bool = False):
        self.task_id = task_id
        self.competitor_id = competitor_id
        self.template_id = template_id
        self.user_id = user_id
        self.org_id = org_id
        self.crawl_only = crawl_only  # True = 只用爬取页面，跳过搜索
        self.status = "pending"
        self.current_step = ""
        self.result: dict | None = None
        self.error: str = ""
        self.created_at = utcnow()
        self.updated_at = utcnow()


def get_extract_task(task_id: str) -> ExtractTask | None:
    """获取任务状态：优先内存，回退到数据库（支持进程重启恢复）"""
    with _extract_lock:
        if task_id in _extract_tasks:
            cached = _extract_tasks[task_id]
            # 如果缓存中的任务已完成/失败，允许 DB 覆盖（处理进程重启场景）
            if cached.status not in ("done", "error"):
                return cached
            # 否则释放锁，从 DB 重新加载
        if len(_extract_tasks) > _EXTRACT_TASKS_MAX:
            _cleanup_extract_cache()

    # 从数据库恢复
    with SessionLocal() as db:
        row = db.get(ProfileExtractTaskModel, task_id)
        if not row:
            return None

        task = ExtractTask(
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
            _extract_tasks[task_id] = task

        return task


def _persist_task(task: ExtractTask) -> None:
    """将任务状态写入数据库（UPSERT）"""
    with SessionLocal() as db:
        row = db.get(ProfileExtractTaskModel, task.task_id)
        if row:
            row.status = task.status
            row.current_step = task.current_step
            row.result = json.dumps(task.result, ensure_ascii=False) if task.result else ""
            row.error = task.error[:500]
            row.updated_at = utcnow()
        else:
            row = ProfileExtractTaskModel(
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


async def _run_extract_task(task_id: str) -> None:
    task = _extract_tasks.get(task_id)
    if not task:
        return
    task.status = "running"
    task.current_step = "正在准备分析..."
    task.updated_at = utcnow()
    _persist_task(task)

    def _on_progress(step: str) -> None:
        task.current_step = step
        task.updated_at = utcnow()
        _persist_task(task)

    try:
        if task.crawl_only:
            # 直接提取模式：只用已爬取的官网页面，跳过搜索
            _on_progress("正在分析爬取页面…")
            result = await extract_profile_direct(
                task.competitor_id, task.template_id, user_id=task.user_id,
            )
        else:
            # 综合模式：优先 ResearchTask 来源，回退到 product_intel + 爬取页面
            from app.services.profiles import generate_profile
            result = await generate_profile(
                task.competitor_id, task.template_id, user_id=task.user_id,
            )
        task.result = result

        # 先不标记 done，等报告和洞察也生成完再告诉前端可以查看了
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

                # Persist pre-generated content into profile_data so the frontend
                # can serve it directly from the cached profile without extra API calls.
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
                        db.commit()
                        logger.info("pre-generated report+insights for profile %s", profile_id)
            except Exception as exc:
                logger.warning("pre-generation for profile %s failed (non-blocking): %s", profile_id, exc)

        # 报告和洞察都完成后，才标记任务为 done
        task.status = "done"
        task.current_step = "画像生成完成"
    except Exception as exc:
        logger.exception("extract task %s failed", task_id)
        task.error = str(exc)[:500]
        task.status = "error"
        task.current_step = ""
    finally:
        task.updated_at = utcnow()
        _persist_task(task)
        # Remove from memory after completion (DB is the persistent store)
        with _extract_lock:
            _extract_tasks.pop(task_id, None)


def create_extract_task(competitor_id: str, template_id: str, user_id: str, org_id: str = "", crawl_only: bool = False) -> ExtractTask:
    """创建并启动后台提取任务（状态持久化到数据库）

    Args:
        crawl_only: True = 只用已爬取页面提取（跳过搜索）
    """
    from app.db.models import _uuid
    task = ExtractTask(
        task_id=_uuid(),
        competitor_id=competitor_id,
        template_id=template_id,
        user_id=user_id,
        org_id=org_id,
        crawl_only=crawl_only,
    )
    with _extract_lock:
        _extract_tasks[task.task_id] = task
    # 立即持久化，确保进程崩溃后也能恢复
    _persist_task(task)
    asyncio.get_running_loop().create_task(_run_extract_task(task.task_id))
    return task


def recover_stale_tasks() -> list[ExtractTask]:
    """从数据库恢复仍在运行但进程重启后丢失内存状态的任务，并重新启动它们"""
    recovered = []
    with SessionLocal() as db:
        stale = (
            db.query(ProfileExtractTaskModel)
            .filter(ProfileExtractTaskModel.status.in_(["pending", "running"]))
            .all()
        )
        for row in stale:
            # 幂等性检查：已有结果的任务不再重跑
            if row.result and row.result.strip():
                row.status = "done"
                row.current_step = "画像生成完成"
                db.commit()
                logger.info("skipping stale extract task %s — already has result", row.id)
                continue

            # 幂等性检查：任务已在内存中运行中，跳过
            with _extract_lock:
                in_memory = row.id in _extract_tasks and _extract_tasks[row.id].status in ("pending", "running")
            if in_memory:
                logger.info("skipping stale extract task %s — already in memory", row.id)
                continue
            task = ExtractTask(
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
                _extract_tasks[task.task_id] = task
            # 重新启动后台任务
            asyncio.get_running_loop().create_task(_run_extract_task(task.task_id))
            recovered.append(task)
            logger.info("recovered stale extract task %s for competitor %s", task.task_id, task.competitor_id)

    return recovered
