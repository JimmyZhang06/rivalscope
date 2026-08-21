from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.graph import _require_manage_project
from app.api.research import _require_manage_task


def _user(*, user_id="member", org_role="member", role="user"):
    return SimpleNamespace(id=user_id, org_id="org-a", org_role=org_role, role=role)


def _resource():
    return SimpleNamespace(user_id="creator", org_id="org-a")


@pytest.mark.parametrize("guard", [_require_manage_task, _require_manage_project])
def test_regular_member_cannot_mutate_another_members_shared_resource(guard):
    with pytest.raises(HTTPException) as exc_info:
        guard(_resource(), _user())
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("guard", [_require_manage_task, _require_manage_project])
@pytest.mark.parametrize("user", [_user(user_id="creator"), _user(org_role="owner"), _user(org_role="admin")])
def test_creator_and_org_managers_can_mutate_shared_resource(guard, user):
    guard(_resource(), user)
