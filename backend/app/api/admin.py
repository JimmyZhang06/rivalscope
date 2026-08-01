from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, month_start_utc
from app.core.plans import PAID_PLANS, PLANS, effective_org_plan, effective_plan
from app.db.database import get_db
from app.db.models import GraphProject, Order, Organization, ResearchTask, User
from app.schemas.auth import (
    AdminListOut,
    AdminOrgListOut,
    AdminOrgOut,
    AdminOrgUpdate,
    AdminStatsOut,
    AdminUserUpdate,
    UserOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/stats", response_model=AdminStatsOut)
def stats(db: Session = Depends(get_db)):
    total_users = db.query(User).count()
    total_tasks = db.query(ResearchTask).count()
    tasks_this_month = db.query(ResearchTask).filter(ResearchTask.created_at >= month_start_utc()).count()
    total_revenue = db.query(func.coalesce(func.sum(Order.amount), 0)).filter(Order.status == "paid").scalar()
    # 活跃付费用户：管理员视同付费；入企用户按企业有效套餐；个人按个人有效套餐
    orgs = {o.id: o for o in db.query(Organization).all()}
    paid_users = sum(
        1
        for u in db.query(User).all()
        if (u.role == "admin")
        or (u.org_id and u.org_id in orgs and effective_org_plan(orgs[u.org_id]) in PAID_PLANS)
        or (not u.org_id and effective_plan(u) in PAID_PLANS)
    )
    return AdminStatsOut(
        total_users=total_users,
        total_tasks=total_tasks,
        tasks_this_month=tasks_this_month,
        total_revenue=total_revenue,
        paid_users=paid_users,
    )


@router.get("/users", response_model=AdminListOut)
def list_users(
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter((User.email.ilike(like)) | (User.nickname.ilike(like)))
    total = query.count()
    items = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AdminListOut(items=items, total=total, page=page, page_size=page_size)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if payload.plan is not None:
        if payload.plan not in PLANS:
            raise HTTPException(status_code=400, detail="无效的套餐")
        user.plan = payload.plan
        user.plan_expires_at = (
            None if payload.plan == "free" else datetime.now(timezone.utc) + timedelta(days=30)
        )
    if payload.role is not None:
        if payload.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="无效的角色")
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
        user.role = payload.role
    db.commit()
    db.refresh(user)
    return user


def _org_month_used(db: Session, org_id: str) -> int:
    """企业本月已消耗额度：调研任务 + 图谱构建，失败不计（与 deps.month_usage 口径一致）"""
    start = month_start_utc()
    tasks = (
        db.query(ResearchTask)
        .filter(
            ResearchTask.org_id == org_id,
            ResearchTask.created_at >= start,
            ResearchTask.status != "failed",
        )
        .count()
    )
    graphs = (
        db.query(GraphProject)
        .filter(
            GraphProject.org_id == org_id,
            GraphProject.created_at >= start,
            GraphProject.status != "failed",
        )
        .count()
    )
    return tasks + graphs


def _org_out(db: Session, org: Organization) -> AdminOrgOut:
    out = AdminOrgOut.model_validate(org)
    out.member_count = db.query(User).filter(User.org_id == org.id).count()
    out.month_used = _org_month_used(db, org.id)
    return out


@router.get("/orgs", response_model=AdminOrgListOut)
def list_orgs(
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Organization)
    if q.strip():
        query = query.filter(Organization.name.ilike(f"%{q.strip()}%"))
    total = query.count()
    orgs = query.order_by(Organization.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AdminOrgListOut(
        items=[_org_out(db, org) for org in orgs], total=total, page=page, page_size=page_size
    )


@router.patch("/orgs/{org_id}", response_model=AdminOrgOut)
def update_org(org_id: str, payload: AdminOrgUpdate, db: Session = Depends(get_db)):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="企业不存在")
    if payload.plan is not None:
        if payload.plan not in PLANS:
            raise HTTPException(status_code=400, detail="无效的套餐")
        org.plan = payload.plan
        org.plan_expires_at = (
            None if payload.plan == "free" else datetime.now(timezone.utc) + timedelta(days=30)
        )
    db.commit()
    db.refresh(org)
    return _org_out(db, org)
