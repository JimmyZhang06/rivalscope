from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.db.database import engine


def test_file_sqlite_does_not_share_one_connection_across_threads():
    database_url = get_settings().database_url
    if database_url.startswith("sqlite") and ":memory:" not in database_url and "mode=memory" not in database_url:
        assert not isinstance(engine.pool, StaticPool)
