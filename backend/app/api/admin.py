from datetime import datetime, timedelta, timezone
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, month_start_utc
from app.core.plans import PAID_PLANS, PLANS, effective_org_plan, effective_plan
from app.db.database import get_db
from app.db.models import AuditLog, GraphProject, Order, Organization, ResearchTask, User
from app.schemas.auth import (
    AdminListOut,
    AdminOrgListOut,
    AdminOrgOut,
    AdminOrgUpdate,
    AdminStatsOut,
    AdminUserUpdate,
    AuditLogOut,
    AuditStatsOut,
    UserOut,
)
from app.services.audit import log_audit

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/stats", response_model=AdminStatsOut)
def stats(db: Session = Depends(get_db)):
    total_users = db.query(User).count()
    total_tasks = db.query(ResearchTask).count()
    tasks_this_month = db.query(ResearchTask).filter(ResearchTask.created_at >= month_start_utc()).count()
    total_revenue = db.query(func.coalesce(func.sum(Order.amount), 0)).filter(Order.status == "paid").scalar()

    # 付费用户：admin 视同付费；个人 plan 在 PAID_PLANS 中；企业用户的企业 plan 在 PAID_PLANS 中
    admin_count = db.query(User).filter(User.role == "admin").count()

    # 个人付费：无企业且 plan 为 pro/enterprise
    personal_paid = (
        db.query(User)
        .filter(User.org_id == "", User.plan.in_(PAID_PLANS))
        .count()
    )

    # 企业付费：先批量取 org plan，再过滤出付费企业的用户
    org_rows = db.query(Organization.id, Organization.plan).all()
    paid_org_ids = [oid for oid, plan in org_rows if plan in PAID_PLANS]
    org_paid = (
        db.query(User)
        .filter(User.org_id != "", User.role != "admin", User.org_id.in_(paid_org_ids))
        .count()
    ) if paid_org_ids else 0

    paid_users = admin_count + personal_paid + org_paid
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
    return AdminListOut(
        items=[UserOut.model_validate(u) for u in items],
        total=total, page=page, page_size=page_size,
    )


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
    try:
        log_audit(
            user_id=admin.id, org_id=admin.org_id or "",
            action="admin.user_update", resource_type="user", resource_id=user.id,
            input_data=json.dumps({"plan": payload.plan, "role": payload.role}),
            status="success",
        )
    except Exception:
        pass
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

    if not orgs:
        return AdminOrgListOut(items=[], total=total, page=page, page_size=page_size)

    org_ids = [o.id for o in orgs]
    start = month_start_utc()

    # 批量查询：各企业成员数
    member_counts = dict(
        db.query(User.org_id, func.count(User.id))
        .filter(User.org_id.in_(org_ids))
        .group_by(User.org_id)
        .all()
    )

    # 批量查询：各企业本月任务数
    org_task_counts = dict(
        db.query(ResearchTask.org_id, func.count(ResearchTask.id))
        .filter(
            ResearchTask.org_id.in_(org_ids),
            ResearchTask.created_at >= start,
            ResearchTask.status != "failed",
        )
        .group_by(ResearchTask.org_id)
        .all()
    )

    # 批量查询：各企业本月图谱数
    org_graph_counts = dict(
        db.query(GraphProject.org_id, func.count(GraphProject.id))
        .filter(
            GraphProject.org_id.in_(org_ids),
            GraphProject.created_at >= start,
            GraphProject.status != "failed",
        )
        .group_by(GraphProject.org_id)
        .all()
    )

    items = []
    for org in orgs:
        out = AdminOrgOut.model_validate(org)
        out.member_count = member_counts.get(org.id, 0)
        out.month_used = org_task_counts.get(org.id, 0) + org_graph_counts.get(org.id, 0)
        items.append(out)

    return AdminOrgListOut(items=items, total=total, page=page, page_size=page_size)


@router.patch("/orgs/{org_id}", response_model=AdminOrgOut)
def update_org(
    org_id: str,
    payload: AdminOrgUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
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
    try:
        log_audit(
            user_id=admin.id, org_id=admin.org_id or "",
            action="admin.org_update", resource_type="organization", resource_id=org.id,
            input_data=json.dumps({"plan": payload.plan}),
            status="success",
        )
    except Exception:
        pass
    return _org_out(db, org)


# ---------- 审计日志（Sprint 4 + 增强） ----------

@router.get("/audit-logs", response_model=AdminListOut[AuditLogOut])
def list_audit_logs(
    action: str = Query("", max_length=50),
    resource_type: str = Query("", max_length=50),
    user_id: str = Query("", max_length=32),
    org_id: str = Query("", max_length=32),
    start: str = Query("", max_length=30),
    end: str = Query("", max_length=30),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if org_id:
        query = query.filter(AuditLog.org_id == org_id)
    if start:
        try:
            query = query.filter(AuditLog.created_at >= datetime.fromisoformat(start))
        except (ValueError, TypeError):
            pass
    if end:
        try:
            query = query.filter(AuditLog.created_at <= datetime.fromisoformat(end))
        except (ValueError, TypeError):
            pass
    total = query.count()
    items = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AdminListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/audit-logs/stats", response_model=AuditStatsOut)
def audit_stats(
    org_id: str = Query("", max_length=32),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """审计概览统计（SQL 聚合）"""
    from datetime import timedelta as _td
    since = datetime.now(timezone.utc) - _td(days=days)

    base_q = db.query(AuditLog).filter(AuditLog.created_at >= since)
    if org_id:
        base_q = base_q.filter(AuditLog.org_id == org_id)

    total_logs = base_q.count()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_logs = db.query(AuditLog).filter(AuditLog.created_at >= today_start).count()

    # SQL 聚合：成功/失败计数
    success_count = base_q.filter(AuditLog.status == "success").count()
    failed_count = total_logs - success_count

    # SQL 聚合：action 分组
    action_rows = (
        base_q.with_entities(AuditLog.action, func.count(AuditLog.id).label("cnt"))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(20)
        .all()
    )
    action_breakdown = [{"action": a, "count": c} for a, c in action_rows]

    # SQL 聚合：top models by cost
    model_rows = (
        base_q.with_entities(
            AuditLog.model_name,
            func.sum(AuditLog.cost).label("total_cost"),
            func.count(AuditLog.id).label("calls"),
        )
        .filter(AuditLog.model_name != "", AuditLog.cost > 0)
        .group_by(AuditLog.model_name)
        .order_by(func.sum(AuditLog.cost).desc())
        .limit(10)
        .all()
    )
    top_models = [
        {"model": m, "total_cost": round(float(c), 6), "calls": n}
        for m, c, n in model_rows
    ]

    return AuditStatsOut(
        total_logs=total_logs,
        today_logs=today_logs,
        success_count=success_count,
        failed_count=failed_count,
        action_breakdown=action_breakdown,
        top_models=top_models,
    )


@router.get("/audit-logs/export")
def audit_export(
    action: str = Query("", max_length=50),
    resource_type: str = Query("", max_length=50),
    user_id: str = Query("", max_length=32),
    org_id: str = Query("", max_length=32),
    start: str = Query("", max_length=30),
    end: str = Query("", max_length=30),
    db: Session = Depends(get_db),
):
    """导出审计日志 CSV（筛选条件同 list_audit_logs，最多 10000 条）"""
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if org_id:
        query = query.filter(AuditLog.org_id == org_id)
    if start:
        try:
            query = query.filter(AuditLog.created_at >= datetime.fromisoformat(start))
        except (ValueError, TypeError):
            pass
    if end:
        try:
            query = query.filter(AuditLog.created_at <= datetime.fromisoformat(end))
        except (ValueError, TypeError):
            pass
    items = query.order_by(AuditLog.created_at.desc()).limit(10000).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "ID", "时间(UTC)", "用户ID", "组织ID", "操作", "资源类型", "资源ID",
        "状态", "错误", "模型", "Prompt Tokens", "Completion Tokens", "成本(USD)",
        "IP", "User-Agent", "输入", "结果",
    ])
    for l in items:
        writer.writerow([
            l.id,
            l.created_at.isoformat() if l.created_at else "",
            l.user_id, l.org_id, l.action, l.resource_type, l.resource_id,
            l.status, l.error, l.model_name,
            l.tokens_prompt, l.tokens_completion, l.cost,
            l.ip, l.user_agent,
            l.input[:500], l.result[:500],
        ])

    return Response(content=buf.getvalue(), media_type="text/csv; charset=utf-8")
