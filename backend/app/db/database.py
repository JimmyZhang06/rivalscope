from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings

settings = get_settings()

if settings.database_url.startswith("sqlite"):
    sqlite_connect_args = {"check_same_thread": False, "timeout": 60}
    is_memory_database = settings.database_url in {"sqlite://", "sqlite:///:memory:"} or "mode=memory" in settings.database_url
    sqlite_pool_options = {"poolclass": StaticPool} if is_memory_database else {"pool_pre_ping": True}
    engine = create_engine(
        settings.database_url,
        connect_args=sqlite_connect_args,
        **sqlite_pool_options,
    )
else:
    engine = create_engine(
        settings.database_url,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _conn_record):
    """SQLite: 启用 WAL 模式 + 外键约束 + 较大超时，减少并发写入锁冲突"""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=60000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖：请求级数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
