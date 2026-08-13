"""统一情报资产中心 API。"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import User
from app.schemas.assets import IntelligenceObjectListOut, IntelligenceObjectType
from app.services.assets import list_intelligence_objects


router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.get("", response_model=IntelligenceObjectListOut)
def list_assets(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    types: list[IntelligenceObjectType] | None = Query(None),
    q: str = Query("", max_length=200),
    status: str = Query("", max_length=30),
):
    """跨竞品、画像、调研任务和图谱返回全局排序的统一目录。"""
    result = list_intelligence_objects(
        db, user, page=page, page_size=page_size, types=types, query=q, status=status
    )
    return IntelligenceObjectListOut(
        items=result.items,
        total=result.total,
        page=page,
        page_size=page_size,
        type_counts=result.type_counts,
    )
