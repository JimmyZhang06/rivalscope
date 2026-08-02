"""定时追踪项：CRUD + 立即运行 + 运行历史（企业维度共享）"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import check_quota_or_403, get_current_user
from app.core.plans import TRACKER_LIMITS, effective_org_plan, plan_limits
from app.db.database import get_db
from app.db.models import Organization, ResearchTask, Tracker, User
from app.schemas.tracker import TrackerCreateIn, TrackerOut, TrackerRunOut, TrackerUpdateIn
from app.services.agent import run_research
from app.services.audit import log_audit
from app.services.scheduler import initial_next_run

router = APIRouter(prefix="/api/trackers", tags=["trackers"])


def _require_org(db: Session, user: User) -> Organization:
    org = db.get(Organization, user.org_id) if user.org_id else None
    if not org:
        raise HTTPException(status_code=403, detail="定时追踪为企业功能，请先创建或加入企业")
    return org


def _get_org_tracker(tracker_id: str, user: User, db: Session) -> Tracker:
    tracker = db.get(Tracker, tracker_id)
    if not tracker or not user.org_id or tracker.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="追踪项不存在")
    return tracker


def _require_manage(tracker: Tracker, user: User) -> None:
    """创建人或企业管理员可修改/删除"""
    if tracker.creator_id != user.id and user.org_role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="仅创建人或企业管理员可操作")


def _with_extras(db: Session, tracker: Tracker, user: User) -> TrackerOut:
    """附加运行次数、最近一期变更摘要预览、运行中状态与创建人/权限信息"""
    out = TrackerOut.model_validate(tracker)
    q = db.query(ResearchTask).filter(ResearchTask.tracker_id == tracker.id)
    out.run_count = q.count()
    last = q.filter(ResearchTask.status == "completed").order_by(ResearchTask.created_at.desc()).first()
    if last:
        out.last_task_id = last.id
        out.last_change_summary = (last.change_summary or "")[:300]
    running = (
        q.filter(ResearchTask.status.notin_(["completed", "failed"]))
        .order_by(ResearchTask.created_at.desc())
        .first()
    )
    if running:
        out.running = True
        out.running_task_id = running.id
    creator = db.get(User, tracker.creator_id)
    if creator:
        out.creator_nickname = creator.nickname or creator.email.split("@")[0]
    out.can_manage = tracker.creator_id == user.id or user.org_role in ("owner", "admin")
    return out


def _with_extras_batch(db: Session, trackers: list[Tracker], user: User) -> list[TrackerOut]:
    """批量附加 extras：一次查询获取所有 tracker 的任务统计和创建者信息

    使用 row_number() window function 限制每个 tracker 最多 10 条任务，
    防止 20 tracker × 250 tasks = 5000 条全加载。
    """
    if not trackers:
        return []

    tracker_ids = [t.id for t in trackers]
    creator_ids = list({t.creator_id for t in trackers})

    # 用 window function 按 tracker 分组取最近 10 条
    from sqlalchemy import func

    subq = (
        db.query(
            ResearchTask.id,
            func.row_number()
            .over(partition_by=ResearchTask.tracker_id, order_by=ResearchTask.created_at.desc())
            .label("rn"),
        )
        .filter(ResearchTask.tracker_id.in_(tracker_ids))
        .subquery()
    )
    recent = (
        db.query(ResearchTask)
        .select_from(subq)
        .filter(subq.c.rn <= 10)
        .join(ResearchTask, ResearchTask.id == subq.c.id)
        .all()
    )

    # 按 tracker_id 分组
    tasks_by_tracker: dict[str, list[ResearchTask]] = {}
    for task in recent:
        tasks_by_tracker.setdefault(task.tracker_id, []).append(task)

    # 一次性加载所有创建者
    creators = {u.id: u for u in db.query(User).filter(User.id.in_(creator_ids)).all()}

    results = []
    for tracker in trackers:
        out = TrackerOut.model_validate(tracker)
        tasks = tasks_by_tracker.get(tracker.id, [])
        out.run_count = len(tasks)
        # 最近完成（已按 created_at 倒序排列）
        completed = [t for t in tasks if t.status == "completed"]
        if completed:
            last = completed[0]
            out.last_task_id = last.id
            out.last_change_summary = (last.change_summary or "")[:300]
        # 运行中
        running = [t for t in tasks if t.status not in ("completed", "failed")]
        if running:
            out.running = True
            out.running_task_id = running[0].id
        creator = creators.get(tracker.creator_id)
        if creator:
            out.creator_nickname = creator.nickname or creator.email.split("@")[0]
        out.can_manage = tracker.creator_id == user.id or user.org_role in ("owner", "admin")
        results.append(out)
    return results


@router.post("", response_model=TrackerOut, status_code=201)
def create_tracker(payload: TrackerCreateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org(db, user)
    plan = effective_org_plan(org)
    limit = TRACKER_LIMITS.get(plan, 1)
    count = db.query(Tracker).filter(Tracker.org_id == org.id).count()
    if count >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"{plan_limits(plan)['name']}最多创建 {limit} 个追踪项，请升级企业套餐",
        )
    tracker = Tracker(
        org_id=org.id,
        creator_id=user.id,
        product_name=payload.product_name.strip(),
        competitors=payload.competitors.strip(),
        focus=payload.focus.strip(),
        time_range=payload.time_range,
        frequency=payload.frequency,
        run_hour=payload.run_hour,
        next_run_at=initial_next_run(payload.frequency, payload.run_hour),
        push_email=payload.push_email,
        push_webhook=payload.push_webhook,
        webhook_type=payload.webhook_type,
        webhook_url=payload.webhook_url.strip(),
    )
    db.add(tracker)
    db.commit()
    db.refresh(tracker)
    try:
        log_audit(
            user_id=user.id, org_id=org.id,
            action="tracker.create", resource_type="tracker", resource_id=tracker.id,
            input_data=json.dumps({"product_name": payload.product_name, "frequency": payload.frequency}),
            status="success",
        )
    except Exception:
        pass
    return _with_extras(db, tracker, user)


@router.get("", response_model=list[TrackerOut])
def list_trackers(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    org = _require_org(db, user)
    query = db.query(Tracker).filter(Tracker.org_id == org.id).order_by(Tracker.created_at.desc())
    trackers = query.offset((page - 1) * page_size).limit(page_size).all()
    return _with_extras_batch(db, trackers, user)


@router.get("/{tracker_id}", response_model=TrackerOut)
def get_tracker(tracker_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tracker = _get_org_tracker(tracker_id, user, db)
    return _with_extras(db, tracker, user)


@router.patch("/{tracker_id}", response_model=TrackerOut)
def update_tracker(
    tracker_id: str,
    payload: TrackerUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tracker = _get_org_tracker(tracker_id, user, db)
    _require_manage(tracker, user)
    data = payload.model_dump(exclude_unset=True)
    reschedule = False
    for field, value in data.items():
        if field in ("frequency", "run_hour") and value != getattr(tracker, field):
            reschedule = True
        if field == "enabled" and value and not tracker.enabled:
            reschedule = True  # 重新启用时刷新下次运行时间
        setattr(tracker, field, value.strip() if isinstance(value, str) else value)
    if reschedule:
        tracker.next_run_at = initial_next_run(tracker.frequency, tracker.run_hour)
    db.commit()
    db.refresh(tracker)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="tracker.update", resource_type="tracker", resource_id=tracker_id,
            input_data=json.dumps(list(data.keys())),
            status="success",
        )
    except Exception:
        pass
    return _with_extras(db, tracker, user)


@router.delete("/{tracker_id}", status_code=204)
def delete_tracker(tracker_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tracker = _get_org_tracker(tracker_id, user, db)
    _require_manage(tracker, user)
    tid = tracker.id
    db.delete(tracker)
    db.commit()
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="tracker.delete", resource_type="tracker", resource_id=tid,
            status="success",
        )
    except Exception:
        pass


@router.post("/{tracker_id}/run-now", response_model=TrackerRunOut, status_code=201)
def run_now(
    tracker_id: str,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手动触发一期调研（占用企业本月调研配额，仅创建人或企业管理员可触发）"""
    tracker = _get_org_tracker(tracker_id, user, db)
    _require_manage(tracker, user)
    check_quota_or_403(db, user)
    running = (
        db.query(ResearchTask)
        .filter(
            ResearchTask.tracker_id == tracker.id,
            ResearchTask.status.notin_(["completed", "failed"]),
        )
        .count()
    )
    if running:
        raise HTTPException(status_code=400, detail="该追踪项有一期正在运行中，请等待完成")
    task = ResearchTask(
        user_id=user.id,
        org_id=tracker.org_id,
        tracker_id=tracker.id,
        product_name=tracker.product_name,
        competitors=tracker.competitors,
        focus=tracker.focus,
        time_range=tracker.time_range,
    )
    db.add(task)
    tracker.last_run_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    try:
        log_audit(
            user_id=user.id, org_id=tracker.org_id,
            action="tracker.run", resource_type="tracker", resource_id=tracker.id,
            input_data=json.dumps({"task_id": task.id}),
            status="success",
        )
    except Exception:
        pass
    background.add_task(run_research, task.id)
    return task


@router.get("/{tracker_id}/runs", response_model=list[TrackerRunOut])
def list_runs(
    tracker_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """该追踪项的历次运行（新→旧），含变更摘要与评分数据"""
    tracker = _get_org_tracker(tracker_id, user, db)
    return (
        db.query(ResearchTask)
        .filter(ResearchTask.tracker_id == tracker.id)
        .order_by(ResearchTask.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
