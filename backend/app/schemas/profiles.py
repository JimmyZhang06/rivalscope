import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DimensionField(BaseModel):
    key: str
    label: str
    type: str = "text"  # text / number / date


class DimensionDef(BaseModel):
    key: str
    label: str
    fields: list[DimensionField] = Field(default_factory=list)


class ProfileTemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    dimensions: list[DimensionDef]
    org_id: str = Field("", max_length=32)


class ProfileTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    name: str
    dimensions: list[dict]
    version: int
    frozen_at: datetime | None
    created_by: str
    created_at: datetime

    @field_validator("dimensions", mode="before")
    @classmethod
    def parse_dimensions(cls, v: Any) -> list[dict]:
        if isinstance(v, list):
            return v
        if isinstance(v, str) and v.strip():
            try:
                data = json.loads(v)
                return data if isinstance(data, list) else []
            except (ValueError, TypeError):
                return []
        return []


class ProfileTemplateFreezeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    frozen_at: datetime | None


class CompetitorProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    competitor_id: str
    template_id: str
    profile_data: dict
    source_refs: list[dict]
    status: str
    frozen_at: datetime | None
    generation_source: str = ""
    created_at: datetime
    updated_at: datetime
    report_markdown: str = ""
    insights_json: str = ""
    source_index_json: str = ""

    @field_validator("profile_data", mode="before")
    @classmethod
    def parse_profile_data(cls, v: Any) -> dict:
        if isinstance(v, dict):
            return v
        if isinstance(v, str) and v.strip():
            try:
                data = json.loads(v)
                return data if isinstance(data, dict) else {}
            except (ValueError, TypeError):
                return {}
        return {}

    @field_validator("source_refs", mode="before")
    @classmethod
    def parse_source_refs(cls, v: Any) -> list[dict]:
        if isinstance(v, list):
            return v
        if isinstance(v, str) and v.strip():
            try:
                data = json.loads(v)
                return data if isinstance(data, list) else []
            except (ValueError, TypeError):
                return []
        return []


class ProfileGenerateIn(BaseModel):
    competitor_id: str
    template_id: str


class GenerateFromCrawlOut(BaseModel):
    task_id: str
    competitor_id: str
    template_id: str
    status: str


class GenerateStatusOut(BaseModel):
    task_id: str
    competitor_id: str
    template_id: str
    status: str
    error: str
    created_at: datetime | None
    updated_at: datetime | None
    result: dict | None = None


class ProfileFreezeOut(BaseModel):
    id: str
    status: str
    frozen_at: datetime | None


# ---------- 横向对比 ----------

class ComparisonIn(BaseModel):
    template_id: str
    profile_ids: list[str] = Field(..., min_length=2, max_length=10)


class ComparisonMatrixRow(BaseModel):
    dimension: str
    values: dict[str, str]


class ComparisonOut(BaseModel):
    template_name: str
    dimensions: list[str]
    matrix: list[ComparisonMatrixRow]
    source_refs: list[list[dict]]


# ---------- 画像报告与洞察 ----------

class ProfileInsightsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scores: dict[str, float | str] = Field(default_factory=dict)
    verdict: str = ""
    positioning: str = ""
    swot: dict[str, list[str]] = Field(default_factory=dict)
    timeline: list[dict] = Field(default_factory=list)
