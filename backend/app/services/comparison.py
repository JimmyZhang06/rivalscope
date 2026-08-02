"""横向对比报告服务"""

import json
import logging

from app.db.database import SessionLocal
from app.db.models import CompetitorProfile, ProfileTemplate

logger = logging.getLogger(__name__)


def generate_comparison(template_id: str, competitor_ids: list[str]) -> dict:
    """基于多份已冻结画像生成横向对比报告"""
    with SessionLocal() as db:
        template = db.get(ProfileTemplate, template_id)
        if not template or template.frozen_at is None:
            raise ValueError("模板不存在或未冻结")

        profiles = (
            db.query(CompetitorProfile)
            .filter(
                CompetitorProfile.competitor_id.in_(competitor_ids),
                CompetitorProfile.status == "frozen",
            )
            .all()
        )

    if len(profiles) < 2:
        raise ValueError("至少需要 2 份已冻结的画像")

    dimensions = json.loads(template.dimensions)

    matrix = []
    for dim in dimensions:
        row = {"dimension": dim["label"], "values": {}}
        fields = dim.get("fields", [])
        field_key = fields[0]["key"] if fields else None
        for p in profiles:
            data = json.loads(p.profile_data) if isinstance(p.profile_data, str) else p.profile_data
            dim_data = data.get("dimensions", {}).get(dim["key"], {})
            if field_key:
                row["values"][p.competitor_id] = dim_data.get(field_key, "信息不足")
            else:
                row["values"][p.competitor_id] = json.dumps(dim_data, ensure_ascii=False)
        matrix.append(row)

    source_refs = []
    for p in profiles:
        refs = json.loads(p.source_refs) if isinstance(p.source_refs, str) else p.source_refs
        source_refs.append(refs)

    return {
        "template_name": template.name,
        "dimensions": [d["label"] for d in dimensions],
        "matrix": matrix,
        "source_refs": source_refs,
    }
