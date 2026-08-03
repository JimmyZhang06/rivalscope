# 02. 系统架构

> **竞品调研 Agent**
> 版本：v7.0.0 · 日期：2026-08-03 · 分支：agent-v7

## 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端层 (React + TypeScript)                                    │
│  路由 → 页面 → 组件 → API Client → 状态管理 (React Context)     │
├─────────────────────────────────────────────────────────────────┤
│  API 层 (FastAPI Routers)                                       │
│  鉴权依赖 → 业务端点 → 响应序列化 (Pydantic Schemas)            │
│  ├─ 限流依赖 (rate_limit_dep — 同步返回 bool) │
│  ├─ 认证依赖 (get_current_user) │
│  │   └─ decode_access_token → token_version 校验 │
│  ├─ 配额依赖 (check_quota_or_403) │
│  └─ RBAC 依赖 (require_permission) │
│  └─ 统一权限 (check_access / is_admin) │ v5.5.0 新增
├─────────────────────────────────────────────────────────────────┤
│  服务层 (Services)                                              │
│  Agent 编排 → LLM 调用 → 搜索 → 去重/置信度/快照 → 通知        │
│  ├─ 审计日志 (audit.py)                                         │
│  ├─ 竞品画像 (profiles.py + profile_extractor.py + profile_report.py) │
│  ├─ 横向对比 (comparison.py)                                    │
│  └─ 竞品爬虫 (crawler.py) ── v5 新增语言感知 + consent 剥离    │
├─────────────────────────────────────────────────────────────────┤
│  数据层 (SQLAlchemy ORM + SQLite)                               │
│  23 张表 ORM → 会话管理 → 查询/写入                             │
├─────────────────────────────────────────────────────────────────┤
│  外部服务                                                        │
│  LLM 提供商 (DeepSeek 等) · Tavily 搜索 · SMTP · Webhook       │
└─────────────────────────────────────────────────────────────────┘
```

## 2.2 前后端通信

### 协议

| 通信方式 | 用途 | 实现 |
|----------|------|------|
| REST (JSON) | 常规 CRUD 操作 | FastAPI + `fetch` 封装 |
| SSE (EventSource) | 调研任务实时进度推送 | `sse-starlette` + `EventSource` |
| FormData (multipart) | 邮件附件上传 | 原生 `fetch` + `FormData` |

### 认证方式

| 场景 | 方式 | 实现位置 |
|------|------|----------|
| REST API | `Authorization: Bearer <access_token>` | Header |
| SSE 长连接 | `?token=<access_token>` 查询参数 | 因 EventSource 不支持自定义 Header |
| Refresh | `POST /api/auth/refresh` with refresh_token | Body |

### 前端架构

- **路由**：`react-router-dom` v6，`/app/*` 全部路由需认证
- **状态管理**：`AuthContext`（用户登录态）+ `useState`/`useEffect`（组件级）+ `useErrorHandler` + `usePageTitle`
- **实时更新**：TasksPage/TrackersPage/GraphPage 使用轮询（3s~5s），TaskDetail 使用 SSE
- **文件导出**：`exportReport.tsx` 支持 PDF (`html2pdf.js`)、Word（HTML MIME）、Markdown（blob 下载）、浏览器打印

## 2.3 后端核心流程

### 应用启动 (`main.py`)

```
启动序列：
1. Base.metadata.create_all()     → 创建所有数据库表
2. migrate_columns()              → 轻量迁移：补充缺失列（SQLite ALTER ADD COLUMN）
3. seed_admin()                   → 若无管理员账号，创建默认 admin@example.com
4. _assert_jwt_secret()           → 校验 JWT_SECRET 已配置
5. 启动调度器线程 (scheduler_loop) → lifespan 事件中 asyncio.create_task
```

### 请求生命周期

```
Request
  │
  ├─ CORS 中间件
  ├─ 路由匹配
  │   ├─ 限流依赖 (rate_limit_dep)
  │   ├─ 认证依赖 (get_current_user)
  │   │   └─ decode_access_token → token_version 校验
  │   ├─ 配额依赖 (check_quota_or_403)
  │   ├─ RBAC 依赖 (require_permission)
  │   └─ 统一权限 (check_access / is_admin)          ← v5.5.0
  │
  ├─ 服务层调用
  │   ├─ LLM 调用 → audit 记录
  │   ├─ 搜索调用
  │   └─ DB 操作
  │
  └─ Pydantic 响应序列化 → JSON
```

## 2.4 数据流向

```
用户创建调研任务
    │
    ▼
run_research() [后台 asyncio 任务]
    │
    ├─ [_plan]        LLM → 竞品清单 + 检索关键词
    ├─ [_search_all]  Tavily → 搜索结果
    ├─ [去重/置信度]   dedup.py → URL去重 + 标题相似度 + 置信度 + 冲突检测
    ├─ [快照存档]     snapshot.py → HTML + 纯文本 + 采集元数据
    ├─ [_analyze]     LLM → 维度分析（带 [n] 引用标记）
    ├─ [_insights]    LLM → 结构化评分/SWOT（非阻塞）
    ├─ [_timeline]    LLM → 事件时间线（非阻塞）
    ├─ [_report]      LLM → Markdown 报告
    └─ [通知]         push_tracker_report → 站内/邮件/Webhook
    │
    ▼
前端通过 SSE 接收 step/status 事件
    │
    ▼
任务完成后，前端展示报告/洞察/来源三 Tab
```

## 2.5 后台任务模型

> **不使用 Celery/Redis 等外部任务队列**，全部使用 `asyncio.create_task()` 在进程内并发执行。

| 触发方式 | 任务 | 实现 |
|----------|------|------|
| 用户创建调研 | `run_research(task_id)` | BackgroundTasks + `asyncio.create_task` |
| 用户创建图谱 | `build_graph(project_id)` | BackgroundTasks + `asyncio.create_task` |
| 调度器扫描到期 | `run_research(task_id)` | `scheduler_loop()` 中 `asyncio.create_task` |
| 手动触发追踪 | `run_research(task_id)` | 同用户创建 |

**并发控制**：`scheduler.py` 使用内存 `_running: set[str]` 防止同一 tracker 重复执行。

## 2.6 审计日志防篡改

启动时通过 `backend/app/db/audit_triggers.py` 创建 SQLite BEFORE UPDATE/DELETE 触发器保护 `audit_logs` 表，任何修改/删除审计日志的操作都会被数据库 abort 并返回错误。

## 2.7 安全架构

| 层次 | 机制 | 实现 |
|------|------|------|
| 认证 | JWT + Refresh Token | `core/security.py`（Access 8h / Refresh 30d） |
| 授权 | RBAC 细粒度权限 | `user_permissions` 表 + `require_permission` 装饰器 |
| 限流 | 令牌桶 | `core/rate_limit.py`（按 IP + 端点分类）+ `core/rate_limit_user.py`（按 user_id） |
| 加密 | Fernet 对称加密 | `core/crypto.py`（AES-128-CBC + HMAC） |
| 审计 | 操作日志 + LLM 调用记录 + DB 级防篡改 | `services/audit.py` + `audit_logs` 表 + `audit_triggers.py` |
| 追溯 | 执行快照 | `execution_snapshots` 表 + 调度器自动生成 |
