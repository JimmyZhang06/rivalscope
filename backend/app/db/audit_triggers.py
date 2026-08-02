"""审计日志数据库级保护：创建触发器防止 UPDATE / DELETE"""
from sqlalchemy import text

from app.db.database import engine


def create_audit_triggers() -> None:
    """在 SQLite 中创建触发器，防止审计日志被修改或删除"""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_update
            BEFORE UPDATE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可修改');
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
            BEFORE DELETE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可删除');
            END
        """))
        conn.commit()
