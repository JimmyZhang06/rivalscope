"""密码哈希与 JWT 签发/校验"""

from datetime import datetime, timedelta, timezone

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


def create_access_token(user_id: str, ver: int = 0) -> str:
    settings = get_settings()
    payload = {
        "sub": user_id,
        "ver": ver,  # 会话版本，与 user.token_version 不一致即失效
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> tuple[str, int] | None:
    """返回 (user_id, ver)，无效或过期返回 None；老 token 无 ver 按 0 兼容"""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            return None
        return user_id, int(payload.get("ver", 0))
    except jwt.PyJWTError:
        return None
