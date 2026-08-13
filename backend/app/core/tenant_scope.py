"""Central tenant and resource-visibility policy.

An empty ``org_id`` represents either a personal resource (when it has an
owner) or a legacy/system resource (when it does not).  Callers must select a
policy explicitly; being an administrator does not implicitly widen a query.
"""

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import and_, false, or_, true
from sqlalchemy.orm import Query, Session


LegacyAccess = Literal["none", "personal", "admin", "personal_or_admin", "authenticated"]
PersonalAccess = Literal["owner", "authenticated", "none"]


class AccessDenied(HTTPException):
    """A resource exists, but the actor may not access it."""

    def __init__(self, detail: str):
        super().__init__(status_code=403, detail=detail)


class ResourceNotFound(AccessDenied):
    """Hide whether an inaccessible resource exists."""

    def __init__(self, detail: str = "资源不存在"):
        super().__init__(detail)
        self.status_code = 404


@dataclass(frozen=True)
class ResourceVisibility:
    """Visibility rules for a resource type or endpoint.

    ``admin_cross_tenant`` is deliberately opt-in.  It covers tenant and
    personal resources, while ``legacy_access`` separately controls ownerless
    records kept for backwards compatibility.
    """

    tenant_shared: bool = True
    personal_access: PersonalAccess = "owner"
    personal_while_in_tenant: bool = False
    owner_across_tenants: bool = False
    personal_owner_across_tenants: bool = False
    personal_ownerless_across_tenants: bool = False
    admin_personal_while_in_tenant: bool = False
    legacy_access: LegacyAccess = "none"
    admin_cross_tenant: bool = False


# Existing aggregate/list semantics: own personal records remain available
# after joining an organization, and organization records are shared.
TENANT_OR_OWNER = ResourceVisibility(owner_across_tenants=True)

# Competitors and profiles historically expose ownerless records to personal
# users and admins, but not to ordinary organization members.
TENANT_OR_OWNER_WITH_LEGACY = ResourceVisibility(
    legacy_access="personal_or_admin",
    personal_owner_across_tenants=True,
    personal_ownerless_across_tenants=True,
    admin_personal_while_in_tenant=True,
)


class TenantScope:
    """Build SQL filters and enforce instance access from one policy source."""

    def __init__(self, actor):
        self.actor = actor
        self.user_id = actor.id
        self.org_id = actor.org_id or ""
        self.is_admin = actor.role == "admin"

    def _legacy_allowed(self, access: LegacyAccess) -> bool:
        if access == "authenticated":
            return True
        if access == "admin":
            return self.is_admin
        if access == "personal":
            return not self.org_id
        if access == "personal_or_admin":
            return not self.org_id or self.is_admin
        return False

    def visible_clause(self, model, policy: ResourceVisibility):
        """Return the SQL predicate for resources visible to this actor."""

        if self.is_admin and policy.admin_cross_tenant:
            return true()

        org_col = model.org_id
        owner_col = model.user_id
        conditions = []

        if policy.tenant_shared and self.org_id:
            conditions.append(org_col == self.org_id)

        if policy.owner_across_tenants:
            conditions.append(owner_col == self.user_id)
        elif not self.org_id and policy.personal_owner_across_tenants:
            conditions.append(owner_col == self.user_id)
        elif policy.personal_access != "none":
            personal_actor_allowed = not self.org_id or policy.personal_while_in_tenant
            if personal_actor_allowed:
                if policy.personal_access == "authenticated":
                    conditions.append(and_(org_col == "", owner_col != ""))
                else:
                    conditions.append(and_(org_col == "", owner_col == self.user_id))

        if self.is_admin and self.org_id and policy.admin_personal_while_in_tenant:
            conditions.append(and_(org_col == "", owner_col != ""))

        if self._legacy_allowed(policy.legacy_access):
            conditions.append(and_(org_col == "", owner_col == ""))
        if not self.org_id and policy.personal_ownerless_across_tenants:
            conditions.append(owner_col == "")

        return or_(*conditions) if conditions else false()

    def filter(self, query: Query, model, policy: ResourceVisibility) -> Query:
        return query.filter(self.visible_clause(model, policy))

    def can_access(
        self,
        resource_org_id: str,
        resource_user_id: str,
        policy: ResourceVisibility,
    ) -> bool:
        if self.is_admin and policy.admin_cross_tenant:
            return True

        org_id = resource_org_id or ""
        owner_id = resource_user_id or ""
        if policy.owner_across_tenants and owner_id == self.user_id:
            return True
        if not self.org_id and policy.personal_owner_across_tenants and owner_id == self.user_id:
            return True
        if not self.org_id and policy.personal_ownerless_across_tenants and not owner_id:
            return True
        if (
            self.is_admin
            and self.org_id
            and not org_id
            and owner_id
            and policy.admin_personal_while_in_tenant
        ):
            return True
        if org_id:
            return bool(policy.tenant_shared and self.org_id and org_id == self.org_id)
        if not owner_id:
            return self._legacy_allowed(policy.legacy_access)
        if policy.personal_access == "authenticated":
            return not self.org_id or policy.personal_while_in_tenant
        return bool(
            policy.personal_access == "owner"
            and owner_id == self.user_id
            and (not self.org_id or policy.personal_while_in_tenant)
        )

    def require(
        self,
        resource,
        policy: ResourceVisibility,
        *,
        denied_as: type[AccessDenied] = AccessDenied,
        resource_name: str = "资源",
    ):
        if resource is None:
            raise ResourceNotFound(f"{resource_name}不存在")
        if not self.can_access(resource.org_id, resource.user_id, policy):
            raise denied_as(f"无权访问该{resource_name}")
        return resource

    def get(
        self,
        db: Session,
        model,
        resource_id,
        policy: ResourceVisibility,
        *,
        resource_name: str = "资源",
    ):
        """Load only a visible row, preventing ID-based existence disclosure."""

        resource = (
            db.query(model)
            .filter(model.id == resource_id, self.visible_clause(model, policy))
            .first()
        )
        if resource is None:
            raise ResourceNotFound(f"{resource_name}不存在")
        return resource
