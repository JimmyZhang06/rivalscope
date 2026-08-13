from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import profiles as profiles_api
from app.api.deps import AccessDenied


class FakeDb:
    def __init__(self, profile):
        self.profile = profile

    def get(self, _model, profile_id):
        return self.profile if self.profile.id == profile_id else None


def _user(*, user_id="user-a", org_id="", org_role="", role="user"):
    return SimpleNamespace(id=user_id, org_id=org_id, org_role=org_role, role=role)


def _profile(*, org_id="", user_id="user-a"):
    return SimpleNamespace(id="profile-a", org_id=org_id, user_id=user_id)


def test_personal_profile_owner_can_access_detail():
    profiles_api._profile_access_check(_profile(), _user())


def test_personal_profile_is_hidden_from_another_user():
    with pytest.raises(AccessDenied):
        profiles_api._profile_access_check(_profile(), _user(user_id="user-b"))


def test_org_owner_can_freeze_org_profile(monkeypatch):
    monkeypatch.setattr(profiles_api, "freeze_profile", lambda profile_id: {"id": profile_id, "status": "frozen"})

    result = profiles_api.freeze_profile_api(
        "profile-a",
        _user(org_id="org-a", org_role="owner"),
        FakeDb(_profile(org_id="org-a")),
    )

    assert result == {"id": "profile-a", "status": "frozen"}


def test_org_member_cannot_freeze_org_profile(monkeypatch):
    monkeypatch.setattr(profiles_api, "freeze_profile", lambda profile_id: {"id": profile_id, "status": "frozen"})

    with pytest.raises(HTTPException) as exc_info:
        profiles_api.freeze_profile_api(
            "profile-a",
            _user(org_id="org-a", org_role="member"),
            FakeDb(_profile(org_id="org-a")),
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "需要企业管理员权限"
