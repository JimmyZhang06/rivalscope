"""横向对比报告服务"""

import json
import logging

from app.db.database import SessionLocal
from app.db.models import CompetitorProfile, ProfileTemplate

logger = logging.getLogger(__name__)


def generate_comparison(template_id: str, profile_ids: list[str]) -> dict:
    """基于多份已冻结画像生成横向对比报告"""
    with SessionLocal() as db:
        template = db.get(ProfileTemplate, template_id)
        if not template or template.frozen_at is None:
            raise ValueError("模板不存在或未冻结")

        profiles = db.query(CompetitorProfile).filter(
            CompetitorProfile.id.in_(profile_ids)
        ).all()

    if len(profiles) < 2:
        raise ValueError("至少需要 2 份已冻结的画像")

    # 按竞品去重：同一竞品保留最新冻结的画像
    latest_by_competitor: dict[str, CompetitorProfile] = {}
    for p in profiles:
        if p.status != "frozen":
            continue
        if p.competitor_id not in latest_by_competitor or \
           (p.frozen_at and p.frozen_at > latest_by_competitor[p.competitor_id].frozen_at):
            latest_by_competitor[p.competitor_id] = p
    profiles = list(latest_by_competitor.values())

    if len(profiles) < 2:
        raise ValueError("至少需要 2 个不同竞品的已冻结画像")

    # 版本一致性校验
    versions = {p.template_version for p in profiles}
    if len(versions) > 1:
        raise ValueError(
            f"所选画像使用了不同版本的模板（{sorted(versions)}），"
            "请确保对比的是同一版本模板生成的画像"
        )

    dimensions = json.loads(template.dimensions)

    matrix = []
    for dim in dimensions:
        fields = dim.get("fields", [])
        if not fields:
            # 无子字段，整维度作为一行
            row = {"dimension": dim["label"], "values": {}}
            for p in profiles:
                data = json.loads(p.profile_data) if isinstance(p.profile_data, str) else p.profile_data
                dim_data = data.get("dimensions", {}).get(dim["key"], {})
                row["values"][p.competitor_id] = json.dumps(dim_data, ensure_ascii=False) if dim_data else "信息不足"
            matrix.append(row)
        else:
            # 每个子字段一行
            for field in fields:
                row = {"dimension": f"{dim['label']} · {field['label']}", "values": {}}
                fk = field["key"]
                for p in profiles:
                    data = json.loads(p.profile_data) if isinstance(p.profile_data, str) else p.profile_data
                    dim_data = data.get("dimensions", {}).get(dim["key"], {})
                    row["values"][p.competitor_id] = dim_data.get(fk, "信息不足")
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
