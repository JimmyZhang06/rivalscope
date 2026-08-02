"""异常行为检测：基于审计日志的告警规则"""

import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# 告警规则配置
BRUTE_FORCE_THRESHOLD = 5       # 同一 IP 10 分钟内登录失败 >= 5 次
BRUTE_FORCE_WINDOW = 600        # 时间窗口（秒）= 10 分钟

BULK_DELETE_THRESHOLD = 10      # 1 小时内删除 >= 10 条资源
BULK_DELETE_WINDOW = 3600       # 时间窗口（秒）= 1 小时

ADMIN_OFF_HOURS_START = 22      # 非工作时间开始（22:00）
ADMIN_OFF_HOURS_END = 8         # 非工作时间结束（08:00）


class _WindowCounter:
    """滑动窗口计数器：记录 [key] 在时间窗口内的事件数"""

    def __init__(self, window_seconds: int):
        self.window = window_seconds
        self._events: list[tuple[float, str]] = []  # (timestamp, key)

    def record(self, key: str) -> int:
        """记录一次事件，返回当前窗口内该 key 的累计数"""
        now = time.time()
        self._events = [(t, k) for t, k in self._events if now - t <= self.window]
        self._events.append((now, key))
        return sum(1 for _, k in self._events if k == key)

    def purge(self) -> None:
        """清理过期记录"""
        now = time.time()
        self._events = [(t, k) for t, k in self._events if now - t <= self.window]


# 全局计数器（进程级，重启后清空）
_failed_logins: dict[str, _WindowCounter] = defaultdict(lambda: _WindowCounter(BRUTE_FORCE_WINDOW))
_bulk_deletes: _WindowCounter = _WindowCounter(BULK_DELETE_WINDOW)


def check_anomalies(audit_entry: dict, db: Session | None = None) -> list[dict]:
    """根据审计条目检查异常行为，返回告警列表"""
    alerts: list[dict] = []
    action = audit_entry.get("action", "")
    ip = audit_entry.get("ip", "")
    user_id = audit_entry.get("user_id", "")
    org_id = audit_entry.get("org_id", "")
    resource_type = audit_entry.get("resource_type", "")
    status = audit_entry.get("status", "")

    # 规则 1：暴力破解检测
    if action == "user.login_failed" and ip:
        count = _failed_logins[ip].record(ip)
        if count >= BRUTE_FORCE_THRESHOLD:
            alerts.append({
                "type": "brute_force",
                "level": "critical",
                "message": f"IP {ip} 在 {BRUTE_FORCE_WINDOW // 60} 分钟内登录失败 {count} 次",
                "ip": ip,
            })
            _failed_logins[ip]._events.clear()

    # 规则 2：批量删除检测
    if action in ("task.delete", "graph.delete", "tracker.delete", "competitor.delete") and status == "success":
        count = _bulk_deletes.record(f"{user_id}:{resource_type}")
        if count >= BULK_DELETE_THRESHOLD:
            alerts.append({
                "type": "bulk_delete",
                "level": "warning",
                "message": f"用户 {user_id[:8]} 在 1 小时内删除了 {count} 条 {resource_type} 资源",
                "user_id": user_id,
                "org_id": org_id,
            })
            _bulk_deletes._events.clear()

    # 规则 3：管理员非工作时间操作
    if action.startswith("admin.") and user_id:
        now = datetime.now(timezone.utc)
        hour = now.hour
        if hour >= ADMIN_OFF_HOURS_START or hour < ADMIN_OFF_HOURS_END:
            alerts.append({
                "type": "admin_off_hours",
                "level": "info",
                "message": f"管理员在非时间（{hour:02d}:00）执行操作: {action}",
                "user_id": user_id,
                "org_id": org_id,
                "action": action,
            })

    # 通知写入（异步，不阻塞主流程）
    if db and alerts:
        for alert in alerts:
            try:
                _notify_admins(db, alert)
            except Exception:
                logger.exception("failed to create system notification")

    return alerts


def _notify_admins(db: Session, alert: dict) -> None:
    """将告警通知写入通知表"""
    from app.db.models import Notification, User

    recipients: set[str] = set()
    org_id = alert.get("org_id", "")

    # 企业告警：通知该企业 owner
    if org_id:
        owner = db.query(User).filter(User.org_id == org_id, User.org_role == "owner").first()
        if owner:
            recipients.add(owner.id)

    # 全局告警：通知所有系统 admin
    for admin in db.query(User).filter(User.role == "admin").all():
        recipients.add(admin.id)

    for uid in recipients:
        db.add(Notification(
            user_id=uid,
            org_id=org_id,
            title=f"安全告警: {alert['type']}",
            body=alert["message"],
            link="/app/admin/audit-logs",
            read=False,
        ))
    if recipients:
        db.commit()
