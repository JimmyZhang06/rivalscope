# 竞品调研 Agent — 优化执行清单

> 版本：v6.0.0 | 日期：2026-08-03 | 分支: agent-v6
> 基于 commit `9a84933` 逐文件核验后生成

---

## 已完成项（commit `9a84933` 中已落地）

| 项 | 说明 |
|---|---|
| P0-1 | `migrate_columns()` + `seed_admin()` 移入 `lifespan` |
| P0-2 | scheduler git hash 缓存（模块级 `_GIT_HASH`） |
| P0-3 | 连接池调优（SQLite `StaticPool`，非 SQLite `pool_pre_ping` + `pool_recycle`） |
| P1-1 | `trackers.py` `_with_extras_batch()` 用 `row_number()` 窗口函数批量查询 |
| P1-2 | `org.py` `list_members` 用 3 个 GROUP BY 批量查询 |
| P1-3 | `admin.py` `list_orgs` 用 3 个 GROUP BY 批量查询 |
| P1-4 | `admin.py` `audit_stats` 全改 SQL 聚合 |
| — | `admin.py` `stats` 端点 SQL 聚合替代 Python 全表扫描 |
| P2-1 | 全部页面 `React.lazy()` 代码分割 |
| P2-2 | vite `manualChunks` 7 个 vendor 拆分 |
| P2-3 | TrackersPage + TasksPage 条件轮询（`hasRunning` gated） |
| P3 (部分) | `list_research`、`list_trackers`、`list_runs`、`list_members`、`list_users`、`list_orgs`、`list_audit_logs` 全加分页 |
| P4-3 | 权限缓存改为 per-user TTL |
| — | SSE 事件流单 session + `seq > sent` |
| — | 邮件发送 `asyncio.to_thread()` |
| — | 审计日志数据库级触发器（`audit_triggers.py`） |
| — | 内存令牌桶限流（`rate_limit.py`） |
| — | 异常行为检测（`anomaly.py`） |
| — | JWT_SECRET 强度警告 + 列顺序自动修复 |

---

## 待执行项（按优先级排序）

### 第 1 优先级：修复正确性 bug（必须做）

#### T1-1：`_with_extras_batch` 的 `run_count` 统计错误

- **位置**：`backend/app/api/trackers.py:111`
- **问题**：`row_number() <= 10` 限制了加载的任务条数，`run_count = len(tasks)` 只统计最近 10 条，不是总任务数。超过 10 期的 tracker 会显示错误的运行次数
- **影响**：前端"已运行 X 期"数字不准确
- **改动量**：约 10 行

```python
# 在 _with_extras_batch 中，现有 row_number 子查询之后添加：

# 批量：每个 tracker 的总任务数（不受 row_number 限制）
total_counts = dict(
    db.query(ResearchTask.tracker_id, func.count(ResearchTask.id))
    .filter(ResearchTask.tracker_id.in_(tracker_ids))
    .group_by(ResearchTask.tracker_id)
    .all()
)

# 然后替换第 111 行：
out.run_count = total_counts.get(tracker.id, 0)
```

**验证**：创建一个有 15 条历史任务的 tracker，确认列表页 `run_count` 显示 15 而非 10。

---

### 第 2 优先级：消除事件循环阻塞（影响并发性能）

#### T2-1：`agent.py` 同步 DB 块改 `asyncio.to_thread()`

- **位置**：`backend/app/services/agent.py`
- **问题**：6 处 `with SessionLocal()` 在 `async def` 函数中同步阻塞事件循环
- **影响**：并发 3 个 research 任务会串行化（总耗时 ~120s 而非 ~40s）
- **改动量**：约 30 行

| 函数 | 行号 | 操作类型 | 改动方式 |
|------|------|---------|---------|
| `_update_status` | 80 | 单条 UPDATE | 整函数 `await asyncio.to_thread(_update_status, ...)` |
| `_add_step` | 90 | 单条 INSERT + COUNT | 整函数 `await asyncio.to_thread(_add_step, ...)` |
| `_save_sources` | 97 | 批量 INSERT + await | 拆分：DB 写 `to_thread`，`save_archive` 保留在 async 块 |
| `_save_insights` | 131 | 单条 UPDATE | 整函数 `await asyncio.to_thread(_save_insights, ...)` |
| `_merge_report_data` | 140 | 读 + 合并 + UPDATE | 整函数 `await asyncio.to_thread(_merge_report_data, ...)` |
| `_save_report` | 156 | 单条 UPDATE | 整函数 `await asyncio.to_thread(_save_report, ...)` |

**核心改动 — `_save_sources` 拆分示例**：

```python
async def _save_sources(task_id: str, results: list[dict]) -> None:
    # 同步 DB 操作放到线程池
    source_ids = await asyncio.to_thread(_do_save_sources, task_id, results)
    # async I/O 在事件循环中正常执行
    for source_id, r in zip(source_ids, results):
        from app.services.snapshot import save_archive
        await save_archive(task_id, source_id, r["url"], raw_content=str(r.get("raw_content") or ""))

def _do_save_sources(task_id: str, results: list[dict]) -> list[int]:
    """同步 DB 块：创建 Source 记录并 flush 获取 id"""
    source_ids = []
    with SessionLocal() as db:
        for r in results:
            # ... 构造 Source 对象 ...
            db.add(source)
            db.flush()
            source_ids.append(source.id)
        db.commit()
    return source_ids
```

其余 5 个函数直接调用：

```python
# 调用处从 _update_status(task_id, "planning") 改为：
await asyncio.to_thread(_update_status, task_id, "planning")
```

**验证**：同时发起 3 个 research 任务，观察 SSE 日志是否并行输出（而非串行等待）。

---

#### T2-2：`graph_agent.py` 同步 DB 块改 `asyncio.to_thread()`

- **位置**：`backend/app/services/graph_agent.py`
- **问题**：3 处 `with SessionLocal()` 在 `async def` 函数中阻塞
- **改动量**：约 15 行

| 函数 | 行号 | 操作类型 |
|------|------|---------|
| `_set_status` | 49 | 单条 UPDATE |
| `_save` | 185 | 批量 INSERT |
| `_save_report` | 261 | 单条 UPDATE |

**改动方式**：与 T2-1 相同，用 `await asyncio.to_thread()` 包裹调用处。

```python
# build_graph 中的调用改为：
await asyncio.to_thread(_set_status, project_id, "building")
# ...
n_ent, n_rel = await asyncio.to_thread(_save, project_id, project.root_name, data, results)
# ...
await asyncio.to_thread(_save_report, project_id, report)
```

**验证**：创建 2 个图谱构建任务，确认不互相阻塞。

---

#### T2-3：`llm.py` 审计日志改 fire-and-forget

- **位置**：`backend/app/services/llm.py:63-67`
- **问题**：每次 LLM 调用后同步执行 `_log_llm_audit()` → `log_audit()`，内含 SessionLocal + commit + `check_anomalies()`，增加 ~2~10ms/次
- **改动量**：约 5 行

```python
# 修改前
try:
    usage = resp.usage or {}
    _log_llm_audit(self.model, ..., usage, ...)
except Exception:
    pass

# 修改后
try:
    usage = resp.usage or {}
    asyncio.create_task(asyncio.to_thread(
        _log_llm_audit, self.model, ..., usage, ...
    ))
except Exception:
    pass
```

**注意**：`asyncio.to_thread` 返回 coroutine，需要用 `asyncio.create_task` 包装为 fire-and-forget。如果事件循环关闭时任务未完成，审计日志会丢失——这是可接受的（非关键路径）。

**验证**：发起一次 research，确认审计日志仍正常写入（检查 `/api/admin/audit-logs`）。

---

### 第 3 优先级：数据库索引（减少查询时间）

#### T3-1：在 `models.py` 中添加 6 个复合索引

- **位置**：`backend/app/db/models.py`
- **问题**：当前只有 `AuditLog` 有 2 个索引，其余表无复合索引
- **改动量**：约 30 行

```python
# User 模型（line 46 附近）
__table_args__ = (
    Index("idx_users_org_role", "org_id", "role"),
)

# ResearchTask 模型（line 175 附近）
__table_args__ = (
    Index("idx_research_status_created", "status", "created_at"),
    Index("idx_research_tracker_status", "tracker_id", "status", "created_at"),
)

# AuditLog 模型（line 451 附近，扩展已有 __table_args__）
__table_args__ = (
    Index("idx_audit_action_resource", "action", "resource_type"),
    Index("idx_audit_created_at", "created_at"),
    Index("idx_audit_user_created", "user_id", "created_at"),
    Index("idx_audit_org_created", "org_id", "created_at"),
)

# Notification 模型（line 385 附近）
__table_args__ = (
    Index("idx_notif_user_created", "user_id", "created_at"),
)
```

**执行方式**：修改 `models.py` 后，SQLite 会在下次 `create_all` 时自动创建索引。对于已有数据库，需要执行 `CREATE INDEX IF NOT EXISTS`：

```bash
cd backend && python -c "
from app.db.database import engine
from sqlalchemy import text
with engine.connect() as conn:
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_users_org_role ON users (org_id, role)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_research_status_created ON research_tasks (status, created_at)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_research_tracker_status ON research_tasks (tracker_id, status, created_at)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs (user_id, created_at)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs (org_id, created_at)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications (user_id, created_at)'))
    conn.commit()
    print('All indexes created')
"
```

**验证**：`EXPLAIN QUERY PLAN SELECT ...` 确认查询使用新索引。

---

### 第 4 优先级：接口分页（防止大表全量返回）

#### T4-1：为剩余 4 个无分页端点加分页

| 端点 | 文件 | 修改 |
|------|------|------|
| `GET /api/competitors` | `competitors.py:24-30` | 加 `page`/`page_size` 参数 |
| `GET /api/graph` | `graph.py:63-71` | 加 `page`/`page_size` 参数 |
| `GET /api/profiles` | `profiles.py:150-155` | 加 `page`/`page_size` 参数 |
| `GET /api/profiles/templates` | `profiles.py:34-39` | 加 `page`/`page_size` 参数 |

**统一模板**：

```python
@router.get("", response_model=list[SomeOut])
def list_something(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    q = db.query(Model).filter(...)
    return q.order_by(Model.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
```

**前端配合**：在 `client.ts` 中为 `listCompetitors`、`listGraphs`、`listProfiles`、`listProfileTemplates` 添加可选的 `page`/`page_size` 参数（保持默认值向后兼容）。

**验证**：每条接口确认 `?page=1&page_size=2` 只返回 2 条数据。

---

### 第 5 优先级：调度器配额查询优化（低影响）

#### T5-1：`_scan_once` 批量预取配额状态

- **位置**：`backend/app/services/scheduler.py:131-160`
- **问题**：每个到期 tracker 调用 `check_quota_or_403`，内含 4 条 COUNT 查询。5 个 tracker = 20 条 COUNT
- **方案**：在 `_scan_once` 中先一次性收集所有 creator_id，批量查 `month_usage` + `member_month_usage`，再逐个判断

```python
def _scan_once() -> None:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        due = db.query(Tracker).filter(...).all()
        if not due:
            return

        # 批量预取所有 creator 的配额
        creator_ids = list({t.creator_id for t in due})
        creators = {u.id: u for u in db.query(User).filter(User.id.in_(creator_ids)).all()}

        # 批量查本月用量（GROUP BY）
        start = month_start_utc()
        org_task_counts = dict(
            db.query(ResearchTask.org_id, func.count(ResearchTask.id))
            .filter(ResearchTask.org_id.in_([c.org_id for c in creators.values() if c.org_id]),
                    ResearchTask.created_at >= start, ResearchTask.status != "failed")
            .group_by(ResearchTask.org_id).all()
        )
        # ... 类似查 graphs

        for tracker in due:
            creator = creators.get(tracker.creator_id)
            if not creator:
                continue
            # 用预取的数据判断配额，不再调 check_quota_or_403
            ...
```

**改动量**：约 25 行
**预期收益**：5 个 tracker 从 20 条 COUNT → 2 条 GROUP BY

---

### 第 6 优先级：架构升级（长期）

#### T6-1：迁移到 `AsyncSession`（可选，收益最大但改动量最大）

- **问题**：当前所有 DB 操作都是同步 ORM，在 async 函数中用 `asyncio.to_thread()` 只是权宜之计
- **方案**：迁移到 `AsyncSession` + `aiosqlite`（SQLite）或 `asyncpg`（PostgreSQL）
- **改动范围**：
  - `database.py`：添加 `async_engine` + `AsyncSessionLocal`
  - `agent.py`、`graph_agent.py`：全部 `with SessionLocal()` 改为 `async with AsyncSessionLocal()`
  - `scheduler.py`、`audit.py`、`deps.py`：同步函数保持现状（FastAPI 依赖注入中同步函数正常）
- **改动量**：约 150 行
- **风险**：高（需全面测试，SQLAlchemy 2.x async 有一些限制）

**不建议现在做**。当前 `asyncio.to_thread()` 方案已经能解决 90% 的并发问题，迁移成本高且收益递减。

---

## 执行优先级总览

```
立即执行（正确性 bug）:
  🔴 T1-1  _with_extras_batch run_count 修复     → 5 行改动，前端显示错误

本周执行（性能提升）:
  🟠 T2-1  agent.py 同步 DB 改 to_thread          → 30 行，并发 research 不再串行
  🟠 T2-2  graph_agent.py 同步 DB 改 to_thread    → 15 行
  🟠 T2-3  llm.py 审计日志 fire-and-forget        → 5 行
  🟠 T3-1  6 个复合索引                           → 30 行 + 迁移脚本

下周执行（体验优化）:
  🟡 T4-1  4 个无分页端点加分页                   → 20 行 + 前端参数

后续可选:
  ⚪ T5-1  _scan_once 配额查询优化                → 25 行，低影响
  ⚪ T6-1  AsyncSession 迁移                     → 150 行，架构升级
```

---

## 不做的事项

| 原方案中的项 | 原因 |
|---|---|
| P2-4 Zustand store 串行改并行 | 已完成（`Promise.all` + persist 缓存） |
| P0-1/2/3、P1-1/2/3/4 | 已完成 |
| P4-3 权限缓存 per-user TTL | 已完成 |
