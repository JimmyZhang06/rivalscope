"""追踪报告推送：站内通知 + 邮件（SMTP 缺省演示模式落库）+ Webhook 群机器人

任何单一渠道失败只记日志，不阻断调研主流程。
"""

import logging
import smtplib
from email.header import Header
from email.mime.text import MIMEText

import httpx

from app.core.config import get_settings
from app.db.database import SessionLocal
from app.db.models import EmailLog, Notification, ResearchTask, Tracker, User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 站内通知
# ---------------------------------------------------------------------------

def notify_org_members(org_id: str, title: str, body: str, link: str) -> int:
    """给企业全体成员各写一条站内通知，返回通知人数"""
    with SessionLocal() as db:
        members = db.query(User).filter(User.org_id == org_id).all()
        for m in members:
            db.add(Notification(user_id=m.id, org_id=org_id, title=title[:200], body=body, link=link[:500]))
        db.commit()
        return len(members)


# ---------------------------------------------------------------------------
# 邮件（SMTP 配置齐全才真实发送，否则演示模式落库）
# ---------------------------------------------------------------------------

def send_email(to_email: str, subject: str, body: str) -> str:
    """发送邮件并落库 email_logs，返回状态 sent / demo / failed"""
    settings = get_settings()
    configured = all([settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from])
    status = "demo"
    if configured:
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = Header(subject, "utf-8")
            msg["From"] = settings.smtp_from
            msg["To"] = to_email
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.sendmail(settings.smtp_from, [to_email], msg.as_string())
            status = "sent"
        except Exception as exc:
            logger.warning("send email to %s failed: %s", to_email, exc)
            status = "failed"
    with SessionLocal() as db:
        db.add(EmailLog(to_email=to_email[:255], subject=subject[:300], body=body, status=status))
        db.commit()
    return status


# ---------------------------------------------------------------------------
# Webhook 群机器人
# ---------------------------------------------------------------------------

def _webhook_payload(webhook_type: str, title: str, text: str, link: str) -> dict:
    """按机器人类型组装消息体"""
    content = f"{title}\n{text}\n查看报告：{link}" if link else f"{title}\n{text}"
    if webhook_type == "wecom":
        return {"msgtype": "markdown", "markdown": {"content": f"**{title}**\n{text}\n[查看报告]({link})"}}
    if webhook_type == "dingtalk":
        return {"msgtype": "markdown", "markdown": {"title": title, "text": f"### {title}\n\n{text}\n\n[查看报告]({link})"}}
    if webhook_type == "feishu":
        return {"msg_type": "text", "content": {"text": content}}
    # generic：通用 JSON 摘要
    return {"title": title, "text": text, "link": link}


async def push_webhook(webhook_type: str, url: str, title: str, text: str, link: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=_webhook_payload(webhook_type, title, text, link))
            resp.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("webhook push failed (%s %s): %s", webhook_type, url, exc)
        return False


# ---------------------------------------------------------------------------
# 追踪报告完成后的三渠道推送编排
# ---------------------------------------------------------------------------

FRONTEND_BASE = "http://localhost:5173"


def _summary_excerpt(change_summary: str, limit: int = 200) -> str:
    """取变更摘要前若干字符作为推送正文（去掉 markdown 标题符号）"""
    text = "\n".join(
        line.lstrip("#").strip() for line in change_summary.splitlines() if line.strip()
    )
    return text[:limit] + ("…" if len(text) > limit else "")


async def push_tracker_report(task_id: str) -> None:
    """追踪任务完成后：站内通知企业全员 + 按追踪项配置发邮件 / webhook"""
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if not task or not task.tracker_id:
            return
        tracker = db.get(Tracker, task.tracker_id)
        if not tracker:
            return
        members = db.query(User).filter(User.org_id == tracker.org_id).all()
        emails = [m.email for m in members]
        change_summary = task.change_summary or ""
        product_name = task.product_name
        db.expunge(tracker)

    title = f"「{product_name}」定期追踪报告已生成"
    excerpt = _summary_excerpt(change_summary) or "本期报告已生成，点击查看完整内容。"
    link_path = f"/app/tasks/{task_id}"
    link_url = f"{FRONTEND_BASE}{link_path}"

    # 1. 站内通知（始终推送）
    try:
        n = notify_org_members(tracker.org_id, title, excerpt, link_path)
        logger.info("tracker %s in-app notified %d members", tracker.id, n)
    except Exception:
        logger.exception("in-app notification failed for task %s", task_id)

    # 2. 邮件
    if tracker.push_email:
        body = f"{title}\n\n本期变更摘要：\n{change_summary or '（首期基线报告）'}\n\n查看完整报告：{link_url}"
        for email in emails:
            try:
                send_email(email, title, body)
            except Exception:
                logger.exception("email push failed for %s", email)

    # 3. Webhook 群机器人
    if tracker.push_webhook and tracker.webhook_url:
        await push_webhook(tracker.webhook_type, tracker.webhook_url, title, excerpt, link_url)
