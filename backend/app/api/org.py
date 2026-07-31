"""企业组织：创建/加入（邀请码）/成员管理，一人同时只属于一个企业"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, member_month_usage
from app.db.database import get_db
from app.db.models import Organization, Tracker, User, _invite_code
from app.schemas.org import (
    MemberOut,
    MemberUpdateIn,
    OrgCreateIn,
    OrgJoinIn,
    OrgMeOut,
    OrgOut,
    OrgUpdateIn,
)

router = APIRouter(prefix="/api/org", tags=["org"])


def _require_org(db: Session, user: User) -> Organization:
    org = db.get(Organization, user.org_id) if user.org_id else None
    if not org:
        raise HTTPException(status_code=404, detail="您还未加入任何企业")
    return org


def _require_org_admin(db: Session, user: User) -> Organization:
    org = _require_org(db, user)
    if user.org_role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="需要企业管理员权限")
    return org


@router.post("", response_model=OrgOut, status_code=201)
def create_org(payload: OrgCreateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.org_id:
        raise HTTPException(status_code=400, detail="您已加入企业，请先退出后再创建")
    org = Organization(name=payload.name.strip(), owner_id=user.id)
    db.add(org)
    db.flush()
    user.org_id = org.id
    user.org_role = "owner"
    db.commit()
    db.refresh(org)
    return org


@router.get("/me", response_model=OrgMeOut)
def my_org(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = db.get(Organization, user.org_id) if user.org_id else None
    if not org:
        return OrgMeOut(org=None)
    count = db.query(User).filter(User.org_id == org.id).count()
    return OrgMeOut(org=OrgOut.model_validate(org), org_role=user.org_role, member_count=count)


@router.patch("", response_model=OrgOut)
def update_org(payload: OrgUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org_admin(db, user)
    org.name = payload.name.strip()
    db.commit()
    db.refresh(org)
    return org


@router.post("/invite-code/reset", response_model=OrgOut)
def reset_invite_code(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org_admin(db, user)
    org.invite_code = _invite_code()
    db.commit()
    db.refresh(org)
    return org


@router.post("/join", response_model=OrgOut)
def join_org(payload: OrgJoinIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.org_id:
        raise HTTPException(status_code=400, detail="您已加入企业，请先退出后再加入其他企业")
    code = payload.invite_code.strip().upper()
    org = db.query(Organization).filter(Organization.invite_code == code).first()
    if not org:
        raise HTTPException(status_code=404, detail="邀请码无效，请与企业管理员确认")
    user.org_id = org.id
    user.org_role = "member"
    db.commit()
    db.refresh(org)
    return org


@router.get("/members", response_model=list[MemberOut])
def list_members(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org(db, user)
    role_rank = {"owner": 0, "admin": 1, "member": 2}
    members = db.query(User).filter(User.org_id == org.id).all()
    members = sorted(members, key=lambda m: (role_rank.get(m.org_role, 9), m.created_at))
    result = []
    for m in members:
        out = MemberOut.model_validate(m)
        out.month_used = member_month_usage(db, m.id)
        result.append(out)
    return result


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org = _require_org_admin(db, user)
    member = db.get(User, member_id)
    if not member or member.org_id != org.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    if member.org_role == "owner":
        raise HTTPException(status_code=400, detail="不能修改企业所有者的角色或额度")
    if payload.org_role is not None:
        if payload.org_role not in ("admin", "member"):
            raise HTTPException(status_code=400, detail="无效的角色")
        member.org_role = payload.org_role
    if payload.org_monthly_limit is not None:
        member.org_monthly_limit = payload.org_monthly_limit
    db.commit()
    db.refresh(member)
    out = MemberOut.model_validate(member)
    out.month_used = member_month_usage(db, member.id)
    return out


@router.delete("/members/{member_id}", status_code=204)
def remove_member(member_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org_admin(db, user)
    member = db.get(User, member_id)
    if not member or member.org_id != org.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    if member.org_role == "owner":
        raise HTTPException(status_code=400, detail="企业所有者不能被移出")
    if member.id == user.id:
        raise HTTPException(status_code=400, detail="不能移出自己，请使用退出企业")
    member.org_id = ""
    member.org_role = ""
    member.org_monthly_limit = -1
    db.commit()


@router.post("/leave", status_code=204)
def leave_org(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org(db, user)
    if user.org_role == "owner":
        others = db.query(User).filter(User.org_id == org.id, User.id != user.id).count()
        if others:
            raise HTTPException(status_code=400, detail="企业内仍有其他成员，所有者不能直接退出")
        # 最后一人退出即解散企业，级联清理追踪项
        db.query(Tracker).filter(Tracker.org_id == org.id).delete()
        db.delete(org)
    user.org_id = ""
    user.org_role = ""
    user.org_monthly_limit = -1
    db.commit()
