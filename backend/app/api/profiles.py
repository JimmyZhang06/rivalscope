import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Competitor, CompetitorProfile, ProfileTemplate, User
from app.schemas.profiles import (
    ComparisonIn,
    ComparisonOut,
    CompetitorProfileOut,
    ProfileGenerateIn,
    ProfileTemplateFreezeOut,
    ProfileTemplateIn,
    ProfileTemplateOut,
)
from app.services.comparison import generate_comparison
from app.services.profiles import freeze_profile, generate_profile
from app.services.profile_extractor import create_extract_task, get_extract_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


def _is_admin(user: User) -> bool:
    return user.role == "admin"


# ---------- 模板 ----------

@router.get("/templates", response_model=list[ProfileTemplateOut])
def list_templates(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(ProfileTemplate).filter(
        (ProfileTemplate.org_id == user.org_id) | (ProfileTemplate.org_id == "")
    )
    return q.order_by(ProfileTemplate.created_at.desc()).all()


@router.post("/templates", response_model=ProfileTemplateOut, status_code=201)
def create_template(payload: ProfileTemplateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = ProfileTemplate(
        org_id=user.org_id or "",
        name=payload.name.strip(),
        dimensions=json.dumps([d.model_dump() for d in payload.dimensions], ensure_ascii=False),
        created_by=user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    t.dimensions = json.loads(t.dimensions)
    return t


@router.patch("/templates/{tid}", response_model=ProfileTemplateOut)
def update_template(tid: str, payload: ProfileTemplateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(ProfileTemplate, tid)
    if not t or (t.org_id != user.org_id and t.org_id != ""):
        raise HTTPException(status_code=404, detail="模板不存在")
    if t.frozen_at is not None:
        raise HTTPException(status_code=400, detail="已冻结的模板不可修改，请创建新版本")
    t.name = payload.name.strip()
    t.dimensions = json.dumps([d.model_dump() for d in payload.dimensions], ensure_ascii=False)
    t.version += 1
    db.commit()
    db.refresh(t)
    t.dimensions = json.loads(t.dimensions)
    return t


@router.post("/templates/{tid}/freeze", response_model=ProfileTemplateFreezeOut)
def freeze_template(tid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(ProfileTemplate, tid)
    if not t or (t.org_id != user.org_id and t.org_id != ""):
        raise HTTPException(status_code=404, detail="模板不存在")
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可冻结模板")
    if t.frozen_at is not None:
        raise HTTPException(status_code=400, detail="模板已冻结")
    from app.services.profiles import _utcnow
    t.frozen_at = _utcnow()
    db.commit()
    db.refresh(t)
    return t


@router.delete("/templates/{tid}", status_code=204)
def delete_template(tid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(ProfileTemplate, tid)
    if not t or (t.org_id != user.org_id and t.org_id != ""):
        raise HTTPException(status_code=404, detail="模板不存在")
    if t.frozen_at is not None:
        raise HTTPException(status_code=400, detail="已冻结的模板不可删除，请创建新版本")
    db.delete(t)
    db.commit()


# ---------- 画像 ----------

@router.post("/generate", response_model=dict, status_code=201)
async def generate_profile_api(payload: ProfileGenerateIn, user: User = Depends(get_current_user)):
    result = await generate_profile(payload.competitor_id, payload.template_id, user_id=user.id)
    return result


# ---------- 基于爬取页面生成画像 ----------

@router.post("/generate-from-crawl", response_model=dict, status_code=202)
async def generate_from_crawl(payload: ProfileGenerateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """后台触发：基于竞品已爬取的官网页面生成画像"""
    competitor = db.get(Competitor, payload.competitor_id)
    if not competitor or (competitor.org_id != user.org_id and competitor.org_id != ""):
        raise HTTPException(status_code=404, detail="竞品不存在")
    template = db.get(ProfileTemplate, payload.template_id)
    if not template or (template.org_id != user.org_id and template.org_id != ""):
        raise HTTPException(status_code=404, detail="模板不存在")
    if template.frozen_at is None:
        raise HTTPException(status_code=400, detail="模板未冻结")

    org_id = competitor.org_id if competitor else ""
    task = create_extract_task(payload.competitor_id, payload.template_id, user.id, org_id)
    return {"task_id": task.task_id, "competitor_id": payload.competitor_id, "template_id": payload.template_id, "status": "running"}


@router.get("/generate-from-crawl/{task_id}", response_model=dict)
def get_generate_status(task_id: str, user: User = Depends(get_current_user)):
    """查询后台画像提取任务状态"""
    task = get_extract_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="无权查看")
    result = {
        "task_id": task.task_id,
        "competitor_id": task.competitor_id,
        "template_id": task.template_id,
        "status": task.status,
        "current_step": task.current_step,
        "error": task.error,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
    if task.status == "done" and task.result:
        result["result"] = task.result
    return result


@router.get("", response_model=list[CompetitorProfileOut])
def list_profiles(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(CompetitorProfile).filter(
        (CompetitorProfile.org_id == user.org_id) | (CompetitorProfile.org_id == "")
    )
    return q.order_by(CompetitorProfile.created_at.desc()).all()


@router.get("/tasks", response_model=list[dict])
def list_extract_tasks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """列出当前用户的画像提取任务（含进行中和历史）"""
    from app.db.models import ProfileExtractTask as ProfileExtractTaskModel
    tasks = (
        db.query(ProfileExtractTaskModel)
        .filter(ProfileExtractTaskModel.user_id == user.id)
        .order_by(ProfileExtractTaskModel.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "task_id": t.id,
            "competitor_id": t.competitor_id,
            "template_id": t.template_id,
            "status": t.status,
            "current_step": t.current_step,
            "error": t.error,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "result": json.loads(t.result) if t.result else None,
        }
        for t in tasks
    ]


@router.get("/{pid}", response_model=CompetitorProfileOut)
def get_profile(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(CompetitorProfile, pid)
    if not p or (p.org_id != user.org_id and p.org_id != ""):
        raise HTTPException(status_code=404, detail="画像不存在")
    return p


@router.post("/{pid}/freeze", response_model=dict)
def freeze_profile_api(pid: str, user: User = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可冻结画像")
    return freeze_profile(pid)


# ---------- 横向对比 ----------

@router.post("/compare", response_model=ComparisonOut)
def compare_profiles(payload: ComparisonIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    result = generate_comparison(payload.template_id, payload.competitor_ids)
    return result
