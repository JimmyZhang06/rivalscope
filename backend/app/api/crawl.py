"""竞品爬取相关 API"""

import asyncio
import logging

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import ResourceNotFound, check_access, get_current_user
from app.db.database import get_db
from app.db.models import Competitor, CompetitorPage, CrawlTask, User
from app.schemas.crawl import CrawlStartIn, CrawlStartOut, CrawlStatusOut, CompetitorPageOut
from app.services.crawler import crawl_competitor_site
from app.services.audit import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/competitors", tags=["crawl"])


# 正在执行的爬取任务，防重入
_running_crawls: set[str] = set()


def _check_competitor_access(competitor: Competitor | None, user: User) -> Competitor:
    if not competitor:
        raise HTTPException(status_code=404, detail="竞品不存在")
    check_access(
        competitor.org_id,
        competitor.user_id,
        user,
        system_access="owner_or_admin",
        cross_org_forbidden_as=ResourceNotFound,
        resource_name="竞品",
    )
    return competitor


# ---------- 启动爬取 ----------

@router.post("/{cid}/crawl", response_model=CrawlStartOut, status_code=201)
async def start_crawl(
    cid: str,
    payload: CrawlStartIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """触发竞品官网爬取（后台异步执行）"""
    competitor = _check_competitor_access(db.get(Competitor, cid), user)
    if not competitor.website:
        raise HTTPException(status_code=400, detail="竞品未设置官网地址")
    if competitor.crawl_status == "running":
        raise HTTPException(status_code=409, detail="该竞品正在爬取中，请稍后再试")

    # 创建任务记录
    task = CrawlTask(
        competitor_id=cid,
        org_id=competitor.org_id,
        user_id=user.id,
        status="pending",
        crawl_config=_make_config(payload.max_pages),
    )
    db.add(task)
    # 标记竞品状态
    competitor.crawl_status = "running"
    competitor.crawl_error = ""
    db.commit()
    db.refresh(task)
    task_id = task.id

    _running_crawls.add(cid)

    # 在后台运行爬取
    loop = asyncio.get_running_loop()
    loop.create_task(_run_crawl(cid, task_id, payload.max_pages, user.id))
    try:
        log_audit(
            user_id=user.id, org_id=user.org_id or "",
            action="crawl.run", resource_type="crawl", resource_id=task.id,
            input_data=json.dumps({"competitor_id": cid, "max_pages": payload.max_pages}),
            status="success",
        )
    except Exception:
        pass
    return CrawlStartOut(task_id=task_id, competitor_id=cid, status="running")


async def _run_crawl(competitor_id: str, task_id: str, max_pages: int, user_id: str) -> None:
    """后台爬取任务"""
    try:
        await crawl_competitor_site(competitor_id, max_pages=max_pages, user_id=user_id, task_id=task_id)
    except Exception as exc:
        logger.exception("background crawl task %s failed", task_id)
    finally:
        _running_crawls.discard(competitor_id)


# ---------- 查询爬取状态 ----------

@router.get("/{cid}/crawl/status", response_model=CrawlStatusOut)
def get_crawl_status(
    cid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取竞品最近一次爬取任务的状态"""
    competitor = _check_competitor_access(db.get(Competitor, cid), user)

    task = (
        db.query(CrawlTask)
        .filter(CrawlTask.competitor_id == cid)
        .order_by(CrawlTask.created_at.desc())
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="暂无爬取记录")
    return task


# ---------- 页面列表 ----------

@router.get("/{cid}/pages", response_model=list[CompetitorPageOut])
def list_crawl_pages(
    cid: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取竞品已爬取的页面列表"""
    competitor = _check_competitor_access(db.get(Competitor, cid), user)

    pages = (
        db.query(CompetitorPage)
        .filter(CompetitorPage.competitor_id == cid)
        .order_by(CompetitorPage.crawled_at.desc().nullslast(), CompetitorPage.discovered_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return pages


# ---------- 辅助 ----------

def _make_config(max_pages: int) -> str:
    return json.dumps({"max_pages": max_pages, "discover": True, "heuristics": True})
