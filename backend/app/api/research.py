import asyncio
import json

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api.deps import check_quota_or_403, get_current_user, get_quota, get_user_from_query_token
from app.db.database import SessionLocal, get_db
from app.db.models import ResearchTask, Source, TaskStep, User
from app.schemas.auth import QuotaOut
from app.schemas.research import (
    AskIn,
    AskOut,
    EmailReportOut,
    ResearchCreate,
    SourceArchiveOut,
    SourceDetail,
    StepOut,
    TaskBrief,
    TaskDetail,
)
from app.services.agent import run_research
from app.services.audit import log_audit

router = APIRouter(prefix="/api/research", tags=["research"])

FINAL_STATUSES = {"completed", "failed"}


async def _run_research_bg(task_id: str) -> None:
    """BackgroundTasks 包装器：async 函数作为 coroutine 直接 await"""
    try:
        await run_research(task_id)
    except Exception:
        logger.exception("research bg task %s failed", task_id)


@router.post("", response_model=TaskBrief, status_code=201)
async def create_research(
    payload: ResearchCreate,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建调研任务并在后台启动 Agent（校验本月配额）"""
    check_quota_or_403(db, user)
    task = ResearchTask(
        user_id=user.id,
        org_id=user.org_id or "",
        product_name=payload.product_name.strip(),
        competitors=payload.competitors.strip(),
        focus=payload.focus.strip(),
        time_range=payload.time_range,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="task.create", resource_type="research_task", resource_id=task.id,
            input_data=json.dumps({"product_name": payload.product_name, "competitors": payload.competitors}),
            status="success",
        )
    except Exception:
        pass
    background.add_task(_run_research_bg, task.id)
    return task


@router.get("", response_model=list[TaskBrief])
def list_research(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """任务列表：本人任务 + 同企业共享任务"""
    q = db.query(ResearchTask)
    if user.org_id:
        q = q.filter((ResearchTask.user_id == user.id) | (ResearchTask.org_id == user.org_id))
    else:
        q = q.filter(ResearchTask.user_id == user.id)
    return q.order_by(ResearchTask.created_at.desc()).all()


@router.get("/quota", response_model=QuotaOut)
def my_quota(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_quota(db, user)


def _get_owned_task(task_id: str, user: User, db: Session) -> ResearchTask:
    """本人、同企业成员或管理员可访问"""
    task = db.get(ResearchTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    allowed = (
        task.user_id == user.id
        or user.role == "admin"
        or (bool(user.org_id) and task.org_id == user.org_id)
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.get("/{task_id}", response_model=TaskDetail)
def get_research(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_task(task_id, user, db)


@router.get("/{task_id}/sources/{source_id}", response_model=SourceDetail)
def get_source_detail(
    task_id: str,
    source_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """来源详情（含原文摘录），沿用任务属主校验"""
    _get_owned_task(task_id, user, db)
    source = db.get(Source, source_id)
    if not source or source.task_id != task_id:
        raise HTTPException(status_code=404, detail="来源不存在")
    return source


@router.delete("/{task_id}", status_code=204)
def delete_research(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _get_owned_task(task_id, user, db)
    db.delete(task)
    db.commit()
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="task.delete", resource_type="research_task", resource_id=task_id,
            status="success",
        )
    except Exception:
        pass


ASK_SOURCE_LIMIT = 15  # 追问上下文最多附带的来源条数
ASK_SNIPPET_LIMIT = 600  # 每条来源摘要截断长度


@router.post("/{task_id}/ask", response_model=AskOut)
async def ask_research(
    task_id: str,
    payload: AskIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """基于报告与来源材料的无状态追问（不占调研配额）"""
    task = _get_owned_task(task_id, user, db)
    if task.status != "completed" or not task.report_markdown:
        raise HTTPException(status_code=400, detail="报告尚未生成，无法追问")

    from app.core.config import get_settings

    settings = get_settings()
    if not settings.llm_api_key:
        raise HTTPException(status_code=503, detail="缺少 LLM 配置，请联系管理员")

    # 高分来源材料（编号与报告 [n] 一致：入库顺序即优先级顺序）
    sources = db.query(Source).filter(Source.task_id == task_id).order_by(Source.id).all()
    materials = "\n".join(
        f"[{i}] {s.title}\nURL: {s.url}\n摘要: {s.snippet[:ASK_SNIPPET_LIMIT]}"
        for i, s in enumerate(sources[:ASK_SOURCE_LIMIT], 1)
    )

    from app.services.llm import LLMClient

    system = (
        _date_header()
        + "你是一名竞品调研助手。用户会针对一份已完成的调研报告提问，"
        "请仅依据给出的报告内容与来源材料回答：\n"
        "1. 论断处标注对应的来源编号 [n]（纯文本，不要写成链接）；\n"
        "2. 报告与材料未覆盖的内容要明确说明信息不足，不得编造；\n"
        "3. 用中文回答，简洁直接，可用 Markdown 列表/表格。"
    )
    prompt = (
        f"调研对象：{task.product_name}\n\n"
        f"调研报告：\n{task.report_markdown[:12000]}\n\n"
        f"来源材料：\n{materials}\n\n"
        f"用户问题：{payload.question.strip()}"
    )
    try:
        answer = await LLMClient(user_id=user.id, org_id=user.org_id).chat(system, prompt)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"回答生成失败：{str(exc)[:200]}") from exc
    return AskOut(answer=answer)


# 发送报告邮件：附件由前端导出后上传，后端仅负责转发
EMAIL_ATTACHMENT_MAX = 20 * 1024 * 1024  # 20MB
EMAIL_MAX_RECIPIENTS = 10
_ATTACH_SUBTYPES = {
    "pdf": "pdf",
    "doc": "msword",
    "docx": "vnd.openxmlformats-officedocument.wordprocessingml.document",
    "md": "octet-stream",
    "txt": "octet-stream",
}


@router.post("/{task_id}/email", response_model=EmailReportOut)
async def email_report(
    task_id: str,
    to: str = Form(..., description="收件人邮箱，多个用逗号分隔"),
    file: UploadFile = File(..., description="前端导出的报告文件（作为附件）"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把已完成报告以附件邮件发送给指定收件人（附件由前端导出上传）"""
    task = _get_owned_task(task_id, user, db)
    if task.status != "completed" or not task.report_markdown:
        raise HTTPException(status_code=400, detail="报告尚未生成，无法发送")

    recipients = [e.strip() for e in to.replace("；", ",").replace(";", ",").replace("，", ",").split(",") if e.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="请填写收件人邮箱")
    if len(recipients) > EMAIL_MAX_RECIPIENTS:
        raise HTTPException(status_code=400, detail=f"收件人不超过 {EMAIL_MAX_RECIPIENTS} 个")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="附件内容为空")
    if len(content) > EMAIL_ATTACHMENT_MAX:
        raise HTTPException(status_code=400, detail="附件过大（上限 20MB）")

    filename = file.filename or f"竞品调研报告-{task.product_name}.pdf"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    subtype = _ATTACH_SUBTYPES.get(ext, "octet-stream")

    from app.core.config import get_settings
    from app.services.notify import send_email

    link_url = f"{(get_settings().frontend_base or '').rstrip('/')}/app/tasks/{task_id}"
    subject = f"「{task.product_name}」竞品调研报告"
    sender = user.nickname or user.email
    body = (
        f"{sender} 与您分享了一份竞品调研报告「{task.product_name}」，详见附件。\n\n"
        f"在线查看：{link_url}"
    )
    html = (
        "<div style=\"font-family:'Microsoft YaHei','Segoe UI',sans-serif;color:#1f2937;font-size:14px;line-height:1.8;\">"
        f"<p><strong>{sender}</strong> 与您分享了一份竞品调研报告「{task.product_name}」，完整报告见附件。</p>"
        # f"<p><a href=\"{link_url}\" style=\"color:#1d4ed8;\">在网页中查看完整报告 →</a></p>"
        "<p style=\"color:#9ca3af;font-size:12px;\">此邮件由系统发送，请勿直接回复。</p></div>"
    )
    attachments = [(filename, content, subtype)]

    statuses: list[str] = []
    for r in recipients:
        try:
            statuses.append(await asyncio.to_thread(send_email, r, subject, body, html, attachments))
        except Exception:
            statuses.append("failed")

    if "sent" in statuses:
        status = "sent"
    elif "demo" in statuses:
        status = "demo"
    else:
        status = "failed"
    return EmailReportOut(status=status, recipients=len(recipients))


@router.get("/{task_id}/events")
async def research_events(task_id: str, token: str = Query(...)):
    """SSE 实时推送任务步骤与状态（EventSource 不支持 Header，用查询参数鉴权）"""
    with SessionLocal() as db:
        user = get_user_from_query_token(token, db)
        _get_owned_task(task_id, user, db)

    async def event_stream():
        sent = 0
        while True:
            with SessionLocal() as db:
                task = db.get(ResearchTask, task_id)
                if not task:
                    break
                status = task.status
                steps = (
                    db.query(TaskStep)
                    .filter(TaskStep.task_id == task_id)
                    .order_by(TaskStep.seq)
                    .offset(sent)
                    .all()
                )
                new_steps = [StepOut.model_validate(s).model_dump(mode="json") for s in steps]
            for step in new_steps:
                sent += 1
                yield {"event": "step", "data": json.dumps(step, ensure_ascii=False)}
            yield {"event": "status", "data": json.dumps({"status": status}, ensure_ascii=False)}
            if status in FINAL_STATUSES:
                break
            await asyncio.sleep(1)

    return EventSourceResponse(event_stream())
