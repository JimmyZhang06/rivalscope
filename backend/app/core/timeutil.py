"""时效性工具：基准时间、发布时间解析、时间衰减权重

用于让调研管线"知道今天"，并对旧信息按时间衰减降权。
"""

from datetime import datetime, timezone
from math import exp, log

from app.core.config import get_settings

_DATE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%dT%H:%M:%S.%f%z",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
)


def baseline_now() -> datetime:
    """当前基准时间（tz-aware, UTC）。

    优先读 Settings.research_now_override（ISO 日期字符串，便于演示/回测），
    解析失败或为空则用真实的 datetime.now(utc)。
    """
    override = (get_settings().research_now_override or "").strip()
    if override:
        parsed = parse_published(override)
        if parsed is not None:
            return parsed
    return datetime.now(timezone.utc)


def parse_published(s: str | None) -> datetime | None:
    """容错解析发布时间，返回 tz-aware UTC datetime；无法解析返回 None。"""
    if not s:
        return None
    text = str(s).strip()
    if not text:
        return None
    # 兼容以 Z 结尾的 ISO 8601
    candidate = text.replace("Z", "+00:00") if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(candidate)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(text, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def recency_weight(
    published: datetime | None,
    now: datetime | None = None,
    half_life_days: float = 180.0,
) -> float:
    """按发布时间做指数衰减，返回 0~1 的新鲜度权重。

    - 无发布时间：给中性值 0.4（既不重奖也不重罚）
    - 半衰期 half_life_days：越旧权重越低；未来时间按 1.0 处理
    """
    if published is None:
        return 0.4
    if now is None:
        now = baseline_now()
    age_days = (now - published).total_seconds() / 86400.0
    if age_days <= 0:
        return 1.0
    decay = exp(-log(2.0) * age_days / half_life_days)
    return max(0.0, min(1.0, decay))


def age_days_of(published: datetime | None, now: datetime | None = None) -> int:
    """距今天数（向下取整）；无发布时间返回 -1。"""
    if published is None:
        return -1
    if now is None:
        now = baseline_now()
    return max(0, int((now - published).total_seconds() // 86400))


def utcnow() -> datetime:
    """当前 UTC 时间（tz-aware）。与 baseline_now 相同，但名称更短，适合作为通用工具。"""
    return baseline_now()
