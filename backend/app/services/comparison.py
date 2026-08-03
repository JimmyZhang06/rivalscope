"""横向对比报告服务"""

import json
import logging

from app.db.database import SessionLocal
from app.db.models import CompetitorProfile, ProfileTemplate

logger = logging.getLogger(__name__)


def _safe_json(s):
    """安全解析 JSON 字符串，失败返回 None"""
    if not s or not isinstance(s, str):
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


def generate_comparison(template_id: str, competitor_ids: list[str]) -> dict:
    """基于多份已冻结画像生成横向对比报告"""
    with SessionLocal() as db:
        template = db.get(ProfileTemplate, template_id)
        if not template or template.frozen_at is None:
            raise ValueError("模板不存在或未冻结，请先冻结模板")

        profiles = (
            db.query(CompetitorProfile)
            .filter(
                CompetitorProfile.competitor_id.in_(competitor_ids),
                CompetitorProfile.status == "frozen",
            )
            .all()
        )

    if len(profiles) < 2:
        raise ValueError(f"至少需要 2 份已冻结的画像，当前仅找到 {len(profiles)} 份")

    dimensions = _safe_json(template.dimensions)
    if not dimensions:
        raise ValueError("模板维度为空，无法生成对比")

    matrix = []
    for dim in dimensions:
        fields = dim.get("fields", [])
        if not fields:
            row = {"dimension": dim["label"], "values": {}}
            for p in profiles:
                data = _safe_json(p.profile_data) or {}
                dim_data = data.get("dimensions", {}).get(dim["key"], {})
                row["values"][p.competitor_id] = json.dumps(dim_data, ensure_ascii=False) if dim_data else "信息不足"
            matrix.append(row)
        else:
            for field in fields:
                row = {"dimension": f"{dim['label']} · {field['label']}", "values": {}}
                fk = field["key"]
                for p in profiles:
                    data = _safe_json(p.profile_data) or {}
                    dim_data = data.get("dimensions", {}).get(dim["key"], {})
                    row["values"][p.competitor_id] = dim_data.get(fk, "信息不足")
                matrix.append(row)

    source_refs = []
    for p in profiles:
        refs = _safe_json(p.source_refs) or []
        source_refs.append(refs)

    return {
        "template_name": template.name,
        "dimensions": [d["label"] for d in dimensions],
        "matrix": matrix,
        "source_refs": source_refs,
    }
