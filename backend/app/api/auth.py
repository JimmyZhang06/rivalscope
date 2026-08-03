import json
import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_quota, rate_limit_dep
from app.core.crypto import decrypt, encrypt
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.db.database import get_db
from app.db.models import GraphProject, LoginLog, Order, ResearchTask, User
from app.schemas.auth import (
    ChangePasswordIn,
    DeleteAccountIn,
    ForgotIn,
    ForgotOut,
    LoginIn,
    LoginLogOut,
    MemberUsage,
    MonthUsage,
    ProfileUpdateIn,
    QuotaOut,
    RegisterIn,
    ResetIn,
    TokenOut,
    UsageOut,
    UserOut,
)
from app.services.audit import log_audit

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
        refresh_token=create_refresh_token(user.id, user.token_version or 0),
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    rate_limit_dep(request)
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
    user = User(email=email, password_hash=hash_password(payload.password), nickname=payload.nickname.strip())
    db.add(user)
    db.flush()
    _log_action(db, user, "register", request)
    db.commit()
    db.refresh(user)
    try:
        log_audit(
            user_id=user.id,
            org_id=user.org_id or "",
            action="user.register",
            resource_type="user",
            resource_id=user.id,
            input_data=f"email={email}",
            status="success",
            ip=(request.client.host if request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    except Exception:
        pass
    return _token_out(user)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    rate_limit_dep(request)
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        try:
            log_audit(
                user_id="",
                org_id="",
                action="user.login_failed",
                resource_type="user",
                resource_id="",
                input_data=f"email={payload.email.lower()}",
                status="failed",
                error="邮箱或密码错误",
                ip=(request.client.host if request.client else "") or "",
                user_agent=(request.headers.get("user-agent") or "")[:300],
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    _log_action(db, user, "login", request)
    db.commit()
    try:
        log_audit(
            user_id=user.id,
            org_id=user.org_id or "",
            action="user.login",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip=(request.client.host if request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    except Exception:
        pass
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
    try:
        log_audit(
            user_id=user.id,
            org_id=user.org_id or "",
            action="user.profile_update",
            resource_type="user",
            resource_id=user.id,
            input_data=json.dumps({"nickname": bool(payload.nickname), "avatar": bool(payload.avatar)}),
            status="success",
        )
    except Exception:
        pass
    return user


@router.post("/change-password", response_model=TokenOut)
def change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    request: Request = None,
    db: Session = Depends(get_db),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    user.password_hash = hash_password(payload.new_password)
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    ip = (request.client.host if request and request.client else "") or ""
    ua = (request.headers.get("user-agent") or "")[:300] if request else ""
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="user.password_change", resource_type="user", resource_id=user.id,
            status="success",
            ip=ip, user_agent=ua,
        )
    except Exception:
        pass
    return _token_out(user)


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
def logout_all(user: User = Depends(get_current_user), request: Request = None, db: Session = Depends(get_db)):
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="user.logout", resource_type="user", resource_id=user.id,
            status="success",
            ip=(request.client.host if request and request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300] if request else "",
        )
    except Exception:
        pass
    return _token_out(user)


@router.delete("/account")
def delete_account(
    payload: DeleteAccountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="管理员账号不能注销")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="密码不正确，无法注销")
    # 级联清理：批量删除任务（触发 ORM 级联删步骤/来源）→ 订单 → 登录日志 → 用户
    db.query(ResearchTask).filter(ResearchTask.user_id == user.id).delete(synchronize_session=False)
    db.query(Order).filter(Order.user_id == user.id).delete(synchronize_session=False)
    db.query(LoginLog).filter(LoginLog.user_id == user.id).delete(synchronize_session=False)
    uid = user.id
    db.delete(user)
    db.commit()
    try:
        log_audit(
            user_id=uid, org_id=user.org_id or "",
            action="user.delete", resource_type="user", resource_id=uid,
            status="success",
        )
    except Exception:
        pass
    return {"message": "账号已注销"}


@router.get("/usage", response_model=UsageOut)
def usage(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    months: int = Query(6, ge=3, le=12),
):
    """近 N 个月每月调研次数（任务 + 图谱）+ 本月配额；企业成员返回成员各自当月用量"""
    now = datetime.now(timezone.utc)
    # 生成最近 N 个月的 YYYY-MM 键（含本月）
    month_keys: list[str] = []
    y, m = now.year, now.month
    for _ in range(months):
        month_keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    month_keys.reverse()
    since = datetime(int(month_keys[0][:4]), int(month_keys[0][5:7]), 1, tzinfo=timezone.utc)
    counts = {key: 0 for key in month_keys}

    # 企业成员：按 org_id 统计全企业（与 month_usage 口径一致）
    # 个人用户：按 user_id 统计
    if user.org_id:
        task_rows = (
            db.query(ResearchTask.created_at)
            .filter(
                ResearchTask.org_id == user.org_id,
                ResearchTask.created_at >= since,
                ResearchTask.status != "failed",
            )
            .all()
        )
        graph_rows = (
            db.query(GraphProject.created_at)
            .filter(
                GraphProject.org_id == user.org_id,
                GraphProject.created_at >= since,
                GraphProject.status != "failed",
            )
            .all()
        )
        # 企业成员各自的当月用量
        member_counts: dict[str, int] = {}
        member_rows = (
            db.query(ResearchTask.user_id, ResearchTask.created_at)
            .filter(
                ResearchTask.org_id == user.org_id,
                ResearchTask.created_at >= since,
                ResearchTask.status != "failed",
            )
            .all()
        )
        for (uid, created_at) in member_rows:
            key = f"{created_at.year:04d}-{created_at.month:02d}"
            if key in month_keys:
                member_counts[uid] = member_counts.get(uid, 0) + 1

        members_out = None
        if member_counts:
            org_members = db.query(User).filter(User.org_id == user.org_id).all()
            members_map = {m.id: m for m in org_members}
            members_out = []
            for uid, cnt in member_counts.items():
                m = members_map.get(uid)
                members_out.append(
                    MemberUsage(
                        user_id=uid,
                        nickname=m.nickname if m and m.nickname else (m.email if m else uid[:8]),
                        count=cnt,
                    )
                )
            members_out.sort(key=lambda x: -x.count)
    else:
        task_rows = (
            db.query(ResearchTask.created_at)
            .filter(
                ResearchTask.user_id == user.id,
                ResearchTask.created_at >= since,
                ResearchTask.status != "failed",
            )
            .all()
        )
        graph_rows = (
            db.query(GraphProject.created_at)
            .filter(
                GraphProject.user_id == user.id,
                GraphProject.created_at >= since,
                GraphProject.status != "failed",
            )
            .all()
        )
        members_out = None

    for (created_at,) in task_rows:
        key = f"{created_at.year:04d}-{created_at.month:02d}"
        if key in counts:
            counts[key] += 1
    for (created_at,) in graph_rows:
        key = f"{created_at.year:04d}-{created_at.month:02d}"
        if key in counts:
            counts[key] += 1

    return UsageOut(
        months=[MonthUsage(month=k, count=counts[k]) for k in month_keys],
        quota=QuotaOut(**get_quota(db, user)),
        members=members_out,
    )


@router.post("/forgot", response_model=ForgotOut)
def forgot_password(payload: ForgotIn, request: Request, db: Session = Depends(get_db)):
    rate_limit_dep(request)
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user:
        # 无论用户是否存在，返回相同消息（防止邮箱枚举）
        return ForgotOut(message="如果邮箱存在，验证码已发送")
    code = f"{random.randint(100000, 999999):06d}"
    user.reset_code = encrypt(code)
    user.reset_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()
    try:
        log_audit(
            user_id=user.id,
            org_id=user.org_id or "",
            action="user.password_forgot",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip=(request.client.host if request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    except Exception:
        pass
    # 发送验证码邮件
    try:
        from app.services.notify import send_email
        subject = "竞品调研助手 — 密码重置验证码"
        body = f"您的密码重置验证码是：{code}\n\n验证码 10 分钟内有效。如非本人操作，请忽略此邮件。"
        html = (
            f"<div style='font-family:'Microsoft YaHei','Segoe UI',sans-serif;color:#1f2937;font-size:14px;line-height:1.8;'>"
            f"<p>您的密码重置验证码是：</p>"
            f"<p style='font-size:24px;font-weight:bold;letter-spacing:4px;color:#1e40af;'>{code}</p>"
            f"<p>验证码 <strong>10 分钟内</strong> 有效。如非本人操作，请忽略此邮件。</p>"
            f"</div>"
        )
        send_email(user.email, subject, body, html)
    except Exception:
        pass
    return ForgotOut(message="如果邮箱存在，验证码已发送")


@router.post("/refresh", response_model=TokenOut)
def refresh_token(payload: dict, db: Session = Depends(get_db)):
    """使用 refresh token 换取新的 access + refresh token"""
    from app.core.security import decode_refresh_token
    raw = payload.get("refresh_token", "")
    decoded = decode_refresh_token(raw)
    if not decoded:
        raise HTTPException(status_code=401, detail="Refresh token 无效或已过期")
    user_id, ver = decoded
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="账号不存在")
    if ver != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    return _token_out(user)


@router.post("/reset")
def reset_password(payload: ResetIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not user.reset_code:
        raise HTTPException(status_code=400, detail="验证码错误")
    # 解密存储的验证码进行比较
    stored_code = decrypt(user.reset_code)
    if not stored_code or stored_code != payload.code:
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
    try:
        log_audit(
            user_id=user.id,
            org_id=user.org_id or "",
            action="user.password_reset",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip=(request.client.host if request.client else "") or "",
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    except Exception:
        pass
    return {"message": "密码已重置，请使用新密码登录"}
