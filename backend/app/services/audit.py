"""审计日志服务"""

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import AuditLog
from app.services.anomaly import check_anomalies

logger = logging.getLogger(__name__)


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
    model_name: str = "",
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
    cost: float = 0.0,
    ip: str = "",
    user_agent: str = "",
    db: Session | None = None,
) -> None:
    """写入审计日志（同步调用，在 with SessionLocal 中执行）

    db: 可选的外部 session，供异常检测写入通知时复用
    """
    try:
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True
        db.add(AuditLog(
            user_id=user_id,
            org_id=org_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            input=input_data[:2000] if input_data else "",
            result=result_data[:2000] if result_data else "",
            status=status,
            error=error[:500] if error else "",
            model_name=model_name[:100],
            tokens_prompt=tokens_prompt,
            tokens_completion=tokens_completion,
            cost=cost,
            ip=ip[:64],
            user_agent=user_agent[:300],
        ))
        db.commit()
        if should_close:
            db.close()
    except Exception:
        logger.exception("audit log write failed")

    # 异常检测（不阻断主流程）
    try:
        check_anomalies({
            "action": action,
            "user_id": user_id,
            "org_id": org_id,
            "resource_type": resource_type,
            "status": status,
            "ip": ip,
            "error": error,
        }, db=db if not should_close else None)
    except Exception:
        pass
