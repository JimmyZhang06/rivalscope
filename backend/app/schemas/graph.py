"""产业链关系图谱相关的请求/响应模型"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

TIME_RANGES = ("", "day", "week", "month", "year")

# 关系类型 -> 中文标签（前端也有一份，后端用于校验/展示兜底）
RELATION_TYPES = (
    "upstream_supplier",
    "downstream_customer",
    "competitor",
    "partner",
    "investor",
    "parent",
    "subsidiary",
)


class GraphCreate(BaseModel):
    """创建关系图谱请求"""

    root_name: str = Field(..., min_length=1, max_length=200, description="根对象（企业/产品）名称")
    industry: str = Field("", max_length=100, description="可选：所属行业，辅助检索")
    competitors: str = Field("", max_length=2000, description="可选：已知竞争对手，逗号分隔")
    time_range: str = Field("year", description="检索时效：''/day/week/month/year")

    @field_validator("time_range")
    @classmethod
    def check_time_range(cls, v: str) -> str:
        if v not in TIME_RANGES:
            raise ValueError("time_range 仅支持 ''/day/week/month/year")
        return v


class GraphProjectOut(BaseModel):
    """图谱项目列表项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    root_name: str
    industry: str
    time_range: str
    status: str
    error: str
    org_id: str = ""
    created_at: datetime
    updated_at: datetime


class GraphEntityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    type: str
    industry: str
    description: str
    is_root: bool


class GraphRelationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    target_id: str
    relation_type: str
    description: str
    confidence: float
    source_url: str


class GraphDetailOut(GraphProjectOut):
    """图谱详情：项目 + 实体 + 关系（供渲染）"""

    report_markdown: str = ""
    entities: list[GraphEntityOut] = []
    relations: list[GraphRelationOut] = []
