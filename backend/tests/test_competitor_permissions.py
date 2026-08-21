from types import SimpleNamespace

import pytest

from app.api import competitors as competitors_api
from app.api import crawl as crawl_api
from app.api.deps import AccessDenied


def _user(*, user_id="user-a", org_id="", role="user"):
    return SimpleNamespace(id=user_id, org_id=org_id, role=role)


def _competitor(*, user_id="user-a", org_id=""):
    return SimpleNamespace(id="competitor-a", user_id=user_id, org_id=org_id)


def test_personal_competitor_owner_can_manage_and_crawl():
    owner = _user()
    competitor = _competitor()

    competitors_api._competitor_access_check(competitor, owner)
    assert crawl_api._check_competitor_access(competitor, owner) is competitor


def test_personal_competitor_is_private_to_creator():
    with pytest.raises(AccessDenied):
        competitors_api._competitor_access_check(_competitor(), _user(user_id="user-b"))

    with pytest.raises(AccessDenied):
        crawl_api._check_competitor_access(_competitor(), _user(user_id="user-b"))
