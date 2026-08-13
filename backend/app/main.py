import asyncio
import logging
from contextlib import asynccontextmanager

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import DefaultClause, MetaData, text
from sqlalchemy.schema import CreateTable

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
_jwt_is_weak = settings.jwt_secret.lower() in _WEAK_JWT_SECRETS or len(settings.jwt_secret) < 32
if _jwt_is_weak:
    if settings.app_env.lower() == "production":
        raise RuntimeError("生产环境 JWT_SECRET 必须为至少 32 位的非默认密钥")
    logger.warning("JWT_SECRET 过短或使用默认值，请立即修改！")
if settings.app_env.lower() == "production":
    try:
        Fernet(settings.master_key.encode())
    except (ValueError, TypeError):
        raise RuntimeError("生产环境 MASTER_KEY 必须是有效的 Fernet 密钥") from None
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
    from app.services.profile_extractor import recover_orphaned_generation_tasks
    from app.services.scheduler import scheduler_loop, _load_git_hash
    _load_git_hash()
    recovered = recover_orphaned_generation_tasks()
    if recovered:
        logger.info("recovered %d stale profile extract tasks on startup", len(recovered))

    scheduler_task = asyncio.create_task(scheduler_loop())
    yield
    scheduler_task.cancel()


def migrate_columns() -> None:
    """轻量迁移：create_all 不会修改已存在的表，这里补充缺失的列（SQLite ALTER ADD COLUMN）"""
    if engine.dialect.name != "sqlite":
        logger.warning("启动轻量迁移仅支持 SQLite；非 SQLite 部署请使用版本化迁移工具")
        return
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
            "template_version": "INTEGER NOT NULL DEFAULT 1",
            "user_id": "VARCHAR(32) NOT NULL DEFAULT ''",
            "profile_data": "TEXT NOT NULL DEFAULT ''",
            "source_refs": "TEXT NOT NULL DEFAULT '[]'",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'draft'",
            "frozen_at": "DATETIME",
            "generation_source": "VARCHAR(20) NOT NULL DEFAULT ''",
            "report_markdown": "TEXT NOT NULL DEFAULT ''",
            "insights_json": "TEXT NOT NULL DEFAULT ''",
            "source_index_json": "TEXT NOT NULL DEFAULT '[]'",
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
        is_sqlite = conn.dialect.name == "sqlite"
        if is_sqlite:
            # SQLite 不允许在事务内切换 foreign_keys；必须先关闭，再显式
            # BEGIN，否则重建被其他表引用的表时 DROP TABLE 会失败。
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.commit()
            conn.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            conn.begin()

        try:
            for table, columns in required.items():
                existing = {
                    row[1]: row[2]
                    for row in conn.execute(text(f"PRAGMA table_info({_quote_identifier(conn, table)})"))
                }
                for col, ddl in columns.items():
                    if col not in existing:
                        conn.execute(text(
                            f"ALTER TABLE {_quote_identifier(conn, table)} "
                            f"ADD COLUMN {_quote_identifier(conn, col)} {ddl}"
                        ))
                        logger.info("migrated: %s.%s", table, col)

            # 回填新增列的 NULL 值为 ''（SQLite ALTER TABLE 的 DEFAULT 不会回填已有行）
            null_backfills = {
                "competitors": "user_id",
                "competitor_profiles": "user_id",
            }
            for table, col in null_backfills.items():
                quoted_table = _quote_identifier(conn, table)
                quoted_col = _quote_identifier(conn, col)
                result = conn.execute(text(
                    f"SELECT COUNT(*) FROM {quoted_table} WHERE {quoted_col} IS NULL"
                ))
                null_count = result.scalar()
                if null_count:
                    conn.execute(text(
                        f"UPDATE {quoted_table} SET {quoted_col} = '' WHERE {quoted_col} IS NULL"
                    ))
                    logger.info("backfilled %d NULL %s in %s", null_count, col, table)

            # 列顺序校验：确保物理表列顺序与 ORM 模型一致
            _fix_column_order_if_needed(conn)

            # 审计日志索引（只创建一次）
            existing_indexes = {
                row[0]
                for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='index'"))
            }
            audit_indexes = [
                ("idx_audit_action_resource", "action, resource_type"),
                ("idx_audit_created_at", "created_at"),
            ]
            for idx_name, cols in audit_indexes:
                if idx_name not in existing_indexes:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON audit_logs ({cols})"))
                    logger.info("migrated index: %s", idx_name)

            if is_sqlite:
                violations = conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                if violations:
                    preview = ", ".join(str(tuple(row)) for row in violations[:5])
                    raise RuntimeError(f"数据库迁移后外键校验失败: {preview}")
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("数据库迁移失败，已回滚本次更改")
            raise
        finally:
            if is_sqlite:
                conn.exec_driver_sql("PRAGMA foreign_keys=ON")
                conn.commit()


def _quote_identifier(conn, identifier: str) -> str:
    """使用当前方言引用由 ORM/迁移清单提供的标识符。"""
    return conn.dialect.identifier_preparer.quote(identifier)


def _normalise_sqlite_type(type_name: str) -> str:
    """SQLite 类型名不区分大小写和多余空白。"""
    return "".join((type_name or "").upper().split())


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

    if conn.dialect.name != "sqlite":
        return

    for model in Base.registry.mappers:
        cls = model.class_
        if not hasattr(cls, '__tablename__'):
            continue
        table_name = cls.__tablename__
        model_cols = [c.name for c in cls.__table__.columns]
        quoted_table = _quote_identifier(conn, table_name)
        actual_rows = conn.execute(text(f"PRAGMA table_info({quoted_table})")).fetchall()
        if not actual_rows:
            # create_all 通常已建表；如果这里仍不存在，不要构造空列 INSERT。
            logger.warning("Skipping missing table during column-order check: %s", table_name)
            continue
        actual_cols = [row[1] for row in actual_rows]

        # 列名和顺序相同时仍需要检查类型。旧逻辑在此之前 continue，
        # 使 VARCHAR(10) -> VARCHAR(44) 等类型修复永远不可达。
        model_types = {
            c.name: _normalise_sqlite_type(str(c.type.compile(dialect=conn.dialect)))
            for c in cls.__table__.columns
        }
        actual_types = {row[1]: row[2] for row in actual_rows}
        type_mismatch = any(
            model_types.get(c) and actual_types.get(c)
            and model_types[c] != _normalise_sqlite_type(actual_types[c])
            for c in model_cols
            if c in actual_types
        )

        if model_cols == actual_cols and not type_mismatch:
            continue

        logger.warning("Column mismatch in %s: model=%s, actual=%s",
                       table_name, model_cols, actual_cols)
        logger.info("Rebuilding %s to fix column order/type...", table_name)

        # DROP 之前捕获索引/触发器 DDL；sqlite_autoindex 的 sql 为 NULL，
        # 它们由新表的 PRIMARY KEY / UNIQUE 约束自动恢复。
        schema_objects = conn.execute(text("""
            SELECT type, name, sql
            FROM sqlite_master
            WHERE tbl_name = :table_name AND type IN ('index', 'trigger')
            ORDER BY type, name
        """), {"table_name": table_name}).fetchall()

        temp_name = f"__migration_new_{table_name}"
        if conn.execute(text(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"
        ), {"name": temp_name}).first():
            raise RuntimeError(f"发现未处理的迁移临时表: {temp_name}")

        # 克隆整个 metadata 以便 FK 能解析其它表，然后仅编译目标表。
        # CreateTable 会保留 PK/FK/UNIQUE/NOT NULL，这是手拼列定义做不到的。
        migration_metadata = MetaData()
        for registered_table in Base.metadata.sorted_tables:
            registered_table.to_metadata(migration_metadata)
        temp_table = migration_metadata.tables[table_name]
        migration_metadata.remove(temp_table)
        temp_table.name = temp_name
        migration_metadata._add_table(temp_name, temp_table.schema, temp_table)

        # ORM 多使用 Python default，而历史 ALTER 列可能有 SQLite server default。
        # 将现有默认值覆盖到新表，避免重建后语义倒退。
        actual_defaults = {row[1]: row[4] for row in actual_rows if row[4] is not None}
        for col_name, default_sql in actual_defaults.items():
            if col_name in temp_table.c:
                temp_table.c[col_name].server_default = DefaultClause(text(default_sql))

        conn.exec_driver_sql(str(CreateTable(temp_table).compile(dialect=conn.dialect)))

        # 复制数据（只复制两边都有的列）
        existing_in_both = [c for c in model_cols if c in set(actual_cols)]
        omitted_required = [
            c.name for c in temp_table.columns
            if c.name not in existing_in_both
            and not c.nullable
            and c.server_default is None
            and not (c.primary_key and c.autoincrement is True)
        ]
        if omitted_required:
            raise RuntimeError(
                f"{table_name} 缺少无默认值的必填列: {', '.join(omitted_required)}"
            )
        src_cols = ", ".join(_quote_identifier(conn, c) for c in existing_in_both)
        dst_cols = src_cols
        conn.execute(text(
            f"INSERT INTO {_quote_identifier(conn, temp_name)} ({dst_cols}) "
            f"SELECT {src_cols} FROM {quoted_table}"
        ))

        conn.execute(text(f"DROP TABLE {quoted_table}"))
        conn.execute(text(
            f"ALTER TABLE {_quote_identifier(conn, temp_name)} "
            f"RENAME TO {quoted_table}"
        ))

        # 恢复重建前的显式索引和触发器（包括非 ORM 定义对象）。
        for object_type, object_name, ddl in schema_objects:
            if ddl:
                conn.exec_driver_sql(ddl)
                logger.debug("Restored %s %s on %s", object_type, object_name, table_name)

        # 老库可能从未创建新模型索引，在此补齐。
        for index in cls.__table__.indexes:
            index.create(bind=conn, checkfirst=True)

        logger.info("Fixed column order in %s", table_name)


def seed_admin() -> None:
    """仅在显式配置时初始化管理员，不在代码中留固定凭据。"""
    from app.db.models import User

    email = settings.seed_admin_email.strip()
    password = settings.seed_admin_password
    environment = settings.app_env.lower()
    if not email and not password:
        logger.info("未配置 SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD，跳过管理员初始化")
        return
    if not email or not password:
        raise RuntimeError("SEED_ADMIN_EMAIL 和 SEED_ADMIN_PASSWORD 必须同时配置")

    known_weak = {"admin123456", "change-me", "changeme", "password", "12345678"}
    min_length = 12 if environment == "production" else 8
    if password.lower() in known_weak or len(password) < min_length:
        raise RuntimeError(
            f"SEED_ADMIN_PASSWORD 不得使用已知弱密码，且在 {environment} 环境至少需 {min_length} 位"
        )

    with SessionLocal() as db:
        if not db.query(User).filter(User.role == "admin").first():
            db.add(
                User(
                    email=email,
                    password_hash=hash_password(password),
                    nickname="管理员",
                    role="admin",
                    plan="enterprise",
                )
            )
            db.commit()
            logger.info("已创建显式配置的管理员：%s", email)


app = FastAPI(title="竞品调研 Agent", version="7.0.0", lifespan=lifespan)

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
