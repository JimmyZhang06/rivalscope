"""页面快照服务：抓取来源页面的 HTML 存档 + 纯文本提取"""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

from app.db.database import SessionLocal
from app.db.models import SourceArchive
from app.core.url_security import safe_external_request

logger = logging.getLogger(__name__)
SNAPSHOT_TIMEOUT_SECONDS = 15


async def capture_snapshot(url: str, raw_content: str = "") -> dict[str, Any]:
    """
    抓取页面快照并返回 SourceArchive 字段字典。

    策略：httpx 获取 HTML（15s 超时）+ BeautifulSoup 纯文本提取。
    网络失败时降级为保存 raw_content，标记 access_status。
    调用方负责写入数据库（传入 task_id + source_id）。
    """
    now = datetime.now(timezone.utc)
    published_at = ""
    html = ""
    text = ""
    access_status = "success"
    access_error = ""

    if raw_content:
        text = raw_content
        html = f"<html><body><pre>{raw_content}</pre></body></html>"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Bound the complete request, including redirects and response reading;
            # httpx's per-I/O timeout alone does not bound total elapsed time.
            resp = await asyncio.wait_for(
                safe_external_request(
                    client,
                    "GET",
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; ResearchAgent/1.0)"},
                ),
                timeout=SNAPSHOT_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            html = resp.text[:500_000]
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            pub_meta = resp.headers.get("last-modified") or resp.headers.get("date", "")
            if pub_meta:
                published_at = pub_meta[:50]
            access_status = "success"
    except Exception as exc:
        logger.warning("snapshot failed for %s: %s", url, exc)
        access_status = "failed"
        access_error = str(exc)[:500]
        if not text:
            text = raw_content or ""
        if not html:
            html = f"<html><body><pre>{text}</pre></body></html>"

    return {
        "snapshot_html": html,
        "snapshot_text": text,
        "snapshot_format": "html",
        "published_at": published_at,
        "collected_at": now,
        "access_status": access_status,
        "access_error": access_error,
        "raw_content_full": text,
    }


async def save_archive(task_id: str, source_id: int, url: str, raw_content: str = "") -> None:
    """
    抓取快照并写入 SourceArchive（失败不影响调用方流程）。
    """
    try:
        data = await capture_snapshot(url, raw_content)
        with SessionLocal() as db:
            db.add(SourceArchive(task_id=task_id, source_id=source_id, **data))
            db.commit()
    except Exception:
        logger.exception("archive write failed for task %s source %d", task_id, source_id)
