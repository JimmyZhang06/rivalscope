"""会员等级与权益定义"""

from datetime import datetime, timezone

UNLIMITED = -1

PLANS: dict[str, dict] = {
    "free": {
        "name": "免费版",
        "price": 0,
        "monthly_tasks": 3,
        "max_queries": 4,
        "priority": False,
        "description": "个人体验，每月 3 次调研",
    },
    "pro": {
        "name": "专业版",
        "price": 99,
        "monthly_tasks": 30,
        "max_queries": 8,
        "priority": True,
        "description": "个人/小团队日常使用",
    },
    "enterprise": {
        "name": "企业版",
        "price": 399,
        "monthly_tasks": UNLIMITED,
        "max_queries": 12,
        "priority": True,
        "description": "企业级不限量调研",
    },
}

PAID_PLANS = ("pro", "enterprise")


def effective_plan(user) -> str:
    """用户当前生效的等级：管理员视同企业版；付费套餐过期回落免费版"""
    if user.role == "admin":
        return "enterprise"
    if user.plan in PAID_PLANS:
        expires = user.plan_expires_at
        if expires is not None:
            if expires.tzinfo is None:  # SQLite 存储可能丢失时区信息
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < datetime.now(timezone.utc):
                return "free"
        return user.plan
    return "free"


def plan_limits(plan: str) -> dict:
    return PLANS.get(plan, PLANS["free"])
