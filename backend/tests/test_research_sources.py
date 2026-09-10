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

    async def capture(url, raw_content=""):
        return {"snapshot_text": raw_content, "snapshot_html": url}

    monkeypatch.setattr(snapshot, "capture_snapshot", capture)
    try:
        asyncio.run(agent._save_sources("task-1", [
            {"title": str(i), "url": f"https://example.com/{i}",
             "content": "excerpt", "raw_content": f"full text {i}"}
            for i in range(3)
        ]))
        with sessions() as db:
            sources = db.scalars(select(Source).order_by(Source.id)).all()
            archives = db.scalars(select(SourceArchive).order_by(SourceArchive.source_id)).all()
            assert len(sources) == len(archives) == 3
            assert [a.source_id for a in archives] == [s.id for s in sources]
            assert [a.snapshot_text for a in archives] == [f"full text {i}" for i in range(3)]
    finally:
        engine.dispose()
