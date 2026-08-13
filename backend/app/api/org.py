"""企业组织：创建/加入（邀请码）/成员管理，一人同时只属于一个企业"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, member_month_usage
from app.db.database import get_db
from app.db.models import GraphProject, Organization, ResearchTask, Tracker, User, _invite_code
from app.schemas.org import (
    MemberOut, MemberUpdateIn, OrgCreateIn, OrgJoinIn, OrgMeOut, OrgOut, OrgUpdateIn,
)
from app.services.audit import AuditWriteError, log_audit_required

router = APIRouter(prefix="/api/org", tags=["org"])


def _required_audit(db: Session, **kwargs) -> None:
    """权限和组织管理操作缺少审计时拒绝提交业务变更。"""
    try:
        log_audit_required(db=db, **kwargs)
    except AuditWriteError as exc:
        raise HTTPException(status_code=503, detail="审计服务暂时不可用，操作未生效") from exc


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
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.create", resource_type="organization", resource_id=org.id,
        input_data=payload.name.strip(),
        status="success",
    )
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
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.update", resource_type="organization", resource_id=org.id,
        input_data=payload.name.strip(),
        status="success",
    )
    db.commit()
    db.refresh(org)
    return org


@router.post("/invite-code/reset", response_model=OrgOut)
def reset_invite_code(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org_admin(db, user)
    org.invite_code = _invite_code()
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.invite_code_reset", resource_type="organization", resource_id=org.id,
        status="success",
    )
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
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.join", resource_type="organization", resource_id=org.id,
        status="success",
    )
    db.commit()
    db.refresh(org)
    return org


@router.get("/members", response_model=list[MemberOut])
def list_members(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    org = _require_org(db, user)
    role_rank = {"owner": 0, "admin": 1, "member": 2}
    members = db.query(User).filter(User.org_id == org.id).order_by(
        User.org_role.asc(), User.created_at.asc()
    ).offset((page - 1) * page_size).limit(page_size).all()
    members = sorted(members, key=lambda m: (role_rank.get(m.org_role, 9), m.created_at))

    member_ids = [m.id for m in members]
    now_utc = datetime.now(timezone.utc)
    start = now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # 批量查询：所有成员的任务数
    task_counts = dict(
        db.query(ResearchTask.user_id, func.count(ResearchTask.id))
        .filter(
            ResearchTask.user_id.in_(member_ids),
            ResearchTask.created_at >= start,
            ResearchTask.status != "failed",
        )
        .group_by(ResearchTask.user_id)
        .all()
    )

    # 批量查询：所有成员的图谱数
    graph_counts = dict(
        db.query(GraphProject.user_id, func.count(GraphProject.id))
        .filter(
            GraphProject.user_id.in_(member_ids),
            GraphProject.created_at >= start,
            GraphProject.status != "failed",
        )
        .group_by(GraphProject.user_id)
        .all()
    )

    # 批量加载所有成员的权限
    from app.db.models import UserPermission
    perms_rows = (
        db.query(UserPermission)
        .filter(UserPermission.user_id.in_(member_ids))
        .all()
    )
    perms_map: dict[str, list[str]] = {}
    for row in perms_rows:
        try:
            perms_map.setdefault(row.user_id, []).extend(json.loads(row.permissions or "[]"))
        except (ValueError, TypeError):
            pass

    result = []
    for m in members:
        out = MemberOut.model_validate(m)
        out.month_used = task_counts.get(m.id, 0) + graph_counts.get(m.id, 0)
        out.permissions = sorted(set(perms_map.get(m.id, [])))
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
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.member_update", resource_type="user", resource_id=member_id,
        input_data=json.dumps({"org_role": payload.org_role, "org_monthly_limit": payload.org_monthly_limit}),
        status="success",
    )
    db.commit()
    db.refresh(member)
    out = MemberOut.model_validate(member)
    out.month_used = member_month_usage(db, member.id)
    return out


@router.post("/members/{member_id}/permissions", response_model=MemberOut)
def set_member_permissions(
    member_id: str,
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """设置成员 RBAC 权限（企业管理员）"""
    from app.api.deps import invalidate_perm_cache

    org = _require_org_admin(db, user)
    member = db.get(User, member_id)
    if not member or member.org_id != org.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    if member.org_role == "owner":
        raise HTTPException(status_code=400, detail="不能修改企业所有者的权限")

    perms = payload.get("permissions", [])
    if not isinstance(perms, list):
        raise HTTPException(status_code=400, detail="permissions 需为字符串数组")

    # 删除旧权限，写入新权限
    db.query(UserPermission).filter(UserPermission.user_id == member_id).delete()
    if perms:
        db.add(UserPermission(user_id=member_id, permissions=json.dumps(perms, ensure_ascii=False)))
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.permission_set", resource_type="user", resource_id=member_id,
        input_data=json.dumps({"permissions": perms}),
        status="success",
    )
    db.commit()
    invalidate_perm_cache(member_id)
    out = MemberOut.model_validate(member)
    out.month_used = member_month_usage(db, member.id)
    out.permissions = sorted(perms)
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
    _required_audit(
        db,
        user_id=user.id, org_id=org.id,
        action="org.member_remove", resource_type="user", resource_id=member_id,
        status="success",
    )
    db.commit()


@router.post("/leave", status_code=204)
def leave_org(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = _require_org(db, user)
    org_id = org.id
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
    _required_audit(
        db,
        user_id=user.id, org_id=org_id,
        action="org.leave", resource_type="organization", resource_id=org_id,
        status="success",
    )
    db.commit()
