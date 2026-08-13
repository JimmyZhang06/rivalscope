from types import SimpleNamespace

import pytest

from app.api.deps import AccessDenied, ResourceNotFound, check_access


def user(*, user_id: str = "user-a", org_id: str = "", role: str = "user"):
    return SimpleNamespace(id=user_id, org_id=org_id, role=role)


def test_personal_resource_is_private_to_owner():
    with pytest.raises(AccessDenied):
        check_access("", "user-a", user(user_id="user-b"), system_access="owner_or_admin")


def test_personal_resource_owner_is_allowed():
    check_access("", "user-a", user(user_id="user-a"), system_access="owner_or_admin")


def test_cross_org_resource_is_rejected_with_requested_error_type():
    with pytest.raises(ResourceNotFound):
        check_access(
            "org-a",
            "user-a",
            user(org_id="org-b"),
            cross_org_forbidden_as=ResourceNotFound,
        )


def test_system_admin_can_access_admin_only_resource():
    check_access("", "", user(role="admin"), system_access="admin_only")
