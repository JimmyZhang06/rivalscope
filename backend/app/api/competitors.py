import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Competitor, CompetitorProfile, User
from app.schemas.competitor import CompetitorIn, CompetitorOut
from app.services.audit import log_audit

router = APIRouter(prefix="/api/competitors", tags=["competitors"])


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _require_org(user: User) -> None:
    if not user.org_id:
        raise HTTPException(status_code=403, detail="请先加入企业")


def _competitor_access_check(c: Competitor, user: User) -> None:
    """统一竞品访问校验：按 org_id 企业隔离 + user_id 个人隔离"""
    if not c:
        raise HTTPException(status_code=404, detail="竞品不存在")
    if c.org_id == "":
        if user.org_id:
            # 企业用户看到系统级竞品：需管理员
            if not _is_admin(user):
                raise HTTPException(status_code=403, detail="无权查看系统级竞品")
        else:
            # 两个都是个人用户：user_id 匹配本人，或存量空 user_id（部署前的旧记录，向后兼容）
            if c.user_id and c.user_id != user.id:
                raise HTTPException(status_code=403, detail="无权查看他人的竞品")
    elif c.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权查看其他企业的竞品")


@router.get("", response_model=list[CompetitorOut])
def list_competitors(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """列出本企业竞品 + 系统级模板竞品（管理员可见）

    个人用户：user_id 匹配本人（新记录）或 user_id 为空（修复部署前的存量记录，向后兼容）
    """
    if user.org_id:
        q = db.query(Competitor).filter(
            (Competitor.org_id == user.org_id)
            | ((Competitor.org_id == "") & _is_admin(user))
        )
    else:
        q = db.query(Competitor).filter(
            ((Competitor.user_id == user.id) | (Competitor.user_id == ""))
        )
    return q.order_by(Competitor.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()


@router.post("", response_model=CompetitorOut, status_code=201)
def create_competitor(payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 允许个人用户创建竞品（org_id 为空表示个人竞品）
    # 企业用户的竞品属于企业维度
    org_id = user.org_id or ""
    c = Competitor(
        org_id=org_id,
        user_id=user.id,
        name=payload.name.strip(),
        alias=payload.alias.strip(),
        website=payload.website.strip(),
        tech_focus=payload.tech_focus.strip(),
        keywords=json.dumps(payload.keywords, ensure_ascii=False),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    try:
        log_audit(
            user_id=user.id, org_id=org_id,
            action="competitor.create", resource_type="competitor", resource_id=c.id,
            status="success",
        )
    except Exception:
        pass
    return c


@router.patch("/{cid}", response_model=CompetitorOut)
def update_competitor(cid: str, payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Competitor, cid)
    if not c:
        raise HTTPException(status_code=404, detail="竞品不存在")
    if c.org_id == "":
        if not user.org_id:
            if not c.user_id or c.user_id != user.id:
                raise HTTPException(status_code=403, detail="无权修改他人的竞品")
    elif c.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权修改其他企业的竞品")
    if c.org_id == "" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="系统级竞品仅管理员可修改")
    c.name = payload.name.strip()
    c.alias = payload.alias.strip()
    c.website = payload.website.strip()
    c.tech_focus = payload.tech_focus.strip()
    c.keywords = json.dumps(payload.keywords, ensure_ascii=False)
    db.commit()
    db.refresh(c)
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="competitor.update", resource_type="competitor", resource_id=cid,
            input_data=json.dumps({"name": payload.name}),
            status="success",
        )
    except Exception:
        pass
    return c


@router.delete("/{cid}", status_code=204)
def delete_competitor(cid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Competitor, cid)
    if not c:
        raise HTTPException(status_code=404, detail="竞品不存在")
    if c.org_id == "":
        if not user.org_id:
            if not c.user_id or c.user_id != user.id:
                raise HTTPException(status_code=403, detail="无权删除他人的竞品")
    elif c.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="无权删除其他企业的竞品")
    if c.org_id == "" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="系统级竞品仅管理员可删除")
    # 应用层外键保护：检查关联画像
    linked = db.query(CompetitorProfile).filter(CompetitorProfile.competitor_id == cid).count()
    if linked > 0:
        raise HTTPException(status_code=400, detail=f"该竞品有 {linked} 个关联画像，请先删除")
    db.delete(c)
    db.commit()
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="competitor.delete", resource_type="competitor", resource_id=cid,
            status="success",
        )
    except Exception:
        pass
