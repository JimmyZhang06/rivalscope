"""定时追踪调度器：进程内每 60s 扫描到期的追踪项并触发调研

- FastAPI lifespan 中以 asyncio.create_task 启动
- 进程内 set 防重入：同一追踪项上一期没跑完不会触发下一期
- next_run_at 持久化在库中，服务重启不丢失
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import Notification, ResearchTask, Tracker, User
from app.services.agent import run_research

logger = logging.getLogger(__name__)

SCAN_INTERVAL = 60  # 秒
PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}

QUOTA_SKIP_TITLE = "定时追踪因额度不足跳过本期"

_running: set[str] = set()  # 正在执行的 tracker_id，防重入


def _as_utc(dt: datetime) -> datetime:
    """SQLite 读出的 datetime 可能丢失时区信息，统一补成 UTC"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def initial_next_run(frequency: str, run_hour: int) -> datetime:
    """新建/修改追踪项时计算首次运行时间：下一个 run_hour 整点（服务器本地时区）"""
    local = datetime.now(timezone.utc).astimezone()
    candidate = local.replace(hour=run_hour, minute=0, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def advance_next_run(tracker: Tracker, now: datetime) -> datetime:
    """按频率推算下一次运行时间（跳过已错过的期数）"""
    period = timedelta(days=PERIOD_DAYS.get(tracker.frequency, 7))
    nxt = _as_utc(tracker.next_run_at) if tracker.next_run_at else now
    while nxt <= now:
        nxt += period
    return nxt


async def _run_and_release(tracker_id: str, task_id: str) -> None:
    try:
        await run_research(task_id)
    finally:
        _running.discard(tracker_id)


def _notify_quota_skip(db, tracker: Tracker, reason: str) -> None:
    """额度不足跳过时通知创建人，同一追踪项本月内只通知一次"""
    from app.api.deps import month_start_utc

    link = f"/app/trackers/{tracker.id}"
    exists = (
        db.query(Notification)
        .filter(
            Notification.user_id == tracker.creator_id,
            Notification.title == QUOTA_SKIP_TITLE,
            Notification.link == link,
            Notification.created_at >= month_start_utc(),
        )
        .count()
    )
    if exists:
        return
    db.add(
        Notification(
            user_id=tracker.creator_id,
            org_id=tracker.org_id,
            title=QUOTA_SKIP_TITLE,
            body=f"「{tracker.product_name}」本期未运行：{reason}",
            link=link,
        )
    )


def _scan_once() -> None:
    from app.api.deps import check_quota_or_403

    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        due = (
            db.query(Tracker)
            .filter(Tracker.enabled.is_(True), Tracker.next_run_at.isnot(None), Tracker.next_run_at <= now)
            .all()
        )
        for tracker in due:
            if tracker.id in _running:
                continue
            # 以创建人身份校验配额：额度不足时跳过本期并顺延，避免每分钟重试
            creator = db.get(User, tracker.creator_id)
            if creator:
                try:
                    check_quota_or_403(db, creator)
                except HTTPException as exc:
                    tracker.next_run_at = advance_next_run(tracker, now)
                    _notify_quota_skip(db, tracker, str(exc.detail))
                    db.commit()
                    logger.info("scheduler skipped tracker %s: %s", tracker.id, exc.detail)
                    continue
            task = ResearchTask(
                user_id=tracker.creator_id,
                org_id=tracker.org_id,
                tracker_id=tracker.id,
                product_name=tracker.product_name,
                competitors=tracker.competitors,
                focus=tracker.focus,
                time_range=tracker.time_range,
            )
            db.add(task)
            tracker.last_run_at = now
            tracker.next_run_at = advance_next_run(tracker, now)
            db.commit()
            db.refresh(task)
            _running.add(tracker.id)
            asyncio.get_running_loop().create_task(_run_and_release(tracker.id, task.id))
            logger.info("scheduler triggered tracker %s -> task %s", tracker.id, task.id)


async def scheduler_loop() -> None:
    logger.info("tracker scheduler started (interval %ss)", SCAN_INTERVAL)
    while True:
        try:
            _scan_once()
        except Exception:
            logger.exception("scheduler scan failed")
        await asyncio.sleep(SCAN_INTERVAL)
