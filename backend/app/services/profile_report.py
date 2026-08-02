"""画像报告与洞察生成服务

负责两类内容的生成：
1. 叙事性 Markdown 报告（报告/洞察）
2. 结构化洞察数据（scores/SWOT/timeline/positioning）
"""

import json
import logging
from typing import Any

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import (
    Competitor,
    CompetitorPage,
    CompetitorProfile,
    GraphEntity,
    GraphProject,
    GraphRelation,
    ProfileTemplate,
    ResearchTask,
    Source,
)
from app.services.llm import LLMClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

async def generate_profile_report(profile_id: str, user_id: str, org_id: str) -> dict:
    """生成画像叙事性报告（Markdown）。

    数据获取优先级（每层尽力而为，跳过失败层继续下一层）：
      1. profile_data 中的 summary → 作为开篇
      2. 关联 research_tasks（通过 related_task_ids） → 提取 report_data + report_markdown
      3. competitor_pages → 提取 about/features/pricing/products 等页面文本
      4. sources → 提取 snippet / raw_content 作为引用素材
      5. graph_entities / graph_relations → 补充市场定位信息
    """
    profile = _load_profile(profile_id)
    if not profile:
        raise ValueError("画像不存在")

    competitor = _load_competitor(profile.competitor_id, org_id)
    template = _load_template(profile.template_id, org_id)

    profile_data = _parse_profile(profile)
    summary_text = _format_summary(profile_data.get("summary", ""))

    # 收集素材 + 来源索引
    materials, source_index = _collect_materials(profile, competitor, org_id)

    # 评估素材质量
    quality = _assess_quality(materials)

    llm = LLMClient(user_id=user_id, org_id=org_id)

    # 组装 prompt（动态规模）
    competitor_info = _format_competitor_info(competitor, template)
    materials_text = _format_materials(materials)[0]  # unpack (text, source_index)

    system_prompt, user_prompt = _build_report_prompt(quality, competitor_info, summary_text, materials_text)

    try:
        report_markdown = await llm.chat(system_prompt, user_prompt, temperature=0.3)
    except Exception as exc:
        logger.error("LLM report generation failed for profile %s: %s", profile_id, exc)
        # 兜底：用素材拼接一个简化报告
        report_markdown = _fallback_report(competitor, profile_data.get("summary", ""), materials)

    # 兜底二次保险：如果 fallback 也产生空内容，至少返回有意义的提示
    if not report_markdown or not report_markdown.strip():
        report_markdown = (
            f"# {competitor.name if competitor else '竞品'} 竞品画像报告\n\n"
            "> 当前可用素材不足，无法生成完整报告。\n"
            "> 建议：为该竞品执行爬取或调研任务以获取更多信息。\n"
        )

    return {
        "report_markdown": report_markdown,
        "source_index": source_index,
        "quality": quality,
        "insights": None,
    }


async def generate_profile_insights(profile_id: str, user_id: str, org_id: str) -> dict:
    """生成画像洞察数据（scores/SWOT/timeline/positioning）。

    数据获取优先级（与报告相同）：
      1. 关联 research_task 的 report_data → 直接提取 scores/swot/timeline
      2. profile_data 中的维度数据 → 作为 LLM 分析的输入
      3. 若已持久化 insights → 直接返回
    """
    profile = _load_profile(profile_id)
    if not profile:
        raise ValueError("画像不存在")

    competitor = _load_competitor(profile.competitor_id, org_id)
    template = _load_template(profile.template_id, org_id)

    profile_data = _parse_profile(profile)
    dimensions = profile_data.get("dimensions", {})

    # 优先从已持久化的 insights 返回
    cached = profile_data.get("insights")
    if cached and isinstance(cached, dict) and cached.get("scores"):
        return cached

    # 优先从关联 research_task 提取已有洞察数据
    existing_report_data = _load_research_report_data(profile, org_id)

    llm = LLMClient(user_id=user_id, org_id=org_id)

    competitor_info = (
        f"竞品：{competitor.name}\n"
        f"别名：{competitor.alias or '无'}\n"
        f"官网：{competitor.website or '无'}\n"
        f"技术领域：{competitor.tech_focus or '无'}\n"
        f"画像模板：{template.name}\n"
    )

    # 如果有 research_task 的 report_data，直接使用
    if existing_report_data and existing_report_data.get("dimensions"):
        insights = {
            "scores": existing_report_data.get("scores", {}),
            "swot": existing_report_data.get("swot", {
                "strengths": [], "weaknesses": [], "opportunities": [], "threats": []
            }),
            "verdict": existing_report_data.get("verdict", ""),
            "positioning": existing_report_data.get("positioning", ""),
            "timeline": existing_report_data.get("timeline", []),
        }
    else:
        # 否则基于 profile_data 用 LLM 生成洞察（确定性规则）
        dim_summary = "\n".join(
            f"【{dim_label}】\n{json.dumps(fields, ensure_ascii=False, indent=2)}"
            for dim_label, fields in dimensions.items()
            if isinstance(fields, dict)
        )

        system_prompt = (
            "你是一名资深的竞争情报分析师。基于给出的竞品画像维度数据，"
            "生成结构化的分析洞察。\n\n"
            "评分规则（严格按证据数量定级）：\n"
            "- 强（8-10分）：3条以上明确正面证据，无负面证据\n"
            "- 中（5-7分）：有正面证据但有限，或存在争议\n"
            "- 弱（1-4分）：负面证据多，或信息严重不足\n"
            "- 信息完全缺失的维度给 0 分并标注「无数据」\n\n"
            "输出要求：\n"
            "1. 仅输出 JSON，不要用代码块包裹，不要输出其他内容；\n"
            "2. 评分必须严格遵循上述规则，不得随意给分；\n"
            "3. 信息不足的维度给出 0-3 分的保守估计，不要编造；\n"
            "4. 分析需专业、客观，不夸大也不贬低。\n\n"
            "JSON 结构：\n"
            '{\n'
            '  "scores": {"维度名": 1-10的评分, ...},\n'
            '  "verdict": "一段话总体结论",\n'
            '  "positioning": "市场定位判断（一段话）",\n'
            '  "swot": {\n'
            '    "strengths": ["优势1", "优势2", ...],\n'
            '    "weaknesses": ["劣势1", "劣势2", ...],\n'
            '    "opportunities": ["机会1", "机会2", ...],\n'
            '    "threats": ["威胁1", "威胁2", ...]\n'
            '  },\n'
            '  "timeline": [\n'
            '    {"date": "YYYY-MM", "title": "事件标题", "summary": "事件摘要"}\n'
            '  ]\n'
            '}'
        )

        user_prompt = (
            f"{competitor_info}\n\n"
            f"【画像维度数据】\n{dim_summary or '（无维度数据）'}"
        )

        try:
            insights_text = await llm.chat(system_prompt, user_prompt, temperature=0.3)
            from app.services.llm import parse_json
            insights = parse_json(insights_text)
        except Exception as exc:
            logger.error("LLM insights generation failed for profile %s: %s", profile_id, exc)
            insights = {
                "scores": {},
                "verdict": "数据不足，无法生成洞察",
                "positioning": "数据不足",
                "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
                "timeline": [],
            }

    # 确保所有字段存在
    insights.setdefault("scores", {})
    insights.setdefault("verdict", "")
    insights.setdefault("positioning", "")
    insights.setdefault("swot", {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []})
    insights.setdefault("timeline", [])

    # 持久化洞察数据到 profile_data
    _persist_insights(profile, insights)

    return insights


# ---------------------------------------------------------------------------
# 数据收集
# ---------------------------------------------------------------------------

def _load_profile(profile_id: str) -> CompetitorProfile | None:
    with SessionLocal() as db:
        p = db.get(CompetitorProfile, profile_id)
        if p:
            return p
    return None


def _parse_profile(p: CompetitorProfile) -> dict:
    """Parse raw ORM JSON columns into dicts."""
    data = p.profile_data or {}
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (ValueError, TypeError):
            data = {}
    return data if isinstance(data, dict) else {}


def _parse_source_refs(p: CompetitorProfile) -> list[dict]:
    refs = p.source_refs or []
    if isinstance(refs, str):
        try:
            refs = json.loads(refs)
        except (ValueError, TypeError):
            refs = []
    return refs if isinstance(refs, list) else []


def _load_competitor(competitor_id: str, org_id: str) -> Competitor | None:
    with SessionLocal() as db:
        c = db.get(Competitor, competitor_id)
        if c and (c.org_id == org_id or c.org_id == ""):
            return c
    return None


def _load_template(template_id: str, org_id: str) -> ProfileTemplate | None:
    with SessionLocal() as db:
        t = db.get(ProfileTemplate, template_id)
        if t and (t.org_id == org_id or t.org_id == ""):
            return t
    return None


def _load_research_report_data(profile: CompetitorProfile, org_id: str) -> dict | None:
    """查找关联 research_task 的 report_data，优先使用。

    从 profile_data.related_task_ids 直接读取已记录的 task 列表，
    不再做模糊搜索。
    """
    profile_data = _parse_profile(profile)
    task_ids = profile_data.get("related_task_ids", [])
    if not task_ids:
        return None

    with SessionLocal() as db:
        # 取第一个关联 task（按 ID 排序，取最近生成的）
        task = db.get(ResearchTask, task_ids[0])
        if task and task.report_data:
            try:
                return json.loads(task.report_data) if isinstance(task.report_data, str) else task.report_data
            except (ValueError, TypeError):
                return None
    return None


def _format_summary(summary: Any) -> str:
    """将 summary 对象转换为可读文本。兼容旧版字符串格式。"""
    if not summary:
        return ""
    if isinstance(summary, str):
        return summary
    if isinstance(summary, dict):
        points = summary.get("key_points", [])
        if points:
            return "\n".join(f"- {p}" for p in points)
        return ""
    return ""


def _collect_materials(
    profile: CompetitorProfile,
    competitor: Competitor | None,
    org_id: str,
) -> tuple[dict, list[dict]]:
    """按优先级收集报告素材。返回 (materials_dict, source_index_list)。"""
    materials: dict[str, list[dict]] = {
        "summary": [],
        "research_sections": [],
        "pages": [],
        "sources": [],
        "graph": [],
    }
    source_index: list[dict] = []

    # 1. 画像概要
    profile_data = _parse_profile(profile)
    summary = profile_data.get("summary", "")
    summary_text = _format_summary(summary)
    if summary_text:
        materials["summary"].append({"text": summary_text, "source": "画像概要"})

    # 2. 关联 research_task 的 report_markdown 相关章节
    task_ids = profile_data.get("related_task_ids", [])
    if task_ids and competitor:
        with SessionLocal() as db:
            for tid in task_ids[:3]:
                task = db.get(ResearchTask, tid)
                if not task or task.status != "completed" or not task.report_markdown:
                    continue
                sections = _extract_competitor_sections(task.report_markdown, competitor.name)
                if sections:
                    materials["research_sections"].append({
                        "text": sections,
                        "source": f"调研报告 ({task.product_name})",
                        "task_id": task.id,
                    })

                # 收集该 task 的 sources
                task_sources = (
                    db.query(Source)
                    .filter(Source.task_id == task.id)
                    .order_by(Source.confidence.desc())
                    .limit(15)
                    .all()
                )
                for s in task_sources:
                    materials["sources"].append({
                        "url": s.url,
                        "title": s.title,
                        "snippet": (s.snippet or "")[:300],
                        "raw_content": (getattr(s, "raw_content", "") or "")[:500],
                        "tier": s.tier,
                        "confidence": s.confidence or 0.0,
                    })

    # 3. competitor_pages（高价值页面类型）
    if competitor:
        with SessionLocal() as db:
            pages = (
                db.query(CompetitorPage)
                .filter(CompetitorPage.competitor_id == profile.competitor_id)
                .filter(CompetitorPage.access_status == "success")
                .filter(
                    CompetitorPage.page_type.in_([
                        "about", "features", "pricing", "products",
                        "product", "customers", "solutions",
                    ])
                )
                .order_by(CompetitorPage.page_type)
                .limit(10)
                .all()
            )
            for p in pages:
                text = (p.content_text or "")[:3000]
                if text:
                    materials["pages"].append({
                        "url": p.url,
                        "title": p.title,
                        "text": text,
                        "page_type": p.page_type,
                    })

    # 4. 画像自身的 source_refs
    source_refs = _parse_source_refs(profile)
    if isinstance(source_refs, list):
        for ref in source_refs:
            if isinstance(ref, dict) and ref.get("url"):
                materials["sources"].append({
                    "url": ref.get("url", ""),
                    "title": ref.get("title", ""),
                    "snippet": (ref.get("snippet", "") or "")[:300],
                    "tier": ref.get("tier", "other"),
                    "confidence": float(ref.get("confidence", 0.0) or 0.0),
                })

    # 5. 图谱关系（如有同名图谱项目）
    if competitor:
        with SessionLocal() as db:
            projects = (
                db.query(GraphProject)
                .filter(GraphProject.root_name.ilike(f"%{competitor.name}%"))
                .filter(GraphProject.status == "completed")
                .order_by(GraphProject.created_at.desc())
                .limit(2)
                .all()
            )
            for proj in projects:
                entities = (
                    db.query(GraphEntity)
                    .filter(GraphEntity.project_id == proj.id)
                    .limit(10)
                    .all()
                )
                relations = (
                    db.query(GraphRelation)
                    .filter(GraphRelation.project_id == proj.id)
                    .limit(20)
                    .all()
                )
                if entities or relations:
                    materials["graph"].append({
                        "project_name": proj.root_name,
                        "entities": [
                            f"{e.name}（{e.type}）: {e.description[:100]}"
                            for e in entities
                        ],
                        "relations": [
                            f"{r.relation_type}: {r.description[:100]}"
                            for r in relations
                        ],
                    })

    return materials, source_index


# ---------------------------------------------------------------------------
# 素材质量评估
# ---------------------------------------------------------------------------

def _assess_quality(materials: dict) -> dict:
    """评估素材质量，返回 {level, source_count, text_length}."""
    total_sources = sum(
        len(v) for k, v in materials.items() if k != "summary"
    )
    total_text = sum(
        len(item.get("text", "") or item.get("snippet", "") or item.get("raw_content", "") or "")
        for category_name, category in materials.items()
        for item in category
    )
    if total_sources >= 5 and total_text >= 5000:
        level = "high"
    elif total_sources >= 2 and total_text >= 1000:
        level = "medium"
    else:
        level = "low"

    return {
        "level": level,
        "source_count": total_sources,
        "text_length": total_text,
    }


# ---------------------------------------------------------------------------
# 动态 Prompt 生成
# ---------------------------------------------------------------------------

def _build_report_prompt(quality: dict, competitor_info: str, summary_text: str, materials_text: str) -> tuple[str, str]:
    """根据素材质量动态生成 system_prompt 和 user_prompt，返回 (system, user)。"""
    quality_label = {"high": "充足", "medium": "一般", "low": "不足"}[quality["level"]]

    if quality["level"] == "high":
        chapters = (
            "# {竞品名} 竞品画像报告\n\n"
            "## 一、公司概况\n"
            "（公司基本信息、发展历程、规模等）\n\n"
            "## 二、产品线概览\n"
            "（核心产品、产品分类、主要功能等）\n\n"
            "## 三、市场定位\n"
            "（目标客户、价格定位、差异化优势等）\n\n"
            "## 四、技术栈与架构\n"
            "（核心技术、架构特点、技术路线等）\n\n"
            "## 五、竞争分析\n"
            "（主要竞品对比、市场格局、优劣势等）\n\n"
            "## 六、发展趋势与展望\n"
            "（近期动态、未来方向、潜在风险等）\n\n"
            "## 七、信息来源"
        )
    elif quality["level"] == "medium":
        chapters = (
            "# {竞品名} 竞品画像报告\n\n"
            "## 一、公司概况\n"
            "（公司基本信息、发展历程等）\n\n"
            "## 二、产品与核心功能\n"
            "（核心产品、主要功能等）\n\n"
            "## 三、市场定位\n"
            "（目标客户、差异化优势等）\n\n"
            "## 四、信息来源"
        )
    else:
        chapters = (
            "# {竞品名} 竞品画像简报\n\n"
            "## 素材摘要\n"
            "（基于现有素材整理的信息摘要）\n\n"
            "## 信息来源"
        )

    system = (
        "你是一名资深的竞品情报分析师，擅长撰写专业、可读的竞品画像报告。\n"
        f"素材质量：{quality_label}（{quality['source_count']} 个来源，{quality['text_length']} 字）\n\n"
        "请基于提供的素材，为以下竞品撰写一份结构化的 Markdown 分析报告。\n\n"
        "报告要求：\n"
        "1. 使用中文撰写，语气专业客观；\n"
        "2. 每个事实/数据点后标注来源编号 [n]，n 对应素材列表的编号；\n"
        "3. 信息不足时明确标注「信息不足」，不得编造；\n"
        "4. 纯 Markdown 输出，不要使用代码块包裹，不要输出 JSON。\n\n"
        "报告章节结构：\n"
        f"{chapters}"
    )

    if quality["level"] == "low":
        system += (
            "\n\n【重要】素材严重不足（低于一般标准），仅能生成简报。"
            "每个章节必须严格基于素材，素材未覆盖的内容不得推断或补充通用知识。"
        )

    user = (
        f"{competitor_info}\n\n"
        f"【画像概要（已有的结构化数据）】\n{summary_text or '（无概要信息）'}\n\n"
        f"【素材（编号后文引用用）】\n{materials_text}"
    )

    return system, user


# ---------------------------------------------------------------------------
# 素材格式化 + 来源编号系统
# ---------------------------------------------------------------------------

def _format_materials(materials: dict) -> tuple[str, list[dict]]:
    """将收集的素材格式化为 LLM prompt 中的素材文本。
    返回 (素材文本, 来源索引列表)。
    """
    parts: list[str] = []
    source_index: list[dict] = []
    counter = 0

    def _numbered(items: list[dict], label: str):
        nonlocal counter
        if not items:
            return
        parts.append(f"--- {label} ---")
        for item in items:
            counter += 1
            n = counter
            text = item.get("text") or item.get("snippet") or item.get("raw_content", "")
            if not text:
                continue
            source = item.get("source", item.get("url", ""))
            parts.append(f"[{n}] {source}")
            parts.append(text[:800])
            parts.append("")
            # 记录来源索引
            if item.get("url"):
                source_index.append({
                    "n": n,
                    "url": item["url"],
                    "title": item.get("title", item.get("source", "")),
                    "tier": item.get("tier", "other"),
                    "confidence": item.get("confidence", 0.0),
                    "snippet": (item.get("snippet", "") or "")[:120],
                })

    _numbered(materials.get("summary", []), "画像概要")
    _numbered(materials.get("research_sections", []), "调研报告章节")
    _numbered(materials.get("pages", []), "官网页面内容")
    _numbered(materials.get("sources", []), "来源材料")
    _numbered(materials.get("graph", []), "产业链关系")

    return "\n".join(parts) if parts else "（无可用素材）", source_index


# ---------------------------------------------------------------------------
# 洞察持久化
# ---------------------------------------------------------------------------

def _persist_insights(profile: CompetitorProfile, insights: dict) -> None:
    """将洞察数据持久化到 profile_data.insights。"""
    profile_data = _parse_profile(profile)
    profile_data["insights"] = insights
    profile_data["insights_generated_at"] = utcnow().isoformat()

    with SessionLocal() as db:
        p = db.get(CompetitorProfile, profile.id)
        if p:
            p.profile_data = json.dumps(profile_data, ensure_ascii=False)
            db.commit()


# ---------------------------------------------------------------------------
# 渲染辅助
# ---------------------------------------------------------------------------

def _extract_competitor_sections(markdown: str, competitor_name: str) -> str:
    """从调研报告 markdown 中提取与指定竞品相关的章节。"""
    lines = markdown.split("\n")
    relevant: list[str] = []
    capture = False

    # 常见章节关键词
    intro_keywords = ["概述", "背景", "研究背景"]
    competitor_keywords = [competitor_name, "竞品分析", "对比", "综合"]
    section_keywords = ["产品", "市场", "技术", "竞争", "发展", "结论"]

    for line in lines:
        is_heading = line.startswith("#")
        if is_heading:
            # 判断该章节是否与竞品相关
            heading_text = line.lstrip("#").strip()
            is_relevant = (
                competitor_name in heading_text
                or any(kw in heading_text for kw in competitor_keywords)
                or any(kw in heading_text for kw in section_keywords)
            )
            capture = is_relevant
        if capture:
            relevant.append(line)

    return "\n".join(relevant[:200])  # 截断防止过长


def _format_competitor_info(competitor: Competitor | None, template: ProfileTemplate | None) -> str:
    parts = []
    if competitor:
        parts.append(f"竞品：{competitor.name}")
        if competitor.alias:
            parts.append(f"别名：{competitor.alias}")
        if competitor.website:
            parts.append(f"官网：{competitor.website}")
        if competitor.tech_focus:
            parts.append(f"技术领域：{competitor.tech_focus}")
    if template:
        parts.append(f"画像模板：{template.name}")
    return "\n".join(parts) if parts else "（竞品信息缺失）"


def _fallback_report(competitor: Competitor | None, summary: Any, materials: dict) -> str:
    """LLM 失败时的兜底报告（纯素材拼接）。"""
    parts = [f"# {competitor.name if competitor else '竞品'} 竞品画像报告\n"]
    summary_text = _format_summary(summary)
    if summary_text:
        parts.append(f"> {summary_text}\n")

    parts.append("## 画像概要\n")
    for m in materials.get("summary", []):
        parts.append(m.get("text", ""))

    parts.append("\n## 来源材料\n")
    counter = 0
    for category in ["research_sections", "pages", "sources", "graph"]:
        for item in materials.get(category, []):
            counter += 1
            text = item.get("text") or item.get("snippet") or item.get("raw_content", "")
            if text:
                parts.append(f"[{counter}] {item.get('source', item.get('url', ''))}\n{text[:500]}\n")

    return "\n".join(parts)
