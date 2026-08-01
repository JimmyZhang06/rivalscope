"""临时 SMTP 诊断脚本：QQ 发件，实测发送到 Outlook。运行后删除。"""
import sys

from app.services.notify import send_email

TEST_TO = "jimmyzhang1729@outlook.com"

status = send_email(
    to_email=TEST_TO,
    subject="竞品调研 Agent — SMTP 测试邮件",
    body="这是一封来自竞品调研 Agent 的 SMTP 测试邮件（QQ 发件）。若收到说明邮件通道已打通。",
    html="<h2>竞品调研 Agent</h2><p>这是一封 <b>SMTP 测试邮件</b>（QQ 发件）。</p><p>若收到说明邮件通道已打通。</p>",
)
print(f"发送状态: {status}  收件人: {TEST_TO}")
sys.exit(0 if status == "sent" else 1)
