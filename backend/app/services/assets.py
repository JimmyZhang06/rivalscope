"""现有情报资产的统一只读查询层。

本切片刻意不引入新表或双写：四类既有领域模型仍是事实来源，统一对象只是
一个可分页、可筛选的 SQL UNION 投影。
"""

from dataclasses import dataclass

from sqlalchemy import Select, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from app.core.tenant_scope import (
    TENANT_OR_OWNER,
    TENANT_OR_OWNER_WITH_LEGACY,
    TenantScope,
)
from app.db.models import (
    Competitor,
    CompetitorProfile,
    GraphProject,
    ProfileTemplate,
    ResearchTask,
    User,
)
from app.schemas.assets import IntelligenceObjectOut, IntelligenceObjectType


OBJECT_TYPES: tuple[IntelligenceObjectType, ...] = (
    "competitor",
    "profile",
    "research_task",
    "graph_project",
)


@dataclass(frozen=True)
class IntelligenceObjectPage:
    items: list[IntelligenceObjectOut]
    total: int
    type_counts: dict[IntelligenceObjectType, int]


def _projection(
    object_type: IntelligenceObjectType,
    source_id,
    title,
    summary,
    status,
    org_id,
    owner_id,
    created_at,
    updated_at,
    attr1_key="",
    attr1_value="",
    attr2_key="",
    attr2_value="",
    attr3_key="",
    attr3_value="",
) -> Select:
    """让所有领域 SELECT 具有完全相同的列契约。"""
    return select(
        literal(object_type).label("type"),
        source_id.label("source_id"),
        title.label("title"),
        func.coalesce(summary, "").label("summary"),
        status.label("status"),
        func.coalesce(org_id, "").label("org_id"),
        func.coalesce(owner_id, "").label("owner_id"),
        created_at.label("created_at"),
        updated_at.label("updated_at"),
        literal(attr1_key).label("attr1_key"),
        func.coalesce(attr1_value, "").label("attr1_value"),
        literal(attr2_key).label("attr2_key"),
        func.coalesce(attr2_value, "").label("attr2_value"),
        literal(attr3_key).label("attr3_key"),
        func.coalesce(attr3_value, "").label("attr3_value"),
    )


def _base_union(user: User):
    scope = TenantScope(user)
    competitors = _projection(
        "competitor",
        Competitor.id,
        Competitor.name,
        Competitor.tech_focus,
        Competitor.status,
        Competitor.org_id,
        Competitor.user_id,
        Competitor.created_at,
        Competitor.updated_at,
        "website",
        Competitor.website,
        "alias",
        Competitor.alias,
        "crawl_status",
        Competitor.crawl_status,
    ).where(scope.visible_clause(Competitor, TENANT_OR_OWNER_WITH_LEGACY))

    profiles = _projection(
        "profile",
        CompetitorProfile.id,
        func.coalesce(Competitor.name, literal("竞品画像")),
        func.coalesce(ProfileTemplate.name, literal("")),
        CompetitorProfile.status,
        CompetitorProfile.org_id,
        CompetitorProfile.user_id,
        CompetitorProfile.created_at,
        CompetitorProfile.updated_at,
        "competitor_id",
        CompetitorProfile.competitor_id,
        "template_id",
        CompetitorProfile.template_id,
        "generation_source",
        CompetitorProfile.generation_source,
    ).select_from(CompetitorProfile).outerjoin(
        Competitor, Competitor.id == CompetitorProfile.competitor_id
    ).outerjoin(
        ProfileTemplate, ProfileTemplate.id == CompetitorProfile.template_id
    ).where(scope.visible_clause(CompetitorProfile, TENANT_OR_OWNER_WITH_LEGACY))

    research = _projection(
        "research_task",
        ResearchTask.id,
        ResearchTask.product_name,
        ResearchTask.focus,
        ResearchTask.status,
        ResearchTask.org_id,
        ResearchTask.user_id,
        ResearchTask.created_at,
        ResearchTask.updated_at,
        "competitors",
        ResearchTask.competitors,
        "time_range",
        ResearchTask.time_range,
        "tracker_id",
        ResearchTask.tracker_id,
    ).where(scope.visible_clause(ResearchTask, TENANT_OR_OWNER))

    graphs = _projection(
        "graph_project",
        GraphProject.id,
        GraphProject.root_name,
        GraphProject.industry,
        GraphProject.status,
        GraphProject.org_id,
        GraphProject.user_id,
        GraphProject.created_at,
        GraphProject.updated_at,
        "industry",
        GraphProject.industry,
        "time_range",
        GraphProject.time_range,
    ).where(scope.visible_clause(GraphProject, TENANT_OR_OWNER))

    return union_all(competitors, profiles, research, graphs).subquery("intelligence_objects")


def _detail_path(object_type: str, source_id: str) -> str:
    return {
        "competitor": "/app/competitors",
        "profile": f"/app/profiles/{source_id}",
        "research_task": f"/app/tasks/{source_id}",
        "graph_project": f"/app/graph/{source_id}",
    }[object_type]


def list_intelligence_objects(
    db: Session,
    user: User,
    *,
    page: int = 1,
    page_size: int = 20,
    types: list[IntelligenceObjectType] | None = None,
    query: str = "",
    status: str = "",
) -> IntelligenceObjectPage:
    unified = _base_union(user)
    filtered = select(unified)

    needle = query.strip().lower()
    if needle:
        pattern = f"%{needle}%"
        filtered = filtered.where(or_(
            func.lower(unified.c.title).like(pattern),
            func.lower(unified.c.summary).like(pattern),
        ))
    if status:
        filtered = filtered.where(unified.c.status == status)

    # Facets intentionally precede the type filter, so the UI can show all matching
    # category counts while one category is selected.
    facet_query = filtered.subquery("filtered_intelligence_objects")
    facet_rows = db.execute(
        select(facet_query.c.type, func.count()).group_by(facet_query.c.type)
    ).all()
    type_counts: dict[IntelligenceObjectType, int] = {kind: 0 for kind in OBJECT_TYPES}
    type_counts.update({row.type: row[1] for row in facet_rows})

    if types:
        filtered = filtered.where(unified.c.type.in_(types))

    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    rows = db.execute(
        filtered.order_by(unified.c.updated_at.desc(), unified.c.type, unified.c.source_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings().all()

    items: list[IntelligenceObjectOut] = []
    for row in rows:
        attributes = {
            row[key_col]: row[value_col]
            for key_col, value_col in (
                ("attr1_key", "attr1_value"),
                ("attr2_key", "attr2_value"),
                ("attr3_key", "attr3_value"),
            )
            if row[key_col] and row[value_col]
        }
        items.append(IntelligenceObjectOut(
            id=f"{row['type']}:{row['source_id']}",
            type=row["type"],
            source_id=row["source_id"],
            title=row["title"],
            summary=row["summary"],
            status=row["status"],
            org_id=row["org_id"],
            owner_id=row["owner_id"],
            detail_path=_detail_path(row["type"], row["source_id"]),
            attributes=attributes,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        ))
    return IntelligenceObjectPage(items=items, total=total, type_counts=type_counts)
