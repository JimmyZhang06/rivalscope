"""持久化 Job/Outbox 队列的 SQLite 回归测试。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.database import Base
from app.db.models import Job, JobStep, Outbox
from app.services.job_queue import (
    LeaseLostError,
    add_job_step,
    claim_job,
    claim_outbox,
    complete_job,
    complete_outbox,
    enqueue_job,
    enqueue_outbox,
    fail_job,
    heartbeat_job,
    stage_outbox,
)


@pytest.fixture
def sessions(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'jobs.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        engine.dispose()


def test_job_and_outbox_idempotency(sessions):
    with sessions() as db:
        first = enqueue_job(
            db,
            kind="research.run",
            idempotency_key="research:42",
            payload={"task_id": "42"},
        )
        duplicate = enqueue_job(
            db,
            kind="research.run",
            idempotency_key="research:42",
            payload={"task_id": "different"},
        )
        other_queue = enqueue_job(
            db,
            queue="slow",
            kind="research.run",
            idempotency_key="research:42",
        )
        event = enqueue_outbox(
            db,
            topic="research.completed",
            idempotency_key="research:42:completed",
            payload={"task_id": "42"},
        )
        duplicate_event = enqueue_outbox(
            db,
            topic="research.completed",
            idempotency_key="research:42:completed",
            payload={"task_id": "different"},
        )

        assert first.id == duplicate.id
        assert other_queue.id != first.id
        assert event.id == duplicate_event.id
        assert db.scalar(select(func.count()).select_from(Job)) == 2
        assert db.scalar(select(func.count()).select_from(Outbox)) == 1


def test_create_all_adds_job_tables_without_touching_existing_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE legacy_records (id INTEGER PRIMARY KEY, value TEXT)")
        connection.exec_driver_sql("INSERT INTO legacy_records VALUES (1, 'keep-me')")

    Base.metadata.create_all(engine)

    with engine.connect() as connection:
        tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert {"jobs", "job_steps", "outbox"}.issubset(tables)
        assert connection.exec_driver_sql("SELECT value FROM legacy_records WHERE id=1").scalar_one() == "keep-me"
    engine.dispose()


def test_job_state_machine_heartbeat_complete_fail_and_steps(sessions):
    now = datetime(2026, 8, 13, 8, 0, tzinfo=timezone.utc)
    with sessions() as db:
        retry_job = enqueue_job(
            db,
            kind="profile.generate",
            idempotency_key="profile:1",
            max_attempts=2,
            available_at=now,
        )
        claimed = claim_job(db, worker_id="worker-a", lease_seconds=10, now=now)
        assert claimed is not None
        assert claimed.id == retry_job.id
        assert claimed.status == "running"
        assert claimed.attempts == 1
        assert claimed.started_at is not None
        first_token = claimed.lease_token

        heartbeat = heartbeat_job(
            db,
            claimed.id,
            worker_id="worker-a",
            lease_token=first_token,
            lease_seconds=30,
            now=now + timedelta(seconds=5),
        )
        assert heartbeat.lease_expires_at.replace(tzinfo=timezone.utc) == now + timedelta(seconds=35)

        step = add_job_step(db, claimed.id, seq=1, name="collect", detail="started")
        assert step.status == "running"

        retried = fail_job(
            db,
            claimed.id,
            worker_id="worker-a",
            lease_token=first_token,
            error="temporary",
            now=now + timedelta(seconds=6),
        )
        assert retried.status == "queued"

        second = claim_job(db, worker_id="worker-b", lease_seconds=10, now=now + timedelta(seconds=7))
        assert second is not None
        assert second.attempts == 2
        assert second.lease_token != first_token
        done = complete_job(
            db,
            second.id,
            worker_id="worker-b",
            lease_token=second.lease_token,
            result={"ok": True},
            now=now + timedelta(seconds=8),
        )
        assert done.status == "succeeded"
        assert done.result == '{"ok":true}'
        assert db.scalars(select(JobStep).where(JobStep.job_id == done.id)).all() == [step]

        with pytest.raises(LeaseLostError):
            complete_job(
                db,
                done.id,
                worker_id="worker-a",
                lease_token=first_token,
                now=now + timedelta(seconds=9),
            )


def test_two_workers_cannot_claim_the_same_job(sessions):
    with sessions() as db:
        job = enqueue_job(db, kind="crawl", idempotency_key="crawl:one")

    barrier = Barrier(2)

    def compete(worker_id: str):
        with sessions() as db:
            barrier.wait()
            claimed = claim_job(db, worker_id=worker_id, lease_seconds=60)
            return None if claimed is None else (claimed.id, claimed.lease_owner)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compete, ("worker-a", "worker-b")))

    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    assert winners[0][0] == job.id
    assert winners[0][1] in {"worker-a", "worker-b"}


def test_expired_lease_is_reclaimed_and_old_worker_is_fenced(sessions):
    now = datetime(2026, 8, 13, 9, 0, tzinfo=timezone.utc)
    with sessions() as db:
        enqueue_job(
            db,
            kind="graph.build",
            idempotency_key="graph:7",
            max_attempts=2,
            available_at=now,
        )
        first = claim_job(db, worker_id="worker-a", lease_seconds=5, now=now)
        assert first is not None
        old_token = first.lease_token

        assert claim_job(db, worker_id="worker-b", now=now + timedelta(seconds=4)) is None
        recovered = claim_job(db, worker_id="worker-b", lease_seconds=30, now=now + timedelta(seconds=6))
        assert recovered is not None
        assert recovered.id == first.id
        assert recovered.attempts == 2
        assert recovered.lease_token != old_token

        with pytest.raises(LeaseLostError):
            complete_job(
                db,
                first.id,
                worker_id="worker-a",
                lease_token=old_token,
                now=now + timedelta(seconds=7),
            )

        fail_job(
            db,
            recovered.id,
            worker_id="worker-b",
            lease_token=recovered.lease_token,
            error="permanent",
            now=now + timedelta(seconds=7),
        )
        terminal = db.get(Job, recovered.id)
        assert terminal is not None
        assert terminal.status == "failed"
        assert claim_job(db, worker_id="worker-c", now=now + timedelta(seconds=8)) is None


def test_expired_final_attempt_is_closed_as_failed(sessions):
    now = datetime(2026, 8, 13, 9, 30, tzinfo=timezone.utc)
    with sessions() as db:
        job = enqueue_job(
            db,
            kind="digest.send",
            idempotency_key="digest:final-attempt",
            max_attempts=1,
            available_at=now,
        )
        claimed = claim_job(db, worker_id="worker-a", lease_seconds=5, now=now)
        assert claimed is not None

        assert claim_job(db, worker_id="worker-b", now=now + timedelta(seconds=6)) is None
        db.refresh(job)
        assert job.status == "failed"
        assert job.error == "lease expired after maximum attempts"


def test_outbox_transaction_and_lease_lifecycle(sessions):
    now = datetime(2026, 8, 13, 10, 0, tzinfo=timezone.utc)
    with sessions() as db:
        staged = stage_outbox(
            db,
            topic="job.completed",
            idempotency_key="job:1:completed",
            payload={"job_id": "1"},
            available_at=now,
        )
        assert staged.id is None
        db.rollback()
        assert db.scalar(select(func.count()).select_from(Outbox)) == 0

        event = enqueue_outbox(
            db,
            topic="job.completed",
            idempotency_key="job:1:completed",
            payload={"job_id": "1"},
            available_at=now,
        )
        claimed = claim_outbox(db, worker_id="publisher", lease_seconds=10, now=now)
        assert claimed is not None
        assert claimed.id == event.id
        assert claimed.status == "publishing"

        published = complete_outbox(
            db,
            claimed.id,
            worker_id="publisher",
            lease_token=claimed.lease_token,
            now=now + timedelta(seconds=1),
        )
        assert published.status == "published"
        assert published.published_at is not None
