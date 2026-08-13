"""统一情报资产投影的离线回归测试。"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import Competitor, CompetitorProfile, GraphProject, ProfileTemplate, ResearchTask, User
from app.services.assets import list_intelligence_objects


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _user(user_id: str, *, org_id: str = "", role: str = "user") -> User:
    return User(
        id=user_id,
        email=f"{user_id}@example.com",
        password_hash="hash",
        nickname=user_id,
        org_id=org_id,
        role=role,
    )


def _seed_all_types(db: Session, owner: User, suffix: str = "a") -> None:
    now = datetime.now(timezone.utc)
    competitor = Competitor(
        id=f"competitor-{suffix}",
        user_id=owner.id,
        org_id=owner.org_id,
        name="Atlas AI",
        website="https://atlas.example.com",
        tech_focus="企业智能搜索",
        created_at=now - timedelta(days=4),
        updated_at=now - timedelta(days=4),
    )
    template = ProfileTemplate(
        id=f"template-{suffix}",
        org_id=owner.org_id,
        name="产品情报模板",
        dimensions="[]",
        created_by=owner.id,
    )
    db.add_all([
        competitor,
        template,
        CompetitorProfile(
            id=f"profile-{suffix}",
            org_id=owner.org_id,
            user_id=owner.id,
            competitor_id=competitor.id,
            template_id=template.id,
            profile_data="{}",
            created_at=now - timedelta(days=3),
            updated_at=now - timedelta(days=3),
        ),
        ResearchTask(
            id=f"research-{suffix}",
            user_id=owner.id,
            org_id=owner.org_id,
            product_name="Atlas 市场研究",
            focus="定价策略",
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=2),
        ),
        GraphProject(
            id=f"graph-{suffix}",
            user_id=owner.id,
            org_id=owner.org_id,
            root_name="Atlas 生态",
            industry="企业软件",
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
        ),
    ])
    db.commit()


def test_unifies_all_types_with_stable_ids_links_and_global_sort(db: Session) -> None:
    owner = _user("owner")
    db.add(owner)
    db.commit()
    _seed_all_types(db, owner)

    result = list_intelligence_objects(db, owner, page_size=10)

    assert result.total == 4
    assert [item.type for item in result.items] == [
        "graph_project", "research_task", "profile", "competitor"
    ]
    assert result.items[0].id == "graph_project:graph-a"
    assert result.items[0].detail_path == "/app/graph/graph-a"
    assert result.items[2].title == "Atlas AI"
    assert result.items[2].summary == "产品情报模板"
    assert result.type_counts == {
        "competitor": 1,
        "profile": 1,
        "research_task": 1,
        "graph_project": 1,
    }


def test_personal_and_cross_org_assets_are_not_exposed(db: Session) -> None:
    viewer = _user("viewer", org_id="org-a")
    teammate = _user("teammate", org_id="org-a")
    outsider = _user("outsider", org_id="org-b")
    personal = _user("personal")
    db.add_all([viewer, teammate, outsider, personal])
    db.commit()
    _seed_all_types(db, teammate, "team")
    _seed_all_types(db, outsider, "outside")
    _seed_all_types(db, personal, "personal")

    result = list_intelligence_objects(db, viewer, page_size=100)

    assert result.total == 4
    assert {item.org_id for item in result.items} == {"org-a"}
    assert {item.owner_id for item in result.items} == {"teammate"}


def test_search_type_filter_and_facets_share_one_contract(db: Session) -> None:
    owner = _user("owner")
    db.add(owner)
    db.commit()
    _seed_all_types(db, owner)

    result = list_intelligence_objects(
        db, owner, types=["research_task"], query="Atlas", page_size=10
    )

    assert result.total == 1
    assert result.items[0].source_id == "research-a"
    # 类型 facet 在选中类型前计算，支持前端无额外请求切换分类。
    assert result.type_counts == {
        "competitor": 1,
        "profile": 1,
        "research_task": 1,
        "graph_project": 1,
    }


def test_pagination_happens_after_cross_type_sort(db: Session) -> None:
    owner = _user("owner")
    db.add(owner)
    db.commit()
    _seed_all_types(db, owner)

    first = list_intelligence_objects(db, owner, page=1, page_size=2)
    second = list_intelligence_objects(db, owner, page=2, page_size=2)

    assert [item.source_id for item in first.items] == ["graph-a", "research-a"]
    assert [item.source_id for item in second.items] == ["profile-a", "competitor-a"]
    assert first.total == second.total == 4
