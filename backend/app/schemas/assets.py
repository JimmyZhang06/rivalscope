"""统一情报对象（资产中心）响应契约。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


IntelligenceObjectType = Literal["competitor", "profile", "research_task", "graph_project"]


class IntelligenceObjectOut(BaseModel):
    """现有领域对象的只读、向后兼容投影。"""

    id: str = Field(description="稳定统一标识，格式为 <type>:<source_id>")
    type: IntelligenceObjectType
    source_id: str
    title: str
    summary: str = ""
    status: str
    org_id: str = ""
    owner_id: str = ""
    detail_path: str
    attributes: dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class IntelligenceObjectListOut(BaseModel):
    items: list[IntelligenceObjectOut]
    total: int
    page: int
    page_size: int
    type_counts: dict[IntelligenceObjectType, int]
