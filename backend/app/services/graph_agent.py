"""产业链关系图谱构建 Agent：规划 -> 检索 -> LLM 抽取实体与关系 -> 去重落库

复用 LLMClient / SearchClient / timeutil。在后台任务中执行，全程 try/except，
失败时把错误写入 GraphProject.error 并置 status=failed。
"""

import logging
import re

from app.core.timeutil import baseline_now
from app.db.database import SessionLocal
from app.db.models import GraphEntity, GraphProject, GraphRelation

logger = logging.getLogger(__name__)

MAX_QUERIES = 6
MAX_RESULTS_PER_QUERY = 5
SNIPPET_LIMIT = 800

ENTITY_TYPES = ("company", "product", "org", "person")
RELATION_TYPES = (
    "upstream_supplier",
    "downstream_customer",
    "competitor",
    "partner",
    "investor",
    "parent",
    "subsidiary",
)

# 关系类型 -> 中文标签（用于报告文本可读性）
RELATION_LABELS = {
    "upstream_supplier": "上游供应商",
    "downstream_customer": "下游客户",
    "competitor": "竞争对手",
    "partner": "合作伙伴",
    "investor": "投资方",
    "parent": "母公司",
    "subsidiary": "子公司",
}


def _norm(name: str) -> str:
    """归一化实体名用于去重：去空格与符号、小写"""
    return re.sub(r"[\s\u3000]+", "", str(name or "").strip()).lower()


def _set_status(project_id: str, status: str, error: str = "") -> None:
    with SessionLocal() as db:
        p = db.get(GraphProject, project_id)
        if p:
            p.status = status
            if error:
                p.error = error[:1000]
            db.commit()


async def _plan_queries(llm, project: GraphProject) -> list[dict]:
    """规划多维度检索词（供应链上下游/竞争/合作/投资）"""
    date_hint = f"当前日期 {baseline_now():%Y-%m-%d}。"
    industry = f"（行业：{project.industry}）" if project.industry else ""
    system = (
        date_hint
        + "你是一名产业链分析师。用户给出一个核心企业/产品，你需要规划检索词，"
        "以便发现它的产业链关系网络，覆盖以下维度：上游供应商、下游客户、竞争对手、合作伙伴、投资方/母子公司。\n"
        "输出 JSON：{\"queries\": [{\"dimension\": \"维度名\", \"query\": \"检索关键词\"}]}，"
        f"queries 不超过 {MAX_QUERIES} 条，关键词具体、适合搜索引擎，必要时带年份体现时效。"
    )
    user = f"核心对象：{project.root_name}{industry}"
    try:
        plan = await llm.chat_json(system, user)
        queries = [q for q in plan.get("queries", []) if str(q.get("query", "")).strip()]
        if queries:
            return queries[:MAX_QUERIES]
    except Exception as exc:
        logger.warning("graph plan failed, fallback to defaults: %s", exc)
    # 兜底：确定性检索词
    base = project.root_name
    suffix = f" {project.industry}" if project.industry else ""
    return [
        {"dimension": "上游供应商", "query": f"{base}{suffix} 供应商 上游"},
        {"dimension": "下游客户", "query": f"{base}{suffix} 客户 下游 应用"},
        {"dimension": "竞争对手", "query": f"{base}{suffix} 竞争对手 对比"},
        {"dimension": "合作伙伴", "query": f"{base}{suffix} 合作伙伴 战略合作"},
        {"dimension": "投资与股权", "query": f"{base} 投资方 母公司 子公司 股东"},
    ]


async def _collect(searcher, queries: list[dict], time_range: str) -> list[dict]:
    """并发检索所有维度，按 URL 去重"""
    import asyncio

    async def one(q: dict) -> list[dict]:
        query = str(q.get("query", "")).strip()
        if not query:
            return []
        try:
            results = await searcher.search(query, max_results=MAX_RESULTS_PER_QUERY, time_range=time_range)
            for r in results:
                r["dimension"] = str(q.get("dimension", "")).strip()
            return results
        except Exception as exc:
            logger.warning("graph search failed for %r: %s", query, exc)
            return []

    grouped = await asyncio.gather(*(one(q) for q in queries))
    seen: set[str] = set()
    merged: list[dict] = []
    for results in grouped:
        for r in results:
            if r.get("url") and r["url"] not in seen:
                seen.add(r["url"])
                merged.append(r)
    return merged


def _build_materials(results: list[dict]) -> str:
    lines = []
    for i, r in enumerate(results, 1):
        meta = f"维度: {r.get('dimension') or '综合'}"
        if r.get("published_date"):
            meta += f" | 发布: {r['published_date']}"
        lines.append(
            f"[{i}] {r.get('title', '')}\nURL: {r.get('url', '')}\n{meta}\n"
            f"内容: {str(r.get('content', ''))[:SNIPPET_LIMIT]}\n"
        )
    return "\n".join(lines)


async def _extract(llm, project: GraphProject, materials: str) -> dict:
    """从检索材料中抽取实体与关系"""
    date_hint = f"当前日期 {baseline_now():%Y-%m-%d}。"
    system = (
        date_hint
        + "你是一名产业链关系抽取专家。基于给出的检索材料，抽取以核心对象为中心的产业链关系网络，输出 JSON：\n"
        '{"entities": [{"name": "实体名", "type": "company|product|org|person", "industry": "所属行业", "description": "一句话简介"}],\n'
        ' "relations": [{"source": "关系起点实体名", "target": "关系终点实体名", "relation_type": "关系类型", "description": "关系依据说明", "confidence": 0.8, "source_ref": 3}]}\n'
        "关系类型 relation_type 取值（均相对于 source 指向 target）：\n"
        "- upstream_supplier：target 是 source 的上游供应商\n"
        "- downstream_customer：target 是 source 的下游客户\n"
        "- competitor：两者为竞争对手\n"
        "- partner：合作伙伴\n"
        "- investor：target 是 source 的投资方\n"
        "- parent：target 是 source 的母公司\n"
        "- subsidiary：target 是 source 的子公司\n"
        "硬性要求：\n"
        "1. entities 必须包含核心对象本身；只抽取材料中有依据的实体与关系，不得编造；\n"
        "2. 每条关系必须给出 source_ref（单个整数，对应作为依据的材料编号 [n]），confidence 为 0~1 的置信度；\n"
        "3. 关系的 source/target 必须是 entities 中出现过的名称；\n"
        "4. 实体不超过 40 个，关系不超过 60 条。"
    )
    user = f"核心对象：{project.root_name}\n\n检索材料：\n{materials}"
    return await llm.chat_json(system, user)


def _parse_ref(ref) -> int | None:
    """从 LLM 返回的 source_ref 中解析出材料编号，容错 int/float/str/list 等多种格式

    兼容：3 / 3.0 / "3" / "[3]" / "材料3" / [3] / ["3"] 等，取第一个出现的整数。
    """
    if isinstance(ref, (list, tuple)):
        ref = ref[0] if ref else None
    if isinstance(ref, bool):
        return None
    if isinstance(ref, (int, float)):
        return int(ref)
    if isinstance(ref, str):
        m = re.search(r"\d+", ref)
        if m:
            return int(m.group())
    return None


def _save(project_id: str, root_name: str, data: dict, results: list[dict]) -> tuple[int, int]:
    """将抽取结果去重落库，返回 (实体数, 关系数)"""
    url_by_ref: dict[int, str] = {}
    for i, r in enumerate(results, 1):
        url_by_ref[i] = r.get("url", "")

    raw_entities = data.get("entities") if isinstance(data, dict) else None
    raw_relations = data.get("relations") if isinstance(data, dict) else None
    raw_entities = raw_entities if isinstance(raw_entities, list) else []
    raw_relations = raw_relations if isinstance(raw_relations, list) else []

    with SessionLocal() as db:
        name_to_id: dict[str, str] = {}

        def ensure_entity(name: str, etype: str = "company", industry: str = "", desc: str = "", is_root: bool = False) -> str | None:
            key = _norm(name)
            if not key:
                return None
            if key in name_to_id:
                return name_to_id[key]
            etype = etype if etype in ENTITY_TYPES else "company"
            ent = GraphEntity(
                project_id=project_id,
                name=str(name)[:200],
                type=etype,
                industry=str(industry or "")[:100],
                description=str(desc or "")[:2000],
                is_root=is_root,
            )
            db.add(ent)
            db.flush()  # 拿到 id
            name_to_id[key] = ent.id
            return ent.id

        # 根实体优先
        ensure_entity(root_name, "company", "", "", is_root=True)
        for e in raw_entities:
            if isinstance(e, dict):
                ensure_entity(
                    e.get("name", ""),
                    str(e.get("type", "company")),
                    e.get("industry", ""),
                    e.get("description", ""),
                    is_root=(_norm(e.get("name", "")) == _norm(root_name)),
                )

        rel_count = 0
        seen_rel: set[tuple[str, str, str]] = set()
        for rel in raw_relations:
            if not isinstance(rel, dict):
                continue
            sid = ensure_entity(rel.get("source", ""))
            tid = ensure_entity(rel.get("target", ""))
            if not sid or not tid or sid == tid:
                continue
            rtype = str(rel.get("relation_type", "partner"))
            if rtype not in RELATION_TYPES:
                rtype = "partner"
            dedup_key = (sid, tid, rtype)
            if dedup_key in seen_rel:
                continue
            seen_rel.add(dedup_key)
            try:
                conf = float(rel.get("confidence", 0.6))
            except (TypeError, ValueError):
                conf = 0.6
            conf = max(0.0, min(1.0, conf))
            ref = _parse_ref(rel.get("source_ref"))
            src_url = url_by_ref.get(ref, "") if ref is not None else ""
            db.add(
                GraphRelation(
                    project_id=project_id,
                    source_id=sid,
                    target_id=tid,
                    relation_type=rtype,
                    description=str(rel.get("description", ""))[:2000],
                    confidence=round(conf, 3),
                    source_url=str(src_url or "")[:1000],
                )
            )
            rel_count += 1

        db.commit()
        return len(name_to_id), rel_count


def _save_report(project_id: str, markdown: str) -> None:
    with SessionLocal() as db:
        p = db.get(GraphProject, project_id)
        if p:
            p.report_markdown = markdown
            db.commit()


async def _report(llm, project: GraphProject, data: dict, results: list[dict]) -> str:
    """根据抽取出的实体/关系与检索材料，生成一份关系网络分析报告（Markdown）"""
    entities = data.get("entities") if isinstance(data, dict) else None
    relations = data.get("relations") if isinstance(data, dict) else None
    entities = entities if isinstance(entities, list) else []
    relations = relations if isinstance(relations, list) else []

    ent_lines = []
    for e in entities:
        if not isinstance(e, dict):
            continue
        name = str(e.get("name", "")).strip()
        if not name:
            continue
        etype = str(e.get("type", "")).strip()
        industry = str(e.get("industry", "")).strip()
        desc = str(e.get("description", "")).strip()
        meta = " / ".join(x for x in (etype, industry) if x)
        ent_lines.append(f"- {name}{f'（{meta}）' if meta else ''}：{desc}")

    rel_lines = []
    for r in relations:
        if not isinstance(r, dict):
            continue
        src = str(r.get("source", "")).strip()
        tgt = str(r.get("target", "")).strip()
        if not src or not tgt:
            continue
        label = RELATION_LABELS.get(str(r.get("relation_type", "")), "关联")
        desc = str(r.get("description", "")).strip()
        ref = r.get("source_ref")
        ref_txt = f" [{ref}]" if isinstance(ref, (int, float)) or (isinstance(ref, str) and str(ref).isdigit()) else ""
        rel_lines.append(f"- {src} —（{label}）→ {tgt}：{desc}{ref_txt}")

    source_list = "\n".join(f"[{i}] {r.get('title', '')} - {r.get('url', '')}" for i, r in enumerate(results, 1))
    date_hint = f"当前日期 {baseline_now():%Y-%m-%d}。"
    system = (
        date_hint
        + "你是一名资深的产业链与竞争情报分析师。请基于给出的关系网络（实体清单与关系清单）和检索材料，"
        "撰写一份结构化的中文 Markdown 分析报告，详细说明该关系网络的情况，包含以下章节：\n"
        "1. 概述（核心对象与关系网络整体情况）\n"
        "2. 核心对象定位（所属行业、在产业链中的位置）\n"
        "3. 上游供应链\n4. 下游客户与应用市场\n5. 竞争格局\n"
        "6. 合作、投资与股权关系\n7. 关键洞察与风险提示\n8. 信息来源（沿用给出的编号与链接）\n"
        "硬性要求：\n"
        "- 仅依据给出的实体、关系与检索材料撰写，不得编造；某维度缺乏材料时如实说明；\n"
        "- 正文论断处保留 [n] 引用标注，直接写 [n] 纯文本，不要写成 Markdown 链接；\n"
        "- 使用中文，直接输出 Markdown 正文，不要用代码块包裹。"
    )
    user = (
        f"核心对象：{project.root_name}"
        + (f"（行业：{project.industry}）" if project.industry else "")
        + "\n\n实体清单：\n"
        + ("\n".join(ent_lines) or "（无）")
        + "\n\n关系清单：\n"
        + ("\n".join(rel_lines) or "（无）")
        + f"\n\n信息来源列表：\n{source_list}"
    )
    return await llm.chat(system, user, temperature=0.4)


async def build_graph(project_id: str) -> None:
    """后台执行图谱构建全流程"""
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.llm_api_key or not settings.llm_base_url or not settings.tavily_api_key:
        _set_status(project_id, "failed", "缺少 LLM / Tavily 配置，请在 backend/.env 中填写")
        return

    with SessionLocal() as db:
        project = db.get(GraphProject, project_id)
        if not project:
            return
        db.expunge(project)

    try:
        _set_status(project_id, "building")
        from app.services.llm import LLMClient
        from app.services.search import SearchClient

        llm = LLMClient()
        searcher = SearchClient()
        queries = await _plan_queries(llm, project)
        results = await _collect(searcher, queries, (project.time_range or "").strip())
        if not results:
            raise ValueError("联网检索未获取到任何结果，请检查 TAVILY_API_KEY 或稍后重试")
        materials = _build_materials(results)
        data = await _extract(llm, project, materials)
        n_ent, n_rel = _save(project_id, project.root_name, data, results)
        if n_ent <= 1 and n_rel == 0:
            raise ValueError("未能从检索材料中抽取到有效的关系网络，请尝试补充行业或调整时效")
        # 生成关系网络分析报告（非阻断：失败不影响图谱本身完成）
        try:
            report = await _report(llm, project, data, results)
            if report.strip():
                _save_report(project_id, report)
        except Exception as exc:
            logger.warning("graph report generation failed for %s (non-blocking): %s", project_id, exc)
        _set_status(project_id, "completed")
        logger.info("graph %s built: %d entities, %d relations", project_id, n_ent, n_rel)
    except Exception as exc:
        logger.exception("graph build failed for %s", project_id)
        _set_status(project_id, "failed", str(exc))
