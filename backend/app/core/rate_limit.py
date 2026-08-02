"""基于内存的令牌桶限流

策略（按 IP + 端点分类）:
  /api/auth/login    5 次/秒
  /api/auth/register 3 次/秒
  /api/auth/forgot   2 次/秒
  默认               60 次/秒

生产环境可替换为 Redis 实现，接口不变。
"""

import time

from collections import defaultdict


class TokenBucket:
    __slots__ = ("capacity", "refill_rate", "tokens", "last_check")

    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens: float = capacity
        self.last_check = time.time()

    def consume(self, count: int = 1) -> bool:
        now = time.time()
        elapsed = now - self.last_check
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_check = now
        if self.tokens >= count:
            self.tokens -= count
            return True
        return False


# key = "ip:endpoint_path"
_buckets: dict[str, TokenBucket] = defaultdict(
    lambda: TokenBucket(60, 60)  # 默认 60 req/s
)

_RULES: dict[str, tuple[int, float]] = {
    "/api/auth/login": (5, 5.0),
    "/api/auth/register": (3, 3.0),
    "/api/auth/forgot": (2, 2.0),
    "/api/auth/reset": (3, 3.0),
}


def check_rate_limit(ip: str, path: str) -> bool:
    rule = _RULES.get(path)
    if rule:
        capacity, rate = rule
    else:
        capacity, rate = 60, 60.0

    key = f"{ip}:{path}"
    bucket = _buckets[key]
    # 如果容量被调小，截断当前令牌数
    if bucket.capacity != capacity:
        bucket.capacity = capacity
        bucket.tokens = min(bucket.tokens, capacity)
        bucket.refill_rate = rate
    return bucket.consume()
