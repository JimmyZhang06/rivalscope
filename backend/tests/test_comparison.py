import json
from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas.profiles import ComparisonOut
from app.services import comparison


class _ProfileQuery:
    def __init__(self, profiles):
        self._profiles = profiles

    def filter(self, *_args):
        return self

    def all(self):
        return self._profiles


class _ComparisonSession:
    def __init__(self, template, profiles):
        self._template = template
        self._profiles = profiles

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def get(self, _model, _identifier):
        return self._template

    def query(self, _model):
        return _ProfileQuery(self._profiles)


def test_generate_comparison_unwraps_normalized_profile_values(monkeypatch):
    frozen_at = datetime.now(timezone.utc)
    template = SimpleNamespace(
        name="价格模板",
        frozen_at=frozen_at,
        dimensions=json.dumps([
            {
                "key": "pricing",
                "label": "价格",
                "fields": [{"key": "amount", "label": "售价", "type": "text"}],
            },
            {"key": "notes", "label": "备注", "fields": []},
        ], ensure_ascii=False),
    )
    profiles = [
        SimpleNamespace(
            id="profile-a",
            competitor_id="competitor-a",
            template_version=1,
            status="frozen",
            frozen_at=frozen_at,
            profile_data=json.dumps({
                "dimensions": {
                    "pricing": {"amount": {"v": "99 元", "c": "high", "s": "官网"}},
                    "notes": {"summary": {"v": "含运费", "c": "medium", "s": ""}},
                }
            }, ensure_ascii=False),
            source_refs="[]",
        ),
        SimpleNamespace(
            id="profile-b",
            competitor_id="competitor-b",
            template_version=1,
            status="frozen",
            frozen_at=frozen_at,
            profile_data={
                "dimensions": {
                    "pricing": {"amount": 129},
                    "notes": {},
                }
            },
            source_refs=[],
        ),
    ]
    fake_session = _ComparisonSession(template, profiles)
    monkeypatch.setattr(comparison, "SessionLocal", lambda: fake_session)

    result = comparison.generate_comparison(
        template_id="template-1",
        profile_ids=["profile-a", "profile-b"],
    )

    assert result["matrix"][0]["values"] == {
        "competitor-a": "99 元",
        "competitor-b": "129",
    }
    assert result["matrix"][1]["values"]["competitor-a"] == (
        '{"summary": {"v": "含运费", "c": "medium", "s": ""}}'
    )
    assert result["matrix"][1]["values"]["competitor-b"] == "信息不足"
    ComparisonOut.model_validate(result)
