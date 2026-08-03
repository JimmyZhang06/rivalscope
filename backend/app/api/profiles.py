import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import check_access, check_quota_or_403, get_current_user, is_admin
from app.db.database import SessionLocal, get_db
from app.db.models import Competitor, CompetitorProfile, ProfileTemplate, User
from app.schemas.profiles import (
    ComparisonIn,
    ComparisonOut,
    CompetitorProfileOut,
    ProfileFreezeOut,
    ProfileGenerateIn,
    ProfileInsightsOut,
    ProfileTemplateFreezeOut,
    ProfileTemplateIn,
    ProfileTemplateOut,
)
from app.services.comparison import generate_comparison
from app.services.profiles import freeze_profile, generate_profile
from app.services.profile_extractor import create_profile_generation_task, get_profile_generation_task
from app.services.profile_report import generate_profile_insights, generate_profile_report
from app.core.timeutil import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


def _profile_access_check(p: CompetitorProfile, user: User) -> None:
    """统一画像访问校验：按 org_id 企业隔离 + user_id 个人隔离"""
    if not p:
        raise HTTPException(status_code=404, detail="画像不存在")
    check_access(
        p.org_id, p.user_id, user,
        system_access="admin_only",
        resource_name="画像",
    )


# ---------- 模板 ----------

@router.get("/templates", response_model=list[ProfileTemplateOut])
def list_templates(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    if user.org_id:
        q = db.query(ProfileTemplate).filter(
            (ProfileTemplate.org_id == user.org_id)
            | ((ProfileTemplate.org_id == "") & is_admin(user))
        )
    else:
        q = db.query(ProfileTemplate).filter(ProfileTemplate.created_by == user.id)
    return q.order_by(ProfileTemplate.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()


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
    if not t:
        raise HTTPException(status_code=404, detail="模板不存在")
    if t.org_id == "":
        if not is_admin(user) and not user.org_id:
            # 个人用户的私有模板：检查创建人
            if t.created_by != user.id:
                raise HTTPException(status_code=403, detail="无权修改他人的模板")
    elif t.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权修改其他企业的模板")
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
    if not t:
        raise HTTPException(status_code=404, detail="模板不存在")
    if t.org_id == "":
        if not is_admin(user):
            raise HTTPException(status_code=403, detail="仅管理员可冻结系统级模板")
    elif t.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权冻结其他企业的模板")
    if t.frozen_at is not None:
        raise HTTPException(status_code=400, detail="模板已冻结")
    t.frozen_at = utcnow()
    db.commit()
    db.refresh(t)
    return t


@router.delete("/templates/{tid}", status_code=204)
def delete_template(tid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(ProfileTemplate, tid)
    if not t:
        raise HTTPException(status_code=404, detail="模板不存在")
    if t.org_id == "":
        if not is_admin(user) and (not user.org_id and t.created_by != user.id):
            raise HTTPException(status_code=403, detail="无权删除他人的模板")
    elif t.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权删除其他企业的模板")
    # 应用层外键保护：检查关联画像
    linked = db.query(CompetitorProfile).filter(CompetitorProfile.template_id == tid).count()
    if linked > 0:
        raise HTTPException(status_code=400, detail=f"该模板有 {linked} 个关联画像，请先删除")
    db.delete(t)
    db.commit()


# ---------- 画像 ----------

@router.post("/generate", response_model=dict, status_code=202)
async def generate_profile_api(payload: ProfileGenerateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """后台触发：生成竞品画像（使用异步任务模式）"""
    check_quota_or_403(db, user)
    competitor = db.get(Competitor, payload.competitor_id)
    if not competitor or (competitor.org_id != user.org_id and competitor.org_id != ""):
        raise HTTPException(status_code=404, detail="竞品不存在")
    template = db.get(ProfileTemplate, payload.template_id)
    if not template or (template.org_id != user.org_id and template.org_id != ""):
        raise HTTPException(status_code=404, detail="模板不存在")
    if template.frozen_at is None:
        raise HTTPException(status_code=400, detail="模板未冻结")

    org_id = competitor.org_id if competitor else ""
    task = create_profile_generation_task(payload.competitor_id, payload.template_id, user.id, org_id)
    return {"task_id": task.task_id, "competitor_id": payload.competitor_id, "template_id": payload.template_id, "status": "running"}


# 兼容别名：旧前端可能仍调用此路径（零改动兼容）
@router.post("/generate-from-crawl", response_model=dict, status_code=202)
async def generate_from_crawl_alias(payload: ProfileGenerateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await generate_profile_api(payload, user, db)


# 主状态查询路径
@router.get("/generate/{task_id}", response_model=dict)
def get_generate_status(task_id: str, user: User = Depends(get_current_user)):
    """查询后台画像提取任务状态"""
    task = get_profile_generation_task(task_id)
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

# 兼容别名：旧前端可能仍调用此路径
@router.get("/generate-from-crawl/{task_id}", response_model=dict)
def get_generate_status_compat(task_id: str, user: User = Depends(get_current_user)):
    return get_generate_status(task_id, user)


@router.get("", response_model=list[CompetitorProfileOut])
def list_profiles(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    # 有企业：显示本企业 + 系统级(管理员可见)
    # 无企业：user_id 匹配本人（新记录）或 user_id 为空（部署前的存量记录，向后兼容）
    if user.org_id:
        q = db.query(CompetitorProfile).filter(
            (CompetitorProfile.org_id == user.org_id)
            | ((CompetitorProfile.org_id == "") & is_admin(user))
        )
    else:
        q = db.query(CompetitorProfile).filter(
            ((CompetitorProfile.user_id == user.id) | (CompetitorProfile.user_id == ""))
        )
    return q.order_by(CompetitorProfile.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()


@router.get("/tasks", response_model=list[dict])
def list_extract_tasks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """列出当前用户的画像提取任务（含进行中和历史）"""
    from app.db.models import ProfileGenerationTask as ProfileGenerationTaskModel
    tasks = (
        db.query(ProfileGenerationTaskModel)
        .filter(ProfileGenerationTaskModel.user_id == user.id)
        .order_by(ProfileGenerationTaskModel.created_at.desc())
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
    _profile_access_check(p, user)
    return p


@router.post("/{pid}/freeze", response_model=dict)
def freeze_profile_api(pid: str, user: User = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可冻结画像")
    return freeze_profile(pid)


# ---------- 画像报告与洞察 ----------

@router.get("/{pid}/report", response_model=dict)
async def get_profile_report(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """返回画像报告：优先读取预生成的独立列缓存，缓存不存在时实时调用 LLM 生成。"""
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读取独立列（拆分后）
    if p.report_markdown:
        return {
            "report_markdown": p.report_markdown,
            "source_index": json.loads(p.source_index_json or "[]"),
            "quality": json.loads(p.profile_data or "{}").get("report_quality", {}),
            "insights": json.loads(p.insights_json) if p.insights_json else None,
        }

    # Fallback: generate on-demand
    result = await generate_profile_report(pid, user.id, p.org_id)
    return result


@router.get("/{pid}/insights", response_model=ProfileInsightsOut)
async def get_profile_insights(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """返回画像洞察数据：优先读取预生成的独立列缓存，缓存不存在时实时调用 LLM 生成。"""
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读取独立列
    if p.insights_json and p.insights_json != "[]":
        try:
            return json.loads(p.insights_json)
        except (json.JSONDecodeError, TypeError):
            pass

    # Fallback: generate on-demand
    result = await generate_profile_insights(pid, user.id, p.org_id)
    return result


@router.get("/{pid}/report-full", response_model=dict)
async def get_profile_report_full(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """一次性返回画像报告 + 洞察 + 来源索引（前端首屏用，减少请求数）。"""
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读取独立列
    if p.report_markdown:
        return {
            "report_markdown": p.report_markdown,
            "source_index": json.loads(p.source_index_json or "[]"),
            "quality": json.loads(p.profile_data or "{}").get("report_quality", {}),
            "insights": json.loads(p.insights_json) if p.insights_json else None,
        }

    # Fallback: generate both on-demand
    from app.services.profile_report import generate_profile_report, generate_profile_insights
    report = await generate_profile_report(pid, user.id, p.org_id)
    insights = await generate_profile_insights(pid, user.id, p.org_id)
    return {
        "report_markdown": report.get("report_markdown", ""),
        "source_index": report.get("source_index", []),
        "quality": report.get("quality") or {},
        "insights": insights,
    }


# ---------- 横向对比 ----------

@router.post("/compare", response_model=ComparisonOut)
def compare_profiles(payload: ComparisonIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    template = db.get(ProfileTemplate, payload.template_id)
    if not template:
        raise HTTPException(status_code=403, detail="无权访问该模板")
    if template.org_id != user.org_id:
        if template.org_id != "" or user.org_id:
            raise HTTPException(status_code=403, detail="无权访问该模板")
        # 两人都无企业：检查创建人
        if template.created_by != user.id:
            raise HTTPException(status_code=403, detail="无权访问该模板")
    valid_ids = []
    for pid in payload.profile_ids:
        p = db.get(CompetitorProfile, pid)
        if not p:
            raise HTTPException(status_code=404, detail=f"画像 {pid} 不存在")
        if p.org_id == "":
            if not is_admin(user):
                if not user.org_id:
                    if p.user_id and p.user_id != user.id:
                        raise HTTPException(status_code=403, detail=f"无权访问画像 {pid}")
                else:
                    raise HTTPException(status_code=403, detail=f"无权访问系统级画像 {pid}")
        elif p.org_id != user.org_id:
            raise HTTPException(status_code=403, detail=f"无权访问画像 {pid}")
        valid_ids.append(pid)
    return generate_comparison(payload.template_id, valid_ids)
