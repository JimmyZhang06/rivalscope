"""权限管理 API：当前用户权限查询"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me/permissions", tags=["permissions"])


@router.get("")
def get_my_permissions(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户权限列表"""
    from app.api.deps import _load_permissions

    perms = _load_permissions(db, user.id)
    return {"permissions": sorted(perms)}
