import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.admin import router as admin_router
from app.api.assistant import router as assistant_router
from app.api.auth import router as auth_router
from app.api.billing import router as billing_router
from app.api.competitors import router as competitors_router
from app.api.crawl import router as crawl_router
from app.api.graph import router as graph_router
from app.api.notifications import router as notifications_router
from app.api.org import router as org_router
from app.api.permissions import router as permissions_router
from app.api.profiles import router as profiles_router
from app.api.research import router as research_router
from app.api.trackers import router as trackers_router
from app.core.config import get_settings
from app.core.security import _assert_jwt_secret, hash_password
from app.db.database import Base, SessionLocal, engine
from app.db import models  # noqa: F401  确保模型注册到 Base.metadata

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

# 启动校验：JWT Secret 必须配置
_assert_jwt_secret()
settings = get_settings()
if not settings.llm_api_key:
    logger.warning("LLM_API_KEY 未配置，LLM 功能将不可用")
if not settings.tavily_api_key:
    logger.warning("TAVILY_API_KEY 未配置，联网检索将不可用")

# 生产环境安全警告
_WEAK_JWT_SECRETS = ("", "changeme", "your-secret-key", "admin123", "123456")
if settings.jwt_secret in _WEAK_JWT_SECRETS or len(settings.jwt_secret) < 32:
    logger.warning("JWT_SECRET 过短或使用默认值，请立即修改！")
if not settings.smtp_host and not settings.tavily_api_key:
    logger.warning("SMTP 和 Tavily 均未配置，邮件推送和联网检索不可用")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动阶段：建表校验 + 迁移列 + 播种管理员 + 恢复画像任务 + 启动调度器"""
    migrate_columns()
    seed_admin()

    # 审计日志数据库级触发器保护
    from app.db.audit_triggers import create_audit_triggers
    create_audit_triggers()

    # 恢复进程重启前未完成的画像提取任务
    from app.services.profile_extractor import recover_stale_tasks
    from app.services.scheduler import scheduler_loop, _load_git_hash
    _load_git_hash()
    recovered = recover_stale_tasks()
    if recovered:
        logger.info("recovered %d stale profile extract tasks on startup", len(recovered))

    scheduler_task = asyncio.create_task(scheduler_loop())
    yield
    scheduler_task.cancel()


def migrate_columns() -> None:
    """轻量迁移：create_all 不会修改已存在的表，这里补充缺失的列（SQLite ALTER ADD COLUMN）"""
    required: dict[str, dict[str, str]] = {
        "users": {
            "avatar": "TEXT NOT NULL DEFAULT ''",
            "token_version": "INTEGER NOT NULL DEFAULT 0",
            # Fernet 加密后约 44 字符，必须用 VARCHAR(44)
            "reset_code": "VARCHAR(44) NOT NULL DEFAULT ''",
            "reset_code_expires_at": "DATETIME",
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "org_role": "VARCHAR(10) NOT NULL DEFAULT ''",
            "org_monthly_limit": "INTEGER NOT NULL DEFAULT -1",
        },
        "research_tasks": {
            "report_data": "TEXT NOT NULL DEFAULT ''",
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "tracker_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "change_summary": "TEXT NOT NULL DEFAULT ''",
            "time_range": "VARCHAR(10) NOT NULL DEFAULT 'year'",
        },
        "trackers": {
            "time_range": "VARCHAR(10) NOT NULL DEFAULT 'year'",
        },
        "assistant_messages": {
            "session_id": "VARCHAR(32) NOT NULL DEFAULT ''",
        },
        "graph_projects": {
            "report_markdown": "TEXT NOT NULL DEFAULT ''",
        },
        # ⚠️ 列顺序必须与 ORM 模型 (models.py) 保持一致！
        # SQLite ALTER TABLE ADD COLUMN 将列追加到表末尾。
        # 如果此处顺序与模型声明的列顺序不一致，SQLAlchemy C 扩展的
        # 行处理器会读到错误的数据类型，导致 IndexError 崩溃。
        "competitors": {
            "name": "VARCHAR(200) NOT NULL DEFAULT ''",
            "alias": "VARCHAR(500) NOT NULL DEFAULT ''",
            "website": "VARCHAR(500) NOT NULL DEFAULT ''",
            "tech_focus": "TEXT NOT NULL DEFAULT ''",
            "keywords": "TEXT NOT NULL DEFAULT ''",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
            "crawl_config": "TEXT NOT NULL DEFAULT ''",
            "crawl_status": "VARCHAR(20) NOT NULL DEFAULT 'idle'",
            "crawl_error": "TEXT NOT NULL DEFAULT ''",
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
            "updated_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
            "last_crawled_at": "DATETIME",
        },
        "sources": {
            "score": "FLOAT NOT NULL DEFAULT 0",
            "domain": "VARCHAR(255) NOT NULL DEFAULT ''",
            "tier": "VARCHAR(20) NOT NULL DEFAULT 'other'",
            "published_at": "VARCHAR(50) NOT NULL DEFAULT ''",
            "dimension": "VARCHAR(100) NOT NULL DEFAULT ''",
            "raw_content": "TEXT NOT NULL DEFAULT ''",
            "confidence": "FLOAT NOT NULL DEFAULT 0",
            "conflict_status": "VARCHAR(20) NOT NULL DEFAULT 'none'",
            "conflict_note": "TEXT NOT NULL DEFAULT ''",
            "is_duplicate": "BOOLEAN NOT NULL DEFAULT 0",
            "dedup_group": "VARCHAR(32) NOT NULL DEFAULT ''",
            "access_status": "VARCHAR(20) NOT NULL DEFAULT ''",
            "access_error": "TEXT NOT NULL DEFAULT ''",
            "collected_at": "DATETIME",
        },
        "profile_templates": {
            "name": "VARCHAR(200) NOT NULL DEFAULT ''",
            "dimensions": "TEXT NOT NULL DEFAULT ''",
            "version": "INTEGER NOT NULL DEFAULT 1",
            "frozen_at": "DATETIME",
            "created_by": "VARCHAR(32) NOT NULL DEFAULT ''",
        },
        "competitor_profiles": {
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "competitor_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "template_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "profile_data": "TEXT NOT NULL DEFAULT ''",
            "source_refs": "TEXT NOT NULL DEFAULT '[]'",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'draft'",
            "frozen_at": "DATETIME",
            "generation_source": "VARCHAR(20) NOT NULL DEFAULT ''",
        },
        "user_permissions": {
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "permissions": "TEXT NOT NULL DEFAULT '[]'",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
        },
        "audit_logs": {
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "action": "VARCHAR(50) NOT NULL DEFAULT ''",
            "resource_type": "VARCHAR(50) NOT NULL DEFAULT ''",
            "resource_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "input": "TEXT NOT NULL DEFAULT ''",
            "result": "TEXT NOT NULL DEFAULT ''",
            "status": "VARCHAR(20) NOT NULL DEFAULT ''",
            "error": "TEXT NOT NULL DEFAULT ''",
            "model_name": "VARCHAR(100) NOT NULL DEFAULT ''",
            "tokens_prompt": "INTEGER NOT NULL DEFAULT 0",
            "tokens_completion": "INTEGER NOT NULL DEFAULT 0",
            "cost": "FLOAT NOT NULL DEFAULT 0",
            "ip": "VARCHAR(64) NOT NULL DEFAULT ''",
            "user_agent": "VARCHAR(300) NOT NULL DEFAULT ''",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
        },
        "execution_snapshots": {
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "tracker_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "task_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "config_hash": "VARCHAR(64) NOT NULL DEFAULT ''",
            "model_params": "TEXT NOT NULL DEFAULT ''",
            "kb_version": "VARCHAR(50) NOT NULL DEFAULT ''",
            "deployment_env": "VARCHAR(100) NOT NULL DEFAULT ''",
            "candidate_version": "VARCHAR(50) NOT NULL DEFAULT ''",
            "build_hash": "VARCHAR(64) NOT NULL DEFAULT ''",
            "created_by": "VARCHAR(32) NOT NULL DEFAULT ''",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
        },
        "profile_extract_tasks": {
            "competitor_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "template_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'pending'",
            "current_step": "VARCHAR(50) NOT NULL DEFAULT ''",
            "result": "TEXT NOT NULL DEFAULT ''",
            "error": "TEXT NOT NULL DEFAULT ''",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
        },
        "service_keys": {
            "service": "VARCHAR(50) NOT NULL DEFAULT ''",
            "encrypted_value": "TEXT NOT NULL DEFAULT ''",
            "label": "VARCHAR(100) NOT NULL DEFAULT ''",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
        },
    }
    with engine.connect() as conn:
        for table, columns in required.items():
            existing = {row[1]: row[2] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, ddl in columns.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                    logger.info("migrated: %s.%s", table, col)

        # 回填新增列的 NULL 值为 ''（SQLite ALTER TABLE 的 DEFAULT 不会回填已有行）
        null_backfills = {
            "competitors": "user_id",
            "competitor_profiles": "user_id",
        }
        for table, col in null_backfills.items():
            result = conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {col} IS NULL"))
            null_count = result.scalar()
            if null_count:
                conn.execute(text(f"UPDATE {table} SET {col} = '' WHERE {col} IS NULL"))
                logger.info("backfilled %d NULL %s in %s", null_count, col, table)

        # 列顺序校验：确保物理表列顺序与 ORM 模型一致
        # 不一致会导致 SQLAlchemy C 扩展崩溃 (IndexError: tuple index out of range)
        _fix_column_order_if_needed(conn)
        # 审计日志索引（只创建一次）
        existing_indexes = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='index'"))}
        audit_indexes = [
            ("idx_audit_action_resource", "action, resource_type"),
            ("idx_audit_created_at", "created_at"),
        ]
        for idx_name, cols in audit_indexes:
            if idx_name not in existing_indexes:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON audit_logs ({cols})"))
                logger.info("migrated index: %s", idx_name)
        conn.commit()


def _fix_column_order_if_needed(conn) -> None:
    """检测并修复所有表列顺序与 ORM 模型不一致的问题。

    SQLite 的 ALTER TABLE ADD COLUMN 将新列追加到表末尾。如果模型演进过程中
    列的声明顺序发生变化（例如在模型中插入了新列），物理表列顺序将与 ORM 模型
    声明顺序不一致。SQLAlchemy C 扩展的行处理器按模型顺序取字段 → 读到错误的
    数据类型 → IndexError 崩溃。此函数在启动时自动检测并修复。

    同时检测列类型不匹配（如 reset_code VARCHAR(10) vs String(44)），
    在类型不匹配时也触发重建。
    """
    from app.db.models import Base

    for model in Base.registry.mappers:
        cls = model.class_
        if not hasattr(cls, '__tablename__'):
            continue
        table_name = cls.__tablename__
        model_cols = [c.name for c in cls.__table__.columns]
        actual_rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        actual_cols = [row[1] for row in actual_rows]

        # 检查列是否匹配（名称 + 顺序）
        if model_cols == actual_cols:
            continue

        # 即使列名相同，也检查是否有类型不匹配
        model_types = {c.name: str(c.type) for c in cls.__table__.columns}
        actual_types = {row[1]: row[2] for row in actual_rows}
        type_mismatch = any(
            model_types.get(c) and actual_types.get(c)
            and model_types[c].upper() != actual_types[c].upper()
            for c in model_cols
            if c in actual_types
        )

        if model_cols == actual_cols and not type_mismatch:
            continue

        logger.warning("Column mismatch in %s: model=%s, actual=%s",
                       table_name, model_cols, actual_cols)
        logger.info("Rebuilding %s to fix column order/type...", table_name)

        # 用 ORM 模型定义的列顺序重建表
        col_defs = []
        for c in cls.__table__.columns:
            type_str = str(c.type.compile())
            col_defs.append(f"{c.name} {type_str}")

        create_sql = f"CREATE TABLE {table_name}_new ({', '.join(col_defs)})"
        conn.execute(text(create_sql))

        # 复制数据（只复制两边都有的列）
        existing_in_both = [c for c in model_cols if c in set(actual_cols)]
        src_cols = ", ".join(f'"{c}"' for c in existing_in_both)
        dst_cols = ", ".join(existing_in_both)
        conn.execute(text(
            f"INSERT INTO {table_name}_new ({dst_cols}) SELECT {src_cols} FROM {table_name}"
        ))

        conn.execute(text(f"DROP TABLE {table_name}"))
        conn.execute(text(f"ALTER TABLE {table_name}_new RENAME TO {table_name}"))

        # 重建该表的索引
        indexes = conn.execute(text(
            f"SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='{table_name}'"
        )).fetchall()
        for idx_name, idx_sql in indexes:
            if idx_sql:
                try:
                    conn.execute(text(idx_sql))
                except Exception:
                    pass
            elif idx_name and not idx_name.startswith("sqlite_"):
                # Rebuild without SQL (for auto-created indexes)
                cols_in_idx = conn.execute(text(
                    f"PRAGMA index_info({idx_name})"
                )).fetchall()
                if cols_in_idx:
                    idx_cols = ", ".join(r[2] for r in cols_in_idx)
                    conn.execute(text(
                        f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name} ({idx_cols})"
                    ))

        logger.info("Fixed column order in %s", table_name)


def seed_admin() -> None:
    """启动时播种默认管理员账号"""
    from app.db.models import User

    with SessionLocal() as db:
        if not db.query(User).filter(User.role == "admin").first():
            db.add(
                User(
                    email="admin@example.com",
                    password_hash=hash_password("Admin123456"),
                    nickname="管理员",
                    role="admin",
                    plan="enterprise",
                )
            )
            db.commit()
            logger.info("已创建默认管理员：admin@example.com / Admin123456")


app = FastAPI(title="竞品调研 Agent", version="0.3.0", lifespan=lifespan)

settings = get_settings()
allow_origins = [o.strip() for o in settings.frontend_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(competitors_router)
app.include_router(crawl_router)
app.include_router(research_router)
app.include_router(profiles_router)
app.include_router(permissions_router)
app.include_router(billing_router)
app.include_router(admin_router)
app.include_router(org_router)
app.include_router(notifications_router)
app.include_router(trackers_router)
app.include_router(graph_router)
app.include_router(assistant_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
