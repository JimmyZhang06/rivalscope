import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.admin import update_user
from app.db.database import Base
from app.db.models import AuditLog, User
from app.schemas.auth import AdminUserUpdate
from app.services import audit


def _audit_kwargs() -> dict:
    return {
        "user_id": "admin-1",
        "org_id": "org-1",
        "action": "admin.user_update",
        "resource_type": "user",
        "resource_id": "user-1",
        "status": "success",
    }


class _FailingSession:
    def __init__(self):
        self.rollback_calls = 0
        self.close_calls = 0

    def add(self, _value):
        return None

    def flush(self, *_args, **_kwargs):
        raise RuntimeError("injected audit storage failure")

    def commit(self):
        raise RuntimeError("injected audit storage failure")

    def rollback(self):
        self.rollback_calls += 1

    def close(self):
        self.close_calls += 1


def test_required_audit_rolls_back_and_exposes_failure():
    db = _FailingSession()

    with pytest.raises(audit.AuditWriteError):
        audit.log_audit_required(db=db, **_audit_kwargs())

    assert db.rollback_calls == 1


def test_best_effort_audit_reports_failure_without_raising(monkeypatch):
    db = _FailingSession()
    monkeypatch.setattr(audit, "SessionLocal", lambda: db)

    assert audit.log_audit_best_effort(**_audit_kwargs()) is False
    assert db.rollback_calls == 1
    assert db.close_calls == 1


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_admin_role_change_and_audit_commit_atomically(db_session):
    admin = User(
        id="admin-1", email="admin@example.com", password_hash="x", nickname="admin", role="admin"
    )
    target = User(
        id="user-1", email="user@example.com", password_hash="x", nickname="user", role="user"
    )
    db_session.add_all([admin, target])
    db_session.commit()

    update_user(
        target.id,
        AdminUserUpdate(role="admin"),
        admin=admin,
        db=db_session,
    )

    assert db_session.get(User, target.id).role == "admin"
    entry = db_session.query(AuditLog).one()
    assert entry.action == "admin.user_update"
    assert entry.resource_id == target.id


def test_admin_role_change_is_rolled_back_when_audit_flush_fails(db_session, monkeypatch):
    admin = User(
        id="admin-1", email="admin@example.com", password_hash="x", nickname="admin", role="admin"
    )
    target = User(
        id="user-1", email="user@example.com", password_hash="x", nickname="user", role="user"
    )
    db_session.add_all([admin, target])
    db_session.commit()

    original_flush = db_session.flush

    def fail_flush(*_args, **_kwargs):
        raise RuntimeError("injected audit storage failure")

    with monkeypatch.context() as patch:
        patch.setattr(db_session, "flush", fail_flush)
        with pytest.raises(HTTPException) as exc_info:
            update_user(
                target.id,
                AdminUserUpdate(role="admin"),
                admin=admin,
                db=db_session,
            )

    assert exc_info.value.status_code == 503
    # rollback 使对象回到数据库中的原值；审计与角色变更均没有部分提交。
    original_flush()
    db_session.expire_all()
    assert db_session.get(User, target.id).role == "user"
    assert db_session.query(AuditLog).count() == 0
