# 竞品调研 Agent / Competitive Research Agent

> SaaS 化竞品调研 Agent —— 联网检索、全链路引用溯源、SSE 实时进度、商业化账号体系

[English](#english-version) · [中文](#中文版本)

---

## 中文版本

### 概述

一个可商用交付的 SaaS 化竞品调研 Agent 应用。输入任意产品/公司名称（可选指定竞品与调研重点），它会自动完成以下全流程：

1. **规划**——LLM 确定竞品清单，生成多组带维度标签的检索关键词（组数由用户套餐决定）
2. **联网检索**——并发调用 Tavily API 搜索，按 URL 去重入库，并对每条来源做可信度分级
3. **对比分析**——LLM 基于检索材料按维度提炼，每条论断强制携带 `[n]` 引用编号；同时生成结构化数据洞察（评分/SWOT/定位）
4. **生成报告**——产出 Markdown 竞品调研报告（执行摘要、功能对比表、定价对比、SWOT、结论建议、可信度说明、来源引用），支持一键导出 PDF / Word / Markdown

全过程通过 SSE 实时推送执行进度，前端以一体化执行视图（阶段步骤条 + 时间线）展示。

系统内置完整的商业化账号体系：邮箱注册登录（JWT + 会话版本控制）、三级会员套餐与月度配额、模拟支付升级、订单记录、管理员后台，以及成熟的账号管理能力（改资料/改密码/忘记密码/登录历史/退出所有设备/账号注销/用量统计）。

### 设计原则

所有功能实现的上位约束：

| 编号 | 原则 | 含义 |
|------|------|------|
| P-01 | 全链路引用溯源 | 报告中每条论断携带 `[n]` 角标，可点击回溯到来源卡片与原文摘录 |
| P-02 | 信息不足明示 | 检索材料未覆盖的内容明确标注"信息不足"，不允许 LLM 编造 |
| P-03 | 来源分级可信 | 每条来源按 official / media / community / other 分级，附相关度评分与时效信息 |
| P-04 | 渐进式降级 | 数据洞察生成失败不阻断报告主流程，仅记录失败步骤后继续 |
| P-05 | 商业化内建 | 检索规模、月度次数由用户套餐决定（免费/专业/企业三级） |

### 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│              用户输入（产品名称 + 可选竞品 / 调研重点）              │
└──────────────────────────┬───────────────────────────────────────┘
                           │ POST /api/research（配额校验）
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI 后端（REST + SSE）                                       │
│  JWT 鉴权（会话版本控制）· 用户数据隔离 · BackgroundTasks 触发     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ run_research(task_id)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Agent 编排（services/agent.py）                                  │
│  planning（规划关键词组）                                          │
│    → searching（Tavily 并发检索 + URL 去重 + 来源分级）            │
│    → analyzing（按维度分析 + [n] 引用 + 数据洞察 JSON）            │
│    → reporting（Markdown 报告 + 程序化可信度统计注入）             │
│  每步写入 task_steps，SSE 实时推送                                 │
└──────────────────────────┬───────────────────────────────────────┘
                           │ SQLite（tasks / steps / sources）
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  React 前端                                                       │
│  执行视图（阶段步骤条 + 实时时间线 + 用时计时）                     │
│    → 报告 Tab（封面头 / 右侧目录 / 引用角标 / 来源章节卡片化）      │
│    → 数据洞察 Tab（雷达图 / 评分对比 / SWOT 矩阵）                 │
│    → 信息来源 Tab（分级统计 / 筛选排序 / 来源详情抽屉）             │
│    → 导出 PDF · Word · Markdown · 浏览器打印                       │
└──────────────────────────────────────────────────────────────────┘
```

### Agent 流水线各阶段职责

| 阶段 | status | 职责 |
|------|--------|------|
| **规划** | `planning` | LLM 产出竞品清单 + 按套餐上限（4/8/12 组）的检索关键词，每组带维度标签 |
| **检索** | `searching` | 并发调用 Tavily（每组最多 5 条，URL 去重），启发式来源分级后全字段入库；入库顺序 = 材料编号 = 前端引用角标编号 |
| **分析** | `analyzing` | 材料按维度分组呈现给 LLM，prompt 强制每条论断紧跟 `[n]` 引用；额外一次 JSON 调用产出数据洞察（失败不阻断） |
| **报告** | `reporting` | 生成 Markdown 报告，正文保持 `[n]` 引用；程序化统计来源分级构成/时间跨度/维度覆盖后注入"可信度说明"章节 |

### 输出交付物

| 交付物 | 说明 |
|--------|------|
| 调研报告 | Markdown 报告：执行摘要、功能对比表、定价对比、SWOT、结论建议、可信度说明；引用角标可点击溯源 |
| 数据洞察 | 结构化 JSON：五维评分（雷达图/条形对比）、SWOT 四象限、各产品一句话定位、总体结论 |
| 信息来源 | 分级来源列表：概览统计、可信度分布条、分级/维度筛选、三种排序、来源详情抽屉（含原文摘录） |
| 报告导出 | PDF（A4 自动分页）/ Word（页面视图 + A4 页边距）/ Markdown / 浏览器打印，独立离屏模板与页面布局解耦 |

### 会员套餐

| 套餐 | 价格 | 月度调研次数 | 检索关键词组/次 | 优先队列 |
|------|------|------------|----------------|---------|
| 免费版 | ¥0 | 3 | 4 | — |
| 专业版 | ¥99/月 | 30 | 8 | ✓ |
| 企业版 | ¥399/月 | 不限 | 12 | ✓ |

升级走模拟支付：支付即生效 30 天，同套餐续费自动顺延，付费到期自动回落免费版。

### 快速开始

#### 环境要求

- Python 3.12+
- Node.js 18+
- LLM API Key（任意 OpenAI 兼容服务：DeepSeek / 通义千问 / Kimi / OpenAI 等）
- Tavily API Key（[tavily.com](https://tavily.com) 免费注册，1000 次/月）

#### 配置

```powershell
Copy-Item backend\.env.example backend\.env
```

编辑 `backend/.env`：

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`：例如 DeepSeek 填 `https://api.deepseek.com/v1` + `deepseek-chat`；通义千问填 `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen-plus`
- `TAVILY_API_KEY`：Tavily 检索密钥
- `JWT_SECRET`：生产环境务必改为随机长字符串

#### 后端启动（端口 8000）

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

首次启动自动建表并播种默认管理员。API 文档在 `http://localhost:8000/docs`。

#### 前端启动（端口 5173）

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，Vite proxy 将 `/api` 请求转发到后端。

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, SSE, PyJWT, bcrypt |
| Agent | OpenAI 兼容 LLM（DeepSeek / 通义千问 / Kimi 等），Tavily 联网检索 |
| 前端 | React 18, TypeScript, Vite 5, Tailwind CSS 4, react-router 6 |
| 报告渲染 | react-markdown + remark-gfm, recharts, html2pdf.js |
| 数据校验 | Pydantic v2 |
| 存储 | SQLite（MVP），可迁移到 PostgreSQL |

### 项目结构

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（CORS、路由注册、建表+轻量迁移、播种管理员）
│   │   ├── core/
│   │   │   ├── config.py        # 环境变量配置（pydantic-settings，含 JWT_SECRET）
│   │   │   ├── plans.py         # 会员套餐权益表与有效套餐计算
│   │   │   └── security.py      # bcrypt 密码哈希 + JWT 签发/校验（含会话版本 ver）
│   │   ├── db/                  # SQLAlchemy engine + ORM 模型（User/Order/LoginLog/Task/Step/Source）
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── api/
│   │   │   ├── deps.py          # 认证依赖（token 版本校验）+ 配额计算
│   │   │   ├── auth.py          # 注册/登录/资料/改密码/登录历史/退出所有设备/注销/用量/忘记密码
│   │   │   ├── research.py      # 调研任务 REST + SSE（鉴权 + 用户隔离 + 配额）
│   │   │   ├── billing.py       # 套餐列表/模拟支付升级/订单
│   │   │   └── admin.py         # 管理后台统计与用户管理
│   │   └── services/
│   │       ├── llm.py           # OpenAI 兼容 LLM 客户端
│   │       ├── search.py        # Tavily 检索客户端
│   │       └── agent.py         # Agent 编排（规划→检索→分析→报告）
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    └── src/
        ├── api/                 # API client（Bearer token 注入、401 处理）+ SSE 订阅
        ├── auth/                # AuthContext + 路由守卫（RequireAuth/RequireAdmin）
        ├── layouts/             # 工作台侧边栏布局
        ├── pages/               # 营销首页、登录/注册/忘记密码、app/ 下各工作台页面
        ├── components/          # 阶段步骤条、进度时间线、报告渲染、目录、来源抽屉、洞察图表等
        └── utils/               # 报告导出模块（PDF/Word/Markdown 独立模板）、来源章节拆分
```

### API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册并返回 JWT | — |
| POST | `/api/auth/login` | 登录并返回 JWT | — |
| GET | `/api/auth/me` | 当前用户信息 | 用户 |
| PATCH | `/api/auth/profile` | 修改昵称/头像 | 用户 |
| POST | `/api/auth/change-password` | 修改密码（旧 token 全部失效） | 用户 |
| GET | `/api/auth/logins` | 最近 20 条登录历史 | 用户 |
| POST | `/api/auth/logout-all` | 退出所有设备 | 用户 |
| DELETE | `/api/auth/account` | 注销账号（级联删除全部数据） | 用户 |
| GET | `/api/auth/usage` | 近 6 个月用量 + 本月配额 | 用户 |
| POST | `/api/auth/forgot` · `/reset` | 忘记密码验证码 / 重置 | — |
| GET | `/api/research/quota` | 本月配额与用量 | 用户 |
| POST | `/api/research` | 创建调研任务（校验配额） | 用户 |
| GET | `/api/research` · `/{id}` | 任务列表 / 详情 | 用户 |
| GET | `/api/research/{id}/events?token=…` | SSE 实时进度 | 用户 |
| GET | `/api/research/{id}/sources/{sid}` | 来源详情（含原文摘录） | 用户 |
| DELETE | `/api/research/{id}` | 删除任务 | 用户 |
| GET | `/api/billing/plans` · `/orders` | 套餐列表 / 我的订单 | — / 用户 |
| POST | `/api/billing/upgrade` | 模拟支付升级套餐 | 用户 |
| GET | `/api/admin/stats` · `/users?q=` | 运营统计 / 用户搜索 | 管理员 |
| PATCH | `/api/admin/users/{id}` | 调整用户套餐/角色 | 管理员 |

### 默认账号（仅开发环境）

首次启动自动创建管理员账号：

- 邮箱：`admin@example.com`
- 密码：`Admin123456`

正式部署前请修改 `JWT_SECRET` 和管理员密码。

### 详细文档

完整的交接与技术实现文档见 [HANDOFF.md](HANDOFF.md)，包含：

- Agent 流水线各阶段的精确行为与来源分级规则
- 数据洞察 JSON 契约
- 数据模型与轻量迁移机制
- 账号体系安全机制（JWT 会话版本控制）
- 报告导出（PDF/Word）踩坑备忘

---

## English Version

### Overview

A production-ready SaaS competitive research agent. Given any product or company name (with optional competitor list and research focus), it automatically:

1. **Plans** — the LLM determines the competitor list and generates multiple groups of dimension-tagged search keywords (group count depends on the user's plan)
2. **Searches the web** — concurrent Tavily API calls, URL-deduplicated, with per-source credibility tiering
3. **Analyzes** — the LLM synthesizes findings per dimension from retrieved material; every claim must carry an `[n]` citation; a structured insights JSON (scores / SWOT / positioning) is generated alongside
4. **Reports** — produces a Markdown competitive research report (executive summary, feature comparison table, pricing comparison, SWOT, conclusions, credibility notes, source citations), exportable to PDF / Word / Markdown in one click

Execution progress is streamed in real time via SSE and rendered as a unified execution view (phase stepper + live timeline).

The system ships with a complete commercial account stack: email registration/login (JWT + session versioning), three-tier membership plans with monthly quotas, simulated payment upgrades, order history, an admin console, and mature account management (profile / password change / password reset / login history / logout-all-devices / account deletion / usage stats).

### Design Principles

Upper-level constraints on all feature implementations:

| # | Principle | Meaning |
|---|-----------|---------|
| P-01 | Full citation traceability | Every claim in the report carries a clickable `[n]` superscript tracing back to the source card and verbatim excerpt |
| P-02 | Explicit data gaps | Content not covered by retrieved material is explicitly marked as insufficient — the LLM must not fabricate |
| P-03 | Tiered source credibility | Every source is tiered as official / media / community / other, with relevance score and recency info |
| P-04 | Graceful degradation | Insights-generation failure never blocks the main report flow; a failure step is logged and the pipeline continues |
| P-05 | Built-in commercialization | Search scale and monthly quota are plan-driven (free / pro / enterprise) |

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│         User Input (product name + optional competitors/focus)    │
└──────────────────────────┬───────────────────────────────────────┘
                           │ POST /api/research (quota check)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (REST + SSE)                                     │
│  JWT auth (session versioning) · per-user data isolation          │
│  BackgroundTasks trigger                                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │ run_research(task_id)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Agent Orchestration (services/agent.py)                          │
│  planning (keyword groups)                                        │
│    → searching (concurrent Tavily + dedupe + source tiering)      │
│    → analyzing (per-dimension analysis + [n] citations            │
│                 + insights JSON)                                  │
│    → reporting (Markdown report + programmatic credibility stats) │
│  Every step written to task_steps and pushed via SSE              │
└──────────────────────────┬───────────────────────────────────────┘
                           │ SQLite (tasks / steps / sources)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  React Frontend                                                   │
│  Execution view (phase stepper + live timeline + elapsed timer)   │
│    → Report tab (cover header / TOC / citation superscripts       │
│                  / structured sources section)                    │
│    → Insights tab (radar chart / score bars / SWOT grid)          │
│    → Sources tab (tier stats / filter & sort / detail drawer)     │
│    → Export PDF · Word · Markdown · browser print                 │
└──────────────────────────────────────────────────────────────────┘
```

### Pipeline Stages

| Stage | status | Responsibility |
|-------|--------|----------------|
| **Planning** | `planning` | LLM produces the competitor list plus plan-capped (4/8/12 groups) search keywords, each group tagged with a dimension |
| **Searching** | `searching` | Concurrent Tavily calls (max 5 results per group, URL-deduplicated); heuristic source tiering, then full-field persistence; insertion order = material number = frontend citation number |
| **Analyzing** | `analyzing` | Material grouped by dimension for the LLM; prompt enforces `[n]` citations after every claim; one extra JSON call produces the insights payload (failure never blocks) |
| **Reporting** | `reporting` | Generates the Markdown report keeping `[n]` citations; programmatically computed source-tier composition / time span / dimension coverage is injected into a "credibility notes" section |

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Research Report | Markdown report: executive summary, feature comparison, pricing comparison, SWOT, conclusions, credibility notes; clickable citation superscripts |
| Data Insights | Structured JSON: five-dimension scores (radar / bars), SWOT quadrants, one-line positioning per product, overall verdict |
| Sources | Tiered source list: overview stats, credibility distribution bar, tier/dimension filters, three sort orders, detail drawer with verbatim excerpts |
| Export | PDF (A4 auto-pagination) / Word (Print view + A4 margins) / Markdown / browser print — standalone off-screen template decoupled from page layout |

### Membership Plans

| Plan | Price | Research runs / month | Keyword groups / run | Priority queue |
|------|-------|----------------------|---------------------|----------------|
| Free | ¥0 | 3 | 4 | — |
| Pro | ¥99/mo | 30 | 8 | ✓ |
| Enterprise | ¥399/mo | Unlimited | 12 | ✓ |

Upgrades go through a simulated payment flow: effective for 30 days on payment, same-plan renewals extend the expiry, and expired paid plans fall back to Free automatically.

### Quick Start

#### Requirements

- Python 3.12+
- Node.js 18+
- An LLM API key (any OpenAI-compatible service: DeepSeek / Qwen / Kimi / OpenAI, etc.)
- A Tavily API key ([tavily.com](https://tavily.com), free tier 1000 calls/month)

#### Configuration

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env`:

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — e.g. DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`; Qwen: `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen-plus`
- `TAVILY_API_KEY` — Tavily search key
- `JWT_SECRET` — change to a long random string in production

#### Backend (port 8000)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Tables are created and a default admin is seeded on first start. API docs at `http://localhost:8000/docs`.

#### Frontend (port 5173)

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`; the Vite proxy forwards `/api` requests to the backend.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, SSE, PyJWT, bcrypt |
| Agent | OpenAI-compatible LLM (DeepSeek / Qwen / Kimi, etc.), Tavily web search |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS 4, react-router 6 |
| Report rendering | react-markdown + remark-gfm, recharts, html2pdf.js |
| Validation | Pydantic v2 |
| Storage | SQLite (MVP), migratable to PostgreSQL |

### Project Layout

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry (CORS, routing, create_all + light migration, admin seeding)
│   │   ├── core/                # config (pydantic-settings), plan entitlements, bcrypt + JWT w/ session version
│   │   ├── db/                  # SQLAlchemy engine + ORM models (User/Order/LoginLog/Task/Step/Source)
│   │   ├── schemas/             # Pydantic request/response models
│   │   ├── api/                 # auth / research (REST+SSE) / billing / admin / deps (auth + quota)
│   │   └── services/            # llm client, tavily client, agent orchestration
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    └── src/
        ├── api/                 # API client (Bearer injection, 401 handling) + SSE subscription
        ├── auth/                # AuthContext + route guards (RequireAuth/RequireAdmin)
        ├── layouts/             # workspace sidebar layout
        ├── pages/               # landing, login/register/forgot, app/ workspace pages
        ├── components/          # phase stepper, step timeline, report view, TOC, source drawer, charts…
        └── utils/               # report export (PDF/Word/Markdown standalone templates), section splitting
```

### API Overview

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/register` | Register, returns JWT | — |
| POST | `/api/auth/login` | Login, returns JWT | — |
| GET | `/api/auth/me` | Current user | User |
| PATCH | `/api/auth/profile` | Update nickname/avatar | User |
| POST | `/api/auth/change-password` | Change password (invalidates old tokens) | User |
| GET | `/api/auth/logins` | Last 20 login records | User |
| POST | `/api/auth/logout-all` | Logout all devices | User |
| DELETE | `/api/auth/account` | Delete account (cascading) | User |
| GET | `/api/auth/usage` | 6-month usage + current quota | User |
| POST | `/api/auth/forgot` · `/reset` | Password reset code / reset | — |
| GET | `/api/research/quota` | Monthly quota & usage | User |
| POST | `/api/research` | Create research task (quota-checked) | User |
| GET | `/api/research` · `/{id}` | Task list / detail | User |
| GET | `/api/research/{id}/events?token=…` | SSE live progress | User |
| GET | `/api/research/{id}/sources/{sid}` | Source detail (verbatim excerpt) | User |
| DELETE | `/api/research/{id}` | Delete task | User |
| GET | `/api/billing/plans` · `/orders` | Plans / my orders | — / User |
| POST | `/api/billing/upgrade` | Simulated payment upgrade | User |
| GET | `/api/admin/stats` · `/users?q=` | Ops stats / user search | Admin |
| PATCH | `/api/admin/users/{id}` | Adjust user plan/role | Admin |

### Default Account (dev only)

A default admin is seeded on first start:

- Email: `admin@example.com`
- Password: `Admin123456`

Change `JWT_SECRET` and the admin password before production deployment.

### Documentation

See [HANDOFF.md](HANDOFF.md) for the full handoff & implementation document, covering:

- Exact per-stage pipeline behavior and source tiering rules
- The insights JSON contract
- Data models and the lightweight migration mechanism
- Account security mechanics (JWT session versioning)
- Report export (PDF/Word) pitfalls and workarounds
