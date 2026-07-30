from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, month_start_utc
from app.core.plans import PLANS
from app.db.database import get_db
from app.db.models import Order, ResearchTask, User
from app.schemas.auth import AdminStatsOut, AdminUserUpdate, UserOut

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/stats", response_model=AdminStatsOut)
def stats(db: Session = Depends(get_db)):
    total_users = db.query(User).count()
    total_tasks = db.query(ResearchTask).count()
    tasks_this_month = db.query(ResearchTask).filter(ResearchTask.created_at >= month_start_utc()).count()
    total_revenue = db.query(func.coalesce(func.sum(Order.amount), 0)).filter(Order.status == "paid").scalar()
    paid_users = db.query(User).filter(User.plan != "free").count()
    return AdminStatsOut(
        total_users=total_users,
        total_tasks=total_tasks,
        tasks_this_month=tasks_this_month,
        total_revenue=total_revenue,
        paid_users=paid_users,
    )


@router.get("/users", response_model=list[UserOut])
def list_users(q: str = Query("", max_length=100), db: Session = Depends(get_db)):
    query = db.query(User)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter((User.email.ilike(like)) | (User.nickname.ilike(like)))
    return query.order_by(User.created_at.desc()).limit(200).all()


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
