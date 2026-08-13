"""审计日志服务。

普通业务可以使用 ``log_audit_best_effort``；权限、角色、套餐和组织成员等
敏感变更必须使用 ``log_audit_required``，并与业务变更共用一个数据库事务。
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import AuditLog
from app.services.anomaly import check_anomalies

logger = logging.getLogger(__name__)


class AuditWriteError(RuntimeError):
    """必需的审计记录无法持久化。调用方必须终止敏感操作。"""


def _audit_values(
    *,
    user_id: str,
    org_id: str,
    action: str,
    resource_type: str,
    resource_id: str = "",
    input_data: str = "",
    result_data: str = "",
    status: str = "success",
    error: str = "",
    model_name: str = "",
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
    cost: float = 0.0,
    ip: str = "",
    user_agent: str = "",
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "org_id": org_id,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "input": input_data[:2000] if input_data else "",
        "result": result_data[:2000] if result_data else "",
        "status": status,
        "error": error[:500] if error else "",
        "model_name": model_name[:100],
        "tokens_prompt": tokens_prompt,
        "tokens_completion": tokens_completion,
        "cost": cost,
        "ip": ip[:64],
        "user_agent": user_agent[:300],
    }


def _anomaly_entry(values: dict[str, Any]) -> dict[str, Any]:
    return {
        "action": values["action"],
        "user_id": values["user_id"],
        "org_id": values["org_id"],
        "resource_type": values["resource_type"],
        "status": values["status"],
        "ip": values["ip"],
        "error": values["error"],
    }


def log_audit_required(*, db: Session, **kwargs: Any) -> None:
    """将审计记录加入调用方事务；失败时回滚并抛出 ``AuditWriteError``。

    该函数只 ``flush``，不会提交。调用方应先修改业务对象，再调用本函数，最后
    只执行一次 ``db.commit()``，从而保证业务变更和审计记录同时成功或同时失败。
    """
    values = _audit_values(**kwargs)
    try:
        entry = AuditLog(**values)
        db.add(entry)
        # 只 flush 审计行，避免把调用方尚未提交的业务约束错误误报为审计故障。
        db.flush([entry])
    except Exception as exc:
        db.rollback()
        logger.exception("required audit log write failed", extra={"audit_action": values["action"]})
        raise AuditWriteError(f"required audit write failed: {values['action']}") from exc


def log_audit_best_effort(*, db: Session | None = None, **kwargs: Any) -> bool:
    """尽力写入审计记录，失败时记录错误但不阻断普通业务。"""
    values = _audit_values(**kwargs)
    audit_db = db
    should_close = False
    try:
        if audit_db is None:
            audit_db = SessionLocal()
            should_close = True
        audit_db.add(AuditLog(**values))
        audit_db.commit()
    except Exception:
        if audit_db is not None:
            try:
                audit_db.rollback()
            except Exception:
                logger.exception("audit session rollback failed")
        logger.exception("best-effort audit log write failed", extra={"audit_action": values["action"]})
        return False
    finally:
        if should_close and audit_db is not None:
            audit_db.close()

    try:
        check_anomalies(_anomaly_entry(values), db=None if should_close else audit_db)
    except Exception:
        logger.exception("audit anomaly check failed", extra={"audit_action": values["action"]})
    return True


def log_audit(**kwargs: Any) -> None:
    """向后兼容的普通审计入口；新代码应明确选择 required 或 best-effort。"""
    log_audit_best_effort(**kwargs)
