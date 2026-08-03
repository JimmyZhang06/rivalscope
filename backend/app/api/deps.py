"""认证依赖与配额计算"""

from datetime import datetime, timezone

import json
import logging
import time

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.plans import UNLIMITED, effective_org_plan, effective_plan, plan_limits
from app.core.rate_limit import check_rate_limit
from app.core.security import decode_access_token
from app.db.database import SessionLocal, get_db
from app.db.models import GraphProject, Notification, Organization, ResearchTask, User, UserPermission

logger = logging.getLogger(__name__)


def _get_user_by_token(token: str, db: Session) -> User:
    decoded = decode_access_token(token)
    if not decoded:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user_id, ver = decoded[:2]
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


def get_session_id(authorization: str = Header(default="")) -> str:
    """从 JWT token 中提取 session_id，用于审计日志关联"""
    if not authorization.startswith("Bearer "):
        return ""
    token = authorization[7:]
    decoded = decode_access_token(token)
    if not decoded:
        return ""
    return decoded[2] if len(decoded) > 2 else ""


def get_user_from_query_token(token: str, db: Session) -> User:
    """SSE 场景：EventSource 无法携带 Header，从查询参数取 token"""
    return _get_user_by_token(token, db)


def month_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def get_user_org(db: Session, user: User) -> Organization | None:
    """用户所属企业，无企业返回 None"""
    if not user.org_id:
        return None
    return db.get(Organization, user.org_id)


def month_usage(db: Session, user: User) -> int:
    """本月已消耗的调研额度"""
    start = month_start_utc()
    tasks = db.query(ResearchTask).filter(
        ResearchTask.created_at >= start, ResearchTask.status != "failed"
    )
    graphs = db.query(GraphProject).filter(
        GraphProject.created_at >= start, GraphProject.status != "failed"
    )
    if user.org_id:
        tasks = tasks.filter(ResearchTask.org_id == user.org_id)
        graphs = graphs.filter(GraphProject.org_id == user.org_id)
    else:
        tasks = tasks.filter(ResearchTask.user_id == user.id)
        graphs = graphs.filter(GraphProject.user_id == user.id)
    return tasks.count() + graphs.count()


def member_month_usage(db: Session, user_id: str) -> int:
    """本月该成员本人消耗的额度"""
    start = month_start_utc()
    tasks = db.query(ResearchTask).filter(
        ResearchTask.user_id == user_id,
        ResearchTask.created_at >= start,
        ResearchTask.status != "failed",
    ).count()
    graphs = db.query(GraphProject).filter(
        GraphProject.user_id == user_id,
        GraphProject.created_at >= start,
        GraphProject.status != "failed",
    ).count()
    return tasks + graphs


def get_quota(db: Session, user: User) -> dict:
    from app.core.plans import UNLIMITED, effective_org_plan, effective_plan, plan_limits
    org = get_user_org(db, user)
    if org and user.role != "admin":
        plan = effective_org_plan(org)
    else:
        plan = effective_plan(user)
    limits = plan_limits(plan)
    member_limit = user.org_monthly_limit if org else UNLIMITED
    return {
        "plan": plan,
        "plan_name": limits["name"],
        "used": month_usage(db, user),
        "limit": limits["monthly_tasks"],
        "max_queries": limits["max_queries"],
        "member_used": member_month_usage(db, user.id) if org else 0,
        "member_limit": member_limit,
    }


def check_quota_or_403(db: Session, user: User) -> None:
    from app.core.plans import UNLIMITED, plan_limits
    quota = get_quota(db, user)
    if quota["limit"] != UNLIMITED and quota["used"] >= quota["limit"]:
        raise HTTPException(
            status_code=403,
            detail=f"{quota['plan_name']}本月 {quota['limit']} 次调研额度已用完，请升级套餐后继续使用",
        )
    if quota["member_limit"] != UNLIMITED and quota["member_used"] >= quota["member_limit"]:
        raise HTTPException(
            status_code=403,
            detail=f"您本月的成员额度（{quota['member_limit']} 次）已用完，请联系企业管理员调整",
        )
    _notify_quota_warning(db, user, quota)


def _notify_quota_warning(db: Session, user: User, quota: dict) -> None:
    from app.db.models import Notification
    if quota["limit"] == UNLIMITED or quota["limit"] <= 0:
        return
    ratio = quota["used"] / quota["limit"]
    if ratio < 0.8:
        return
    start = month_start_utc()
    exists = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.title == "额度预警",
        Notification.created_at >= start,
    ).count()
    if exists:
        return
    db.add(Notification(
        user_id=user.id,
        org_id=user.org_id,
        title="额度预警",
        body=f"本月额度已使用 {ratio:.0%}，请注意控制用量",
        link="/app/account",
    ))
    db.commit()


def invalidate_perm_cache(user_id: str = "") -> None:
    global _PERM_CACHE
    if user_id:
        _PERM_CACHE.pop(user_id, None)
    else:
        _PERM_CACHE.clear()


# ---------- RBAC 权限（Sprint 4） ----------

_PERM_CACHE: dict[str, tuple[set[str], float]] = {}  # user_id -> (perms, cached_at)
_CACHE_TTL = 60  # 秒


def _load_permissions(db: Session, user_id: str) -> set[str]:
    now = time.time()
    cached = _PERM_CACHE.get(user_id)
    if cached and now - cached[1] < _CACHE_TTL:
        return cached[0]

    perms: set[str] = set()
    user = db.get(User, user_id)
    if user and user.role == "admin":
        perms = {"*"}

    rows = db.query(UserPermission).filter(UserPermission.user_id == user_id).all()
    for row in rows:
        try:
            perms.update(json.loads(row.permissions or "[]"))
        except (ValueError, TypeError):
            pass

    _PERM_CACHE[user_id] = (perms, now)
    return perms


def require_permission(*permissions: str):
    """依赖项：检查当前用户是否有任一指定权限"""
    async def _check(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        user_perms = _load_permissions(db, user.id)
        if "*" in user_perms or any(p in user_perms for p in permissions):
            return user
        raise HTTPException(status_code=403, detail=f"需要权限：{', '.join(permissions)}")
    return _check


async def rate_limit_dep(request: Request) -> None:
    """限流依赖：按 IP + 端点路径判断，超过阈值抛 429"""
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip, request.url.path):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后重试")