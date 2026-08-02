# 竞品调研 Agent — 性能诊断与优化方案

> 版本：v6.0.0 | 日期：2026-08-03 | 分支: agent-v6
> **v5.2 更新**：基于 commit `9a84933` 逐文件核验后更新
> - P0-1/2/3、P1-1/2/3/4、P2-1/2、P3-2（部分）、P4-3 已完成
> - 新增 audit_triggers、rate_limit、anomaly 服务
> - 列顺序自动修复机制、JWT 安全警告

---

## 一、问题总览

| 维度 | 现状 | 目标 |
|------|------|------|
| 启动时间（含热重载） | 3 ~ 5s | < 1s |
| 列表接口响应 | 500 ~ 2000ms | 50 ~ 200ms |
| 并发 Research（3 个） | 串行 ~120s | 并行 ~40s |
| 前端首屏 JS | ~500KB（29 个页面） | ~150KB |

---

## 二、已完成项（commit `9a84933` 中已落地）

### P0 — 启动阻塞

| 项 | 文件 | 状态 | 说明 |
|---|---|---|---|
| P0-1 | `main.py:47-67` | ✅ 已完成 | `migrate_columns()` + `seed_admin()` 移入 `lifespan` 启动阶段 |
| P0-2 | `scheduler.py:27-38,54` | ✅ 已完成 | 模块级 `_GIT_HASH`，启动时 `_load_git_hash()` 缓存一次 |
| P0-3 | `database.py:9-23` | ✅ 已完成 | SQLite 用 `StaticPool`，非 SQLite 用 `pool_pre_ping=True` + `pool_recycle=1800` |
| — | `main.py:54-55` | ✅ 新增 | 审计日志数据库级触发器保护（`create_audit_triggers()`） |
| — | `main.py:40-44` | ✅ 新增 | JWT_SECRET 强度警告 |
| — | `main.py:228-328` | ✅ 新增 | `_fix_column_order_if_needed()` 自动修复列顺序不一致 |

### P1 — N+1 查询批量化

| 项 | 文件 | 状态 | 说明 |
|---|---|---|---|
| P1-1 | `trackers.py:66-128` | ✅ 已完成 | `_with_extras_batch()` 用 `row_number()` 窗口函数，每 tracker 限 10 条 |
| P1-2 | `org.py:125-187` | ✅ 已完成 | 3 个 GROUP BY 批量查询（tasks + graphs + permissions） |
| P1-3 | `admin.py:153-211` | ✅ 已完成 | 3 个 GROUP BY 批量查询替代逐 org 调用 |
| P1-4 | `admin.py:283-341` | ✅ 已完成 | `audit_stats` 全改 SQL `func.count`/`group_by` |
| — | `admin.py:30-63` | ✅ 已完成 | `stats` 端点重写：SQL 聚合替代 Python 全表扫描 |

### P2 — 前端启动优化

| 项 | 文件 | 状态 | 说明 |
|---|---|---|---|
| P2-1 | `App.tsx:11-29` | ✅ 已完成 | 18 个页面全部 `React.lazy()` |
| P2-2 | `vite.config.ts:17-33` | ✅ 已完成 | 7 个 `manualChunks`（vendor-react/charts/editor/pdf/flow/state/utils） |
| P2-3 | `TrackersPage.tsx:69-73` | ✅ 已完成 | Zustand store + `hasRunning` gated 轮询 |
| — | `TasksPage.tsx` | ✅ 已完成 | `hasRunning` gated 轮询 |
| — | `trackerStore.ts:20-34` | ✅ 已完成 | `reload()` 已用 `Promise.all` 并行 `getOrgMe()` + `listTrackers()`，首次加载（`hasOrg=null`）走串行兜底逻辑合理 |

### P3 — 其他优化

| 项 | 文件 | 状态 | 说明 |
|---|---|---|---|
| P3-2 部分 | `research.py:74-87` | ✅ 已完成 | `list_research` 加分页（`page`/`page_size`） |
| P3-2 部分 | `trackers.py:172-182` | ✅ 已完成 | `list_trackers` + `list_runs` 加分页 |
| P3-2 部分 | `admin.py` | ✅ 已完成 | `list_users`、`list_orgs`、`list_audit_logs` 全加分页 |
| P3-2 部分 | `org.py:125-131` | ✅ 已完成 | `list_members` 加分页 |
| — | `research.py:272-308` | ✅ 已完成 | SSE 事件流：单 session + `seq > sent` 替代 `offset(sent)` |
| — | `research.py:259` | ✅ 已完成 | 邮件发送用 `asyncio.to_thread(send_email, ...)` |
| P4-3 | `deps.py:173-206` | ✅ 已完成 | 权限缓存改为 per-user TTL，消除全局 `_last_refresh` bug |
| — | `anomaly.py` | ✅ 新增 | 异常行为检测服务（暴力破解、批量删除、非工作时间操作） |
| — | `rate_limit.py` | ✅ 新增 | 内存令牌桶限流（登录 5/s、注册 3/s、默认 60/s） |
| — | `audit_triggers.py` | ✅ 新增 | SQLite 触发器防止审计日志 UPDATE/DELETE |

---

## 三、仍需优化的项

### P4 — 事件循环阻塞修复（投入 ~2h，架构层面）

#### P4-1：agent.py / graph_agent.py 同步 DB 改 async（HIGH）

- **文件**：`backend/app/services/agent.py` + `backend/app/services/graph_agent.py`
- **问题**：7 处 `with SessionLocal()` 同步 ORM 在 `async def` 函数中阻塞事件循环
- **受影响函数**：
  - `agent.py`：`_update_status`（80）、`_add_step`（90）、`_save_sources`（97）、`_save_insights`（131）、`_merge_report_data`（140）、`_save_report`（156）、`run_research`（434）
  - `graph_agent.py`：`_set_status`（49）、`_save`（185）、`_save_report`（261）
- **方案**：
  - 短期：同步 DB 块包裹 `await asyncio.to_thread()`
  - 长期：迁移 `AsyncSession` + `aiosqlite`/`asyncpg`
- **改动量**：约 80 行
- **风险**：中（需确保 session 生命周期正确）

#### P4-2：llm.py 审计日志改 fire-and-forget（MEDIUM）

- **文件**：`backend/app/services/llm.py:14-38` + `backend/app/services/audit.py`
- **问题**：每次 LLM 调用后同步执行 `_log_llm_audit()` → `log_audit()`，内含 SessionLocal + commit + `check_anomalies()`（可能再写通知），增加 ~2~10ms/次
- **方案**：将同步审计日志写入放到 `asyncio.to_thread()` 中，不阻塞事件循环。注意：`_log_llm_audit` 是同步函数，不能直接用 `asyncio.create_task()` 包裹（会报错），必须通过 `to_thread` 或改为 async 函数
- **改动量**：约 15 行
- **风险**：低（审计日志非关键路径，丢失可接受）

```python
# 修改前（同步阻塞）
_log_llm_audit(self.model, ..., usage, ...)

# 修改后（fire-and-forget）
asyncio.create_task(asyncio.to_thread(
    _log_llm_audit, self.model, ..., usage, ...
))
```

### P3 — 数据库索引与分页（投入 ~30min）

#### P3-1：添加复合索引（MEDIUM）

`models.py` 中尚无复合索引。以下查询模式会受益：

> **实现方式**：在每个模型的 `__table_args__` 中添加 `Index("idx_name", "col1", "col2")`，与 `AuditLog` 已有的两个索引（`idx_audit_action_resource`、`idx_audit_created_at`）写法一致。不可在列定义中直接内联复合索引。

| 缺失索引 | 表 | 影响查询 | 严重度 |
|---|---|---|---|
| `("org_id", "role")` | users | 企业成员列表 + 角色过滤 | 中 |
| `("status", "created_at")` | research_tasks | 任务列表排序、调度器扫描 | 高 |
| `("tracker_id", "status", "created_at")` | research_tasks | 调度器按 tracker 扫描运行状态 | 高 |
| `("user_id", "created_at")` | audit_logs | 月度审计统计 | 中 |
| `("org_id", "created_at")` | audit_logs | 管理员审计统计 | 中 |
| `("user_id", "read", "created_at")` | notifications | 未读通知列表 | 低 |

**注意**：SQLite 支持在线添加索引，但大表（>10 万行）加索引会锁表。

#### P3-2：剩余无分页端点（MEDIUM）

| 端点 | 文件 | 现状 |
|------|------|------|
| `GET /api/competitors` | `competitors.py:24` | 无分页，返回全量 |
| `GET /api/graph` | `graph.py:63` | 无分页，返回全量 |
| `GET /api/profiles` | `profiles.py:150` | 无分页，返回全量 |
| `GET /api/profiles/templates` | `profiles.py:34` | 无分页，返回全量 |

| — | `_with_extras_batch` | ⚠️ 正确性 bug | `run_count = len(tasks)` 只统计最近 10 条（受 `row_number() <= 10` 限制），非总任务数 |

### P2 — 前端（LOW）

> **技术评审结论**：`trackerStore.ts` 的 `reload()` 已实现 `Promise.all` 并行，且通过 persist 缓存 `hasOrg` 做条件判断。首次加载（`hasOrg=null`）时的串行兜底是合理的（需要先知道 `hasOrg` 才能决定是否调 `listTrackers`）。**P2-4 无需改动，标记为已完成。**

#### ~~P2-4：Zustand store 串行调用改并行~~ ~~已完成~~

---

## 四、执行顺序建议

```
第 1 步（已完成，回顾）:
  ✅ P0-1  migrate_columns/seed_admin 移入 lifespan
  ✅ P0-2  git hash 缓存
  ✅ P0-3  连接池调优
  ✅ P1-1  trackers N+1 修复 + 分页
  ✅ P1-2  org N+1 修复 + 分页
  ✅ P1-3  admin N+1 修复 + 分页
  ✅ P1-4  audit_stats SQL 聚合
  ✅ P2-1  路由代码分割
  ✅ P2-2  vite manualChunks
  ✅ P2-3  条件轮询
  ✅ P4-3  权限缓存 per-user TTL
  ✅ SSE 单 session + seq 查询
  ✅ 审计触发器 + 限流 + 异常检测

第 2 步（待做，~1h）:
  🔲 P4-1  agent.py / graph_agent.py 同步 DB 改 async to_thread  → 并发 research 不再串行
  🔲 P4-2  审计日志 fire-and-forget                           → LLM 链路减少 ~10~50ms
  🔲 P3-1  6 个复合索引                                       → 列表查询提速 2~10x
  🔲 P3-2  剩余 4 个端点加分页                                 → 防止大表全量返回

第 3 步（待做，~30min）:
  🔲 P3-1  6 个复合索引                    → 列表查询提速 2~10x
  🔲 P3-2  列表分页                        → 防止大表全量返回
  🔲 修复   _with_extras_batch run_count  → 当前只统计最近 10 条，需加 COUNT 获取真实总数
```

---

## 五、核心剩余问题详述

### P4-1：agent.py 同步 DB 阻塞事件循环

当前 `agent.py` 中 7 处使用 `with SessionLocal()` 在 `async def` 函数内：

```python
# 示例：_save_sources (line 96-127)
async def _save_sources(task_id: str, results: list[dict]) -> None:
    with SessionLocal() as db:          # ← 同步阻塞
        for r in results:
            ...
            db.add(source)
            db.flush()
            await save_archive(...)     # ← 在同步块中 await
        db.commit()
```

每次 `with SessionLocal()` 打开连接、执行 SQL、commit 都会阻塞事件循环 1~5ms。一次 research 约 10+ 次阻塞，并发 3 个 research 会串行化。

**短期修复**（~1h）：将同步 DB 操作与异步 I/O 拆分。以 `_save_sources` 为例：

```python
# 修改前：同步 DB 块中包含 await，整个块阻塞事件循环
async def _save_sources(task_id: str, results: list[dict]) -> None:
    with SessionLocal() as db:
        for r in results:
            ...
            db.add(source)
            db.flush()  # source.id 已可用
            await save_archive(task_id, source.id, r["url"], ...)  # 在同步块中 await
        db.commit()

# 修改后：同步 DB 操作在一个线程中完成，async I/O 移到外面
async def _save_sources(task_id: str, results: list[dict]) -> None:
    def _do_save():
        with SessionLocal() as db:
            for r in results:
                ...
                db.add(source)
                db.flush()
            db.commit()
    # 将同步 DB 块放到线程池，不阻塞事件循环
    await asyncio.to_thread(_do_save)
    # async I/O 在事件循环中正常执行
    for r in results:
        source_id = ...  # 从 DB 中获取（或通过 _do_save 返回值传递）
        from app.services.snapshot import save_archive
        await save_archive(task_id, source_id, r["url"], ...)
```

但这只是把部分逻辑移出 async 块。真正的修复需要 `AsyncSession`，改动量较大。

**长期修复**（~2h）：迁移到 `AsyncSession` + `aiosqlite`，将所有 `with SessionLocal()` 改为 `async with async_sessionmaker()`。改动涉及 3 个 service 文件 + `database.py`，风险中等。

### P3-1：缺失复合索引

当前 `models.py` 只有 `AuditLog.__table_args__` 中有 2 个索引（`idx_audit_action_resource`、`idx_audit_created_at`），其余表无复合索引。

最影响性能的是 `research_tasks(status, created_at)` — 任务列表排序、调度器扫描都依赖这个组合过滤。当前只有 `status` 单列索引（line 169），`status + created_at` 组合过滤时无法利用索引。

### P3-2：剩余无分页端点

`competitors`、`graph`、`profiles`、`profiles/templates` 四个端点仍返回全量数据。虽然当前数据量不大，但随着使用增长会成为瓶颈。

### 已发现但方案中未列出的正确性问题

#### `_with_extras_batch` 的 `run_count` 统计错误（MEDIUM）

**文件**：`backend/app/api/trackers.py:111`

**问题**：`row_number() <= 10` 限制了每个 tracker 最多加载 10 条任务用于展示最近完成/运行中状态，但 `run_count = len(tasks)` 用这 10 条的数量充当总任务数。当 tracker 历史超过 10 期时，前端显示的"已运行 X 期"是错误的。

**修复**：在批量查询中额外执行 `func.count()` GROUP BY 获取真实总数（不受 `row_number` 限制）。

#### `_scan_once` 调度器逐条调用 `check_quota_or_403`（LOW）

**文件**：`backend/app/services/scheduler.py:148`

**问题**：每个到期的 tracker 都独立调用 `check_quota_or_403`，内含 `month_usage`（2 条 COUNT） + `member_month_usage`（2 条 COUNT） + `_notify_quota_warning`（1 条 COUNT）。如果有 5 个 tracker 同时到期，一轮扫描执行 25 条 COUNT 查询。

**优化**：将 `month_usage` 结果缓存（per-user + per-month），或在调度器层面批量预取所有 creator 的配额状态。

---

## 六、验证方案

| 验证项 | 方法 |
|--------|------|
| 启动速度 | `time python -c "from app.main import app"` 对比前后 |
| API 列表接口 | 浏览器 DevTools → Network，对比前后响应时间 |
| N+1 修复 | 确认 `_with_extras_batch` 被 `list_trackers` 使用 |
| 前端首屏 | Chrome DevTools → Network → JS 总大小对比 |
| 并发 research | 同时发起 3 个 research，确认 SSE 日志并行 |
| 条件轮询 | Network 面板确认无运行中任务时无轮询请求 |
| 索引生效 | `EXPLAIN QUERY PLAN SELECT ...` 确认使用新索引 |
| SSE 单 session | 确认 `research_events` 中 session 复用 + `seq > sent` |

---

## 八、技术评审总结

### 评审结论

| 类别 | 数量 | 说明 |
|------|------|------|
| 方案可行、无需修改 | 8 项 | P0-1/2/3、P1-1/2/3/4、P2-1/2、P3-2（部分）、P4-3 均已落地且实现正确 |
| 方案需修正后可行 | 2 项 | P4-1 代码示例错误（`r["id"]` → 需通过 flush 后获取 source.id）；P4-2 `create_task` 不能包裹同步函数（需用 `asyncio.to_thread`） |
| 方案不可行，已替代 | 1 项 | P2-4 实际已通过 `Promise.all` 完成，标记为已完成 |
| 方案中发现新 bug | 2 项 | `_with_extras_batch` run_count 统计错误；`_scan_once` 配额查询可进一步优化 |

### 已修正的 3 处方案错误

1. **P4-1 代码示例**：原方案中 `r["id"]` 引用不存在的字段。修改为 `await asyncio.to_thread(_do_save)` 包裹整个同步 DB 块
2. **P4-2 实现方式**：原方案用 `asyncio.create_task()` 直接包裹同步函数 `_log_llm_audit`，会报错。修正为 `asyncio.create_task(asyncio.to_thread(...))`
3. **P3-1 实现方式**：补充说明复合索引必须通过 `__table_args__` 中的 `Index()` 添加，不可在列定义中内联

本方案基于以下文件逐行核验：

**后端（22 个文件）**：
`main.py`、`database.py`、`models.py`、`audit_triggers.py`
`agent.py`、`scheduler.py`、`graph_agent.py`、`llm.py`、`audit.py`、`anomaly.py`、`search.py`
`trackers.py`、`org.py`、`admin.py`、`research.py`、`deps.py`、`competitors.py`、`profiles.py`、`graph.py`
`config.py`、`security.py`、`rate_limit.py`

**前端（7 个文件）**：
`App.tsx`、`vite.config.ts`、`TasksPage.tsx`、`TrackersPage.tsx`、`client.ts`、`AppLayout.tsx`、`trackerStore.ts`
