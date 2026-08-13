"""数据库持久化作业队列与租约原语。

本模块只提供后续迁移需要的基础能力；现有 FastAPI BackgroundTasks 调用链
在 M1 第一阶段保持不变。每个公开的状态变更方法都是一个独立短事务。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, TypeVar, cast

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Job, JobStep, Outbox


class JobQueueError(RuntimeError):
    """队列操作失败。"""


class LeaseLostError(JobQueueError):
    """worker 不再持有目标记录的有效租约。"""


class InvalidTransitionError(JobQueueError):
    """记录当前状态不允许所请求的转换。"""


QueueRecord = TypeVar("QueueRecord", Job, Outbox)


def _now(value: datetime | None = None) -> datetime:
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _json(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def enqueue_job(
    db: Session,
    *,
    kind: str,
    idempotency_key: str,
    payload: Any = None,
    queue: str = "default",
    priority: int = 0,
    max_attempts: int = 3,
    available_at: datetime | None = None,
) -> Job:
    """按 ``queue + idempotency_key`` 幂等创建作业并提交。"""
    if not kind or not idempotency_key:
        raise ValueError("kind and idempotency_key are required")
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    job = Job(
        kind=kind,
        idempotency_key=idempotency_key,
        payload=_json({} if payload is None else payload),
        queue=queue,
        priority=priority,
        max_attempts=max_attempts,
        available_at=_now(available_at),
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Job).where(
            Job.queue == queue,
            Job.idempotency_key == idempotency_key,
        ))
        if existing is None:
            raise
        return existing
    db.refresh(job)
    return job


def _eligible(model: type[QueueRecord], queued_status: str, running_status: str, now: datetime):
    return or_(
        and_(
            model.status == queued_status,
            model.available_at <= now,
            model.attempts < model.max_attempts,
        ),
        and_(
            model.status == running_status,
            model.lease_expires_at.is_not(None),
            model.lease_expires_at <= now,
            model.attempts < model.max_attempts,
        ),
    )


def _expire_exhausted(
    db: Session,
    model: type[QueueRecord],
    *,
    running_status: str,
    failed_status: str,
    now: datetime,
) -> None:
    db.execute(
        update(model)
        .where(
            model.status == running_status,
            model.lease_expires_at.is_not(None),
            model.lease_expires_at <= now,
            model.attempts >= model.max_attempts,
        )
        .values(
            status=failed_status,
            error="lease expired after maximum attempts",
            lease_owner="",
            lease_token="",
            lease_expires_at=None,
            updated_at=now,
        )
        .execution_options(synchronize_session=False)
    )


def _claim(
    db: Session,
    model: type[QueueRecord],
    *,
    worker_id: str,
    lease_seconds: int,
    queued_status: str,
    running_status: str,
    failed_status: str,
    now: datetime,
    extra_filter=(),
    order_by=(),
    claim_values: dict[str, Any] | None = None,
) -> QueueRecord | None:
    if not worker_id:
        raise ValueError("worker_id is required")
    if lease_seconds < 1:
        raise ValueError("lease_seconds must be at least 1")

    _expire_exhausted(
        db,
        model,
        running_status=running_status,
        failed_status=failed_status,
        now=now,
    )
    eligible = _eligible(model, queued_status, running_status, now)
    candidate = (
        select(model.id)
        .where(eligible, *extra_filter)
        .order_by(*order_by)
        .limit(1)
        .scalar_subquery()
    )
    token = uuid.uuid4().hex
    values = {
        "status": running_status,
        "attempts": model.attempts + 1,
        "lease_owner": worker_id,
        "lease_token": token,
        "lease_expires_at": now + timedelta(seconds=lease_seconds),
        "last_heartbeat_at": now,
        "updated_at": now,
    }
    values.update(claim_values or {})
    result = db.execute(
        update(model)
        .where(model.id == candidate, eligible)
        .values(**values)
        .returning(model.id)
        .execution_options(synchronize_session=False)
    ).first()
    db.commit()
    if result is None:
        return None
    db.expire_all()
    return db.get(model, result[0])


def claim_job(
    db: Session,
    *,
    worker_id: str,
    queue: str = "default",
    lease_seconds: int = 60,
    now: datetime | None = None,
) -> Job | None:
    """原子领取一个可执行或租约已过期的 Job。"""
    claimed = _claim(
        db,
        Job,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        queued_status="queued",
        running_status="running",
        failed_status="failed",
        now=_now(now),
        extra_filter=(Job.queue == queue,),
        order_by=(Job.priority.desc(), Job.available_at, Job.created_at),
        claim_values={"started_at": func.coalesce(Job.started_at, _now(now))},
    )
    return cast(Job | None, claimed)


def _owned_active_lease(model: type[QueueRecord], record_id: str, worker_id: str, lease_token: str, now: datetime):
    return and_(
        model.id == record_id,
        model.lease_owner == worker_id,
        model.lease_token == lease_token,
        model.lease_expires_at.is_not(None),
        model.lease_expires_at > now,
    )


def _leased_update(
    db: Session,
    model: type[QueueRecord],
    *,
    record_id: str,
    worker_id: str,
    lease_token: str,
    running_status: str,
    now: datetime,
    values: dict[str, Any],
) -> QueueRecord:
    result = db.execute(
        update(model)
        .where(
            _owned_active_lease(model, record_id, worker_id, lease_token, now),
            model.status == running_status,
        )
        .values(updated_at=now, **values)
        .returning(model.id)
        .execution_options(synchronize_session=False)
    ).first()
    if result is None:
        db.rollback()
        raise LeaseLostError(f"active lease lost for {model.__tablename__} {record_id}")
    db.commit()
    db.expire_all()
    record = db.get(model, result[0])
    assert record is not None
    return record


def heartbeat_job(
    db: Session,
    job_id: str,
    *,
    worker_id: str,
    lease_token: str,
    lease_seconds: int = 60,
    now: datetime | None = None,
) -> Job:
    """延长当前 Job 租约；过期或令牌不匹配时拒绝。"""
    if lease_seconds < 1:
        raise ValueError("lease_seconds must be at least 1")
    heartbeat_at = _now(now)
    record = _leased_update(
        db,
        Job,
        record_id=job_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="running",
        now=heartbeat_at,
        values={
            "last_heartbeat_at": heartbeat_at,
            "lease_expires_at": heartbeat_at + timedelta(seconds=lease_seconds),
        },
    )
    return cast(Job, record)


def complete_job(
    db: Session,
    job_id: str,
    *,
    worker_id: str,
    lease_token: str,
    result: Any = None,
    now: datetime | None = None,
) -> Job:
    """由当前租约持有者将 Job 从 running 转为 succeeded。"""
    completed_at = _now(now)
    record = _leased_update(
        db,
        Job,
        record_id=job_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="running",
        now=completed_at,
        values={
            "status": "succeeded",
            "result": _json({} if result is None else result),
            "error": "",
            "completed_at": completed_at,
            "lease_owner": "",
            "lease_token": "",
            "lease_expires_at": None,
        },
    )
    return cast(Job, record)


def fail_job(
    db: Session,
    job_id: str,
    *,
    worker_id: str,
    lease_token: str,
    error: str,
    retryable: bool = True,
    retry_delay_seconds: int = 0,
    now: datetime | None = None,
) -> Job:
    """失败当前尝试；未耗尽时重新排队，否则进入终态 failed。"""
    failed_at = _now(now)
    job = db.get(Job, job_id)
    if job is None:
        raise InvalidTransitionError(f"job {job_id} does not exist")
    will_retry = retryable and job.attempts < job.max_attempts
    values: dict[str, Any] = {
        "status": "queued" if will_retry else "failed",
        "error": error,
        "available_at": failed_at + timedelta(seconds=max(0, retry_delay_seconds)),
        "completed_at": None if will_retry else failed_at,
        "lease_owner": "",
        "lease_token": "",
        "lease_expires_at": None,
    }
    record = _leased_update(
        db,
        Job,
        record_id=job_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="running",
        now=failed_at,
        values=values,
    )
    return cast(Job, record)


def add_job_step(
    db: Session,
    job_id: str,
    *,
    seq: int,
    name: str,
    status: str = "running",
    detail: str = "",
) -> JobStep:
    """追加一个唯一序号的 JobStep。"""
    step = JobStep(job_id=job_id, seq=seq, name=name, status=status, detail=detail)
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


def enqueue_outbox(
    db: Session,
    *,
    topic: str,
    idempotency_key: str,
    payload: Any,
    aggregate_type: str = "",
    aggregate_id: str = "",
    max_attempts: int = 5,
    available_at: datetime | None = None,
) -> Outbox:
    """幂等创建 Outbox 事件并提交。"""
    if not topic or not idempotency_key:
        raise ValueError("topic and idempotency_key are required")
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    event = Outbox(
        topic=topic,
        idempotency_key=idempotency_key,
        payload=_json(payload),
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        max_attempts=max_attempts,
        available_at=_now(available_at),
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Outbox).where(Outbox.idempotency_key == idempotency_key))
        if existing is None:
            raise
        return existing
    db.refresh(event)
    return event


def stage_outbox(
    db: Session,
    *,
    topic: str,
    idempotency_key: str,
    payload: Any,
    aggregate_type: str = "",
    aggregate_id: str = "",
    max_attempts: int = 5,
    available_at: datetime | None = None,
) -> Outbox:
    """将事件加入当前业务事务；提交与回滚均由调用者负责。"""
    if not topic or not idempotency_key:
        raise ValueError("topic and idempotency_key are required")
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    event = Outbox(
        topic=topic,
        idempotency_key=idempotency_key,
        payload=_json(payload),
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        max_attempts=max_attempts,
        available_at=_now(available_at),
    )
    db.add(event)
    return event


def claim_outbox(
    db: Session,
    *,
    worker_id: str,
    lease_seconds: int = 60,
    now: datetime | None = None,
) -> Outbox | None:
    """原子领取一个待投递或租约已过期的 Outbox 事件。"""
    claimed = _claim(
        db,
        Outbox,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        queued_status="pending",
        running_status="publishing",
        failed_status="failed",
        now=_now(now),
        order_by=(Outbox.available_at, Outbox.created_at),
    )
    return cast(Outbox | None, claimed)


def heartbeat_outbox(
    db: Session,
    event_id: str,
    *,
    worker_id: str,
    lease_token: str,
    lease_seconds: int = 60,
    now: datetime | None = None,
) -> Outbox:
    heartbeat_at = _now(now)
    record = _leased_update(
        db,
        Outbox,
        record_id=event_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="publishing",
        now=heartbeat_at,
        values={
            "last_heartbeat_at": heartbeat_at,
            "lease_expires_at": heartbeat_at + timedelta(seconds=lease_seconds),
        },
    )
    return cast(Outbox, record)


def complete_outbox(
    db: Session,
    event_id: str,
    *,
    worker_id: str,
    lease_token: str,
    now: datetime | None = None,
) -> Outbox:
    published_at = _now(now)
    record = _leased_update(
        db,
        Outbox,
        record_id=event_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="publishing",
        now=published_at,
        values={
            "status": "published",
            "error": "",
            "published_at": published_at,
            "lease_owner": "",
            "lease_token": "",
            "lease_expires_at": None,
        },
    )
    return cast(Outbox, record)


def fail_outbox(
    db: Session,
    event_id: str,
    *,
    worker_id: str,
    lease_token: str,
    error: str,
    retryable: bool = True,
    retry_delay_seconds: int = 0,
    now: datetime | None = None,
) -> Outbox:
    failed_at = _now(now)
    event = db.get(Outbox, event_id)
    if event is None:
        raise InvalidTransitionError(f"outbox event {event_id} does not exist")
    will_retry = retryable and event.attempts < event.max_attempts
    record = _leased_update(
        db,
        Outbox,
        record_id=event_id,
        worker_id=worker_id,
        lease_token=lease_token,
        running_status="publishing",
        now=failed_at,
        values={
            "status": "pending" if will_retry else "failed",
            "error": error,
            "available_at": failed_at + timedelta(seconds=max(0, retry_delay_seconds)),
            "lease_owner": "",
            "lease_token": "",
            "lease_expires_at": None,
        },
    )
    return cast(Outbox, record)
