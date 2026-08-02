# 竞品调研 Agent — 性能诊断与优化方案

> 版本：v5.1.0 | 日期：2026-08-02 | 分支：agent-v5

---

## 一、问题总览

| 维度 | 现状 | 目标 |
|------|------|------|
| 启动时间（含热重载） | 3 ~ 5s | < 1s |
| 列表接口响应 | 500 ~ 2000ms | 50 ~ 200ms |
| 前端首屏 JS | ~500KB+ | ~150KB |
| 并发调研 | 串行（事件循环阻塞） | 并行 |

---

## 二、根因分析

### 2.1 后端启动阻塞

**`backend/app/main.py`** 在模块顶层（import 阶段）同步执行：

1. `Base.metadata.create_all(bind=engine)` — 建表
2. `_assert_jwt_secret()` + `get_settings()` — 配置校验
3. 原 `migrate_columns()` + `seed_admin()` — **已移入 lifespan** ✅

**`backend/app/services/scheduler.py`** 的 `_snapshot_execution()` — 已缓存 git hash ✅

**`backend/app/db/database.py`** — 已配置连接池 ✅

### 2.2 N+1 查询问题

#### 已修复 ✅

| 位置 | 修复方案 | 验证代码 |
|---|---|---|
| `trackers.py:_with_extras()` | 新增 `_with_extras_batch()`，列表端点改用批量查询 | `trackers.py:66-111`, `list_trackers` line 165 |
| `org.py:list_members()` | 3 个 GROUP BY 批量查询替代逐成员调用 | `org.py:136-173` |
| `admin.py:list_orgs()` | 3 个 GROUP BY 批量查询替代逐 org 调用 | `admin.py:157-199` |
| `admin.py:audit_stats` | 全改 SQL `func.count`/`group_by` | `admin.py:278-317` |

#### 已修复 ✅

| 严重度 | 位置 | 修复方案 |
|---|---|---|
| **HIGH** | `auth.py:/account DELETE` | Python 循环逐条删除 → 批量 `delete(synchronize_session=False)` |
| **HIGH** | `research.py:research_events` | 每轮询新建 session + `offset(sent)` O(n) → 单 session 复用 + `seq > sent` 索引查询 |
| **MED** | `trackers.py:_with_extras_batch` | 全量加载所有 tracker 历史任务 → 窗口函数 `row_number()` 每 tracker 限 10 条 |

#### 仍存在问题 ❌

| 严重度 | 位置 | 问题 | 量化 |
|---|---|---|---|
| **HIGH** | `admin.py:/stats` line 37-44 | `db.query(User).all()` + `db.query(Organization).all()` 加载全表到 Python，逐行计算付费用户 | 10K 用户 = OOM/秒级 |
| **MED** | `assistant.py:/ask` | 加载 50 条 ResearchTask（含完整 `report_markdown`）供 LLM 选择 | report_markdown 可能很大 |

### 2.3 前端首屏 Bundle

**已修复** ✅：

- `App.tsx` 全部 18 个页面改为 `React.lazy()`
- `AppLayout.tsx` 添加 `Suspense` 边界
- `vite.config.ts` 添加 7 个 `manualChunks`

### 2.4 前端 Store 串行调用

**已修复** ✅：

- `trackerStore.reload()` 使用 `Promise.all` + persist 缓存判断

### 2.5 缺失数据库索引

**已有索引** ✅：

- `idx_user_org_role` (users)
- `idx_research_status_created`, `idx_research_tracker_status` (research_tasks)
- `idx_notif_user_read_created` (notifications)
- `idx_audit_user_created`, `idx_audit_org_created`, `idx_audit_action_resource`, `idx_audit_created_at` (audit_logs)

**仍缺失** ❌：

| 缺失索引 | 影响场景 |
|---|---|
| `research_tasks(user_id, created_at)` | `month_usage()`, `/usage` 按月统计 |
| `graph_projects(user_id, created_at)` | graph 配额检查 |

### 2.6 权限缓存 Bug

**已修复** ✅：`_PERM_CACHE` 改为 `dict[str, tuple[set, float]]`，per-user TTL

### 2.7 分页状态

**已添加分页** ✅：

| 端点 | 实现 |
|---|---|
| `GET /api/research` | `page`/`page_size` 参数，默认 20 |
| `GET /api/trackers` | `page`/`page_size` 参数，默认 20 |
| `GET /api/competitors` | `page`/`page_size` 参数，默认 50 |
| `GET /api/graph` | `page`/`page_size` 参数，默认 20 |

**仍缺少分页** ❌：

| 端点 | 文件 | 行号 |
|---|---|---|
| `GET /api/profiles/templates` | `profiles.py` | 35-39 |
| `GET /api/profiles` | `profiles.py` | 152-156 |
| `GET /api/org/members` | `org.py` | 127 |
| `GET /api/trackers/{id}/runs` | `trackers.py` | 271-280 |
| `GET /api/competitors/{cid}/pages` | `crawl.py` | 131-137 |

**前端未传分页参数** ❌：

`client.ts` 中 `listResearch()`、`listTrackers()`、`listCompetitors()`、`listProfiles()`、`listGraphs()` 均不传 `page`/`page_size`，依赖后端默认值。

---

## 三、优化方案

### P0 — 已完成 ✅

| 项 | 文件 | 状态 |
|---|---|---|
| P0-1: 迁移列/种子移出模块顶层 | `main.py:43-44` | ✅ 已在 lifespan 中执行 |
| P0-2: 缓存 git hash | `scheduler.py:27,30-38` + `main.py:48-49` | ✅ 模块级 `_GIT_HASH` |
| P0-3: 连接池调优 | `database.py:9-23` | ✅ StaticPool + pool_pre_ping |

### P1 — 已完成 ✅

| 项 | 文件 | 状态 |
|---|---|---|
| P1-1: trackers N+1 修复 | `trackers.py:66-111` | ✅ `_with_extras_batch()` |
| P1-2: org members N+1 修复 | `org.py:136-173` | ✅ 3 个 GROUP BY |
| P1-3: admin orgs N+1 修复 | `admin.py:157-199` | ✅ 3 个 GROUP BY |
| P1-4: audit_stats SQL 聚合 | `admin.py:278-317` | ✅ 全 SQL 聚合 |

### P2 — 已完成 ✅

| 项 | 文件 | 状态 |
|---|---|---|
| P2-1: 路由懒加载 | `App.tsx:11-29` + `AppLayout.tsx:187` | ✅ 18 个页面全部 lazy |
| P2-2: manualChunks | `vite.config.ts:20-28` | ✅ 7 个 vendor chunk |
| P2-3/2-4: store 并行 | `trackerStore.ts:23-31` | ✅ Promise.all + persist 缓存 |

### P3 — 部分完成 ✅ / 进行中

#### P3-1a：SSE 单 session + seq 查询 ✅

`research.py:282-318` — 单 session 复用（try/finally 关闭），`seq > sent` 替代 `offset(sent)` 消除 O(n) 开销。

#### P3-1b：追踪/调研列表分页 ✅

`trackers.py` list + runs 端点、`research.py` list 端点 — 均支持 `page`/`page_size` 参数（默认 20）。

#### P3-1c：追踪列表批量加载 ✅

`trackers.py:66-111` — `_with_extras_batch()` 使用窗口函数 `row_number()` 每 tracker 限 10 条，替代全量加载。

#### P3-2：仍待补充的分页端点

| 端点 | 文件 | 修改 |
|---|---|---|
| `GET /api/profiles/templates` | `profiles.py:35` | 加 `page`/`page_size` 参数 |
| `GET /api/profiles` | `profiles.py:152` | 加 `page`/`page_size` 参数 |
| `GET /api/org/members` | `org.py:127` | 加 `page`/`page_size` 参数 |
| `GET /api/competitors/{cid}/pages` | `crawl.py:131` | 加 `page`/`page_size` 参数 |

#### P3-3：前端 API 函数暴露分页参数

**文件**: `frontend/src/api/client.ts`

为 `listResearch`、`listTrackers`、`listCompetitors`、`listProfiles`、`listGraphs` 添加可选的分页参数：

```typescript
export function listResearch(page = 1, pageSize = 20): Promise<TaskBrief[]> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  return request(`/api/research?${params}`)
}
```

### P4 — 新增待实施项

#### P4-1：修复 `admin/stats` 全表加载（HIGH）

**文件**: `backend/app/api/admin.py` line 30-51

**当前代码**:
```python
orgs = {o.id: o for o in db.query(Organization).all()}  # 全表
paid_users = sum(
    1 for u in db.query(User).all()  # 全表
    if (u.role == "admin")
    or (u.org_id and u.org_id in orgs and effective_org_plan(orgs[u.org_id]) in PAID_PLANS)
    or (not u.org_id and effective_plan(u) in PAID_PLANS)
)
```

**修复方案**：用 SQL 聚合替代 Python 循环：

```python
# 企业付费用户数：按 org_id 分组统计有效企业套餐的用户数
org_plans = dict(
    db.query(Organization.id, Organization.plan)
    .filter(Organization.id.in_(org_ids))
    .all()
)
paid_from_orgs = 0
for org_id, plan in org_plans.items():
    if effective_org_plan_simple(plan) in PAID_PLANS:
        # 统计该企业下非 admin 用户数
        paid_from_orgs += db.query(User).filter(
            User.org_id == org_id, User.role != "admin"
        ).count()

paid_users = (
    db.query(User).filter(User.role == "admin").count()  # admin 视同付费
    + paid_from_orgs
    + db.query(User).filter(User.org_id == "", effective_plan_cond(User).in_(PAID_PLANS)).count()  # 个人付费
)
```

**预期收益**: 10000 用户场景从 ~2s → ~50ms。

#### P4-2：`auth/delete_account` 批量删除 ✅

`auth.py:235-238` — Python 循环逐条 `db.delete(task)` → 批量 `delete(synchronize_session=False)`。

**预期收益**: 500 tasks 场景从 ~500 条 DELETE → 3 条批量 DELETE。

#### P4-3：SSE 事件流 Session 复用 ✅

`research.py:282-318` — 复用外层 session，用 `seq > sent` 替代 `offset(sent)`:

**预期收益**: 消除 session 累积风险，`seq > sent` 利用索引避免 O(n) 偏移。

#### P4-4：`_with_extras_batch` 限制任务加载量 ✅

`trackers.py:66-111` — 窗口函数 `row_number()` 每 tracker 限 10 条，替代全量加载。

#### P4-5：`assistant/ask` 减少加载字段（MED）

**文件**: `backend/app/api/assistant.py`

只 select 需要的字段，避免加载完整 `report_markdown`:

```python
tasks = (
    db.query(ResearchTask.id, ResearchTask.product_name, ResearchTask.created_at, ResearchTask.tracker_id)
    .filter(ResearchTask.status == "completed", ResearchTask.org_id == user.org_id)
    .order_by(ResearchTask.created_at.desc())
    .limit(50)
    .all()
)
```

---

## 四、执行顺序建议

```
第 1 天（已完成）:
  ✅ P0-1  迁移列/种子移出 lifespan
  ✅ P0-2  缓存 git hash
  ✅ P0-3  连接池调优
  ✅ P2-1  路由代码分割 React.lazy()
  ✅ P2-2  vite manualChunks
  ✅ P2-3/2-4 store 并行
  ✅ P1-1~1-4 N+1 批量查询
  ✅ P4-3  权限缓存 per-user TTL
  ✅ P4-2  auth/delete_account 批量删除           → 500 tasks 从 500 条 DELETE → 3 条
  ✅ P4-3  SSE 复用 Session + seq > sent          → 消除连接泄漏 + O(n) 偏移
  ✅ P4-4  _with_extras_batch 窗口函数限制

第 2 天（~1.5h）:
  🔲 P4-1  admin/stats SQL 聚合替代全表加载      → 10000 用户从 ~2s → ~50ms
  🔲 P3-1  补充 2 个复合索引                      → month_usage 查询提速
  🔲 P3-2  补充分页端点（profiles/org members/crawl pages）

第 3 天（~30min）:
  🔲 P3-3  前端 API 暴露分页参数
  🔲 P4-5  assistant/ask 字段裁剪
  🔲 P4-6  agent.py async DB                    → 并发 research 不再阻塞事件循环
  🔲 P4-7  审计日志 fire-and-forget             → LLM 链路减少 ~10~50ms
```

---

## 五、优先级排序（按影响面 × 严重程度）

| 优先级 | 优化项 | 预计耗时 | 预期收益 | 影响面 |
|---|---|---|---|---|
| **P0** | P0-1 迁移列/种子移出 lifespan | 15min | 启动快 0.5~2s | 所有用户（每次热重载） |
| **P0** | P0-2 缓存 git hash | 10min | 每次扫描省 100~500ms | 调度器（每小时 60 次） |
| **P0** | P0-3 连接池调优 | 5min | 消除空闲超时 | 稳定性 |
| **P1** | P1-1 trackers N+1 | 45min | 列表提速 10~16x | 企业用户（追踪列表） |
| **P1** | P1-2 org members N+1 | 30min | 成员列表提速 10x | 企业用户（成员管理） |
| **P1** | P1-3 admin orgs N+1 | 20min | 企业列表提速 ~15x | 管理员 |
| **P1** | P1-4 audit_stats SQL | 15min | O(n) → O(1) | 管理员（审计页） |
| **P2** | P2-1 路由代码分割 | 20min | 首屏 JS 减半 | 所有用户 |
| **P2** | P2-2 manualChunks | 5min | 重型库按需加载 | 所有用户 |
| **P2** | P2-3 store 并行 | 10min | 减少 1 次 RTT | 追踪页用户 |
| **P4** | P4-1 admin/stats 修复 | 30min | 10000 用户从 ~2s → ~50ms | 管理员 |
| **P4** | P4-2 auth delete 批量删除 | 10min | 500 tasks 从 500 → 3 条 DELETE | 注销用户 |
| **P4** | P4-3 SSE Session 复用 | 15min | 消除连接泄漏 | 进行中任务用户 |
| **P3** | P3-1 复合索引 | 10min | 列表查询提速 2~10x | 所有用户 |
| **P3** | P3-2 补充分页端点 | 20min | 防止大表全量返回 | 所有用户 |
| **P3** | P3-3 前端分页参数 | 10min | 支持翻页 | 所有用户 |
| **P4** | P4-4 batch 限制任务加载 | 15min | 单次查询从 5000 → ~200 条 | 企业用户 |
| **P4** | P4-5 assistant/ask 字段裁剪 | 10min | 减少内存占用 | 追问用户 |

---

## 六、实施状态总览

| 状态 | 数量 | 项目 |
|---|---|---|
| ✅ 已完成 | 14 项 | P0-1/2/3, P1-1/2/3/4, P2-1/2/3/5/6/7/8, P3-1a/1b/1c, P4-2/3/4 |
| ❌ 待实施（新增） | 3 项 | P4-1(admin/stats), P4-5(ask fields), P4-6/7(async DB + audit fire-and-forget) |
| ❌ 待实施（P3 补充） | 1 项 | P3-2(4 pagination endpoints) |

---

## 七、验证方案

| 优化项 | 验证方法 |
|---|---|
| 启动速度 | `time python -c "import app.main"` 对比前后 |
| API 列表接口 | 浏览器 DevTools → Network，对比前后响应时间 |
| N+1 修复 | SQLAlchemy echo 模式，确认单条列表请求 SQL 条数 |
| 前端首屏 | Chrome DevTools → Network → JS 总大小对比 |
| 路由懒加载 | Network 面板确认切换路由时才加载对应 chunk |
| Store 并行 | React DevTools Profiler 确认 reload 只发 1 次而非 2 次 |
| 条件轮询 | Network 面板确认无运行中任务时无轮询请求 |
| 索引生效 | `EXPLAIN QUERY PLAN SELECT ...` 确认使用新索引 |
| 分页 | 创建 100+ 条数据，确认列表只返回 page_size 条 |
| admin/stats | 创建 1000+ 用户，确认 `/api/admin/stats` 响应 < 200ms |
| SSE | 开启 SSE 连接 5 分钟，确认无 Session 累积 |
| delete_account | 用户有 500+ tasks 时注销，确认秒级完成 |
