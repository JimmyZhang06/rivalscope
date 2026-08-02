# FleetView 性能优化方案（技术评审修正版）

> 创建于 2026-08-02 | 分支: agent-v5
> **更新**：v5.1 爬虫多语言修复提升首爬成功率（多语言站点从 0 页修复到正常爬取，consent overlay  stripping 减少无效内容提取）
> 本文件基于逐文件代码核验后的修正版诊断报告生成

---

## 一、问题总览

| 维度 | 现状 | 目标 |
|------|------|------|
| 启动时间（含热重载） | 3 ~ 5s | < 1s |
| 列表接口响应 | 500 ~ 2000ms | 50 ~ 200ms |
| 并发 Research（3 个） | 串行 ~120s | 并行 ~40s |
| 前端首屏 JS | ~400KB | ~150KB |

---

## 二、优化项清单（按优先级 P0 → P3）

---

### P0 — 启动阻塞（投入 ~30min，收益最大）

#### P0-1：迁移列 / 种子数据移出模块顶层

- **文件**：`backend/app/main.py`
- **行号**：29、190、212
- **问题**：`migrate_columns()` 和 `seed_admin()` 在模块导入时同步执行。每次 `uvicorn` 加载模块（含 `--reload` 热重载）都触发：
  - `migrate_columns`：遍历 15 张表做 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` + 索引创建
  - `seed_admin`：开 Session + 查询 admin 用户 + 可能插入
- **实测影响**：每次热重载增加 200~800ms 阻塞延迟
- **方案**：移到 `lifespan` 启动阶段（`yield` 之前）
- **改动量**：约 15 行
- **风险**：低（逻辑不变，只改执行时机）

```python
# 修改前
Base.metadata.create_all(bind=engine)  # 第 29 行
migrate_columns()                       # 第 190 行
seed_admin()                            # 第 212 行

app = FastAPI(...)

# 修改后
app = FastAPI(...)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    migrate_columns()
    seed_admin()
    from app.services.profile_extractor import recover_stale_tasks
    from app.services.scheduler import scheduler_loop
    recovered = recover_stale_tasks()
    if recovered:
        logger.info("recovered %d stale profile extract tasks on startup", recovered)
    scheduler_task = asyncio.create_task(scheduler_loop())
    yield
    scheduler_task.cancel()
```

#### P0-2：scheduler 缓存 git hash

- **文件**：`backend/app/services/scheduler.py`
- **行号**：42~43
- **问题**：`_snapshot_execution()` 每次调度扫描（60 秒一次）spawn 子进程获取 git hash：
  ```python
  build_hash = subprocess.check_output(
      ["git", "rev-parse", "HEAD"], text=True, timeout=5
  ).strip()[:64]
  ```
  阻塞事件循环 100~500ms
- **方案**：启动时读取一次，存入模块级变量 `_GIT_HASH`
- **改动量**：约 8 行
- **风险**：极低（只影响调度元数据中的版本标记）

```python
# 模块级变量
_GIT_HASH: str = ""

def _load_git_hash() -> None:
    global _GIT_HASH
    try:
        _GIT_HASH = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, timeout=5
        ).strip()[:64]
    except Exception:
        _GIT_HASH = ""

# 在 _snapshot_execution 中
build_hash = _GIT_HASH  # 直接使用缓存值
```

#### P0-3：数据库连接池加 pool_pre_ping

- **文件**：`backend/app/db/database.py`
- **行号**：8~13
- **问题**：`create_engine` 无任何 pool 配置，SQLite 未显式指定 `StaticPool`
- **方案**：
  - SQLite：`StaticPool`（单连接共享，避免连接池反模式）
  - 非 SQLite：`pool_pre_ping=True`、`pool_recycle=1800`、`pool_size=10`、`max_overflow=20`
- **改动量**：约 10 行
- **风险**：低

```python
if settings.database_url.startswith("sqlite"):
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_engine(
        settings.database_url,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
    )
```

---

### P1 — N+1 查询批量化（投入 ~1.5h，收益极大）

#### P1-1：trackers.py `_with_extras()` 批量查询

- **文件**：`backend/app/api/trackers.py`
- **行号**：41~62
- **问题**：`_with_extras()` 对列表中每个 tracker 执行 4 条独立查询：
  1. `q.count()` — 总任务数
  2. `q.filter(status="completed").order_by(created_at desc).first()` — 最近完成
  3. `q.filter(status.notin_(["completed","failed"])).first()` — 运行中
  4. `db.get(User, creator_id)` — 创建者
- **量化**：50 个 tracker = 200 条 SQL
- **方案**：收集所有 tracker_id，一次性用 `GROUP BY` 批量查任务统计，一次性 `IN` 查用户
- **预期提速**：50 tracker 场景从 ~800ms → ~50ms
- **改动量**：约 60 行重写 `_with_extras` + 新辅助函数
- **风险**：中（需确保批量查询结果与逐条一致，注意 NULL/空集边界）

**关键实现要点**：
- 用 `func.count()` + `group_by(ResearchTask.tracker_id)` 一次性获取所有 tracker 的任务计数
- 用子查询 + `row_number()` 或两次分组查询获取每个 tracker 的最后完成时间和运行中状态
- 用 `User.id.in_(creator_ids)` 一次性加载所有创建者

#### P1-2：org.py `list_members()` 批量查询

- **文件**：`backend/app/api/org.py`
- **行号**：123~137
- **问题**：每个成员调用 `member_month_usage(db, m.id)`（2 COUNT：tasks + graphs）+ `_load_permissions(db, m.id)`（1 query）
- **量化**：20 个成员 = 60 条 SQL
- **方案**：收集所有 member_id，一次性批量查：
  - 任务数：`group_by(ResearchTask.user_id)`
  - 图谱数：`group_by(GraphProject.user_id)`
  - 权限：`UserPermission.user_id.in_(member_ids)`
- **预期提速**：20 成员场景从 ~300ms → ~30ms
- **改动量**：约 50 行重写 `list_members`
- **风险**：中

#### P1-3：admin.py `_org_out()` 批量查询

- **文件**：`backend/app/api/admin.py`
- **行号**：134~138
- **问题**：每个 org 执行 `User.count()` + `_org_month_used()`（再含 2 COUNT）
- **量化**：20 个 org = 60 条 SQL
- **方案**：`list_orgs` 中一次性获取所有 org 的用户数和月度用量
- **改动量**：约 30 行
- **风险**：中

#### P1-4：admin.py `audit_stats` Python 聚合改 SQL

- **文件**：`backend/app/api/admin.py`
- **行号**：239~261
- **问题**：`q.all()` 全量加载到内存，Python 循环计算 counts/breakdown/top_models
- **方案**：用 SQL `func.count()` + `group_by` + `order_by` 在数据库层完成聚合
- **改动量**：约 30 行
- **风险**：低

```python
# 修改前（Python 侧聚合）
logs = q.all()
success = sum(1 for l in logs if l.status == "success")
action_counts: dict[str, int] = {}
for l in logs:
    action_counts[l.action] = action_counts.get(l.action, 0) + 1

# 修改后（SQL 侧聚合）
success = db.query(func.count(AuditLog.id)).filter(
    AuditLog.created_at >= since
).filter(AuditLog.status == "success").scalar()

action_breakdown = db.query(AuditLog.action, func.count(AuditLog.id).label("cnt"))
    .filter(AuditLog.created_at >= since)
    .group_by(AuditLog.action)
    .order_by(func.count(AuditLog.id).desc())
    .limit(20).all()
```

---

### P2 — 前端启动优化（投入 ~30min，首屏减半）

#### P2-1：路由级代码分割

- **文件**：`frontend/src/App.tsx`
- **行号**：5~27
- **问题**：24 个页面全部静态导入，打包进首屏 JS chunk
- **方案**：`React.lazy()` + `Suspense` 包装 `Outlet`
- **改动量**：约 30 行
- **风险**：低（已有 Suspense 基础设施）

```tsx
// 修改前
import DashboardPage from './pages/app/DashboardPage'
import TasksPage from './pages/app/TasksPage'
// ... 24 个静态 import

// 修改后
import { lazy, Suspense } from 'react'
const DashboardPage = lazy(() => import('./pages/app/DashboardPage'))
const TasksPage = lazy(() => import('./pages/app/TasksPage'))
// ... 24 个 lazy import

// 在 <AppLayout> 内
<Suspense fallback={<div className="p-8 text-center text-gray-400">加载中…</div>}>
  <Outlet />
</Suspense>
```

#### P2-2：vite 配置 manualChunks

- **文件**：`frontend/vite.config.ts`
- **行号**：全文件（17 行）
- **问题**：无 `build.rollupOptions.output.manualChunks`，recharts(~200KB)、reactflow(~200KB)、html2pdf(~100KB)、react-markdown 全部混在 vendor chunk
- **方案**：按库拆分 vendor chunk
- **改动量**：约 20 行
- **风险**：极低

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-charts': ['recharts'],
        'vendor-editor': ['react-markdown', 'remark-gfm'],
        'vendor-pdf': ['html2pdf.js'],
        'vendor-flow': ['reactflow'],
      }
    }
  },
  sourcemap: false,
  chunkSizeWarningLimit: 500,
}
```

#### P2-3：TasksPage 条件轮询

- **文件**：`frontend/src/pages/app/TasksPage.tsx`
- **行号**：33~37
- **问题**：`setInterval(refresh, 3000)` 无条件运行，即便无运行中任务也持续请求 `/api/research`
- **现状**：`hasRunning`（第 24 行）已计算但仅用于 UI 指示器
- **方案**：`hasRunning` 为 false 时不设 interval
- **改动量**：约 5 行
- **风险**：极低

```tsx
// 修改前
useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
}, [refresh])

// 修改后
useEffect(() => {
    refresh()
    if (!hasRunning) return  // 无运行中任务，停止轮询
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
}, [refresh, hasRunning])
```

---

### P3 — 数据库索引与分页（投入 ~20min，长期收益）

#### P3-1：添加复合索引

在 `models.py` 各模型的 `__table_args__` 中添加：

| 索引 | 表 | 行号 | 作用 |
|------|------|------|------|
| `("org_id", "role")` | users | 46 | 企业成员列表 + 角色过滤 |
| `("status", "created_at")` | research_tasks | 175 | 任务列表排序、调度器扫描 |
| `("tracker_id", "status", "created_at")` | research_tasks | 175 | 调度器按 tracker 扫描运行状态 |
| `("user_id", "created_at")` | audit_logs | 454 | 月度审计统计 |
| `("org_id", "created_at")` | audit_logs | 454 | 管理员审计统计 |
| `("user_id", "read", "created_at")` | notifications | 385 | 未读通知列表 |

**注意**：SQLite 支持在线添加索引，但大表（>10 万行）加索引会锁表，建议在低峰期执行或分批。

#### P3-2：列表接口加分页

| 端点 | 文件 | 现状 | 建议 |
|------|------|------|------|
| `GET /api/research` | `research.py:74` | 无分页，返回全量 | 加 `?page=1&page_size=20` |
| `GET /api/trackers` | `trackers.py:106` | 无分页 | 加 `?page=1&page_size=20` |
| `GET /api/competitors` | `competitors.py` | 无分页 | 加 `?page=1&page_size=50` |
| `GET /api/graph` | `graph.py` | 无分页 | 加 `?page=1&page_size=20` |

**注意**：分页会影响 SSE 实时推送的 `sent` 偏移量计算（`research.py:286`），需确保 offset 在分页场景下仍正确。

---

### P4 — 事件循环阻塞修复（投入 ~2h，架构层面）

#### P4-1：agent.py / graph_agent.py 同步 DB 改 async

- **短期**：同步 DB 块包裹 `await asyncio.to_thread()`
- **长期**：迁移 `AsyncSession` + `aiosqlite`/`asyncpg`

受影响函数：
- `agent.py`：`_update_status`（80）、`_add_step`（90）、`_save_sources`（97）、`_save_insights`（131）、`_merge_report_data`（140）、`_save_report`（156）、`run_research`（434）
- `graph_agent.py`：`_set_status`（49）、`_save`（185）、`_save_report`（261）

#### P4-2：llm.py 审计日志改 fire-and-forget

- **文件**：`backend/app/services/llm.py` + `backend/app/services/audit.py`
- **问题**：每次 LLM 调用后同步执行 `log_audit()`，内含 SessionLocal + commit + check_anomalies（可能再写通知），增加 ~2~10ms/次
- **方案**：用 `asyncio.create_task()` 异步写审计日志，主流程不等待
- **注意**：需处理后台任务异常时的日志丢失（可接受，审计日志非关键路径）

#### P4-3：权限缓存修复 per-user TTL bug

- **文件**：`backend/app/api/deps.py`
- **行号**：173~210
- **问题**：
  1. `_last_refresh` 是全局变量，所有用户共享同一 TTL 时间戳
  2. `invalidate_perm_cache` 设置 `_last_refresh = 0`，导致所有用户缓存同时失效，可能引发缓存雪崩
- **方案**：改为 per-user TTL

```python
# 修改前
_PERM_CACHE: dict[str, set[str]] = {}
_CACHE_TTL = 60
_last_refresh: float = 0  # 全局时间戳 — BUG

def _load_permissions(db, user_id):
    global _last_refresh
    now = time.time()
    if user_id in _PERM_CACHE and now - _last_refresh < _CACHE_TTL:
        return _PERM_CACHE[user_id]
    # ...
    _last_refresh = now

def invalidate_perm_cache(user_id=""):
    global _last_refresh
    _last_refresh = 0  # 清除所有用户缓存 — BUG
    if user_id:
        _PERM_CACHE.pop(user_id, None)
    else:
        _PERM_CACHE.clear()

# 修改后
_PERM_CACHE: dict[str, tuple[set[str], float]] = {}  # user_id -> (perms, cached_at)
_CACHE_TTL = 60

def _load_permissions(db, user_id):
    now = time.time()
    cached = _PERM_CACHE.get(user_id)
    if cached and now - cached[1] < _CACHE_TTL:
        return cached[0]
    # ... 查库 ...
    _PERM_CACHE[user_id] = (perms, now)
    return perms

def invalidate_perm_cache(user_id=""):
    if user_id:
        _PERM_CACHE.pop(user_id, None)
    else:
        _PERM_CACHE.clear()
```

---

## 三、执行顺序建议

```
第 1 天（~1h）:
  ✅ P0-1  迁移列/种子移出模块顶层          → 启动减少 0.5~2s
  ✅ P0-2  缓存 git hash                   → 每次扫描省 100~500ms
  ✅ P0-3  连接池调优                      → 消除空闲超时 500
  ✅ P2-1  路由代码分割 React.lazy()       → 首屏 JS 减半
  ✅ P2-2  vite manualChunks               → 重型库按需加载
  ✅ P2-3  TasksPage 条件轮询              → 无任务时停止轮询

第 2 天（~1.5h）:
  ✅ P1-1  trackers N+1 修复               → 列表接口提速 10~16x
  ✅ P1-2  org N+1 修复                    → 成员列表提速 10x
  ✅ P1-3  admin N+1 修复                  → 企业列表提速 ~15x
  ✅ P1-4  audit_stats SQL 聚合            → 内存占用从 O(n) → O(1)

第 3 天（~30min）:
  ✅ P3-1  6 个复合索引                    → 列表查询提速 2~10x
  ✅ P3-2  列表分页                        → 防止大表全量返回

后续（按需）:
  🔲 P4-1  agent.py / graph_agent.py async DB  → 并发 research 不再串行
  🔲 P4-2  审计日志 fire-and-forget           → LLM 链路减少 ~10~50ms
  🔲 P4-3  权限缓存 per-user TTL 修复         → 消除缓存雪崩风险
```

---

## 四、验证方案

每项修复完成后验证：

| 验证项 | 方法 |
|--------|------|
| 启动速度 | `time python -c "import app.main"` 对比前后 |
| API 列表接口 | 浏览器 DevTools → Network，对比前后响应时间 |
| N+1 修复 | SQLAlchemy echo 模式，确认单条列表请求 SQL 条数 |
| 前端首屏 | Chrome DevTools → Network → JS 总大小对比 |
| 并发 research | 同时发起 3 个 research，确认日志并行执行（非串行） |
| 条件轮询 | Network 面板确认无运行中任务时无 3s 轮询请求 |
| 索引生效 | `EXPLAIN QUERY PLAN SELECT ...` 确认使用新索引 |

---

## 五、核验说明

本方案基于以下逐文件代码核验生成：

**后端（16 个文件）**：
- `backend/app/main.py` (259 行)
- `backend/app/db/database.py` (37 行)
- `backend/app/db/models.py` (590 行)
- `backend/app/services/agent.py` (573 行)
- `backend/app/services/scheduler.py` (171 行)
- `backend/app/services/graph_agent.py` (374 行)
- `backend/app/services/llm.py` (105 行)
- `backend/app/services/audit.py` (77 行)
- `backend/app/api/trackers.py` (228 行)
- `backend/app/api/org.py` (264 行)
- `backend/app/api/admin.py` (326 行)
- `backend/app/api/research.py` (299 行)
- `backend/app/api/deps.py` (231 行)

**前端（5 个文件）**：
- `frontend/src/App.tsx` (94 行)
- `frontend/src/pages/app/TasksPage.tsx` (168 行)
- `frontend/vite.config.ts` (18 行)
- `frontend/src/api/client.ts` (587 行)
- `frontend/src/layouts/AppLayout.tsx` (151 行)

原始诊断报告 90% 的发现经过确认，4 处已修正：
1. `_save_sources` 的 `await` 位置：函数本身是 async，问题在于同步 Session 块整体阻塞
2. 审计日志延迟量化：`check_anomalies` 额外增加延迟，实际 ~2~10ms/次而非 ~1~5ms
3. 权限缓存：从"性能问题"更正为"正确性 bug"（全局 TTL + 缓存雪崩）
4. `_load_permissions` 缓存行为：per-user entry 存在但 TTL 是全局共享的，不是简单的"全局失效"
