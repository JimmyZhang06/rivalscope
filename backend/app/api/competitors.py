import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Competitor, User
from app.schemas.competitor import CompetitorIn, CompetitorOut
from app.services.audit import log_audit

router = APIRouter(prefix="/api/competitors", tags=["competitors"])


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _require_org(user: User) -> None:
    if not user.org_id:
        raise HTTPException(status_code=403, detail="请先加入企业")


@router.get("", response_model=list[CompetitorOut])
def list_competitors(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """列出本企业竞品 + 系统级模板竞品"""
    q = db.query(Competitor).filter(
        (Competitor.org_id == user.org_id) | (Competitor.org_id == "")
    )
    return q.order_by(Competitor.created_at.desc()).all()


@router.post("", response_model=CompetitorOut, status_code=201)
def create_competitor(payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_org(user)
    c = Competitor(
        org_id=user.org_id or "",
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
            user_id=user.id, org_id=user.org_id or "",
            action="competitor.create", resource_type="competitor", resource_id=c.id,
            status="success",
        )
    except Exception:
        pass
    return c


@router.patch("/{cid}", response_model=CompetitorOut)
def update_competitor(cid: str, payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Competitor, cid)
    if not c or (c.org_id != user.org_id and c.org_id != ""):
        raise HTTPException(status_code=404, detail="竞品不存在")
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
    if not c or (c.org_id != user.org_id and c.org_id != ""):
        raise HTTPException(status_code=404, detail="竞品不存在")
    if c.org_id == "" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="系统级竞品仅管理员可删除")
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
