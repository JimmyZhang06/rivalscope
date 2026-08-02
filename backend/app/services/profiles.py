"""竞品画像生成服务"""

import json
import logging

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CompetitorProfile, ProfileTemplate, ResearchTask, Source
from app.services.llm import LLMClient

logger = logging.getLogger(__name__)


async def generate_profile(competitor_id: str, template_id: str, user_id: str = "") -> dict:
    """按模板维度生成竞品画像（优先 ResearchTask 来源，回退到爬取页面）"""
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")

        dimensions = json.loads(template.dimensions)
        name = competitor.name
        tasks = (
            db.query(ResearchTask)
            .filter(ResearchTask.status == "completed")
            .filter(
                (ResearchTask.product_name.like(f"%{name}%"))
                | (ResearchTask.competitors.like(f"%{name}%"))
            )
            .all()
        )
        task_ids = [t.id for t in tasks]
        sources = (
            db.query(Source)
            .filter(Source.task_id.in_(task_ids))
            .order_by(Source.confidence.desc())
            .limit(20)
            .all()
        ) if task_ids else []
        org_id = competitor.org_id

    llm = LLMClient(user_id=user_id, org_id=org_id)

    # 优先：从 ResearchTask 来源生成
    if sources:
        dim_descriptions = []
        for dim in dimensions:
            fields_desc = "、".join(f"{f['label']}（{f['type']}）" for f in dim.get("fields", []))
            dim_descriptions.append(f"【{dim['label']}】字段：{fields_desc}")

        system = (
            "你是一名资深竞争情报分析师。基于给出的来源材料，为指定竞品生成结构化画像。\n"
            f"画像模板包含以下维度：\n" + "\n".join(dim_descriptions) + "\n"
            "要求：\n"
            "1. 每个维度只输出模板中定义的字段，来源不足的字段标注「信息不足」；\n"
            "2. 只依据材料中的信息，不得编造，不确定的内容明确标注；\n"
            '3. 输出 JSON：{"dimensions": {"dimension_key": {"field_key": "value", ...}}, "summary": "一句话总结"}\n'
            "4. 直接输出 JSON，不要用代码块包裹。"
        )

        source_materials = "\n".join(
            f"[{i + 1}] {s.title}\nURL: {s.url}\n内容: {s.snippet}\n置信度: {s.confidence:.2f}"
            for i, s in enumerate(sources[:15])
        )
        user = f"竞品：{competitor.name}\n别名：{competitor.alias}\n官网：{competitor.website}\n技术主题：{competitor.tech_focus}\n\n来源材料：\n{source_materials}"

        data = await llm.chat_json(system, user)
        data.setdefault("dimensions", {})
        data.setdefault("summary", "")

        with SessionLocal() as db:
            profile = CompetitorProfile(
                org_id=org_id,
                competitor_id=competitor_id,
                template_id=template_id,
                profile_data=json.dumps(data, ensure_ascii=False),
                source_refs=json.dumps(
                    [{"url": s.url, "title": s.title, "snippet": s.snippet[:200]} for s in sources[:10]],
                    ensure_ascii=False,
                ),
                status="draft",
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

        # 序列化用于返回（ORM 属性保持 JSON 字符串不变）
        profile_data_out = json.loads(profile.profile_data) if isinstance(profile.profile_data, str) else profile.profile_data
        source_refs_out = json.loads(profile.source_refs) if isinstance(profile.source_refs, str) else profile.source_refs

        return {
            "id": profile.id,
            "status": profile.status,
            "profile_data": profile_data_out,
            "source_refs": source_refs_out,
            "generation_source": "research",
        }

    # 回退：走搜索优先的产品情报路径
    logger.info("no research sources found for %s, trying product_intel", competitor_id)
    try:
        from app.services.product_intel import generate_product_intel
        return await generate_product_intel(competitor_id, template_id, user_id=user_id)
    except Exception as exc:
        logger.warning("product_intel failed for %s: %s", competitor_id, exc)

    # 最终兜底：从爬取页面生成
    logger.info("product_intel also failed, falling back to crawled pages for %s", competitor_id)
    from app.services.profile_extractor import extract_profile_from_pages
    return await extract_profile_from_pages(competitor_id, template_id, user_id=user_id)


def freeze_profile(profile_id: str) -> dict:
    """冻结画像（冻结后不可修改）"""
    with SessionLocal() as db:
        profile = db.get(CompetitorProfile, profile_id)
        if not profile:
            raise ValueError("画像不存在")
        if profile.status == "frozen":
            raise ValueError("画像已冻结")
        profile.status = "frozen"
        profile.frozen_at = utcnow()
        db.commit()
        db.refresh(profile)
        return {"id": profile.id, "status": profile.status}
