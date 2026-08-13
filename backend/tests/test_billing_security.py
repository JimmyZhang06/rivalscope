from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.billing import list_orders, list_plans, upgrade
from app.core.config import get_settings
from app.db.database import Base
from app.db.models import Order, Organization, User
from app.schemas.auth import UpgradeIn


@pytest.fixture(autouse=True)
def _clear_settings_cache_after_test():
    yield
    get_settings.cache_clear()


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def _configure(monkeypatch, *, app_env: str, enabled: bool) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("ENABLE_SIMULATED_BILLING", "true" if enabled else "false")
    get_settings.cache_clear()


def _user(user_id: str = "user-1", **overrides) -> User:
    values = {
        "id": user_id,
        "email": f"{user_id}@example.com",
        "password_hash": "hash",
        "plan": "free",
        "created_at": datetime.now(timezone.utc),
    }
    values.update(overrides)
    return User(**values)


def _assert_http_error(status_code: int, call) -> HTTPException:
    with pytest.raises(HTTPException) as exc_info:
        call()
    assert exc_info.value.status_code == status_code
    return exc_info.value


def test_production_forces_simulated_billing_off_even_when_enabled(monkeypatch):
    _configure(monkeypatch, app_env="production", enabled=True)
    db = _session()
    user = _user()
    db.add(user)
    db.commit()

    _assert_http_error(503, lambda: upgrade(UpgradeIn(plan="pro"), user, db))

    db.refresh(user)
    assert user.plan == "free"
    assert db.query(Order).count() == 0


def test_test_environment_requires_explicit_opt_in(monkeypatch):
    _configure(monkeypatch, app_env="test", enabled=False)
    db = _session()
    user = _user()
    db.add(user)
    db.commit()

    _assert_http_error(503, lambda: upgrade(UpgradeIn(plan="pro"), user, db))
    assert db.query(Order).count() == 0


def test_test_environment_can_explicitly_enable_simulated_billing(monkeypatch):
    _configure(monkeypatch, app_env="test", enabled=True)
    db = _session()
    user = _user()
    db.add(user)
    db.commit()

    order = upgrade(UpgradeIn(plan="pro"), user, db)

    assert order.status == "paid"
    assert order.amount == 99
    assert user.plan == "pro"
    assert [item.id for item in list_orders(user, db)] == [order.id]
    assert {plan["key"] for plan in list_plans()} == {"free", "pro", "enterprise"}


def test_organization_member_cannot_upgrade_or_create_order(monkeypatch):
    _configure(monkeypatch, app_env="test", enabled=True)
    db = _session()
    org = Organization(id="org-1", name="Example", owner_id="owner-1")
    member = _user("member-1", org_id=org.id, org_role="member")
    db.add_all([org, member])
    db.commit()

    _assert_http_error(403, lambda: upgrade(UpgradeIn(plan="enterprise"), member, db))

    db.refresh(org)
    assert org.plan == "free"
    assert db.query(Order).count() == 0


@pytest.mark.parametrize("org_role", ["owner", "admin"])
def test_organization_privileged_roles_upgrade_the_organization(monkeypatch, org_role):
    _configure(monkeypatch, app_env="test", enabled=True)
    db = _session()
    org = Organization(id="org-1", name="Example", owner_id="user-1")
    user = _user(org_id=org.id, org_role=org_role)
    db.add_all([org, user])
    db.commit()

    order = upgrade(UpgradeIn(plan="enterprise"), user, db)

    assert order.status == "paid"
    assert org.plan == "enterprise"
    assert user.plan == "free"
    assert db.query(Order).count() == 1
