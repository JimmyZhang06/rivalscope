"""审计日志服务：链式哈希完整性校验 + 变更对比 + 留存策略"""

import hashlib
import json
import logging
import uuid as _uuid_mod
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import AuditLog
from app.services.anomaly import check_anomalies

logger = logging.getLogger(__name__)


def _compute_checksum(entry_data: dict, prev_hash: str) -> str:
    """计算审计日志的 SHA-256 校验和

    checksum = SHA256(prev_hash + action + resource_type + resource_id
                      + status + user_id + org_id)
    链式结构：prev_hash 指向上一条记录的 checksum，篡改任意一条会导致后续全部校验失败。
    """
    raw = json.dumps({
        "prev": prev_hash,
        "action": entry_data.get("action", ""),
        "resource_type": entry_data.get("resource_type", ""),
        "resource_id": entry_data.get("resource_id", ""),
        "status": entry_data.get("status", ""),
        "user_id": entry_data.get("user_id", ""),
        "org_id": entry_data.get("org_id", ""),
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def _get_latest_checksum(db: Session) -> tuple[str, str]:
    """获取审计日志链中最新一条的 (id, checksum)"""
    latest = db.query(AuditLog.id, AuditLog.checksum).order_by(AuditLog.created_at.desc()).first()
    if latest:
        return latest.id, latest.checksum or ""
    return "", ""


def log_audit(
    user_id: str,
    org_id: str,
    action: str,
    resource_type: str,
    resource_id: str = "",
    input_data: str = "",
    result_data: str = "",
    status: str = "success",
    error: str = "",
    changes: str = "",
    model_name: str = "",
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
    cost: float = 0.0,
    ip: str = "",
    user_agent: str = "",
    session_id: str = "",
    db: Session | None = None,
) -> AuditLog | None:
    """写入审计日志（同步调用，包含链式哈希完整性校验）

    session_id: 会话 ID，来自 JWT token 或新登录时生成
    changes: JSON 字符串，更新类操作的变更前后对比
    失败不阻断主流程。返回写入的 AuditLog 对象，失败返回 None。
    """
    try:
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True

        now = datetime.now(timezone.utc)

        # 获取链中前一条记录的 checksum 作为 prev_hash
        prev_entry_id, prev_checksum = _get_latest_checksum(db)

        # 计算本条记录的校验和（使用确定性字段，不受时间精度影响）
        entry_data = {
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "status": status,
            "user_id": user_id,
            "org_id": org_id,
        }
        checksum = _compute_checksum(entry_data, prev_checksum)

        record = AuditLog(
            user_id=user_id,
            org_id=org_id,
            session_id=session_id or "",
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            input=input_data[:2000] if input_data else "",
            result=result_data[:2000] if result_data else "",
            status=status,
            error=error[:500] if error else "",
            changes=changes[:5000] if changes else "",
            model_name=model_name[:100],
            tokens_prompt=tokens_prompt,
            tokens_completion=tokens_completion,
            cost=cost,
            ip=ip[:64],
            user_agent=user_agent[:300],
            prev_hash=prev_checksum,
            checksum=checksum,
            created_at=now,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        if should_close:
            db.close()

        # 异常检测（不阻断主流程）
        try:
            check_anomalies({
                "action": action,
                "user_id": user_id,
                "org_id": org_id,
                "session_id": session_id,
                "resource_type": resource_type,
                "status": status,
                "ip": ip,
                "error": error,
            }, db=db if not should_close else None)
        except Exception:
            pass

        return record

    except Exception:
        logger.exception("audit log write failed")
        return None


def purge_expired_logs(retention_days: int = 365, db: Session | None = None) -> int:
    """清理超过留存期的审计日志

    通过临时启用/禁用触发器保护来执行清理。
    retention_days: 留存天数，默认 365 天
    返回: 删除的日志条数
    """
    if retention_days <= 0:
        return 0

    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True

    try:
        from app.db.audit_triggers import enable_purge, disable_purge

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

        # 先统计要删除的数量
        count = db.query(AuditLog).filter(AuditLog.created_at < cutoff).count()
        if count == 0:
            if should_close:
                db.close()
            return 0

        # 临时启用清理触发器
        enable_purge()

        db.execute(
            AuditLog.__table__.delete().where(AuditLog.created_at < cutoff)
        )
        db.commit()

        # 重新禁用清理触发器
        disable_purge()

        logger.info("purged %d audit logs older than %d days", count, retention_days)

        if should_close:
            db.close()
        return count

    except Exception:
        logger.exception("audit log purge failed")
        try:
            from app.db.audit_triggers import disable_purge
            disable_purge()
        except Exception:
            pass
        if should_close:
            try:
                db.close()
            except Exception:
                pass
        return 0


def verify_integrity(db: Session, start_id: str | None = None,
                     end_id: str | None = None) -> dict:
    """验证审计日志链的完整性

    逐条校验 checksum 是否与链式计算一致。
    注意：start_id/end_id 基于 UUID 字符串比较，仅当知道具体边界时有用。
    对于全表校验，不传参数即可。
    返回: {"valid": bool, "total": int, "checked": int, "broken_at": str | None, "details": str}
    """
    query = db.query(AuditLog).order_by(AuditLog.created_at.asc(), AuditLog.id.asc())

    # 使用 date 范围而非 UUID 范围（更可靠）
    if start_id:
        start_log = db.get(AuditLog, start_id)
        if start_log and start_log.created_at:
            query = query.filter(AuditLog.created_at >= start_log.created_at)
    if end_id:
        end_log = db.get(AuditLog, end_id)
        if end_log and end_log.created_at:
            query = query.filter(AuditLog.created_at <= end_log.created_at)

    logs = query.all()

    total = len(logs)
    if total == 0:
        return {"valid": True, "total": 0, "checked": 0, "broken_at": None, "details": "no records"}

    # 跳过没有 checksum 的旧记录（链式校验上线前的记录）
    new_start = 0
    for i, log in enumerate(logs):
        if log.checksum:
            new_start = i
            break

    if new_start > 0:
        # 找到第一条有 checksum 的记录
        for i in range(new_start, total):
            log = logs[i]
            entry_data = {
                "action": log.action,
                "resource_type": log.resource_type or "",
                "resource_id": log.resource_id or "",
                "status": log.status or "",
                "user_id": log.user_id or "",
                "org_id": log.org_id or "",
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            expected = _compute_checksum(entry_data, log.prev_hash or "")
            if expected != (log.checksum or ""):
                return {
                    "valid": False,
                    "total": total,
                    "checked": i + 1,
                    "broken_at": log.id,
                    "details": f"checksum mismatch at record {i + 1}/{total} (id={log.id}, action={log.action})",
                }
        return {
            "valid": True,
            "total": total,
            "checked": total - new_start,
            "broken_at": None,
            "details": f"verified {total - new_start} new records (skipped {new_start} pre-migration)",
        }

    # 所有记录都有 checksum
    for i, log in enumerate(logs):
        entry_data = {
            "action": log.action,
            "resource_type": log.resource_type or "",
            "resource_id": log.resource_id or "",
            "status": log.status or "",
            "user_id": log.user_id or "",
            "org_id": log.org_id or "",
            "created_at": log.created_at.isoformat() if log.created_at else "",
        }
        expected = _compute_checksum(entry_data, log.prev_hash or "")
        if expected != (log.checksum or ""):
            return {
                "valid": False,
                "total": total,
                "checked": i + 1,
                "broken_at": log.id,
                "details": f"checksum mismatch at record {i + 1}/{total} (id={log.id}, action={log.action})",
            }

    return {"valid": True, "total": total, "checked": total, "broken_at": None, "details": "all records verified"}


def generate_session_id() -> str:
    """生成新的会话 ID"""
    return _uuid_mod.uuid4().hex