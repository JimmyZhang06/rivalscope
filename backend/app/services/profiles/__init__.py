"""画像生成服务（聚合入口 + freeze 兼容层）

`generate_profile` 路由到 pipeline 模块（strategy pattern）。
`freeze_profile` 保持原地不变。
"""
from __future__ import annotations

import json
import logging

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import CompetitorProfile

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pipeline re-export
# ---------------------------------------------------------------------------

from .router import generate_profile, GenerationError, ProfileContext, ProfileResult  # noqa: E402

__all__ = [
    "generate_profile",
    "freeze_profile",
    "GenerationError",
    "ProfileContext",
    "ProfileResult",
]


# ---------------------------------------------------------------------------
# freeze_profile (unchanged)
# ---------------------------------------------------------------------------

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
