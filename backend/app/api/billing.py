from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.plans import PAID_PLANS, PLANS, effective_org_plan, effective_plan
from app.db.database import get_db
from app.db.models import Order, Organization, User
from app.schemas.auth import OrderOut, UpgradeIn

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/plans")
def list_plans():
    """套餐权益表，供定价页展示"""
    return [{"key": key, **value} for key, value in PLANS.items()]


def _extend_expires(current_plan: str, effective: str, new_plan: str, expires_at, now: datetime) -> datetime:
    """同套餐续费在现有到期时间上顺延，否则从当前时间起 30 天"""
    base = now
    if current_plan == new_plan and effective == new_plan and expires_at:
        expires = expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        base = max(now, expires)
    return base + timedelta(days=30)


@router.post("/upgrade", response_model=OrderOut, status_code=201)
def upgrade(payload: UpgradeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """模拟支付：创建订单并立即生效 30 天；已入企用户升级的是企业套餐"""
    if payload.plan not in PAID_PLANS:
        raise HTTPException(status_code=400, detail="无效的套餐")
    now = datetime.now(timezone.utc)
    order = Order(user_id=user.id, plan=payload.plan, amount=PLANS[payload.plan]["price"], status="paid", paid_at=now)
    db.add(order)

    org = db.get(Organization, user.org_id) if user.org_id else None
    if org:
        if user.org_role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="仅企业所有者或管理员可升级企业套餐")
        org.plan_expires_at = _extend_expires(
            org.plan, effective_org_plan(org), payload.plan, org.plan_expires_at, now
        )
        org.plan = payload.plan
    else:
        user.plan_expires_at = _extend_expires(
            user.plan, effective_plan(user), payload.plan, user.plan_expires_at, now
        )
        user.plan = payload.plan
    db.commit()
    db.refresh(order)
    return order


@router.get("/orders", response_model=list[OrderOut])
def list_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Order).filter(Order.user_id == user.id).order_by(Order.created_at.desc()).all()
