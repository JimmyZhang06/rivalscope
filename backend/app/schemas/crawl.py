"""爬取任务相关 Pydantic Schemas"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CrawlStartIn(BaseModel):
    """启动爬取请求体"""
    max_pages: int = Field(default=50, ge=5, le=200)


class CrawlStartOut(BaseModel):
    """启动爬取响应"""
    task_id: str
    competitor_id: str
    status: str


class CrawlStatusOut(BaseModel):
    """爬取任务状态"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    competitor_id: str
    org_id: str
    user_id: str
    status: str
    total_pages: int
    crawled_pages: int
    error: str
    crawl_config: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    @staticmethod
    def _parse_config(v: Any) -> dict:
        if isinstance(v, dict):
            return v
        if isinstance(v, str) and v.strip():
            try:
                import json
                data = json.loads(v)
                return data if isinstance(data, dict) else {}
            except (ValueError, TypeError):
                return {}
        return {}


class CompetitorPageOut(BaseModel):
    """爬取到的页面"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    competitor_id: str
    url: str
    page_type: str
    title: str
    access_status: str
    access_error: str
    discovered_at: datetime
    crawled_at: datetime | None
