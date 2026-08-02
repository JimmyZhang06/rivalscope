"""Fernet 对称加密：用于加密数据库中敏感字段

- 基于 AES-128-CBC + HMAC，是认证加密（AEAD）
- 同一个明文每次加密结果不同（含随机 IV）
- 密钥从 Settings.master_key 加载（通过 pydantic-settings 从 .env 读取）
"""

from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_cipher: Optional[Fernet] = None


def _get_cipher() -> Fernet:
    global _cipher
    if _cipher is None:
        from app.core.config import get_settings
        settings = get_settings()
        key = settings.master_key
        if not key:
            raise RuntimeError(
                "MASTER_KEY 环境变量未设置。运行 scripts/generate_keys.py 生成密钥后写入 .env"
            )
        _cipher = Fernet(key.encode())
    return _cipher


def encrypt(plaintext: str) -> str:
    """加密字符串，返回 Fernet token（URL-safe base64）"""
    if not plaintext:
        return ""
    return _get_cipher().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """解密 Fernet token，返回原文；解密失败返回空串"""
    if not ciphertext:
        return ""
    try:
        return _get_cipher().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return ""
