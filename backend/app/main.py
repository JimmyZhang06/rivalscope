import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.billing import router as billing_router
from app.api.research import router as research_router
from app.core.security import hash_password
from app.db.database import Base, SessionLocal, engine
from app.db import models  # noqa: F401  确保模型注册到 Base.metadata

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)


def migrate_columns() -> None:
    """轻量迁移：create_all 不会修改已存在的表，这里补充缺失的列（SQLite ALTER ADD COLUMN）"""
    required: dict[str, dict[str, str]] = {
        "users": {
            "avatar": "TEXT NOT NULL DEFAULT ''",
            "token_version": "INTEGER NOT NULL DEFAULT 0",
            "reset_code": "VARCHAR(10) NOT NULL DEFAULT ''",
            "reset_code_expires_at": "DATETIME",
        },
        "research_tasks": {"report_data": "TEXT NOT NULL DEFAULT ''"},
        "sources": {
            "score": "FLOAT NOT NULL DEFAULT 0",
            "domain": "VARCHAR(255) NOT NULL DEFAULT ''",
            "tier": "VARCHAR(20) NOT NULL DEFAULT 'other'",
            "published_at": "VARCHAR(50) NOT NULL DEFAULT ''",
            "dimension": "VARCHAR(100) NOT NULL DEFAULT ''",
            "raw_content": "TEXT NOT NULL DEFAULT ''",
        },
    }
    with engine.connect() as conn:
        for table, columns in required.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, ddl in columns.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                    logger.info("migrated: %s.%s", table, col)
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

app = FastAPI(title="竞品调研 Agent", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(research_router)
app.include_router(billing_router)
app.include_router(admin_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
