from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.intelligence import router
from app.db.database import Base, get_db
from app.db.models import GraphProject, ResearchTask, User
from app.services.intelligence_events import list_events, summarize_events


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def _user(user_id: str, *, org_id: str = "") -> User:
    return User(
        id=user_id,
        email=f"{user_id}@example.com",
        password_hash="hash",
        org_id=org_id,
    )


def test_aggregates_sources_with_normalized_status_and_newest_first():
    db = _session()
    now = datetime.now(timezone.utc)
    owner = _user("owner")
    db.add(owner)
    db.add_all([
        ResearchTask(
            id="research-1",
            user_id=owner.id,
            product_name="Alpha",
            status="completed",
            change_summary="",
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(hours=1),
        ),
        ResearchTask(
            id="tracker-run-1",
            user_id=owner.id,
            tracker_id="tracker-1",
            product_name="Beta",
            status="analyzing",
            change_summary="定价发生变化",
            created_at=now,
            updated_at=now,
        ),
        GraphProject(
            id="graph-1",
            user_id=owner.id,
            root_name="Gamma",
            status="failed",
            error="来源不足",
            created_at=now - timedelta(hours=1),
            updated_at=now,
        ),
    ])
    db.commit()

    events, total = list_events(db, owner)

    assert total == 3
    assert [event.id for event in events] == [
        "tracker:tracker-run-1",
        "graph:graph-1",
        "research:research-1",
    ]
    assert [event.status for event in events] == ["running", "failed", "completed"]
    assert events[0].summary == "定价发生变化"


def test_filters_and_paginates_after_merging_sources():
    db = _session()
    now = datetime.now(timezone.utc)
    owner = _user("owner")
    db.add(owner)
    for index in range(3):
        db.add(ResearchTask(
            id=f"task-{index}",
            user_id=owner.id,
            product_name=f"Product {index}",
            status="completed",
            created_at=now - timedelta(minutes=index * 2),
            updated_at=now,
        ))
        db.add(GraphProject(
            id=f"graph-{index}",
            user_id=owner.id,
            root_name=f"Graph {index}",
            status="completed",
            created_at=now - timedelta(minutes=index * 2 + 1),
            updated_at=now,
        ))
    db.commit()

    page, total = list_events(db, owner, status="completed", page=2, page_size=2)
    graph_events, graph_total = list_events(db, owner, event_type="graph")

    assert total == 6
    assert [event.id for event in page] == ["research:task-1", "graph:graph-1"]
    assert graph_total == 3
    assert all(event.event_type == "graph" for event in graph_events)


def test_visibility_matches_personal_and_same_org_rules():
    db = _session()
    viewer = _user("viewer", org_id="org-a")
    teammate = _user("teammate", org_id="org-a")
    outsider = _user("outsider", org_id="org-b")
    db.add_all([viewer, teammate, outsider])
    db.add_all([
        ResearchTask(id="own", user_id=viewer.id, org_id="", product_name="Own"),
        ResearchTask(id="shared", user_id=teammate.id, org_id="org-a", product_name="Shared"),
        ResearchTask(id="hidden", user_id=outsider.id, org_id="org-b", product_name="Hidden"),
    ])
    db.commit()

    events, total = list_events(db, viewer)

    assert total == 2
    assert {event.source_id for event in events} == {"own", "shared"}


def test_summary_counts_types_statuses_and_latest_event():
    db = _session()
    now = datetime.now(timezone.utc)
    owner = _user("owner")
    db.add(owner)
    db.add_all([
        ResearchTask(id="r1", user_id=owner.id, product_name="A", status="pending", created_at=now),
        ResearchTask(
            id="t1",
            user_id=owner.id,
            tracker_id="tracker",
            product_name="B",
            status="reporting",
            created_at=now - timedelta(minutes=1),
        ),
        GraphProject(
            id="g1",
            user_id=owner.id,
            root_name="C",
            status="completed",
            created_at=now - timedelta(minutes=2),
        ),
    ])
    db.commit()

    result = summarize_events(db, owner)

    assert result["total"] == 3
    assert result["active"] == 2
    assert result["completed"] == 1
    assert result["failed"] == 0
    assert result["by_type"] == {"research": 1, "tracker": 1, "graph": 1}
    assert result["by_status"] == {"queued": 1, "running": 1, "completed": 1, "failed": 0}
    assert result["latest_at"].replace(tzinfo=timezone.utc) == now


def test_events_api_exposes_filtered_list_and_summary_contracts():
    db = _session()
    owner = _user("owner")
    db.add(owner)
    db.add_all([
        ResearchTask(id="r1", user_id=owner.id, product_name="Research", status="completed"),
        GraphProject(id="g1", user_id=owner.id, root_name="Graph", status="building"),
    ])
    db.commit()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: owner
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    events = client.get("/api/intelligence/events", params={"event_type": "graph"})
    summary = client.get("/api/intelligence/summary")

    assert events.status_code == 200
    assert events.json()["total"] == 1
    assert events.json()["items"][0]["id"] == "graph:g1"
    assert events.json()["items"][0]["status"] == "running"
    assert summary.status_code == 200
    assert summary.json()["total"] == 2
    assert summary.json()["by_type"] == {"research": 1, "tracker": 0, "graph": 1}
