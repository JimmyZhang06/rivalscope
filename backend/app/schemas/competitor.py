import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.url_security import normalize_and_validate_url


class CompetitorIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    alias: str = Field("", max_length=500)
    website: str = Field("", max_length=500)
    tech_focus: str = Field("", max_length=2000)
    keywords: list[str] = Field(default_factory=list)
    crawl_status: str = Field("", max_length=20)
    crawl_error: str = Field("", max_length=500)

    @field_validator("website", mode="before")
    @classmethod
    def validate_website(cls, v: Any) -> str:
        value = "" if v is None else str(v).strip()
        if not value:
            return ""
        return normalize_and_validate_url(value, allow_missing_scheme=True)


class CompetitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    name: str
    alias: str
    website: str
    tech_focus: str
    keywords: list[str]
    status: str
    crawl_status: str
    last_crawled_at: datetime | None = None
    crawl_error: str
    created_at: datetime
    updated_at: datetime

    @field_validator("keywords", mode="before")
    @classmethod
    def parse_keywords(cls, v: Any) -> list[str]:
        if isinstance(v, list):
            return v
        if isinstance(v, str) and v.strip():
            try:
                data = json.loads(v)
                return data if isinstance(data, list) else []
            except (ValueError, TypeError):
                return []
        return []
