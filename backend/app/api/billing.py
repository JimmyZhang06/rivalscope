from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.plans import PAID_PLANS, PLANS, effective_plan
from app.db.database import get_db
from app.db.models import Order, User
from app.schemas.auth import OrderOut, UpgradeIn

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/plans")
def list_plans():
    """套餐权益表，供定价页展示"""
    return [{"key": key, **value} for key, value in PLANS.items()]


@router.post("/upgrade", response_model=OrderOut, status_code=201)
def upgrade(payload: UpgradeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """模拟支付：创建订单并立即生效 30 天"""
    if payload.plan not in PAID_PLANS:
        raise HTTPException(status_code=400, detail="无效的套餐")
    now = datetime.now(timezone.utc)
    order = Order(user_id=user.id, plan=payload.plan, amount=PLANS[payload.plan]["price"], status="paid", paid_at=now)
    db.add(order)

    # 同套餐续费则在现有到期时间上顺延，否则从当前时间起 30 天
    base = now
    if user.plan == payload.plan and effective_plan(user) == payload.plan and user.plan_expires_at:
        expires = user.plan_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        base = max(now, expires)
    user.plan = payload.plan
    user.plan_expires_at = base + timedelta(days=30)
    db.commit()
    db.refresh(order)
    return order


@router.get("/orders", response_model=list[OrderOut])
def list_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Order).filter(Order.user_id == user.id).order_by(Order.created_at.desc()).all()
