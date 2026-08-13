from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_user_from_stream_ticket
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_stream_ticket,
    decode_stream_ticket,
)
from app.db.database import Base
from app.db.models import User


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def _configure_jwt(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "test-stream-ticket-secret-long-enough")
    monkeypatch.setenv("JWT_ISSUER", "stream-ticket-tests")
    get_settings.cache_clear()


def test_stream_ticket_is_scoped_to_one_task(monkeypatch):
    _configure_jwt(monkeypatch)
    db = _session()
    user = User(
        id="user-1",
        email="user-1@example.com",
        password_hash="hash",
        token_version=3,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()

    ticket = create_stream_ticket(user.id, "task-1", user.token_version)

    assert decode_stream_ticket(ticket) == ("user-1", 3, "task-1")
    assert get_user_from_stream_ticket(ticket, "task-1", db).id == user.id

    try:
        get_user_from_stream_ticket(ticket, "task-2", db)
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("ticket must not be reusable for another task")


def test_access_token_cannot_be_used_as_stream_ticket(monkeypatch):
    _configure_jwt(monkeypatch)
    access_token = create_access_token("user-1", 0)
    assert decode_stream_ticket(access_token) is None
