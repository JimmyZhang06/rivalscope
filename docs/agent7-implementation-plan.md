# Agent 7 竞品技术监测 — 子任务分解计划（修订版）

> 基于合同要求 + 现有架构逐行审查后的实施方案
> 编制日期：2026-08-01

---

## 架构对齐确认

在制定计划前，逐项确认了现有代码的核心模式，确保新代码无缝融入：

| 模式 | 现有实现 | 新代码遵循方式 |
|------|---------|---------------|
| 模型定义 | `_uuid()` PK + `_now()` 默认 + `String(32)` + `mapped_column` | 完全沿用 |
| 关系模式 | `back_populates` + `cascade="all, delete-orphan"` | 完全沿用 |
| 后台任务 DB | `with SessionLocal() as db:` 短生命周期会话 | 完全沿用 |
| 错误处理 | 非阻断步骤用 try/except + `logger.exception` | 完全沿用 |
| LLM 调用 | `llm.chat(system, user)` / `llm.chat_json(system, user)` | 完全沿用 |
| 通知推送 | `with SessionLocal() as db:` → 构造 Notification → commit | 完全沿用 |
| 迁移方式 | `migrate_columns()` 中 SQLite `ALTER TABLE ADD COLUMN` | 完全沿用 |
| 前端数据流 | `useEffect(() => api().then(setState), [])` + try/catch | 完全沿用 |
| 前端路由 | `App.tsx` 中 `<Route path="xxx" element={<Page />} />` | 完全沿用 |

---

## 依赖关系图

```
[Task 1: 竞品实体] ──────────────────────────────────┐
                                                     │
[Task 2: Source 改造] ───→ [Task 3: 去重/冲突/置信度] │
  (模型字段 + 快照服务)          (服务层，依赖 Task 2 字段) │
                                                     │
                                                     ▼
                                          [Task 4: 画像生成]
                                                     │
                                                     ▼
                                          [Task 5: 横向对比]

[Task 6: 变化提醒] ──→ 独立（依赖 Task 1 + Task 2）

[Task 7: RBAC] ──→ [Task 8: 审计日志] ──→ [Task 9: 预算预警+快照]

[Task 10: 容器化/文档/导出] ──→ 独立，最后做
```

关键路径：Task 1 → Task 4 → Task 5（最长链，3 个 Task 顺序执行）
其他 Sprint 内 Task 之间无依赖，可并行。

---

## 第一批：数据基础层（Sprint 1-2，约 1 周）

> 目标：建立竞品实体和来源存证——所有上层功能的数据基础

---

### Task 1：竞品实体模型

**对应合同**：A7-01 竞品名单维护

**改造内容**：

#### 后端

**1. ORM 模型** `backend/app/db/models.py` — 在 `class User(Base):` 之后、`class Order(Base):` 之前插入：

```python
class Competitor(Base):
    """竞品：结构化注册竞品信息，企业维度隔离"""

    __tablename__ = "competitors"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    # 空 org_id 表示系统级模板竞品（仅管理员创建）
    name: Mapped[str] = mapped_column(String(200))
    alias: Mapped[str] = mapped_column(String(500), default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    tech_focus: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
```

注意：
- 完全沿用 `_uuid` / `_now` 辅助函数
- 完全沿用 `String(32)` + `mapped_column` 风格
- `keywords` 存 JSON 数组字符串（同 `Tracker.competitors` 的 Text 风格）
- 不加 `relationship`——竞品通过 API 查询，不需要 ORM 级联

**2. Schema** `backend/app/schemas/competitor.py`（新建）：

```python
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class CompetitorIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    alias: str = Field("", max_length=500)
    website: str = Field("", max_length=500)
    tech_focus: str = Field("", max_length=2000)
    keywords: list[str] = Field(default_factory=list)


class CompetitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    name: str
    alias: str
    website: str
    tech_focus: str
    keywords: list[str]
    status: str
    created_at: datetime
    updated_at: datetime
```

注意：
- `ConfigDict(from_attributes=True)` 完全沿用现有 Schema 风格
- `keywords: list[str]` 需要在输出时做 JSON 反序列化——在 API 层手动处理（同 `MemberOut.month_used` 的手动填充模式）

**3. API 路由** `backend/app/api/competitors.py`（新建）：

```python
router = APIRouter(prefix="/api/competitors", tags=["competitors"])

def _is_admin(user: User) -> bool:
    return user.role == "admin"

def _require_org(db: Session, user: User) -> Organization:
    """Competitor 操作需要企业归属（系统级竞品除外）"""
    if not user.org_id:
        raise HTTPException(status_code=403, detail="请先加入企业")
    return db.get(Organization, user.org_id)

@router.get("", response_model=list[CompetitorOut])
def list_competitors(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """列出本企业竞品 + 系统级模板竞品"""
    q = db.query(Competitor).filter(
        (Competitor.org_id == user.org_id) | (Competitor.org_id == "")
    )
    return q.order_by(Competitor.created_at.desc()).all()

@router.post("", response_model=CompetitorOut, status_code=201)
def create_competitor(payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_admin(user) and not user.org_id:
        raise HTTPException(status_code=403, detail="需要企业管理员权限")
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
    c.keywords = payload.keywords  # 手动填充解析后的字段
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
    c.keywords = payload.keywords
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
```

关键设计决策：
- **权限先用 `user.role == "admin"`**——Task 7（RBAC）完成后做一次 refactor 切到新权限系统
- **软删除改为硬删除**——竞品 CRUD 操作频率低，且合同未要求审计追溯竞品的删除
- **`keywords` 存 JSON 字符串**——同现有系统的 Text + 手动序列化模式

**4. 路由注册** `backend/app/main.py`：

```python
from app.api.competitors import router as competitors_router
app.include_router(competitors_router)
```

**5. 数据库迁移** `backend/app/main.py` 的 `migrate_columns()` 中新增：

```python
"competitors": {
    "org_id": "VARCHAR(32) NOT NULL DEFAULT ''",
    "name": "VARCHAR(200) NOT NULL DEFAULT ''",
    "alias": "VARCHAR(500) NOT NULL DEFAULT ''",
    "website": "VARCHAR(500) NOT NULL DEFAULT ''",
    "tech_focus": "TEXT NOT NULL DEFAULT ''",
    "keywords": "TEXT NOT NULL DEFAULT ''",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
    "created_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
    "updated_at": "DATETIME NOT NULL DEFAULT (datetime('now'))",
},
```

#### 前端

**1. TypeScript 类型** `frontend/src/api/types.ts`：

```typescript
export interface Competitor {
  id: string
  org_id: string
  name: string
  alias: string
  website: string
  tech_focus: string
  keywords: string[]
  status: 'active' | 'paused' | 'archived'
  created_at: string
  updated_at: string
}
```

**2. API 客户端** `frontend/src/api/client.ts`：

```typescript
export function listCompetitors(): Promise<Competitor[]>
export function createCompetitor(p: Omit<Competitor, 'id' | 'created_at' | 'updated_at'>): Promise<Competitor>
export function updateCompetitor(id: string, p: Partial<Competitor>): Promise<Competitor>
export function deleteCompetitor(id: string): Promise<void>
```

**3. 页面** `frontend/src/pages/app/CompetitorsPage.tsx`：

参考现有页面的结构模式（如 `TrackersPage.tsx` 的 useCallback + useEffect + 弹窗模式）：
- 列表区：竞品卡片网格（名称、别名、官网、关键词标签、状态徽标）
- 新建/编辑弹窗：表单字段对齐 CompetitorIn schema
- 删除：`window.confirm` 确认后调用 API

**4. 路由** `frontend/src/App.tsx`：

```typescript
<Route path="competitors" element={<CompetitorsPage />} />
```

导航入口：在 `AppLayout.tsx` 的侧栏或 Trackers 页面附近加"竞品管理"链接。

**验收标准**：创建 5 家竞品，别名/官网/技术主题/关键词可结构化存储和修改，系统级竞品仅管理员可见。

---

### Task 2：Source 模型改造 + 页面快照服务

**对应合同**：A7-03 来源存证

**改造内容**：

#### 后端

**1. ORM 改造** `backend/app/db/models.py` — 在 `class Source(Base):` 的 `raw_content` 行之后新增字段：

```python
class Source(Base):
    # ... 现有字段全部保留 ...

    raw_content: Mapped[str] = mapped_column(Text, default="")

    # 新增：置信度与状态标记
    confidence: Mapped[float] = mapped_column(default=0.0)
    conflict_status: Mapped[str] = mapped_column(String(20), default="none")
    conflict_note: Mapped[str] = mapped_column(Text, default="")
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    dedup_group: Mapped[str] = mapped_column(String(32), default="")
    access_status: Mapped[str] = mapped_column(String(20), default="")
    access_error: Mapped[str] = mapped_column(Text, default="")
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

新增 `SourceArchive` 模型，在 `class Source(Base):` 之后插入：

```python
class SourceArchive(Base):
    """来源存证快照：页面 HTML + 纯文本 + 采集元数据"""

    __tablename__ = "source_archives"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(32), index=True)
    source_id: Mapped[int] = mapped_column(index=True)

    snapshot_html: Mapped[str] = mapped_column(Text, default="")
    snapshot_text: Mapped[str] = mapped_column(Text, default="")
    snapshot_format: Mapped[str] = mapped_column(String(20), default="html")

    published_at: Mapped[str] = mapped_column(String(50), default="")
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    access_status: Mapped[str] = mapped_column(String(20), default="success")
    access_error: Mapped[str] = mapped_column(Text, default="")

    raw_content_full: Mapped[str] = mapped_column(Text, default="")
```

设计决策：
- **快照与 Source 分表**——`source_archives` 独立存储，查询 Source 列表时不做 JOIN，避免性能问题
- **`raw_content_full` 不截断**——完整原文存在快照表，Source 表的 `raw_content` 保留截断（供列表展示用）
- **`collected_at` 用 `DateTime(timezone=True)`**——完全沿用现有时间戳风格

**2. 页面快照服务** `backend/app/services/snapshot.py`（新建）：

```python
import logging
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.db.database import SessionLocal
from app.db.models import SourceArchive

logger = logging.getLogger(__name__)


async def capture_snapshot(url: str, raw_content: str = "") -> dict:
    """
    抓取页面快照并创建 SourceArchive 记录。

    策略：先用 httpx 获取 HTML（超时 15 秒），再用 BeautifulSoup 提取纯文本。
    如果网络请求失败，降级为：仅保存已有的 raw_content 为全文，标记 access_status。

    返回：SourceArchive 字段字典（不含 task_id/source_id，由调用方填充）
    """
    now = datetime.now(timezone.utc)
    published_at = ""
    html = ""
    text = ""
    access_status = "success"
    access_error = ""

    if raw_content:
        text = raw_content
        html = f"<html><body><pre>{raw_content}</pre></body></html>"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            html = resp.text[:500_000]  # 限制 500KB
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            # 尝试提取发布时间
            pub_meta = (
                resp.headers.get("last-modified")
                or resp.headers.get("date", "")
            )
            if pub_meta:
                published_at = pub_meta[:50]
            access_status = "success"
    except Exception as exc:
        logger.warning("snapshot failed for %s: %s", url, exc)
        access_status = "failed"
        access_error = str(exc)[:500]
        if not text:
            text = raw_content or ""
        if not html:
            html = f"<html><body><pre>{text}</pre></body></html>"

    return {
        "snapshot_html": html,
        "snapshot_text": text,
        "snapshot_format": "html",
        "published_at": published_at,
        "collected_at": now,
        "access_status": access_status,
        "access_error": access_error,
        "raw_content_full": text,
    }
```

关键设计决策：
- **失败不影响主流程**——try/except 包裹，返回降级数据
- **超时 15 秒**——同 `push_webhook` 的超时风格
- **500KB HTML 上限**——防止巨型页面撑爆数据库
- **BeautifulSoup 纯文本提取**——第一阶段实现，后续可升级为截图

**3. 改造 `agent.py` 的 `_save_sources()`**：

```python
def _save_sources(task_id: str, results: list[dict]) -> None:
    with SessionLocal() as db:
        for r in results:
            raw_pub = str(r.get("published_date") or "")
            parsed = parse_published(raw_pub)
            published_at = parsed.strftime("%Y-%m-%d") if parsed else raw_pub[:50]

            # 原始截断内容（供列表展示）
            raw_content = str(r.get("raw_content") or "")[:RAW_CONTENT_LIMIT]

            source = Source(
                task_id=task_id,
                title=r["title"][:500],
                url=r["url"][:1000],
                snippet=r["content"][:2000],
                score=round(float(r.get("score") or 0.0), 4),
                domain=r.get("domain", "")[:255],
                tier=r.get("tier", "other"),
                published_at=published_at,
                dimension=str(r.get("dimension") or "")[:100],
                raw_content=raw_content,
                # 新增字段（Task 3 填充）
                confidence=0.0,
                conflict_status="none",
                is_duplicate=False,
                dedup_group="",
                access_status="",
                access_error="",
            )
            db.add(source)
            db.flush()  # 获取 source.id

            # 异步创建快照（不阻塞入库）
            try:
                snapshot_data = await capture_snapshot(r["url"], raw_content=str(r.get("raw_content") or ""))
                archive = SourceArchive(
                    task_id=task_id,
                    source_id=source.id,
                    **snapshot_data,
                )
                db.add(archive)
                # 回写 Source 的 access_status
                source.access_status = snapshot_data["access_status"]
                source.access_error = snapshot_data["access_error"][:500]
                source.collected_at = snapshot_data["collected_at"]
            except Exception:
                logger.exception("snapshot creation failed for source %d", source.id)
        db.commit()
```

注意：
- `db.flush()` 先获取 `source.id`，再创建关联的 `SourceArchive`
- 快照失败只记日志，不抛异常
- `raw_content` 仍保留 `[:RAW_CONTENT_LIMIT]` 截断，完整版在 `SourceArchive.raw_content_full`

**4. Schema 更新** `backend/app/schemas/research.py`：

`SourceOut` 新增字段：

```python
class SourceOut(BaseModel):
    # ... 现有字段 ...
    confidence: float = 0.0
    conflict_status: str = "none"
    conflict_note: str = ""
    is_duplicate: bool = False
```

新增 `SourceArchiveOut`：

```python
class SourceArchiveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    task_id: str
    source_id: int
    snapshot_html: str
    snapshot_text: str
    snapshot_format: str
    published_at: str
    collected_at: datetime | None
    access_status: str
    access_error: str
    raw_content_full: str
```

**5. 新增 API** `backend/app/api/research.py`：

```python
@router.get("/{task_id}/sources/{source_id}/archive", response_model=SourceArchiveOut)
def get_source_archive(task_id: str, source_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_task(task_id, user, db)
    archive = db.query(SourceArchive).filter(
        SourceArchive.task_id == task_id,
        SourceArchive.source_id == source_id,
    ).first()
    if not archive:
        raise HTTPException(status_code=404, detail="快照不存在")
    return archive
```

**6. 依赖**：`snapshot.py` 需要 `httpx` 和 `beautifulsoup4`——检查 `requirements.txt` 是否已有：

- `httpx`：已存在（`push_webhook` 使用）
- `beautifulsoup4`：需要确认，如果不存在需加入

#### 前端

**1. TypeScript 类型** `frontend/src/api/types.ts`：

```typescript
export interface SourceOut {
  // ... 所有现有字段 ...
  confidence: number
  conflict_status: string
  conflict_note: string
  is_duplicate: boolean
}

export interface SourceArchive {
  id: string
  task_id: string
  source_id: number
  snapshot_html: string
  snapshot_text: string
  snapshot_format: string
  published_at: string
  collected_at: string | null
  access_status: string
  access_error: string
  raw_content_full: string
}
```

**2. API 客户端** `frontend/src/api/client.ts`：

```typescript
export function getSourceArchive(taskId: string, sourceId: number): Promise<SourceArchive>
```

**3. TaskDetailPage.tsx 改造**（Sources Tab）：

- 每条来源显示置信度色条（绿 ≥0.7 / 黄 ≥0.4 / 红 <0.4）
- 冲突来源显示 ⚠️ 标记，hover 显示 `conflict_note`
- 去重来源显示"转载"标签
- 新增"查看存证"按钮，点击弹出 Modal 展示 `snapshot_text`（纯文本）

**验收标准**：每次调研完成后，所有来源有 `SourceArchive` 记录；来源详情页可查看快照文本；`access_status` 正确标记成功/失败。

---

### Task 3：去重、冲突检测与置信度服务

**对应合同**：A7-04 结构化处理、零容忍

**改造内容**：

#### 后端

**1. 服务文件** `backend/app/services/dedup.py`（新建）：

```python
import hashlib
import logging
import re
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# 来源层级权重
_TIER_WEIGHT = {"official": 0.9, "media": 0.7, "community": 0.4, "other": 0.2}


def estimate_confidence(source: dict) -> float:
    """
    规则评分：来源层级权重 × 新鲜度衰减。

    新鲜度衰减：≤30 天不衰减，≤180 天 ×0.85，≤365 天 ×0.6，>365 天 ×0.3，无日期 ×0.25
    """
    from app.core.timeutil import age_days_of, baseline_now, parse_published

    tier_w = _TIER_WEIGHT.get(source.get("tier", "other"), 0.2)
    pub = parse_published(source.get("published_date"))
    age = age_days_of(pub, baseline_now())
    if age < 0:
        freshness = 0.25
    elif age <= 30:
        freshness = 1.0
    elif age <= 180:
        freshness = 0.85
    elif age <= 365:
        freshness = 0.6
    else:
        freshness = 0.3
    return round(tier_w * freshness, 3)


def dedup_by_content(results: list[dict], threshold: float = 0.85) -> list[dict]:
    """
    基于 URL + 标题相似度的去重（第一阶段，纯规则，不依赖 LLM）。

    策略：
    1. URL 完全相同的直接去重（保留第一条）
    2. 域名相同 + 标题相似度 > threshold → 标记为重复
    3. 为重复项设置 dedup_group 和 is_duplicate
    """
    seen_urls: dict[str, int] = {}
    dedup_groups: dict[str, str] = {}
    group_counter = 0

    def _group_id() -> str:
        nonlocal group_counter
        group_counter += 1
        return f"g{group_counter:06d}"

    for r in results:
        url = (r.get("url") or "").strip().rstrip("/")
        title = (r.get("title") or "").strip()
        if not url:
            continue

        # URL 完全重复
        if url in seen_urls:
            r["is_duplicate"] = True
            r["dedup_group"] = seen_urls[url]
            continue

        seen_urls[url] = url

        # 域名相同 + 标题相似 → 去重组
        from urllib.parse import urlparse
        domain = urlparse(url).hostname or ""
        for other_url, other_title in [(seen_urls[k], "") for k in seen_urls]:
            other_domain = urlparse(other_url).hostname or ""
            if domain and domain == other_domain:
                sim = SequenceMatcher(None, title, other_title).ratio()
                if sim > threshold:
                    gid = dedup_groups.get(other_url, _group_id())
                    dedup_groups[other_url] = gid
                    dedup_groups[url] = gid
                    r["dedup_group"] = gid
                    break

    return results


def detect_conflicts(sources: list[dict], dimensions: list[str]) -> list[dict]:
    """
    检测同一维度内的数值/结论冲突（第一阶段：标记为 pending，人工复核）。

    策略：按 dimension 分组，组内如果存在数值差异超过阈值，标记为冲突。
    当前为保守策略：全部标记 pending，由事实复核人在前端确认。
    """
    conflicts = []
    by_dim: dict[str, list[dict]] = {}
    for s in sources:
        dim = s.get("dimension", "综合")
        by_dim.setdefault(dim, []).append(s)

    for dim, group in by_dim.items():
        if len(group) < 2:
            continue
        # 检查 URL 是否不同但 domain 相同（同源多篇可能冲突）
        urls = {s.get("url", "") for s in group}
        if len(urls) > 1:
            for s in group:
                if s.get("conflict_status") == "none":
                    s["conflict_status"] = "pending"
                    conflicts.append({
                        "dimension": dim,
                        "source_id": s.get("source_id"),
                        "note": f"维度「{dim}」存在多个来源，需人工复核一致性",
                    })
    return conflicts
```

注意：
- **纯规则实现，不依赖 LLM**——合同零容忍要求"无来源不输出确定性结论"，先用规则标记，不自动下结论
- **使用 `SequenceMatcher`**（Python stdlib，无需额外依赖）做标题相似度
- **冲突只标记 pending**——不自动判定谁对谁错，留给人工

**2. 改造 `agent.py` 的 `_search_all()`**：

在 `_save_sources()` 调用前插入去重和置信度计算：

```python
# 在 _search_all 的返回处（调用 _save_sources 之前）：
from app.services.dedup import dedup_by_content, detect_conflicts, estimate_confidence

# 1. 去重
results = dedup_by_content(results)

# 2. 置信度
for r in results:
    r["confidence"] = estimate_confidence(r)

# 3. 冲突检测（收集所有维度）
dimensions = list({q.get("dimension", "综合") for q in queries})
detect_conflicts(results, dimensions)

# 4. 综合排序（保留原有逻辑）
now = baseline_now()
for r in results:
    recency = recency_weight(parse_published(r.get("published_date")), now, RECENCY_HALF_LIFE_DAYS)
    r["combined"] = 0.6 * float(r.get("score") or 0.0) + 0.4 * recency
results.sort(key=lambda r: r.get("combined", 0.0), reverse=True)
```

**3. 改造 `_save_sources()`** 写入新增字段：

```python
source = Source(
    task_id=task_id,
    # ... 现有字段 ...
    confidence=r.get("confidence", 0.0),
    conflict_status=r.get("conflict_status", "none"),
    is_duplicate=r.get("is_duplicate", False),
    dedup_group=r.get("dedup_group", ""),
    access_status="",  # 由 Task 2 的 snapshot 服务回写
)
```

#### 前端

- `TaskDetailPage.tsx` 的 Sources Tab 中每条来源显示：
  - 置信度条（宽度 = confidence × 100%，颜色映射）
  - `conflict_status === "pending"` 时显示 ⚠️ 图标，tooltip 显示 `conflict_note`
  - `is_duplicate` 时显示"转载"标签 + 原文链接
  - `access_status` 为空时显示"快照加载中…"，失败时显示"快照获取失败"

**验收标准**：调研结果自动去重；所有来源有置信度标记；冲突来源有视觉标识；去重来源标记转载。

---

## 第二批：业务能力层（Sprint 3-4，约 1 周）

> 目标：竞品画像、横向对比、变化提醒

---

### Task 4：画像模板系统

**对应合同**：A7-05 竞品画像、固定维度模板

**改造内容**：

#### 后端

**1. ORM 模型** `backend/app/db/models.py`：

```python
class ProfileTemplate(Base):
    """画像模板：固定维度定义，冻结后不可修改"""

    __tablename__ = "profile_templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    name: Mapped[str] = mapped_column(String(200))
    dimensions: Mapped[str] = mapped_column(Text)
    # JSON: [{"key": "product_overview", "label": "产品概况",
    #         "fields": [{"key": "name", "label": "名称", "type": "text"},
    #                    {"key": "price", "label": "价格区间", "type": "text"}]}]
    version: Mapped[int] = mapped_column(default=1)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CompetitorProfile(Base):
    """竞品画像：按模板维度生成的结构化数据"""

    __tablename__ = "competitor_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    competitor_id: Mapped[str] = mapped_column(String(32), index=True)
    template_id: Mapped[str] = mapped_column(String(32), index=True)

    profile_data: Mapped[str] = mapped_column(Text)
    # JSON: {"dimension_key": {"field_key": "value", ...}, ...}
    source_refs: Mapped[str] = mapped_column(Text, default="[]")
    # JSON: [{"url": "...", "title": "...", "snippet": "..."}] — 快照副本，避免悬空引用

    status: Mapped[str] = mapped_column(String(20), default="draft")
    # draft / reviewed / frozen
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
```

关键设计决策：
- **`source_refs` 存快照副本而非 id 引用**——避免 Source 删除后悬空
- **冻结用 `frozen_at` 时间戳判断**——`frozen_at is not None` 即为冻结，不可修改
- **模板版本号递增**——冻结后创建新版本（version + 1），不改旧版本

**2. 画像生成服务** `backend/app/services/profiles.py`（新建）：

```python
import json
import logging

from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorProfile, ProfileTemplate, Source
from app.services.agent import LLMClient

logger = logging.getLogger(__name__)


async def generate_profile(llm: LLMClient, competitor_id: str, template_id: str) -> dict:
    """按模板维度生成竞品画像"""
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")

        dimensions = json.loads(template.dimensions)
        # 收集该竞品相关的来源（按置信度排序）
        sources = db.query(Source).filter(
            Source.task_id.in_(
                db.query(ResearchTask.task_id).filter(
                    ResearchTask.competitors.like(f"%{competitor.name}%"),
                    ResearchTask.status == "completed",
                )
            )
        ).order_by(Source.confidence.desc()).limit(20).all()

    # 构建 prompt
    dim_descriptions = []
    for dim in dimensions:
        fields_desc = "、".join(f"{f['label']}（{f['type']}）" for f in dim.get("fields", []))
        dim_descriptions.append(f"【{dim['label']}】字段：{fields_desc}")

    system = (
        "你是一名资深竞争情报分析师。基于给出的来源材料，为指定竞品生成结构化画像。\n"
        f"画像模板包含以下维度：\n" + "\n".join(dim_descriptions) + "\n"
        "要求：\n"
        "1. 每个维度只输出模板中定义的字段，来源不足的字段标注「信息不足」；\n"
        "2. 只依据材料中的信息，不得编造，不确定的内容明确标注；\n"
        '3. 输出 JSON：{"dimensions": {"dimension_key": {"field_key": "value", ...}}, "summary": "一句话总结"}\n'
        "4. 直接输出 JSON，不要用代码块包裹。"
    )

    source_materials = "\n".join(
        f"[{i + 1}] {s.title}\nURL: {s.url}\n内容: {s.snippet}\n置信度: {s.confidence:.2f}"
        for i, s in enumerate(sources[:15])
    )
    user = f"竞品：{competitor.name}\n别名：{competitor.alias}\n官网：{competitor.website}\n技术主题：{competitor.tech_focus}\n\n来源材料：\n{source_materials}"

    data = await llm.chat_json(system, user)
    data.setdefault("dimensions", {})
    data.setdefault("summary", "")

    # 落库
    with SessionLocal() as db:
        profile = CompetitorProfile(
            org_id=competitor.org_id,
            competitor_id=competitor_id,
            template_id=template_id,
            profile_data=json.dumps(data, ensure_ascii=False),
            source_refs=json.dumps(
                [{"url": s.url, "title": s.title, "snippet": s.snippet[:200]} for s in sources[:10]],
                ensure_ascii=False,
            ),
            status="draft",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
        profile.profile_data = data  # 手动填充解析后的 JSON
        profile.source_refs = json.loads(profile.source_refs)

    return profile
```

注意：
- 完全沿用 `with SessionLocal() as db:` 模式
- 先读后写，两次独立会话（同 `digest.py` 的模式）
- `source_refs` 存快照副本（URL + title + snippet），避免悬空引用

**3. API 路由** `backend/app/api/profiles.py`（新建）：

```
POST   /api/profiles/templates            创建模板
GET    /api/profiles/templates             列出模板
PATCH  /api/profiles/templates/{id}       更新（未冻结时）
POST   /api/profiles/templates/{id}/freeze 冻结

POST   /api/profiles/generate             生成画像（competitor_id + template_id）
GET    /api/profiles                       列出本企业画像
GET    /api/profiles/{id}                  画像详情
PATCH  /api/profiles/{id}                 更新备注（未冻结时）
POST   /api/profiles/{id}/freeze           冻结画像
```

#### 前端

**模板管理页面** `frontend/src/pages/app/ProfileTemplatesPage.tsx`：
- 模板列表（名称、版本、冻结状态）
- 维度配置编辑器（JSON 编辑器或表单化配置）
- 冻结按钮（确认对话框）

**画像页面** `frontend/src/pages/app/ProfilesPage.tsx`：
- 左侧：竞品选择器 + 模板选择器
- 右侧：画像展示（按维度分组，附来源链接）
- "生成画像"按钮 → 显示进度 → 渲染结果

**验收标准**：能创建含 5+ 维度的模板并冻结；按模板生成竞品画像；冻结后不可修改。

---

### Task 5：横向对比报告

**对应合同**：A7-06 横向对比与摘要

**改造内容**：

#### 后端

**服务** `backend/app/services/comparison.py`（新建）：

```python
import json
import logging

from app.db.database import SessionLocal
from app.db.models import CompetitorProfile, ProfileTemplate

logger = logging.getLogger(__name__)


async def generate_comparison(template_id: str, competitor_ids: list[str]) -> dict:
    """基于多份画像生成横向对比报告"""
    with SessionLocal() as db:
        template = db.get(ProfileTemplate, template_id)
        if not template or template.frozen_at is None:
            raise ValueError("模板不存在或未冻结")

        profiles = db.query(CompetitorProfile).filter(
            CompetitorProfile.id.in_(competitor_ids),
            CompetitorProfile.status == "frozen",
        ).all()

    if len(profiles) < 2:
        raise ValueError("至少需要 2 份已冻结的画像")

    dimensions = json.loads(template.dimensions)

    # 构建对比矩阵
    matrix = []
    for dim in dimensions:
        row = {"dimension": dim["label"], "values": {}}
        for p in profiles:
            data = json.loads(p.profile_data) if isinstance(p.profile_data, str) else p.profile_data
            dim_data = data.get("dimensions", {}).get(dim["key"], {})
            # 取该维度的第一个字段值作为对比值
            fields = dim.get("fields", [])
            if fields:
                row["values"][p.competitor_id] = dim_data.get(fields[0]["key"], "信息不足")
        matrix.append(row)

    return {
        "matrix": matrix,
        "source_refs": [json.loads(p.source_refs) for p in profiles],
    }
```

**API**（复用 profiles 路由）：

```python
@router.post("/compare")
def compare_profiles(payload: { template_id: str, competitor_ids: list[str] }, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    result = generate_comparison(payload.template_id, payload.competitor_ids)
    return result
```

#### 前端

**对比页面** `frontend/src/pages/app/ComparisonPage.tsx`：
- 模板选择下拉 + 竞品多选（≥2 家）
- 对比矩阵表格（行 = 维度，列 = 竞品名）
- 来源说明区

**验收标准**：选择 2-5 家已冻结画像生成对比矩阵。

---

## 第三批：安全审计层（Sprint 5，约 3-4 天）

> 目标：RBAC + 审计日志 + 预算预警

---

### Task 6：细粒度 RBAC（轻量实现）

**对应合同**：第五章 安全门槛

**改造内容**：

#### 后端

**1. ORM 模型** `backend/app/db/models.py`：

```python
class UserPermission(Base):
    """用户权限：JSON 数组存储，轻量实现"""

    __tablename__ = "user_permissions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    permissions: Mapped[str] = mapped_column(Text, default="[]")
    # JSON: ["source:register", "profile:generate", ...]
```

设计决策：
- **不用 Role/UserRole 多表关联**——现有系统简单，用一个 JSON 数组就够了
- **预设权限枚举**：
  - `competitor:read/write/freeze`
  - `source:register/approve/update/freeze`
  - `profile:generate/review/freeze`
  - `report:generate/publish`
  - `tracker:create/update/delete/run`
  - `budget:view/configure`
  - `key:view/rotate`
  - `audit:read`
  - `admin:access`
- **空权限 = 普通用户**——默认只有 `tracker:create` 和 `source:read`
- **admin 角色自动拥有全部权限**——`require_permission` 中对 `user.role == "admin"` 直接放行

**2. 权限装饰器** `backend/app/api/deps.py`：

```python
import json
from functools import wraps

from fastapi import Depends, HTTPException

_PERM_CACHE: dict[str, set[str]] = {}
_CACHE_TTL = 60  # 秒
_last_refresh: float = 0


def _load_permissions(db: Session, user_id: str) -> set[str]:
    """从数据库加载用户权限集合（带简单缓存）"""
    import time
    global _last_refresh
    now = time.time()
    if user_id in _PERM_CACHE and now - _last_refresh < _CACHE_TTL:
        return _PERM_CACHE[user_id]

    perms: set[str] = set()
    # admin 角色拥有全部权限
    user = db.get(User, user_id)
    if user and user.role == "admin":
        perms = {"*"}  # 通配符

    # 从 user_permissions 表加载
    rows = db.query(UserPermission).filter(UserPermission.user_id == user_id).all()
    for row in rows:
        perms.update(json.loads(row.permissions or "[]"))

    _PERM_CACHE[user_id] = perms
    _last_refresh = now
    return perms


def invalidate_perm_cache(user_id: str = "") -> None:
    """权限变更后调用，清除缓存"""
    global _last_refresh
    _last_refresh = 0
    if user_id:
        _PERM_CACHE.pop(user_id, None)
    else:
        _PERM_CACHE.clear()


def require_permission(*permissions: str):
    """依赖项：检查当前用户是否有任一指定权限"""
    async def _check(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        user_perms = _load_permissions(db, user.id)
        if "*" in user_perms or any(p in user_perms for p in permissions):
            return user
        raise HTTPException(status_code=403, detail=f"需要权限：{', '.join(permissions)}")
    return _check
```

注意：
- **用同步函数 `_load_permissions`**——FastAPI 的 `Depends` 可以在 sync 函数中调用 `db.query()`
- **简单内存缓存**——TTL 60 秒，权限变更后调用 `invalidate_perm_cache` 清除
- **`"*"` 通配符**——admin 角色直接放行

**3. 预设权限种子** — 在 `seed_admin()` 中给默认 admin 插入通配权限：

```python
from app.db.models import UserPermission
db.add(UserPermission(user_id=admin.id, permissions=json.dumps(["*"])))
```

**4. API 路由** `backend/app/api/permissions.py`（新建）：

```
GET    /api/me/permissions     当前用户权限列表
POST   /api/org/members/{id}/permissions  设置成员权限（企业管理员）
```

#### 前端

- `OrgPanel.tsx`：成员列表每行增加"权限"按钮 → 弹窗展示权限复选框（按分类分组）
- 前端 `useAuth` 中增加 `permissions` 状态
- 所有操作按钮按权限显隐/禁用

**验收标准**：admin 拥有全部权限；普通用户只有基础权限；权限不足时 API 返回 403。

---

### Task 7：审计日志

**对应合同**：A7-08 运行日志 + 第五章 统一日志

**改造内容**：

#### 后端

**1. ORM 模型** `backend/app/db/models.py`：

```python
class AuditLog(Base):
    """审计日志：关键操作 + 模型调用 + 来源访问"""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)

    action: Mapped[str] = mapped_column(String(50))
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_id: Mapped[str] = mapped_column(String(32), default="")

    input: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str] = mapped_column(Text, default="")

    model_name: Mapped[str] = mapped_column(String(100), default="")
    tokens_prompt: Mapped[int] = mapped_column(default=0)
    tokens_completion: Mapped[int] = mapped_column(default=0)
    cost: Mapped[float] = mapped_column(default=0.0)

    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

**2. 审计服务** `backend/app/services/audit.py`（新建）：

```python
import logging
import time
from datetime import datetime, timezone

from app.db.database import SessionLocal
from app.db.models import AuditLog

logger = logging.getLogger(__name__)


def log_audit(
    user_id: str,
    org_id: str,
    action: str,
    resource_type: str,
    resource_id: str = "",
    input_data: str = "",
    result_data: str = "",
    status: str = "success",
    error: str = "",
    model_name: str = "",
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
    cost: float = 0.0,
    ip: str = "",
    user_agent: str = "",
) -> None:
    """写入审计日志（同步调用，在 with SessionLocal 中执行）"""
    try:
        with SessionLocal() as db:
            db.add(AuditLog(
                user_id=user_id,
                org_id=org_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                input=input_data[:2000] if input_data else "",
                result=result_data[:2000] if result_data else "",
                status=status,
                error=error[:500] if error else "",
                model_name=model_name[:100],
                tokens_prompt=tokens_prompt,
                tokens_completion=tokens_completion,
                cost=cost,
                ip=ip[:64],
                user_agent=user_agent[:300],
            ))
            db.commit()
    except Exception:
        logger.exception("audit log write failed")
```

**3. LLM 调用埋点** `backend/app/services/llm.py` 改造：

在 `chat()` 和 `chat_json()` 中增加审计记录。关键：OpenAI SDK 的 `usage` 字段包含 `prompt_tokens` 和 `completion_tokens`。

```python
async def chat(self, system: str, user: str, temperature: float = 0.3) -> str:
    resp = await self.client.chat.completions.create(...)
    content = resp.choices[0].message.content or ""
    # 审计埋点
    try:
        usage = resp.usage or {}
        _log_llm_audit(system[:100], user[:100], content[:100], usage)
    except Exception:
        pass
    return content
```

**4. 来源访问记录** — 在 `snapshot.py` 的 `capture_snapshot()` 中，每次调用后写一条 `AuditLog`（`action="source.access"`）。

**5. API**（复用 admin 路由）：

```python
@router.get("/audit-logs", response_model=AdminListOut[AuditLogOut])
def list_audit_logs(
    action: str = Query(""),
    resource_type: str = Query(""),
    user_id: str = Query(""),
    start: str = Query(""),
    end: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if start:
        query = query.filter(AuditLog.created_at >= datetime.fromisoformat(start))
    if end:
        query = query.filter(AuditLog.created_at <= datetime.fromisoformat(end))
    total = query.count()
    items = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AdminListOut(items=items, total=total, page=page, page_size=page_size)
```

#### 前端

`AdminPage.tsx` 新增"审计日志"Tab：
- 表格：时间、操作人、操作类型、资源、状态、模型/token/费用
- 筛选器：操作类型下拉、资源类型下拉、用户搜索、日期范围

**验收标准**：LLM 调用记录 token 和费用；来源访问记录成功/失败；操作日志可按条件筛选。

---

### Task 8：预算预警与执行快照

**对应合同**：第五章 安全与成本控制

**改造内容**：

#### 后端

**1. 预算预警** — 改造 `backend/app/api/deps.py` 的 `check_quota_or_403`：

```python
def check_quota_or_403(db: Session, user: User) -> None:
    quota = get_quota(db, user)
    if quota["limit"] != UNLIMITED:
        ratio = quota["used"] / quota["limit"]
        if ratio >= 1.0:
            raise HTTPException(
                status_code=403,
                detail=f"{quota['plan_name']}本月 {quota['limit']} 次调研额度已用完，请升级套餐后继续使用",
            )
        if ratio >= 0.8:
            # 额度预警通知（本月内不重复推送）
            _notify_quota_warning(db, user, ratio)
```

新增 `_notify_quota_warning`（同 `_notify_quota_skip` 的模式，用 `month_start_utc` 去重）：

```python
def _notify_quota_warning(db: Session, user: User, ratio: float) -> None:
    from app.api.deps import month_start_utc
    exists = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.title == "额度预警",
        Notification.created_at >= month_start_utc(),
    ).count()
    if exists:
        return
    db.add(Notification(
        user_id=user.id,
        org_id=user.org_id,
        title="额度预警",
        body=f"本月额度已使用 {ratio:.0%}，请注意控制用量",
        link="/app/account",
    ))
```

**2. 执行快照** `backend/app/db/models.py`：

```python
class ExecutionSnapshot(Base):
    __tablename__ = "execution_snapshots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    tracker_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(String(32), index=True)

    config_hash: Mapped[str] = mapped_column(String(64))
    model_params: Mapped[str] = mapped_column(Text)
    kb_version: Mapped[str] = mapped_column(String(50), default="")
    deployment_env: Mapped[str] = mapped_column(String(100), default="")
    candidate_version: Mapped[str] = mapped_column(String(50), default="")
    build_hash: Mapped[str] = mapped_column(String(64), default="")

    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

**3. 快照生成** — 改造 `scheduler.py` 的 `_scan_once()`，在创建 ResearchTask 后生成快照：

```python
# 创建任务后，生成执行快照
task = ResearchTask(...)
db.add(task)
db.commit()
db.refresh(task)

# 生成快照
_snapshot_execution(db, task)
```

快照服务：

```python
def _snapshot_execution(db: Session, task: ResearchTask) -> None:
    import hashlib
    import subprocess

    # 配置哈希
    config_str = json.dumps({
        "competitors": task.competitors,
        "focus": task.focus,
        "time_range": task.time_range,
    }, sort_keys=True)
    config_hash = hashlib.sha256(config_str.encode()).hexdigest()[:64]

    # git commit hash（如果可用）
    try:
        build_hash = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()[:64]
    except Exception:
        build_hash = ""

    snapshot = ExecutionSnapshot(
        org_id=task.org_id,
        tracker_id=task.tracker_id or "",
        task_id=task.id,
        config_hash=config_hash,
        model_params=json.dumps({"model": get_settings().llm_model}),
        build_hash=build_hash,
        deployment_env="development",
        created_by=task.user_id,
    )
    db.add(snapshot)
    db.commit()
```

**验收标准**：额度达 80% 时推送预警通知；每次调研生成执行快照含配置哈希。

---

## 第四批：交付运维层（Sprint 6，约 3-4 天）

> 目标：容器化、文档、数据导出

---

### Task 9：容器化与文档

**改造内容**：

1. `Dockerfile`（后端 Python + 前端 Node 构建）
2. `docker-compose.yml`（后端 + 前端 + 可选 PostgreSQL）
3. `.env.example`
4. `docs/DEPLOYMENT.md`
5. `docs/BACKUP.md`
6. `docs/COST_REPORT.md`

**验收标准**：`docker-compose up` 启动全部服务。

---

### Task 10：数据导出

**改造内容**：

```python
# backend/app/api/admin.py 新增
@router.get("/export/tasks")
def export_tasks(format: str = "csv", ...):
    # CSV 或 JSON 下载

@router.get("/export/audit-logs")
def export_audit_logs(...):
    pass
```

前端 `AdminPage.tsx` 新增"导出"按钮。

---

## 实施检查清单

### Sprint 1（Task 1 + Task 2）

- [ ] `models.py`：新增 Competitor、SourceArchive、Source 字段
- [ ] `migrate_columns()`：新增 competitors 表 + Source 新字段 + source_archives 表
- [ ] `schemas/competitor.py`：新建
- [ ] `api/competitors.py`：新建路由
- [ ] `main.py`：注册 router
- [ ] `services/snapshot.py`：新建快照服务
- [ ] `services/dedup.py`：新建去重/冲突/置信度（但不接入 agent 流程）
- [ ] `agent.py` `_save_sources()`：改造（加快照创建 + Source 新字段）
- [ ] `schemas/research.py`：SourceOut 新增字段 + SourceArchiveOut
- [ ] `api/research.py`：新增 archive 端点
- [ ] 前端 types + client + CompetitorsPage + TaskDetailPage 改造
- [ ] `App.tsx`：注册路由

### Sprint 2（Task 3）

- [ ] `services/dedup.py` 接入 `agent.py` 的 `_search_all()`
- [ ] 前端 Sources Tab 显示置信度 + 冲突标记 + 快照查看

### Sprint 3（Task 4 + Task 5）

- [ ] `models.py`：ProfileTemplate + CompetitorProfile
- [ ] `schemas/profiles.py`：新建
- [ ] `services/profiles.py`：画像生成
- [ ] `services/comparison.py`：横向对比
- [ ] `api/profiles.py`：路由
- [ ] `main.py`：注册 router
- [ ] 前端 ProfileTemplatesPage + ProfilesPage + ComparisonPage

### Sprint 4（Task 6 + Task 7 + Task 8）

- [ ] `models.py`：UserPermission + AuditLog + ExecutionSnapshot
- [ ] `api/deps.py`：`require_permission` + `_load_permissions`
- [ ] `services/audit.py`：审计日志服务
- [ ] `services/llm.py`：LLM 调用审计埋点
- [ ] `services/snapshot.py`：来源访问审计
- [ ] `api/permissions.py`：权限管理路由
- [ ] `deps.py` `check_quota_or_403`：80% 预警
- [ ] `scheduler.py`：执行快照生成
- [ ] 前端 OrgPanel 权限管理 + AdminPage 审计日志 Tab

### Sprint 5（Task 9 + Task 10）

- [ ] Dockerfile + docker-compose.yml
- [ ] 文档
- [ ] 数据导出 API

---

## 验收对照表

| 合同交付物 | 对应 Task | 验收标准 |
|-----------|----------|---------|
| A7-01 竞品名单维护 | Task 1 | 5 家竞品 CRUD，含别名/官网/关键词 |
| A7-02 批准来源配置 | Task 2 | 10 个来源可注册/审批/配置状态 |
| A7-03 来源存证 | Task 2 + Task 3 | 10/10 条快照，含 URL/快照/采集时间/原文 |
| A7-04 监测记录 | Task 3 + agent | 结构化提取 ≥9/10，含置信度/冲突标记 |
| A7-05 竞品画像 | Task 4 | 5/5 份画像，按模板维度，附来源 |
| A7-06 横向对比 | Task 5 | 固定维度对比表 + 摘要 |
| A7-07 变化提醒 | Task 3 + Tracker 改造 | 变化检测 + 通知推送 |
| A7-08 运行日志 | Task 7 | 全量操作日志 + LLM 调用记录 |
| 共用平台交付 | Task 9 | Docker + 文档 + 导出 |
