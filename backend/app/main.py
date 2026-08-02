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


def migrate_columns() -> None:
    """轻量迁移：create_all 不会修改已存在的表，这里补充缺失的列（SQLite ALTER ADD COLUMN）"""
    required: dict[str, dict[str, str]] = {
        "users": {
            "avatar": "TEXT NOT NULL DEFAULT ''",
            "token_version": "INTEGER NOT NULL DEFAULT 0",
            "reset_code": "VARCHAR(10) NOT NULL DEFAULT ''",
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
        "competitors": {
            "name": "VARCHAR(200) NOT NULL DEFAULT ''",
            "alias": "VARCHAR(500) NOT NULL DEFAULT ''",
            "website": "VARCHAR(500) NOT NULL DEFAULT ''",
            "tech_focus": "TEXT NOT NULL DEFAULT ''",
            "keywords": "TEXT NOT NULL DEFAULT ''",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
            "created_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
            "updated_at": "DATETIME NOT NULL DEFAULT (datetime('now', 'utc'))",
            "crawl_config": "TEXT NOT NULL DEFAULT ''",
            "last_crawled_at": "DATETIME",
            "crawl_status": "VARCHAR(20) NOT NULL DEFAULT 'idle'",
            "crawl_error": "TEXT NOT NULL DEFAULT ''",
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
            "profile_data": "TEXT NOT NULL DEFAULT ''",
            "source_refs": "TEXT NOT NULL DEFAULT '[]'",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'draft'",
            "frozen_at": "DATETIME",
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
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, ddl in columns.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                    logger.info("migrated: %s.%s", table, col)
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


migrate_columns()


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


seed_admin()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动定时追踪调度器 + 恢复未完成的画像提取任务"""
    from app.services.profile_extractor import recover_stale_tasks
    from app.services.scheduler import scheduler_loop

    # 恢复进程重启前未完成的画像提取任务
    recovered = recover_stale_tasks()
    if recovered:
        logger.info("recovered %d stale profile extract tasks on startup", len(recovered))

    scheduler_task = asyncio.create_task(scheduler_loop())
    yield
    scheduler_task.cancel()


app = FastAPI(title="竞品调研 Agent", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
