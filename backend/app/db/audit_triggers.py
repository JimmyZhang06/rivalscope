"""审计日志数据库级保护：创建触发器防止 UPDATE / DELETE

设计原则：
- 审计日志默认不可修改或删除（WORM 保护）
- 应用层的 purge_expired_logs 通过 drop/recreate 触发器来执行清理
- 清理完成后立即恢复保护
"""
from sqlalchemy import text

from app.db.database import engine

_DROP_DELETE_TRIGGER = text("DROP TRIGGER IF EXISTS prevent_audit_delete")
_CREATE_DELETE_TRIGGER = text("""
    CREATE TRIGGER prevent_audit_delete
    BEFORE DELETE ON audit_logs
    BEGIN
        SELECT RAISE(ABORT, '审计日志不可删除');
    END
""")


def create_audit_triggers() -> None:
    """创建审计日志保护触发器（启动时调用）"""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_update
            BEFORE UPDATE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可修改');
            END
        """))
        conn.execute(text("DROP TRIGGER IF EXISTS prevent_audit_delete"))
        conn.execute(text("""
            CREATE TRIGGER prevent_audit_delete
            BEFORE DELETE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可删除');
            END
        """))
        conn.commit()


def enable_purge() -> None:
    """启用审计日志删除（清理前调用，临时移除删除保护）"""
    with engine.connect() as conn:
        conn.execute(_DROP_DELETE_TRIGGER)
        conn.commit()


def disable_purge() -> None:
    """恢复审计日志删除保护（清理后调用）"""
    with engine.connect() as conn:
        conn.execute(_CREATE_DELETE_TRIGGER)
        conn.commit()
