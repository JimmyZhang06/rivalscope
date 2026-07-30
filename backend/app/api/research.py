import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api.deps import check_quota_or_403, get_current_user, get_quota, get_user_from_query_token
from app.db.database import SessionLocal, get_db
from app.db.models import ResearchTask, Source, TaskStep, User
from app.schemas.auth import QuotaOut
from app.schemas.research import ResearchCreate, SourceDetail, StepOut, TaskBrief, TaskDetail
from app.services.agent import run_research

router = APIRouter(prefix="/api/research", tags=["research"])

FINAL_STATUSES = {"completed", "failed"}


@router.post("", response_model=TaskBrief, status_code=201)
def create_research(
    payload: ResearchCreate,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建调研任务并在后台启动 Agent（校验本月配额）"""
    check_quota_or_403(db, user)
    task = ResearchTask(
        user_id=user.id,
        product_name=payload.product_name.strip(),
        competitors=payload.competitors.strip(),
        focus=payload.focus.strip(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    background.add_task(run_research, task.id)
    return task


@router.get("", response_model=list[TaskBrief])
def list_research(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(ResearchTask)
        .filter(ResearchTask.user_id == user.id)
        .order_by(ResearchTask.created_at.desc())
        .all()
    )


@router.get("/quota", response_model=QuotaOut)
def my_quota(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_quota(db, user)


def _get_owned_task(task_id: str, user: User, db: Session) -> ResearchTask:
    task = db.get(ResearchTask, task_id)
    if not task or (task.user_id != user.id and user.role != "admin"):
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
