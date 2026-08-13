"""把调研、追踪运行和图谱项目兼容聚合为统一事件流。"""

from collections import Counter
from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from app.db.models import GraphProject, ResearchTask, User
from app.schemas.intelligence import IntelligenceEvent, IntelligenceEventStatus

EventTypeFilter = Literal["all", "research", "tracker", "graph"]
StatusFilter = Literal["all", "queued", "running", "completed", "failed"]

_RESEARCH_STATUS_MAP: dict[str, IntelligenceEventStatus] = {
    "pending": "queued",
    "planning": "running",
    "searching": "running",
    "analyzing": "running",
    "reporting": "running",
    "completed": "completed",
    "failed": "failed",
}
_GRAPH_STATUS_MAP: dict[str, IntelligenceEventStatus] = {
    "pending": "queued",
    "building": "running",
    "completed": "completed",
    "failed": "failed",
}


def _accessible(query: Query, model: type[ResearchTask] | type[GraphProject], user: User) -> Query:
    """沿用各模块现有的本人 + 同企业可见规则。"""
    if user.org_id:
        return query.filter((model.user_id == user.id) | (model.org_id == user.org_id))
    return query.filter(model.user_id == user.id)


def _native_statuses(
    normalized: StatusFilter,
    mapping: dict[str, IntelligenceEventStatus],
) -> list[str]:
    if normalized == "all":
        return list(mapping)
    return [native for native, status in mapping.items() if status == normalized]


def _short(value: str, limit: int = 240) -> str:
    text = " ".join((value or "").split())
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _research_event(task: ResearchTask) -> IntelligenceEvent:
    is_tracker = bool(task.tracker_id)
    event_type = "tracker" if is_tracker else "research"
    if task.error:
        summary = task.error
    elif is_tracker and task.change_summary:
        summary = task.change_summary
    elif task.focus:
        summary = task.focus
    elif task.competitors:
        summary = f"关注竞品：{task.competitors}"
    else:
        summary = "竞品情报调研任务"
    return IntelligenceEvent(
        id=f"{event_type}:{task.id}",
        event_type=event_type,
        status=_RESEARCH_STATUS_MAP.get(task.status, "running"),
        title=(f"追踪更新 · {task.product_name}" if is_tracker else f"调研 · {task.product_name}"),
        summary=_short(summary),
        source_id=task.id,
        href=f"/app/tasks/{task.id}",
        occurred_at=task.created_at,
        updated_at=task.updated_at,
        context={
            "tracker_id": task.tracker_id or None,
            "product_name": task.product_name,
            "source_status": task.status,
        },
    )


def _graph_event(project: GraphProject) -> IntelligenceEvent:
    summary = project.error or (
        f"{project.industry}产业链关系网络" if project.industry else "产业链关系网络构建"
    )
    return IntelligenceEvent(
        id=f"graph:{project.id}",
        event_type="graph",
        status=_GRAPH_STATUS_MAP.get(project.status, "running"),
        title=f"图谱 · {project.root_name}",
        summary=_short(summary),
        source_id=project.id,
        href=f"/app/graph/{project.id}",
        occurred_at=project.created_at,
        updated_at=project.updated_at,
        context={
            "root_name": project.root_name,
            "industry": project.industry or None,
            "source_status": project.status,
        },
    )


def _research_query(
    db: Session,
    user: User,
    *,
    tracker: bool,
    status: StatusFilter,
) -> Query:
    query = _accessible(db.query(ResearchTask), ResearchTask, user)
    query = query.filter(ResearchTask.tracker_id != "" if tracker else ResearchTask.tracker_id == "")
    if status != "all":
        query = query.filter(ResearchTask.status.in_(_native_statuses(status, _RESEARCH_STATUS_MAP)))
    return query


def _graph_query(db: Session, user: User, status: StatusFilter) -> Query:
    query = _accessible(db.query(GraphProject), GraphProject, user)
    if status != "all":
        query = query.filter(GraphProject.status.in_(_native_statuses(status, _GRAPH_STATUS_MAP)))
    return query


def list_events(
    db: Session,
    user: User,
    *,
    event_type: EventTypeFilter = "all",
    status: StatusFilter = "all",
    page: int = 1,
    page_size: int = 30,
) -> tuple[list[IntelligenceEvent], int]:
    """分源限量读取后归并排序，避免改动或复制原业务数据。"""
    take = page * page_size
    events: list[IntelligenceEvent] = []
    total = 0

    if event_type in ("all", "research"):
        query = _research_query(db, user, tracker=False, status=status)
        total += query.count()
        events.extend(_research_event(row) for row in query.order_by(ResearchTask.created_at.desc()).limit(take))
    if event_type in ("all", "tracker"):
        query = _research_query(db, user, tracker=True, status=status)
        total += query.count()
        events.extend(_research_event(row) for row in query.order_by(ResearchTask.created_at.desc()).limit(take))
    if event_type in ("all", "graph"):
        query = _graph_query(db, user, status)
        total += query.count()
        events.extend(_graph_event(row) for row in query.order_by(GraphProject.created_at.desc()).limit(take))

    events.sort(key=lambda event: (event.occurred_at, event.id), reverse=True)
    start = (page - 1) * page_size
    return events[start : start + page_size], total


def summarize_events(db: Session, user: User) -> dict:
    by_type: Counter[str] = Counter({"research": 0, "tracker": 0, "graph": 0})
    by_status: Counter[str] = Counter({"queued": 0, "running": 0, "completed": 0, "failed": 0})
    for event_type, tracker in (("research", False), ("tracker", True)):
        query = _research_query(db, user, tracker=tracker, status="all")
        for native_status, count in query.with_entities(
            ResearchTask.status,
            func.count(ResearchTask.id),
        ).group_by(ResearchTask.status):
            by_type[event_type] += count
            by_status[_RESEARCH_STATUS_MAP.get(native_status, "running")] += count
    query = _graph_query(db, user, "all")
    for native_status, count in query.with_entities(
        GraphProject.status,
        func.count(GraphProject.id),
    ).group_by(GraphProject.status):
        by_type["graph"] += count
        by_status[_GRAPH_STATUS_MAP.get(native_status, "running")] += count

    latest_candidates = [
        _research_query(db, user, tracker=False, status="all").order_by(ResearchTask.created_at.desc()).first(),
        _research_query(db, user, tracker=True, status="all").order_by(ResearchTask.created_at.desc()).first(),
        _graph_query(db, user, "all").order_by(GraphProject.created_at.desc()).first(),
    ]
    latest_at = max((row.created_at for row in latest_candidates if row), default=None)
    return {
        "total": sum(by_type.values()),
        "active": by_status["queued"] + by_status["running"],
        "completed": by_status["completed"],
        "failed": by_status["failed"],
        "by_type": dict(by_type),
        "by_status": dict(by_status),
        "latest_at": latest_at,
    }
