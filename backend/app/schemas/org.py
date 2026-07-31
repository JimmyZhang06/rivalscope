"""企业组织相关的请求/响应模型"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OrgCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class OrgUpdateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class OrgJoinIn(BaseModel):
    invite_code: str = Field(..., min_length=8, max_length=8)


class OrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    plan: str
    plan_expires_at: datetime | None
    owner_id: str
    invite_code: str
    created_at: datetime


class OrgMeOut(BaseModel):
    """当前用户的企业信息；org 为 null 表示未加入企业"""

    org: OrgOut | None
    org_role: str = ""
    member_count: int = 0


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    nickname: str
    avatar: str = ""
    org_role: str
    org_monthly_limit: int = -1  # 管理员设置的月调研额度，-1 不限
    created_at: datetime
    # 端点手动填充
    month_used: int = 0  # 本月本人发起的调研次数


class MemberUpdateIn(BaseModel):
    """两个字段均可选，支持单独改角色或额度"""

    org_role: str | None = None  # admin / member
    org_monthly_limit: int | None = Field(default=None, ge=-1)  # -1 不限，0 禁止发起
