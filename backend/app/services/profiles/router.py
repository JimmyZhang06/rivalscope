"""画像生成策略路由（聚合入口）

将 `generate_profile` 拆分为策略管道：research → product_intel → crawl fallback。
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import or_

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CompetitorProfile, ProfileTemplate, ResearchTask, Source
from app.services.llm import LLMClient

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Context / Result data classes
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProfileContext:
    competitor: Competitor
    template: ProfileTemplate
    dimensions: list[dict]
    user_id: str
    org_id: str
    research_sources: list[Any] = field(default_factory=list)
    research_tasks: list[Any] = field(default_factory=list)
    competitor_pages: list[Any] = field(default_factory=list)


@dataclass
class ProfileResult:
    profile_id: str
    profile_data: dict
    source_refs: list[dict]
    generation_source: str
    related_task_ids: list[str] = field(default_factory=list)
    related_source_ids: list[int] = field(default_factory=list)


class GenerationError(Exception):
    """所有策略均无法生成画像"""
    pass


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def generate_profile(competitor_id: str, template_id: str, user_id: str = "") -> dict:
    """策略路由：按优先级尝试各数据源生成画像

    优先级（有本地数据时优先使用本地数据，避免依赖外部 API 的不确定性）：
    1. crawl（本地已爬取的页面，最直接相关）
    2. research（调研任务的来源材料，结构化程度高）
    3. product_intel（Tavily 搜索 + 定向抓取，作为兜底）
    """
    ctx = _build_context(competitor_id, template_id, user_id)

    # 优先使用本地爬取数据（最相关、最快、不依赖外部 API）
    if ctx.competitor_pages:
        try:
            result = await _generate_from_crawl(ctx)
            return _result_to_dict(result)
        except Exception as exc:
            logger.warning("crawl strategy failed for %s: %s", competitor_id, exc)

    # 其次使用调研来源（结构化程度高）
    if ctx.research_sources:
        try:
            result = await _generate_from_research(ctx)
            return _result_to_dict(result)
        except Exception as exc:
            logger.warning("research strategy failed for %s: %s", competitor_id, exc)

    # 兜底：搜索优先（需要 Tavily API）
    if _tavily_available():
        try:
            result = await _generate_from_product_intel(ctx)
            return _result_to_dict(result)
        except Exception as exc:
            logger.warning("product_intel strategy failed for %s: %s", competitor_id, exc)

    raise GenerationError(
        "无可用的数据源：请先执行爬取、配置搜索 API，或创建调研任务"
    )


def _tavily_available() -> bool:
    from app.core.config import get_settings
    return bool(get_settings().tavily_api_key)


# ---------------------------------------------------------------------------
# Context builder
# ---------------------------------------------------------------------------

def _build_context(competitor_id: str, template_id: str, user_id: str) -> ProfileContext:
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")

        dimensions = json.loads(template.dimensions)
        name = competitor.name

        # 精确匹配（避免模糊匹配误命中）
        tasks = db.query(ResearchTask).filter(
            ResearchTask.status == "completed",
            ResearchTask.product_name == name,
        ).all()

        # 别名精确匹配
        if not tasks and competitor.alias:
            aliases = [a.strip() for a in competitor.alias.replace("，", ",").split(",") if a.strip()]
            if aliases:
                conditions = [ResearchTask.product_name == a for a in aliases]
                tasks = db.query(ResearchTask).filter(
                    ResearchTask.status == "completed",
                    or_(*conditions),
                ).all()

        task_ids = [t.id for t in tasks]
        sources = (
            db.query(Source)
            .filter(Source.task_id.in_(task_ids))
            .order_by(Source.confidence.desc())
            .limit(20)
            .all()
        ) if task_ids else []

        pages = db.query(CompetitorPage).filter(
            CompetitorPage.competitor_id == competitor_id,
            CompetitorPage.access_status == "success",
        ).order_by(CompetitorPage.crawled_at.desc().nullslast()).all()

    return ProfileContext(
        competitor=competitor,
        template=template,
        dimensions=dimensions,
        user_id=user_id,
        org_id=competitor.org_id,
        research_sources=sources,
        research_tasks=tasks,
        competitor_pages=pages,
    )


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

async def _generate_from_research(ctx: ProfileContext) -> ProfileResult:
    """从 ResearchTask 来源生成画像（最优策略）"""
    llm = LLMClient(user_id=ctx.user_id, org_id=ctx.org_id)
    dimensions = ctx.dimensions
    sources = ctx.research_sources
    tasks = ctx.research_tasks
    competitor = ctx.competitor

    dim_descriptions = []
    for dim in dimensions:
        fields_desc = "、".join(f"{f['label']}（{f['type']}）" for f in dim.get("fields", []))
        dim_descriptions.append(f"【{dim['label']}】字段：{fields_desc}")

    system = (
        "你是一名资深竞争情报分析师。基于给出的来源材料，为指定竞品生成结构化画像。\n"
        f"画像模板包含以下维度：\n" + "\n".join(dim_descriptions) + "\n"
        "严格要求：\n"
        "1. 每个字段的值必须是纯文本字符串，不得使用对象、数组或其他复杂结构；\n"
        "2. 如果需要列出多项，用顿号（、）分隔成一段话；\n"
        "3. 只依据材料中的信息，不得编造，来源不足的字段填写「信息不足」；\n"
        "4. summary 必须是对象格式 {\"key_points\": [\"要点1\", \"要点2\", \"要点3\"], \"data_quality\": \"high|medium|low\"}，"
        "key_points 包含 3-5 条画像要点，data_quality 根据素材丰富度评估；\n"
        '5. 输出 JSON：{"dimensions": {"dimension_key": {"field_key": "文本字符串", ...}}, "summary": {"key_points": [...], "data_quality": "..."}}\n'
        "6. 直接输出 JSON，不要用代码块包裹，不要输出任何其他内容。"
    )

    source_materials = "\n".join(
        f"[{i + 1}] {s.title}\nURL: {s.url}\n内容: {s.snippet}\n置信度: {s.confidence:.2f}"
        for i, s in enumerate(sources[:15])
    )
    user = f"竞品：{competitor.name}\n别名：{competitor.alias}\n官网：{competitor.website}\n技术主题：{competitor.tech_focus}\n\n来源材料：\n{source_materials}"

    data = await llm.chat_json(system, user)
    data.setdefault("dimensions", {})

    # Ensure summary is structured (key_points list + data_quality)
    raw_summary = data.get("summary", "")
    if isinstance(raw_summary, str):
        if raw_summary and raw_summary != "信息不足":
            data["summary"] = {
                "key_points": [raw_summary],
                "data_quality": "medium",
            }
        else:
            data["summary"] = {
                "key_points": [],
                "data_quality": "low",
            }
    elif isinstance(raw_summary, dict):
        raw_summary.setdefault("key_points", [])
        raw_summary.setdefault("data_quality", "medium")

    with SessionLocal() as db:
        profile_data_str = json.dumps(data, ensure_ascii=False)
        data["related_task_ids"] = [t.id for t in tasks]
        data["related_source_ids"] = [s.id for s in sources[:10]]
        final_data_str = json.dumps(data, ensure_ascii=False)

        profile = CompetitorProfile(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            competitor_id=ctx.competitor.id,
            template_id=ctx.template.id,
            template_version=ctx.template.version,
            profile_data=final_data_str,
            source_refs=json.dumps(
                [{"url": s.url, "title": s.title, "snippet": s.snippet[:200]} for s in sources[:10]],
                ensure_ascii=False,
            ),
            status="draft",
            generation_source="research",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    profile_data_out = json.loads(profile.profile_data) if isinstance(profile.profile_data, str) else profile.profile_data
    source_refs_out = json.loads(profile.source_refs) if isinstance(profile.source_refs, str) else profile.source_refs

    return ProfileResult(
        profile_id=profile.id,
        profile_data=profile_data_out,
        source_refs=source_refs_out,
        generation_source="research",
        related_task_ids=[t.id for t in tasks],
        related_source_ids=[s.id for s in sources[:10]],
    )


async def _generate_from_product_intel(ctx: ProfileContext) -> ProfileResult:
    """搜索优先的产品情报路径"""
    from app.services.product_intel import generate_product_intel
    result = await generate_product_intel(ctx.competitor.id, ctx.template.id, user_id=ctx.user_id)
    return ProfileResult(
        profile_id=result["id"],
        profile_data=result.get("profile_data", {}),
        source_refs=result.get("source_refs", []),
        generation_source="product_intel",
    )


async def _generate_from_crawl(ctx: ProfileContext) -> ProfileResult:
    """从爬取页面生成（兜底策略）"""
    from app.services.profile_extractor import generate_profile_from_crawl_data
    result = await generate_profile_from_crawl_data(ctx.competitor.id, ctx.template.id, user_id=ctx.user_id)
    return ProfileResult(
        profile_id=result["id"],
        profile_data=result.get("profile_data", {}),
        source_refs=result.get("source_refs", []),
        generation_source="crawl",
    )


def _result_to_dict(result: ProfileResult) -> dict:
    return {
        "id": result.profile_id,
        "status": "draft",
        "profile_data": result.profile_data,
        "source_refs": result.source_refs,
        "generation_source": result.generation_source,
        "related_task_ids": result.related_task_ids,
        "related_source_ids": result.related_source_ids,
    }
