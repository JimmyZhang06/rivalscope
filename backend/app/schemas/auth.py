import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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
    month_used: int = 0  # 本月已消耗额度（调研 + 图谱，失败不计）


class AdminOrgUpdate(BaseModel):
    plan: str | None = None  # free / pro / enterprise


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


class UsageOut(BaseModel):
    months: list[MonthUsage]
    quota: QuotaOut


class ForgotIn(BaseModel):
    email: EmailStr


class ForgotOut(BaseModel):
    message: str
    demo_code: str  # 演示模式：无邮件服务，验证码直接返回


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)
