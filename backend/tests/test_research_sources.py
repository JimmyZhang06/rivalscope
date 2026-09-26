import asyncio

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import ResearchTask, Source, SourceArchive, User
from app.services import agent, snapshot


def test_sources_are_committed_before_snapshot_writes(tmp_path, monkeypatch):
    # A file database uses separate connections and reproduces SQLite write locks.
    engine = create_engine(
        f"sqlite:///{tmp_path / 'sources.db'}", connect_args={"timeout": 0.05}
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(agent, "SessionLocal", sessions)
    monkeypatch.setattr(snapshot, "SessionLocal", sessions)
    with sessions() as db:
        db.add(User(id="user-1", email="test@example.com", password_hash="hash"))
        db.commit()
        db.add(ResearchTask(id="task-1", user_id="user-1", product_name="Test"))
        db.commit()

    active = peak = 0

    async def capture(url, raw_content=""):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)  # Allow overlapping network operations, not DB writes.
        active -= 1
        return {"snapshot_text": raw_content, "snapshot_html": url}

    monkeypatch.setattr(snapshot, "capture_snapshot", capture)
    try:
        asyncio.run(agent._save_sources("task-1", [
            {"title": str(i), "url": f"https://example.com/{i}",
             "content": "excerpt", "raw_content": f"full text {i}"}
            for i in range(9)
        ]))
        assert 1 < peak <= agent.SNAPSHOT_CONCURRENCY
        with sessions() as db:
            sources = db.scalars(select(Source).order_by(Source.id)).all()
            archives = db.scalars(select(SourceArchive).order_by(SourceArchive.source_id)).all()
            assert len(sources) == len(archives) == 9
            assert [a.source_id for a in archives] == [s.id for s in sources]
            assert [a.snapshot_text for a in archives] == [f"full text {i}" for i in range(9)]
    finally:
        engine.dispose()


def test_snapshot_deadline_preserves_search_content(monkeypatch):
    cancelled = []

    async def stalled_request(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    monkeypatch.setattr(snapshot, "safe_external_request", stalled_request)
    monkeypatch.setattr(snapshot, "SNAPSHOT_TIMEOUT_SECONDS", 0.01)
    data = asyncio.run(snapshot.capture_snapshot("https://example.com", "search evidence"))
    assert cancelled == [True]
    assert data["access_status"] == "failed"
    assert data["snapshot_text"] == "search evidence"
