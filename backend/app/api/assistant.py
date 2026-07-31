"""全局 AI 助手：跨报告问答（不占调研配额）

两阶段回答：
1. 检索定位——把用户可见的已完成报告目录交给 LLM 挑选最相关的至多 3 份（失败时回退关键词匹配）
2. 生成回答——选中报告正文（各截 8000 字）+ 最近对话历史 + 问题，多轮 messages 调用

会话模型：一个用户可拥有多个会话（AssistantSession），消息按 session_id 归属；
旧的无会话消息在首次访问会话列表时懒迁移到一个「历史对话」会话，保证存量数据可见。
"""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import AssistantMessage, AssistantSession, ResearchTask, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

CATALOG_LIMIT = 50  # 供 LLM 挑选的报告目录条数上限（最近优先）
SELECT_LIMIT = 3  # 单次回答最多引用的报告数
REPORT_CHAR_LIMIT = 8000  # 每份报告正文截断长度
HISTORY_LIMIT = 6  # 携带的最近对话条数
MESSAGE_PAGE = 100  # 历史消息返回上限
TITLE_LIMIT = 30  # 会话标题自动截断长度


class AskIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    session_id: str = ""  # 为空则新建会话


class SessionRename(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class SessionOut(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class AssistantRef(BaseModel):
    task_id: str
    product_name: str


class AssistantMessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: datetime
    refs: list[AssistantRef] = []


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _title_from(question: str) -> str:
    """用首条提问生成会话标题"""
    t = question.strip().replace("\n", " ")
    if not t:
        return "新对话"
    return t[:TITLE_LIMIT] + "…" if len(t) > TITLE_LIMIT else t


def _session_out(s: AssistantSession) -> SessionOut:
    return SessionOut(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at)


def _to_out(msg: AssistantMessage) -> AssistantMessageOut:
    try:
        refs = [AssistantRef(**r) for r in json.loads(msg.refs)] if msg.refs else []
    except (ValueError, TypeError):
        refs = []
    return AssistantMessageOut(
        id=msg.id,
        session_id=msg.session_id,
        role=msg.role,
        content=msg.content,
        created_at=msg.created_at,
        refs=refs,
    )


def _owned_session(db: Session, user: User, session_id: str) -> AssistantSession:
    """取属于当前用户的会话，不存在则 404"""
    s = (
        db.query(AssistantSession)
        .filter(AssistantSession.id == session_id, AssistantSession.user_id == user.id)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return s


def _migrate_legacy(db: Session, user: User) -> None:
    """把无会话归属（session_id 空）的旧消息归入一个「历史对话」会话，保证存量数据可见"""
    orphans = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.user_id == user.id, AssistantMessage.session_id == "")
        .order_by(AssistantMessage.created_at.asc())
        .all()
    )
    if not orphans:
        return
    sess = AssistantSession(user_id=user.id, title="历史对话")
    sess.created_at = orphans[0].created_at
    sess.updated_at = orphans[-1].created_at
    db.add(sess)
    db.flush()
    for m in orphans:
        m.session_id = sess.id
    db.commit()


def _visible_completed(db: Session, user: User) -> list[ResearchTask]:
    """用户可见的已完成报告（本人 + 同企业共享），最近优先"""
    q = db.query(ResearchTask).filter(
        ResearchTask.status == "completed", ResearchTask.report_markdown != ""
    )
    if user.org_id:
        q = q.filter((ResearchTask.user_id == user.id) | (ResearchTask.org_id == user.org_id))
    else:
        q = q.filter(ResearchTask.user_id == user.id)
    return q.order_by(ResearchTask.created_at.desc()).limit(CATALOG_LIMIT).all()


def _catalog_line(t: ResearchTask) -> str:
    kind = "追踪期次" if t.tracker_id else "调研报告"
    change = (t.change_summary or "").strip().replace("\n", " ")[:100]
    parts = [
        f"id={t.id}",
        f"类型={kind}",
        f"调研对象={t.product_name}",
    ]
    if t.competitors:
        parts.append(f"竞品={t.competitors}")
    parts.append(f"时间={t.created_at:%Y-%m-%d}")
    if change:
        parts.append(f"本期变更={change}")
    return " | ".join(parts)


async def _select_tasks(question: str, tasks: list[ResearchTask]) -> list[ResearchTask]:
    """让 LLM 从目录中挑选相关报告，失败时回退关键词匹配，兜底取最新一份"""
    from app.services.llm import LLMClient

    by_id = {t.id: t for t in tasks}
    catalog = "\n".join(_catalog_line(t) for t in tasks)
    try:
        data = await LLMClient().chat_json(
            "你是检索助手。根据用户问题从报告目录中挑选最相关的报告，"
            f"最多 {SELECT_LIMIT} 份，输出 JSON：{{\"ids\": [\"报告id\"]}}。"
            "问题与目录都不相关时返回空数组。",
            f"用户问题：{question}\n\n报告目录：\n{catalog}",
        )
        picked = [by_id[i] for i in data.get("ids", []) if i in by_id][:SELECT_LIMIT]
        if picked:
            return picked
    except Exception:
        logger.warning("assistant report selection failed, fallback to keyword match", exc_info=True)

    # 关键词回退：问题中命中调研对象/竞品名的最近报告
    hits = [
        t
        for t in tasks
        if t.product_name and t.product_name in question
        or any(c.strip() and c.strip() in question for c in (t.competitors or "").split(","))
    ]
    return (hits or tasks)[:SELECT_LIMIT]


# ---------- 会话管理 ----------


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """当前用户的全部会话（最近活跃优先）；首次访问时懒迁移旧消息"""
    _migrate_legacy(db, user)
    sessions = (
        db.query(AssistantSession)
        .filter(AssistantSession.user_id == user.id)
        .order_by(AssistantSession.updated_at.desc())
        .all()
    )
    return [_session_out(s) for s in sessions]


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def rename_session(
    session_id: str,
    payload: SessionRename,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """重命名会话"""
    s = _owned_session(db, user, session_id)
    s.title = payload.title.strip()[:200] or s.title
    db.commit()
    db.refresh(s)
    return _session_out(s)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除会话及其全部消息"""
    s = _owned_session(db, user, session_id)
    db.query(AssistantMessage).filter(
        AssistantMessage.user_id == user.id, AssistantMessage.session_id == session_id
    ).delete()
    db.delete(s)
    db.commit()


@router.get("/sessions/{session_id}/messages", response_model=list[AssistantMessageOut])
def list_session_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """某个会话的最近 100 条消息（升序）"""
    _owned_session(db, user, session_id)
    msgs = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.user_id == user.id, AssistantMessage.session_id == session_id)
        .order_by(AssistantMessage.created_at.desc())
        .limit(MESSAGE_PAGE)
        .all()
    )
    return [_to_out(m) for m in reversed(msgs)]


@router.delete("/sessions/{session_id}/messages", status_code=204)
def clear_session_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """清空某个会话的消息（保留会话本身）"""
    _owned_session(db, user, session_id)
    db.query(AssistantMessage).filter(
        AssistantMessage.user_id == user.id, AssistantMessage.session_id == session_id
    ).delete()
    db.commit()


# ---------- 问答 ----------


@router.post("/ask", response_model=AssistantMessageOut)
async def ask_assistant(
    payload: AskIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """全局问答：跨调研报告与追踪期次回答问题（不占调研配额）"""
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.llm_api_key or settings.llm_api_key == "your-llm-api-key":
        raise HTTPException(status_code=503, detail="缺少 LLM 配置，请在 backend/.env 中填写")

    question = payload.question.strip()

    # 确定会话：给定且属主则复用，否则新建（标题取首条提问）
    session: AssistantSession | None = None
    if payload.session_id:
        session = (
            db.query(AssistantSession)
            .filter(AssistantSession.id == payload.session_id, AssistantSession.user_id == user.id)
            .first()
        )
    if session is None:
        session = AssistantSession(user_id=user.id, title=_title_from(question))
        db.add(session)
        db.flush()
    session_id = session.id

    tasks = _visible_completed(db, user)

    # 先落库用户消息（无论后续是否成功回答，历史里保留提问）
    user_msg = AssistantMessage(user_id=user.id, session_id=session_id, role="user", content=question)
    db.add(user_msg)
    db.commit()

    if not tasks:
        answer = "暂无已完成的调研报告可供问答。请先在「新建调研」发起一次调研，或等待定时追踪产出报告后再来提问。"
        refs: list[dict] = []
    else:
        selected = await _select_tasks(question, tasks)
        refs = [{"task_id": t.id, "product_name": t.product_name} for t in selected]

        contexts = []
        for i, t in enumerate(selected, 1):
            kind = "追踪期次报告" if t.tracker_id else "调研报告"
            block = (
                f"【报告{i}】《{t.product_name}》（{kind}，{t.created_at:%Y-%m-%d}）\n"
                f"{t.report_markdown[:REPORT_CHAR_LIMIT]}"
            )
            if t.change_summary:
                block += f"\n\n本期变更摘要：\n{t.change_summary[:2000]}"
            contexts.append(block)

        from app.services.agent import _date_header
        from app.services.llm import LLMClient

        system = (
            _date_header()
            + "你是竞品调研平台的 AI 助手。用户会针对平台内已完成的调研报告与定时追踪报告提问，"
            "请仅依据给出的报告材料回答：\n"
            "1. 引用论断时标注来源报告，如「据《XX》报告」；\n"
            "2. 材料未覆盖的内容明确说明信息不足，不得编造；\n"
            "3. 用中文回答，简洁直接，可用 Markdown 列表/表格。"
        )
        history = (
            db.query(AssistantMessage)
            .filter(
                AssistantMessage.session_id == session_id,
                AssistantMessage.id != user_msg.id,
            )
            .order_by(AssistantMessage.created_at.desc())
            .limit(HISTORY_LIMIT)
            .all()
        )
        messages: list[dict] = [{"role": "system", "content": system}]
        for m in reversed(history):
            messages.append({"role": m.role, "content": m.content})
        messages.append(
            {
                "role": "user",
                "content": "报告材料：\n\n" + "\n\n---\n\n".join(contexts) + f"\n\n用户问题：{question}",
            }
        )
        try:
            answer = await LLMClient().chat_messages(messages)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"回答生成失败：{str(exc)[:200]}") from exc

    reply = AssistantMessage(
        user_id=user.id,
        session_id=session_id,
        role="assistant",
        content=answer,
        refs=json.dumps(refs, ensure_ascii=False),
    )
    db.add(reply)
    session.updated_at = _now()  # 活跃时间置顶
    db.add(session)
    db.commit()
    db.refresh(reply)
    return _to_out(reply)
