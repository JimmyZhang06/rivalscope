"""追踪报告推送：站内通知 + 邮件（SMTP 缺省演示模式落库）+ Webhook 群机器人

任何单一渠道失败只记日志，不阻断调研主流程。
"""

import asyncio
import logging
import re
import smtplib
import ssl
from email.header import Header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.db.database import SessionLocal
from app.db.models import EmailLog, Notification, ResearchTask, Tracker, User

logger = logging.getLogger(__name__)

# 附件三元组：(文件名, 字节内容, MIME 子类型，如 pdf / msword)
Attachment = tuple[str, bytes, str]


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

def _build_message(
    subject: str,
    from_addr: str,
    to_email: str,
    body: str,
    html: str | None,
    attachments: list[Attachment] | None,
):
    """按是否含 HTML / 附件组装 MIME 消息（纯文本 → alternative → mixed）"""
    text_part = MIMEText(body, "plain", "utf-8")
    if attachments:
        root: MIMEMultipart = MIMEMultipart("mixed")
        if html:
            alt = MIMEMultipart("alternative")
            alt.attach(text_part)
            alt.attach(MIMEText(html, "html", "utf-8"))
            root.attach(alt)
        else:
            root.attach(text_part)
        for filename, content, subtype in attachments:
            part = MIMEApplication(content, _subtype=subtype)
            # RFC 2231 编码文件名以支持中文
            part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", filename))
            root.attach(part)
        msg: object = root
    elif html:
        alt = MIMEMultipart("alternative")
        alt.attach(text_part)
        alt.attach(MIMEText(html, "html", "utf-8"))
        msg = alt
    else:
        msg = text_part
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = from_addr
    msg["To"] = to_email
    return msg


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html: str | None = None,
    attachments: list[Attachment] | None = None,
) -> str:
    """发送邮件并落库 email_logs，返回状态 sent / demo / failed

    body 为纯文本正文；html 非空时附带 HTML 版本；attachments 为附件列表。
    该函数为同步阻塞调用，在事件循环中请用 asyncio.to_thread 包裹。
    """
    settings = get_settings()
    configured = all([settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from])
    status = "demo"
    if configured:
        try:
            msg = _build_message(subject, settings.smtp_from, to_email, body, html, attachments)
            # 端口 465 走隐式 SSL（SMTP_SSL）；其余端口（如 587）走明文连接 + STARTTLS 升级
            if settings.smtp_port == 465:
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                    smtp.sendmail(settings.smtp_from, [to_email], msg.as_string())
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
                    smtp.ehlo()
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()
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

def _frontend_base() -> str:
    """前端基础 URL（去除结尾斜杠），用于拼接报告链接"""
    return (get_settings().frontend_base or "http://localhost:5173").rstrip("/")


# 报告邮件正文样式：内联 CSS，兼容主流邮件客户端（不支持外部样式表）
_REPORT_EMAIL_CSS = (
    "body{margin:0;background:#f3f4f6;}"
    ".wrap{max-width:720px;margin:0 auto;padding:24px 16px;font-family:'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif;color:#1f2937;line-height:1.8;font-size:14px;}"
    ".card{background:#fff;border-radius:10px;padding:28px 30px;box-shadow:0 1px 3px rgba(0,0,0,.08);}"
    ".kicker{font-size:11px;letter-spacing:2px;color:#1e40af;text-transform:uppercase;margin:0;}"
    "h1{font-size:22px;color:#111827;margin:6px 0 4px;}"
    ".meta{font-size:12px;color:#6b7280;margin:0 0 18px;border-bottom:2px solid #1e40af;padding-bottom:14px;}"
    "h2{font-size:17px;color:#111827;border-left:4px solid #1e40af;padding-left:10px;margin:24px 0 10px;}"
    "h3{font-size:15px;color:#1f2937;margin:16px 0 6px;}"
    "p{margin:8px 0;}strong{color:#1e3a8a;}"
    "ul,ol{margin:8px 0;padding-left:22px;}li{margin:4px 0;}"
    "table{width:100%;border-spacing:0;border-collapse:collapse;font-size:12px;margin:12px 0;word-break:break-word;}"
    "th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top;}"
    "thead th{background:#eff6ff !important;color:#1e3a8a !important;font-weight:600;}"
    "tbody tr:nth-child(even){background:#f9fafb;}"
    ".src-card{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;margin:6px 0;"
    "background:#f9fafb;border-left:3px solid #1e40af;border-radius:4px;}"
    ".src-card a{color:#1d4ed8;text-decoration:none;font-weight:500;font-size:13px;word-break:break-all;}"
    ".src-card .src-url{display:block;font-size:11px;color:#6b7280;margin-top:2px;word-break:break-all;}"
    ".src-num{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;"
    "width:22px;height:22px;border-radius:50%;background:#1e40af;color:#fff;font-size:11px;font-weight:600;}"
    ".src-section{margin:16px 0 8px;padding:14px 16px;background:#f9fafb;border-radius:8px;}"
    ".src-section h3{margin:0 0 10px;font-size:15px;color:#1e3a8a;}"
    "a{color:#1d4ed8;word-break:break-all;}"
    "blockquote{background:#eff6ff;border-left:3px solid #60a5fa;padding:8px 14px;margin:10px 0;color:#4b5563;}"
    ".btn{display:inline-block;margin:6px 0 2px;background:#1e40af;color:#fff !important;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;}"
    ".foot{font-size:12px;color:#9ca3af;margin-top:20px;text-align:center;}"
)


def render_report_html(product_name: str, report_markdown: str, link_url: str) -> str:
    """把报告 Markdown 渲染成可内嵌邮件正文的完整 HTML 文档"""
    import markdown as md

    # 把来源章节从正文中剥离，用结构化卡片替代
    body_md, sources_section = _split_sources(report_markdown or "")
    body_html = md.markdown(body_md or report_markdown or "", extensions=["tables", "fenced_code", "sane_lists"])
    sources_block = ""
    if sources_section:
        sources_block = _render_sources_html(sources_section)
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>{_REPORT_EMAIL_CSS}</style></head><body><div class='wrap'><div class='card'>"
        "<p class='kicker'>Competitive Research Report</p>"
        f"<h1>{product_name} 竞品调研报告</h1>"
        "<p class='meta'>本邮件由竞品调研助手自动发送，以下为报告全文。</p>"
        f"{body_html}"
        f"{sources_block}"
        f"<p style='margin-top:22px'><a class='btn' href='{link_url}'>在网页中查看完整报告 →</a></p>"
        "</div><p class='foot'>此邮件由系统自动发送，请勿直接回复。</p></div></body></html>"
    )


def _summary_excerpt(change_summary: str, limit: int = 200) -> str:
    """取变更摘要前若干字符作为推送正文（去掉 markdown 标题符号）"""
    text = "\n".join(
        line.lstrip("#").strip() for line in change_summary.splitlines() if line.strip()
    )
    return text[:limit] + ("…" if len(text) > limit else "")


_SOURCES_HEADING_RE = re.compile(r"^#{1,3}\s+(.*(?:信息来源|参考来源|参考资料|参考文献|来源引用|References?).*)$", re.IGNORECASE | re.MULTILINE)
_SOURCE_URL_RE = re.compile(r"https?://[^\s\)\]>]+")


def _parse_sources(sources_text: str) -> list[dict]:
    """从来源 markdown 文本中提取结构化来源列表"""
    entries = []
    for line in sources_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        stripped = stripped.lstrip("- ").strip()
        if not stripped:
            continue
        urls = _SOURCE_URL_RE.findall(stripped)
        url = urls[0] if urls else ""
        if not url:
            continue
        # 去掉 [n] 编号
        title_text = re.sub(r"^\[\d+\]\s*", "", stripped).strip()
        # 找 URL 在文本中的位置
        url_pos = title_text.find(url)
        if url_pos == -1:
            url_pos = title_text.find(url.replace("https://", "").replace("http://", ""))
        if url_pos == -1:
            # URL 格式可能略有不同，直接用整个文本去掉 URL
            title_text = _SOURCE_URL_RE.sub("", title_text).strip(" -—:：")
        else:
            before = title_text[:url_pos].strip(" -—:：")
            after = title_text[url_pos + len(url):].strip(" -—:：")
            title_text = before if before else after
        if not title_text:
            parsed = urlparse(url)
            title_text = parsed.path.strip("/").split("/")[-1] or parsed.netloc
            title_text = title_text.replace("-", " ").replace("_", " ")[:60]
        entries.append({"url": url, "title": title_text[:80]})
    return entries


def _render_sources_html(sources_text: str) -> str:
    """将来源 markdown 文本转为结构化卡片 HTML"""
    entries = _parse_sources(sources_text)
    if not entries:
        return ""

    items_html = []
    for idx, entry in enumerate(entries, 1):
        items_html.append(
            f'<div class="src-card">'
            f'<span class="src-num">{idx}</span>'
            f'<div>'
            f'<a href="{entry["url"]}">{entry["title"]}</a>'
            f'<span class="src-url">{entry["url"]}</span>'
            f'</div></div>'
        )

    return (
        '<div class="src-section">'
        '<h3>📎 数据来源</h3>'
        + "".join(items_html)
        + "</div>"
    )


def _split_sources(markdown: str) -> tuple[str, str]:
    """将来源章节从 markdown 中剥离，返回 (去除来源后的正文, 来源章节文本)"""
    match = _SOURCES_HEADING_RE.search(markdown)
    if not match:
        return markdown, ""
    heading = match.group(0)
    level = len(heading) - len(heading.lstrip("#"))
    section_start = match.start()
    after_heading = match.end()
    rest = markdown[after_heading:]
    pattern = r"^#{" + "1," + str(level) + r"}\s+"
    next_heading = re.search(pattern, rest, re.MULTILINE)
    if next_heading:
        sources_text = rest[: next_heading.start()]
        before_sources = markdown[:section_start]
        after_sources = rest[next_heading.start():]
        return (before_sources + after_sources).strip(), sources_text
    sources_text = rest
    return markdown[:section_start].strip(), sources_text


async def push_task_report_email(task_id: str) -> None:
    """一次性调研任务完成后：给创建人发送内嵌完整报告的 HTML 邮件

    仅对非追踪任务使用；追踪任务走 push_tracker_report。SMTP 未配置时降级为演示模式。
    """
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if not task or not task.report_markdown:
            return
        creator = db.get(User, task.user_id)
        if not creator or not creator.email:
            return
        to_email = creator.email
        product_name = task.product_name
        report_markdown = task.report_markdown

    link_url = f"{_frontend_base()}/app/tasks/{task_id}"
    subject = f"「{product_name}」竞品调研报告已生成"
    html = render_report_html(product_name, report_markdown, link_url)
    text = f"{subject}\n\n您的竞品调研报告已生成。\n查看完整报告：{link_url}"
    try:
        status = await asyncio.to_thread(send_email, to_email, subject, text, html)
        logger.info("task %s report email to %s: %s", task_id, to_email, status)
    except Exception:
        logger.exception("task report email failed for task %s", task_id)


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
        report_markdown = task.report_markdown or ""
        product_name = task.product_name
        db.expunge(tracker)

    title = f"「{product_name}」定期追踪报告已生成"
    excerpt = _summary_excerpt(change_summary) or "本期报告已生成，点击查看完整内容。"
    link_path = f"/app/tasks/{task_id}"
    link_url = f"{_frontend_base()}{link_path}"

    # 1. 站内通知（始终推送）
    try:
        n = notify_org_members(tracker.org_id, title, excerpt, link_path)
        logger.info("tracker %s in-app notified %d members", tracker.id, n)
    except Exception:
        logger.exception("in-app notification failed for task %s", task_id)

    # 2. 邮件：正文含本期变更摘要 + 报告全文（HTML）
    if tracker.push_email:
        text = f"{title}\n\n本期变更摘要：\n{change_summary or '（首期基线报告）'}\n\n查看完整报告：{link_url}"
        change_html = ""
        if change_summary:
            import markdown as md

            # 从变更摘要中剥离来源章节，用结构化卡片渲染
            body_md, sources_section = _split_sources(change_summary)
            sources_html = _render_sources_html(sources_section)
            rendered_body = md.markdown(body_md or change_summary, extensions=["tables", "sane_lists"])
            sources_block = f"<div style='margin:14px 0 6px;'>{sources_html}</div>" if sources_html else ""

            change_html = (
                "<div style='background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;margin:0 0 6px;'>"
                "<p style='margin:0 0 6px;font-weight:600;color:#1e40af;'>本期变更（与上一期对比）</p>"
                + rendered_body
                + sources_block
                + "</div>"
            )
        report_html = render_report_html(product_name, report_markdown, link_url)
        # 把变更摘要块插入报告正文卡片顶部
        html = report_html.replace("<p class='meta'>", change_html + "<p class='meta'>", 1) if change_html else report_html
        for email in emails:
            try:
                status = await asyncio.to_thread(send_email, email, title, text, html)
                logger.info("tracker %s email to %s: %s", tracker.id, email, status)
            except Exception:
                logger.exception("email push failed for %s", email)

    # 3. Webhook 群机器人
    if tracker.push_webhook and tracker.webhook_url:
        await push_webhook(tracker.webhook_type, tracker.webhook_url, title, excerpt, link_url)
