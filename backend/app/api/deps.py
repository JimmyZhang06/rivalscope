"""认证依赖与配额计算"""

from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.plans import UNLIMITED, effective_org_plan, effective_plan, plan_limits
from app.core.security import decode_access_token
from app.db.database import get_db
from app.db.models import GraphProject, Organization, ResearchTask, User


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


def get_user_org(db: Session, user: User) -> Organization | None:
    """用户所属企业，无企业返回 None"""
    if not user.org_id:
        return None
    return db.get(Organization, user.org_id)


def month_usage(db: Session, user: User) -> int:
    """本月已消耗的调研额度：调研任务 + 图谱构建，失败的不计入；
    入企用户按企业全员统计（共享企业配额），否则按个人"""
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
    """本月该成员本人消耗的额度（调研任务 + 图谱构建，失败不计），用于成员个人额度校验"""
    start = month_start_utc()
    tasks = (
        db.query(ResearchTask)
        .filter(
            ResearchTask.user_id == user_id,
            ResearchTask.created_at >= start,
            ResearchTask.status != "failed",
        )
        .count()
    )
    graphs = (
        db.query(GraphProject)
        .filter(
            GraphProject.user_id == user_id,
            GraphProject.created_at >= start,
            GraphProject.status != "failed",
        )
        .count()
    )
    return tasks + graphs


def get_quota(db: Session, user: User) -> dict:
    """配额：有企业时按企业套餐（管理员个人豁免仍生效），否则按个人套餐；
    成员个人月额度（管理员设置）作为第二重限制，member_limit=-1 表示未设限"""
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
