import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_quota
from app.core.security import create_access_token, hash_password, verify_password
from app.db.database import get_db
from app.db.models import LoginLog, Order, ResearchTask, User
from app.schemas.auth import (
    ChangePasswordIn,
    DeleteAccountIn,
    ForgotIn,
    ForgotOut,
    LoginIn,
    LoginLogOut,
    MonthUsage,
    ProfileUpdateIn,
    QuotaOut,
    RegisterIn,
    ResetIn,
    TokenOut,
    UsageOut,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_KEYS = {"", "blue", "cyan", "emerald", "amber", "rose", "slate", "teal", "sky"}


def _valid_avatar(v: str) -> bool:
    """允许预设色键，或前端压缩后上传的 data URL 图片（≤ 200KB 文本）"""
    if v in AVATAR_KEYS:
        return True
    return v.startswith("data:image/") and ";base64," in v[:40]


def _log_action(db: Session, user: User, action: str, request: Request) -> None:
    """记录登录/注册/重置密码日志（随调用方一起 commit）"""
    db.add(
        LoginLog(
            user_id=user.id,
            action=action,
            ip=(request.client.host if request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    )


def _token_out(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, user.token_version or 0),
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
    user = User(email=email, password_hash=hash_password(payload.password), nickname=payload.nickname.strip())
    db.add(user)
    db.flush()
    _log_action(db, user, "register", request)
    db.commit()
    db.refresh(user)
    return _token_out(user)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    _log_action(db, user, "login", request)
    db.commit()
    return _token_out(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if payload.nickname is not None:
        nickname = payload.nickname.strip()
        if not nickname:
            raise HTTPException(status_code=422, detail="昵称不能为空")
        user.nickname = nickname
    if payload.avatar is not None:
        if not _valid_avatar(payload.avatar):
            raise HTTPException(status_code=422, detail="无效的头像选项")
        user.avatar = payload.avatar
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", response_model=TokenOut)
def change_password(
    payload: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    user.password_hash = hash_password(payload.new_password)
    user.token_version = (user.token_version or 0) + 1  # 其他设备旧 token 全部失效
    db.commit()
    db.refresh(user)
    return _token_out(user)  # 返回新 token，当前设备无感


@router.get("/logins", response_model=list[LoginLogOut])
def list_logins(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(LoginLog)
        .filter(LoginLog.user_id == user.id)
        .order_by(LoginLog.created_at.desc())
        .limit(20)
        .all()
    )


@router.post("/logout-all", response_model=TokenOut)
def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    return _token_out(user)


@router.delete("/account")
def delete_account(
    payload: DeleteAccountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="管理员账号不能注销")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="密码不正确，无法注销")
    # 级联清理：任务（ORM 级联删步骤/来源）→ 订单 → 登录日志 → 用户
    for task in db.query(ResearchTask).filter(ResearchTask.user_id == user.id).all():
        db.delete(task)
    db.query(Order).filter(Order.user_id == user.id).delete()
    db.query(LoginLog).filter(LoginLog.user_id == user.id).delete()
    db.delete(user)
    db.commit()
    return {"message": "账号已注销"}


@router.get("/usage", response_model=UsageOut)
def usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """近 6 个月每月调研次数 + 本月配额"""
    now = datetime.now(timezone.utc)
    # 生成最近 6 个月的 YYYY-MM 键（含本月）
    months: list[str] = []
    y, m = now.year, now.month
    for _ in range(6):
        months.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    since = datetime(int(months[0][:4]), int(months[0][5:7]), 1, tzinfo=timezone.utc)
    counts = {key: 0 for key in months}
    tasks = (
        db.query(ResearchTask.created_at)
        .filter(ResearchTask.user_id == user.id, ResearchTask.created_at >= since)
        .all()
    )
    for (created_at,) in tasks:
        key = f"{created_at.year:04d}-{created_at.month:02d}"
        if key in counts:
            counts[key] += 1
    return UsageOut(
        months=[MonthUsage(month=k, count=counts[k]) for k in months],
        quota=QuotaOut(**get_quota(db, user)),
    )


@router.post("/forgot", response_model=ForgotOut)
def forgot_password(payload: ForgotIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="该邮箱未注册")
    code = f"{random.randint(0, 999999):06d}"
    user.reset_code = code
    user.reset_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()
    # 演示模式：无邮件服务，验证码直接返回给前端展示
    return ForgotOut(message="验证码已生成（演示模式：无邮件服务，验证码如下）", demo_code=code)


@router.post("/reset")
def reset_password(payload: ResetIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not user.reset_code or user.reset_code != payload.code:
        raise HTTPException(status_code=400, detail="验证码错误")
    expires = user.reset_code_expires_at
    if expires and expires.tzinfo is None:  # SQLite 丢失时区信息
        expires = expires.replace(tzinfo=timezone.utc)
    if not expires or expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="验证码已过期，请重新获取")
    user.password_hash = hash_password(payload.new_password)
    user.reset_code = ""
    user.reset_code_expires_at = None
    user.token_version = (user.token_version or 0) + 1  # 所有旧登录失效
    _log_action(db, user, "reset", request)
    db.commit()
    return {"message": "密码已重置，请使用新密码登录"}
