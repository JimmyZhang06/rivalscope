from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.auth import delete_account
from app.db.database import Base
from app.db.models import User
from app.schemas.auth import DeleteAccountIn


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def test_organization_member_must_leave_before_deleting_account():
    db = _session()
    user = User(
        id="member-1",
        email="member@example.com",
        password_hash="unused",
        org_id="org-1",
        org_role="member",
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        delete_account(DeleteAccountIn(password="irrelevant"), user, db)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "请先退出所属企业，再注销账号"
    assert db.get(User, user.id) is not None
