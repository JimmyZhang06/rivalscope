"""统一情报事件的 API 数据契约。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


IntelligenceEventType = Literal["research", "tracker", "graph"]
IntelligenceEventStatus = Literal["queued", "running", "completed", "failed"]


class IntelligenceEvent(BaseModel):
    """由现有业务记录适配得到的统一事件，不要求迁移历史数据。"""

    id: str
    event_type: IntelligenceEventType
    status: IntelligenceEventStatus
    title: str
    summary: str = ""
    source_id: str
    href: str
    occurred_at: datetime
    updated_at: datetime
    context: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class IntelligenceEventList(BaseModel):
    items: list[IntelligenceEvent]
    total: int
    page: int
    page_size: int


class IntelligenceEventSummary(BaseModel):
    total: int
    active: int
    completed: int
    failed: int
    by_type: dict[IntelligenceEventType, int]
    by_status: dict[IntelligenceEventStatus, int]
    latest_at: datetime | None = None
