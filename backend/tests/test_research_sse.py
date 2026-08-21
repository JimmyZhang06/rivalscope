from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.research import _stream_task_status
from app.db.database import Base
from app.db.models import ResearchTask, User


def test_stream_status_refreshes_long_lived_session_identity_map(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'research-sse.db'}")
    Base.metadata.create_all(engine)

    with Session(engine) as setup:
        setup.add(User(id="user-1", email="user@example.com", password_hash="hash"))
        setup.add(ResearchTask(
            id="task-1",
            user_id="user-1",
            product_name="测试任务",
            status="pending",
        ))
        setup.commit()

    with Session(engine) as stream_session:
        assert _stream_task_status(stream_session, "task-1") == "pending"

        with Session(engine) as worker_session:
            task = worker_session.get(ResearchTask, "task-1")
            task.status = "completed"
            worker_session.commit()

        # The same stream session must see the background worker's commit.
        assert _stream_task_status(stream_session, "task-1") == "completed"
        assert _stream_task_status(stream_session, "missing-task") == "failed"

    engine.dispose()
