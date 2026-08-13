"""密码哈希与 JWT 签发/校验"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _assert_jwt_secret() -> None:
    settings = get_settings()
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET 环境变量未设置，应用无法启动")


def create_access_token(user_id: str, ver: int = 0) -> str:
    _assert_jwt_secret()
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "ver": ver,
        "exp": now + timedelta(hours=8),
        "iat": now,
        "iss": settings.jwt_issuer,
        "nbf": now,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(user_id: str, ver: int = 0) -> str:
    """Refresh token：有效期 30 天，仅用于换取新的 access token"""
    _assert_jwt_secret()
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "ver": ver,
        "exp": now + timedelta(days=30),
        "iat": now,
        "iss": settings.jwt_issuer,
        "nbf": now,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_stream_ticket(user_id: str, task_id: str, ver: int = 0) -> str:
    """签发仅用于单个任务 SSE 的短期凭据，避免把 access token 暴露在 URL 中。"""
    _assert_jwt_secret()
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "task": task_id,
        "ver": ver,
        "jti": uuid4().hex,
        "exp": now + timedelta(seconds=60),
        "iat": now,
        "iss": settings.jwt_issuer,
        "nbf": now,
        "type": "stream",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> tuple[str, int] | None:
    """返回 (user_id, ver)，无效或过期返回 None；老 token 无 ver 按 0 兼容"""
    _assert_jwt_secret()
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
        token_type = payload.get("type", "access")
        if token_type != "access":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        return user_id, int(payload.get("ver", 0))
    except jwt.PyJWTError:
        return None


def decode_refresh_token(token: str) -> tuple[str, int] | None:
    """返回 (user_id, ver)，仅接受 type=refresh 的 token"""
    _assert_jwt_secret()
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
        if payload.get("type") != "refresh":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        return user_id, int(payload.get("ver", 0))
    except jwt.PyJWTError:
        return None


def decode_stream_ticket(token: str) -> tuple[str, int, str] | None:
    """返回 (user_id, token_version, task_id)，仅接受短期 stream ticket。"""
    _assert_jwt_secret()
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
        if payload.get("type") != "stream":
            return None
        user_id = payload.get("sub")
        task_id = payload.get("task")
        if not user_id or not task_id:
            return None
        return user_id, int(payload.get("ver", 0)), task_id
    except (jwt.PyJWTError, TypeError, ValueError):
        return None
