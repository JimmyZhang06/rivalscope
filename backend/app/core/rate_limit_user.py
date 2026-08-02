"""用户级限流：补充 IP 级限流，防止 IP 共享场景下的滥用"""
import time

from collections import defaultdict


class UserTokenBucket:
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


# user_id -> bucket（登录态限流）
_user_buckets: dict[str, UserTokenBucket] = defaultdict(
    lambda: UserTokenBucket(30, 30)  # 登录用户 30 req/s
)


def check_user_rate_limit(user_id: str) -> bool:
    """用户级限流检查（需要登录态）"""
    return _user_buckets[user_id].consume()
