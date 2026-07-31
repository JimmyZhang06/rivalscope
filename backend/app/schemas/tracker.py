"""定时追踪相关的请求/响应模型"""

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

FREQUENCIES = ("daily", "weekly", "monthly")
WEBHOOK_TYPES = ("wecom", "dingtalk", "feishu", "generic")
TIME_RANGES = ("", "day", "week", "month", "year")


class TrackerCreateIn(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=200)
    competitors: str = Field("", max_length=2000)
    focus: str = Field("", max_length=2000)
    time_range: str = "year"
    frequency: str = "weekly"
    run_hour: int = Field(9, ge=0, le=23)
    push_email: bool = False
    push_webhook: bool = False
    webhook_type: str = "generic"
    webhook_url: str = Field("", max_length=1000)

    @field_validator("time_range")
    @classmethod
    def check_time_range(cls, v: str) -> str:
        if v not in TIME_RANGES:
            raise ValueError("time_range 仅支持 ''/day/week/month/year")
        return v

    @field_validator("frequency")
    @classmethod
    def check_frequency(cls, v: str) -> str:
        if v not in FREQUENCIES:
            raise ValueError("频率仅支持 daily / weekly / monthly")
        return v

    @field_validator("webhook_type")
    @classmethod
    def check_webhook_type(cls, v: str) -> str:
        if v not in WEBHOOK_TYPES:
            raise ValueError("webhook 类型仅支持 wecom / dingtalk / feishu / generic")
        return v


class TrackerUpdateIn(BaseModel):
    product_name: str | None = Field(default=None, min_length=1, max_length=200)
    competitors: str | None = Field(default=None, max_length=2000)
    focus: str | None = Field(default=None, max_length=2000)
    time_range: str | None = None
    frequency: str | None = None
    run_hour: int | None = Field(default=None, ge=0, le=23)
    enabled: bool | None = None
    push_email: bool | None = None
    push_webhook: bool | None = None
    webhook_type: str | None = None
    webhook_url: str | None = Field(default=None, max_length=1000)

    @field_validator("time_range")
    @classmethod
    def check_time_range(cls, v: str | None) -> str | None:
        if v is not None and v not in TIME_RANGES:
            raise ValueError("time_range 仅支持 ''/day/week/month/year")
        return v

    @field_validator("frequency")
    @classmethod
    def check_frequency(cls, v: str | None) -> str | None:
        if v is not None and v not in FREQUENCIES:
            raise ValueError("频率仅支持 daily / weekly / monthly")
        return v

    @field_validator("webhook_type")
    @classmethod
    def check_webhook_type(cls, v: str | None) -> str | None:
        if v is not None and v not in WEBHOOK_TYPES:
            raise ValueError("webhook 类型仅支持 wecom / dingtalk / feishu / generic")
        return v


class TrackerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    creator_id: str
    product_name: str
    competitors: str
    focus: str
    time_range: str = "year"
    frequency: str
    run_hour: int
    next_run_at: datetime | None
    last_run_at: datetime | None
    enabled: bool
    push_email: bool
    push_webhook: bool
    webhook_type: str
    webhook_url: str
    created_at: datetime
    # 列表卡片附加信息（端点手动填充）
    run_count: int = 0
    last_task_id: str = ""
    last_change_summary: str = ""
    running: bool = False
    running_task_id: str = ""
    creator_nickname: str = ""  # 创建人昵称（无昵称时为邮箱前缀）
    can_manage: bool = False  # 当前用户是否可管理（创建人或企业管理员）


class TrackerRunOut(BaseModel):
    """追踪项的一期运行记录（含变更摘要与结构化评分，供时间线与趋势图）"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    error: str
    change_summary: str = ""
    report_data: dict | None = None
    created_at: datetime

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
