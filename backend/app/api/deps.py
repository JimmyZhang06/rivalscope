"""认证依赖与配额计算"""

from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.plans import UNLIMITED, effective_plan, plan_limits
from app.core.security import decode_access_token
from app.db.database import get_db
from app.db.models import ResearchTask, User


def _get_user_by_token(token: str, db: Session) -> User:
    decoded = decode_access_token(token)
    if not decoded:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user_id, ver = decoded
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="账号不存在")
    if ver != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    return user


def get_current_user(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    return _get_user_by_token(authorization[7:], db)


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def get_user_from_query_token(token: str, db: Session) -> User:
    """SSE 场景：EventSource 无法携带 Header，从查询参数取 token"""
    return _get_user_by_token(token, db)


def month_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_usage(db: Session, user: User) -> int:
    """本月已发起的调研次数"""
    return (
        db.query(ResearchTask)
        .filter(ResearchTask.user_id == user.id, ResearchTask.created_at >= month_start_utc())
        .count()
    )


def get_quota(db: Session, user: User) -> dict:
    plan = effective_plan(user)
    limits = plan_limits(plan)
    return {
        "plan": plan,
        "plan_name": limits["name"],
        "used": month_usage(db, user),
        "limit": limits["monthly_tasks"],
        "max_queries": limits["max_queries"],
    }


def check_quota_or_403(db: Session, user: User) -> None:
    quota = get_quota(db, user)
    if quota["limit"] != UNLIMITED and quota["used"] >= quota["limit"]:
        raise HTTPException(
            status_code=403,
            detail=f"{quota['plan_name']}本月 {quota['limit']} 次调研额度已用完，请升级套餐后继续使用",
        )
