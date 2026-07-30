import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResearchCreate(BaseModel):
    """创建调研任务请求"""

    product_name: str = Field(..., min_length=1, max_length=200, description="要调研的产品/公司名称")
    competitors: str = Field("", max_length=2000, description="可选：指定竞品，逗号分隔")
    focus: str = Field("", max_length=2000, description="可选：调研重点，如定价、功能对比等")


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    seq: int
    phase: str
    title: str
    detail: str
    created_at: datetime


class SourceOut(BaseModel):
    """来源列表项（不含 raw_content，控制响应体积）"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    url: str
    snippet: str
    score: float = 0.0
    domain: str = ""
    tier: str = "other"
    published_at: str = ""
    dimension: str = ""


class SourceDetail(SourceOut):
    """来源详情，含原文摘录"""

    raw_content: str = ""


class TaskBrief(BaseModel):
    """任务列表项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    product_name: str
    competitors: str
    focus: str
    status: str
    error: str
    created_at: datetime
    updated_at: datetime


class TaskDetail(TaskBrief):
    """任务详情，含报告、结构化洞察、步骤与来源"""

    report_markdown: str
    report_data: dict | None = None  # 结构化洞察，解析失败时为 null，前端优雅降级
    steps: list[StepOut] = []
    sources: list[SourceOut] = []

    @field_validator("report_data", mode="before")
    @classmethod
    def parse_report_data(cls, v: Any) -> dict | None:
        if isinstance(v, dict):
            return v
        if isinstance(v, str) and v.strip():
            try:
                data = json.loads(v)
                return data if isinstance(data, dict) else None
            except ValueError:
                return None
        return None
