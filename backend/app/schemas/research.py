import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

TIME_RANGES = ("", "day", "week", "month", "year")


class ResearchCreate(BaseModel):
    """创建调研任务请求"""

    product_name: str = Field(..., min_length=1, max_length=200, description="要调研的产品/公司名称")
    competitors: str = Field("", max_length=2000, description="可选：指定竞品，逗号分隔")
    focus: str = Field("", max_length=2000, description="可选：调研重点，如定价、功能对比等")
    time_range: str = Field("year", description="检索时效：''(不限)/day/week/month/year")

    @field_validator("time_range")
    @classmethod
    def check_time_range(cls, v: str) -> str:
        if v not in TIME_RANGES:
            raise ValueError("time_range 仅支持 ''/day/week/month/year")
        return v


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
    age_days: int = -1
    confidence: float = 0.0
    conflict_status: str = "none"
    conflict_note: str = ""
    is_duplicate: bool = False
    access_status: str = ""


class SourceDetail(SourceOut):
    """来源详情，含原文摘录"""

    raw_content: str = ""


class SourceArchiveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    source_id: int
    snapshot_html: str
    snapshot_text: str
    snapshot_format: str
    published_at: str
    collected_at: datetime | None
    access_status: str
    access_error: str
    raw_content_full: str


class TaskBrief(BaseModel):
    """任务列表项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    product_name: str
    competitors: str
    focus: str
    status: str
    error: str
    org_id: str = ""
    tracker_id: str = ""
    creator_nickname: str = ""  # 企业共享任务展示创建人
    created_at: datetime
    updated_at: datetime


class TaskDetail(TaskBrief):
    """任务详情，含报告、结构化洞察、步骤与来源"""

    report_markdown: str
    report_data: dict | None = None  # 结构化洞察，解析失败时为 null，前端优雅降级
    change_summary: str = ""  # 定时追踪的本期变更摘要（与上一期对比）
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


class AskIn(BaseModel):
    """报告追问请求"""

    question: str = Field(..., min_length=1, max_length=2000, description="针对报告的问题")


class AskOut(BaseModel):
    """报告追问回答（无状态，不持久化）"""

    answer: str


class EmailReportOut(BaseModel):
    """手动发送报告邮件结果"""

    status: str  # sent / demo / failed
    recipients: int
