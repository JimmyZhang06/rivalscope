import re
from datetime import datetime

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from typing import Any

T = TypeVar("T")


class AdminListOut(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=64)
    nickname: str = Field(..., min_length=1, max_length=50)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("密码需至少 8 位且同时包含字母和数字")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    nickname: str
    avatar: str = ""
    role: str
    plan: str
    plan_expires_at: datetime | None
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str = ""
    user: UserOut


class QuotaOut(BaseModel):
    """当前用户本月配额情况"""

    plan: str
    plan_name: str
    used: int
    limit: int  # -1 表示不限
    max_queries: int
    member_used: int = 0  # 本月本人发起次数（企业成员维度）
    member_limit: int = -1  # 管理员设置的成员月额度，-1 未设限


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    plan: str
    amount: int
    status: str
    created_at: datetime
    paid_at: datetime | None


class UpgradeIn(BaseModel):
    plan: str  # pro / enterprise


class AdminUserUpdate(BaseModel):
    plan: str | None = None  # free / pro / enterprise
    role: str | None = None  # user / admin


class AdminStatsOut(BaseModel):
    total_users: int
    total_tasks: int
    tasks_this_month: int
    total_revenue: int
    paid_users: int


class AdminOrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    plan: str
    plan_expires_at: datetime | None
    invite_code: str
    created_at: datetime
    member_count: int = 0
    month_used: int = 0


class AdminOrgUpdate(BaseModel):
    plan: str | None = None


class AdminOrgListOut(BaseModel):
    items: list[AdminOrgOut]
    total: int
    page: int
    page_size: int


def _validate_password_strength(v: str) -> str:
    if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
        raise ValueError("密码需至少 8 位且同时包含字母和数字")
    return v


class ProfileUpdateIn(BaseModel):
    """修改个人资料：昵称 / 头像（预设色键或 data:image/ base64，压缩后约几十 KB）"""

    nickname: str | None = Field(default=None, min_length=1, max_length=50)
    avatar: str | None = Field(default=None, max_length=200_000)


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class DeleteAccountIn(BaseModel):
    password: str


class LoginLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    action: str
    ip: str
    user_agent: str
    created_at: datetime


class MonthUsage(BaseModel):
    month: str  # YYYY-MM
    count: int


class MemberUsage(BaseModel):
    """企业成员当月用量明细"""

    user_id: str
    nickname: str
    count: int = 0


class UsageOut(BaseModel):
    months: list[MonthUsage]
    quota: QuotaOut
    members: list[MemberUsage] | None = None  # 企业成员各自当月用量（企业成员视角）


class ForgotIn(BaseModel):
    email: EmailStr


class ForgotOut(BaseModel):
    message: str


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class RefreshIn(BaseModel):
    refresh_token: str


# ---------- 审计日志（Sprint 4） ----------

class AuditStatsOut(BaseModel):
    """审计统计概览"""
    total_logs: int
    today_logs: int
    success_count: int
    failed_count: int
    action_breakdown: list[dict[str, int]]
    top_models: list[dict[str, Any]]


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    org_id: str
    action: str
    resource_type: str
    resource_id: str
    input: str
    result: str
    status: str
    error: str
    model_name: str
    tokens_prompt: int
    tokens_completion: int
    cost: float
    ip: str
    user_agent: str
    created_at: datetime


class AuditLogQuery(BaseModel):
    action: str = ""
    resource_type: str = ""
    user_id: str = ""
    start: str = ""
    end: str = ""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


# ---------- 执行快照（Sprint 4） ----------

class ExecutionSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    tracker_id: str
    task_id: str
    config_hash: str
    model_params: str
    kb_version: str
    deployment_env: str
    candidate_version: str
    build_hash: str
    created_by: str
    created_at: datetime
