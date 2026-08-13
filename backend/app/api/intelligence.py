"""事件流与监测中心 API。"""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import User
from app.schemas.intelligence import IntelligenceEventList, IntelligenceEventSummary
from app.services.intelligence_events import list_events, summarize_events

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.get("/events", response_model=IntelligenceEventList)
def get_events(
    event_type: Literal["all", "research", "tracker", "graph"] = "all",
    status: Literal["all", "queued", "running", "completed", "failed"] = "all",
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items, total = list_events(
        db,
        user,
        event_type=event_type,
        status=status,
        page=page,
        page_size=page_size,
    )
    return IntelligenceEventList(items=items, total=total, page=page, page_size=page_size)


@router.get("/summary", response_model=IntelligenceEventSummary)
def get_event_summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return IntelligenceEventSummary(**summarize_events(db, user))
