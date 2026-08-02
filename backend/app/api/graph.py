"""产业链关系图谱 API"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import check_quota_or_403, get_current_user
from app.db.database import get_db
from app.db.models import GraphEntity, GraphProject, GraphRelation, User
from app.schemas.graph import GraphCreate, GraphDetailOut, GraphProjectOut
from app.services.audit import log_audit
from app.services.graph_agent import build_graph

router = APIRouter(prefix="/api/graph", tags=["graph"])


def _get_owned_project(project_id: str, user: User, db: Session) -> GraphProject:
    """本人、同企业成员或管理员可访问"""
    project = db.get(GraphProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="图谱项目不存在")
    allowed = (
        project.user_id == user.id
        or user.role == "admin"
        or (bool(user.org_id) and project.org_id == user.org_id)
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="图谱项目不存在")
    return project


@router.post("", response_model=GraphProjectOut, status_code=201)
def create_graph(
    payload: GraphCreate,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建图谱项目并在后台构建（占用本月调研配额）"""
    check_quota_or_403(db, user)
    project = GraphProject(
        user_id=user.id,
        org_id=user.org_id or "",
        root_name=payload.root_name.strip(),
        industry=payload.industry.strip(),
        time_range=payload.time_range,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="graph.create", resource_type="graph", resource_id=project.id,
            input_data=payload.root_name,
            status="success",
        )
    except Exception:
        pass
    background.add_task(build_graph, project.id)
    return project


@router.get("", response_model=list[GraphProjectOut])
def list_graphs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """项目列表：本人 + 同企业共享"""
    q = db.query(GraphProject)
    if user.org_id:
        q = q.filter((GraphProject.user_id == user.id) | (GraphProject.org_id == user.org_id))
    else:
        q = q.filter(GraphProject.user_id == user.id)
    return q.order_by(GraphProject.created_at.desc()).all()


@router.get("/{project_id}", response_model=GraphDetailOut)
def get_graph(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_project(project_id, user, db)


@router.post("/{project_id}/refresh", response_model=GraphProjectOut)
def refresh_graph(
    project_id: str,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """重建图谱：清空既有实体与关系后在后台重新构建（占用调研配额）"""
    project = _get_owned_project(project_id, user, db)
    if project.status == "building":
        raise HTTPException(status_code=400, detail="图谱正在构建中，请等待完成")
    check_quota_or_403(db, user)
    db.query(GraphRelation).filter(GraphRelation.project_id == project.id).delete()
    db.query(GraphEntity).filter(GraphEntity.project_id == project.id).delete()
    project.status = "pending"
    project.error = ""
    project.report_markdown = ""
    db.commit()
    db.refresh(project)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="graph.refresh", resource_type="graph", resource_id=project_id,
            status="success",
        )
    except Exception:
        pass
    background.add_task(build_graph, project.id)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_graph(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_owned_project(project_id, user, db)
    pid = project.id
    db.delete(project)
    db.commit()
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="graph.delete", resource_type="graph", resource_id=pid,
            status="success",
        )
    except Exception:
        pass
