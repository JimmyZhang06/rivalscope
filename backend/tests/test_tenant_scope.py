"""TenantScope policy matrix and IDOR regression tests."""

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.tenant_scope import (
    ResourceNotFound,
    ResourceVisibility,
    TENANT_OR_OWNER,
    TENANT_OR_OWNER_WITH_LEGACY,
    TenantScope,
)
from app.db.database import Base
from app.db.models import ResearchTask, User


def actor(user_id: str, *, org_id: str = "", role: str = "user"):
    return SimpleNamespace(id=user_id, org_id=org_id, role=role)


@pytest.mark.parametrize(
    ("viewer", "resource_org", "owner", "allowed"),
    [
        (actor("a1", org_id="org-a"), "org-a", "a2", True),
        (actor("a1", org_id="org-a"), "org-b", "b1", False),
        (actor("a1", org_id="org-a"), "", "a1", True),
        (actor("a1", org_id="org-a"), "", "personal", False),
        (actor("personal"), "", "personal", True),
        (actor("personal"), "", "someone-else", False),
        (actor("personal"), "org-a", "a1", False),
        (actor("admin", role="admin"), "org-a", "a1", False),
        (actor("admin", role="admin"), "", "admin", True),
    ],
)
def test_tenant_or_owner_access_matrix(viewer, resource_org, owner, allowed):
    assert TenantScope(viewer).can_access(resource_org, owner, TENANT_OR_OWNER) is allowed


def test_admin_cross_tenant_access_is_explicit_opt_in():
    admin = TenantScope(actor("admin", role="admin"))

    assert not admin.can_access("org-b", "b1", TENANT_OR_OWNER)
    assert admin.can_access(
        "org-b",
        "b1",
        ResourceVisibility(admin_cross_tenant=True),
    )


def test_legacy_asset_policy_preserves_personal_owner_fallback():
    personal = TenantScope(actor("former-org-member"))

    assert personal.can_access(
        "old-org",
        "former-org-member",
        TENANT_OR_OWNER_WITH_LEGACY,
    )
    assert personal.can_access("old-org", "", TENANT_OR_OWNER_WITH_LEGACY)
    assert not personal.can_access("old-org", "other-member", TENANT_OR_OWNER_WITH_LEGACY)


def test_scoped_get_hides_cross_tenant_resource_existence():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine)
    db.add_all([
        User(id="a1", email="a@example.com", password_hash="hash", org_id="org-a"),
        User(id="b1", email="b@example.com", password_hash="hash", org_id="org-b"),
        ResearchTask(id="task-b", user_id="b1", org_id="org-b", product_name="Secret"),
    ])
    db.commit()

    with pytest.raises(ResourceNotFound) as exc:
        TenantScope(actor("a1", org_id="org-a")).get(
            db,
            ResearchTask,
            "task-b",
            TENANT_OR_OWNER,
            resource_name="任务",
        )

    assert exc.value.status_code == 404
    assert exc.value.detail == "任务不存在"
    db.close()
    engine.dispose()
