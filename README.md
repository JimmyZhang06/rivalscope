# 竞品调研 Agent / Competitive Research Agent

> **版本**: v7.0.0 | **日期**: 2026-08-03 | **分支**: agent-v7
> This work is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License](https://creativecommons.org/licenses/by-nc/4.0/).

> SaaS 化竞品情报平台 —— 联网检索、全链路引用溯源、SSE 实时进度、定时追踪、关系图谱、竞品画像、全局 AI 助手、企业组织与商业化账号体系

[English](#english-version) · [中文](#中文版本)

---

## 中文版本

### 1. 概述

一个可商用交付的 SaaS 化竞品情报平台。围绕"竞品调研 Agent"核心流水线，扩展出定时追踪、产业链关系图谱、竞品画像、报告问答与全局 AI 助手等能力：

1. **竞品调研**——输入产品/公司名称（可选竞品与调研重点），Agent 自动完成：规划关键词 → Tavily 联网检索 → 按维度对比分析（每条论断携带 `[n]` 引用）→ 数据洞察（评分/SWOT/定位）→ 事件时间线 → Markdown 报告，支持导出 PDF / Word / Markdown
2. **时效引擎**——所有 LLM 提示词注入当前日期，检索词自带时效约束，可指定检索时间范围（天/周/月/年）；来源发布时间解析、距今天数与新鲜度分布统计注入报告"可信度说明"
3. **定时追踪**——按日/周/月频率自动执行调研，期次间自动生成"变更摘要"，支持站内通知、邮件与 Webhook（企业微信/钉钉/飞书/通用）推送；内置调度器每 60 秒扫描到期追踪项
4. **关系图谱**——以任意企业/产品为根对象，联网抽取产业链关系网络（上下游/竞争/合作/投资/母子公司），可视化画布展示并支持一键重建
5. **竞品画像**——结构化画像模板 → 基于已有来源生成竞品画像 → 冻结锁定 → 多份画像横向对比；画像详情支持报告/洞察/来源/维度四 Tab，预生成报告+洞察存入缓存
6. **报告问答与全局 AI 助手**——既可针对单份报告追问，也可在任意页面通过右下角悬浮球或独立页向 AI 助手提问，助手自动定位最相关的报告作为上下文并附引用链接，**不占调研额度**
7. **企业组织**——邀请码加入、owner/admin/member 三级企业角色、企业套餐共享配额、成员月额度管控、RBAC 细粒度权限、任务/追踪/图谱企业内共享可见
8. **安全增强**——JWT + Refresh Token（Access 8h / Refresh 30d）、会话版本控制、令牌桶限流、Fernet 加密、审计日志、执行快照
9. **商业化账号体系**——邮箱注册登录、三级会员套餐与月度配额、模拟支付升级、订单记录、站内通知、管理员后台（用户 + 企业管理 + 审计日志 + 执行快照）
10. **爬虫增强**——多语言网站智能识别（自动检测 /cn/、/en/ 等语言路径前缀），sitemap 多路径发现（`/{lang}/sitemap.xml`），隐私 consent overlay 自动 stripping（OneTrust/CCPA/GDPR），Chrome UA 降低被拦截率
11. **性能优化**——SSE 长连接改为单 session 复用 + seq 增量查询（消除 O(n) offset 开销），追踪列表批量加载（窗口函数一次查询），调研/追踪列表分页支持（page/page_size），账号注销批量删除，git hash 启动时一次性缓存
12. **安全加固**——审计日志数据库级触发器（防篡改），画像提取任务进程重启自动恢复，启动时 JWT_SECRET 强度校验与生产环境警告，reset_code 列修正为 VARCHAR(44) 适配 Fernet 加密输出
13. **用户级限流**——补充 IP 级限流，防止 IP 共享场景下的滥用（`core/rate_limit_user.py`）
14. **画像报告服务**——新增 `services/profile_report.py`，预生成画像报告+洞察存入 `profile_data` 缓存，前端优先读取缓存避免懒加载失败
15. **数据播种脚本**——新增 `scripts/seed_data.py`，一键播种测试数据（用户、组织、竞品、画像模板、调研任务等）

全过程通过 SSE 实时推送执行进度，前端以一体化执行视图（阶段步骤条 + 时间线）展示。

### 2. 设计原则

所有功能实现的上位约束：

| 编号 | 原则 | 含义 |
|------|------|------|
| P-01 | 全链路引用溯源 | 报告中每条论断携带 `[n]` 角标，可点击回溯到来源卡片与原文摘录；AI 助手回答附来源报告链接 |
| P-02 | 信息不足明示 | 检索材料未覆盖的内容明确标注"信息不足"，不允许 LLM 编造 |
| P-03 | 来源分级可信 | 每条来源按 official / media / community / other 分级，附相关度评分、发布时间与距今天数、置信度 |
| P-04 | 渐进式降级 | 数据洞察/变更摘要生成失败不阻断报告主流程；AI 助手报告定位失败自动回退关键词匹配 |
| P-05 | 商业化内建 | 检索规模、月度次数、追踪项数量均由套餐决定（免费/专业/企业三级，个人与企业双维度） |
| P-06 | 时间意识 | 所有 LLM 调用注入当前日期，优先采信近期信息，报告统计来源新鲜度分布 |
| P-07 | 可审计可追溯 | 关键操作写入审计日志，LLM 调用记录 token 消耗与费用，调度器生成执行快照 |

### 3. 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│  用户入口                                                            │
│  新建调研 / 定时追踪(自动) / 关系图谱 / 竞品画像 / 报告问答 / 全局 AI 助手 │
└───────────────┬────────────────────────────────────────────────────┘
                │ REST（配额校验：任务+图谱 计入，失败不计，助手/画像不计）
                ▼
┌────────────────────────────────────────────────────────────────────┐
│  FastAPI 后端（REST + SSE）                                          │
│  JWT 鉴权（会话版本控制）· 企业/个人数据隔离 · BackgroundTasks        │
│  ├─ 调度器线程（60s 扫描 trackers，配额不足跳过本期并通知）           │
│  ├─ Agent 编排：planning → searching → dedup/confidence/conflict    │
│  │   → snapshot → analyzing → insights/timeline → reporting          │
│  ├─ 图谱构建：实体/关系抽取（graph_agent.py）                        │
│  ├─ 竞品画像：模板管理 + 画像生成 + 冻结 + 横向对比                  │
│  ├─ 变更摘要：期次对比 digest（站内/邮件/Webhook 推送）               │
│  ├─ AI 助手：多会话管理（session CRUD）+ 报告定位（LLM 选择+关键词回退）→ 多轮问答  │
│  ├─ 安全：限流 / Fernet 加密 / 审计日志 / 执行快照                  │
│  └─ 竞品爬虫：结构化提取竞品官网信息（crawl.py）                      │
└───────────────┬────────────────────────────────────────────────────┘
                │ SQLite（users/orgs/tasks/steps/sources/source_archives/
                │         trackers/graph_*/notifications/assistant_sessions/
                │         assistant_messages/email_logs/competitors/profile_*
                │         user_permissions/audit_logs/execution_snapshots/service_keys…）
                ▼
┌────────────────────────────────────────────────────────────────────┐
│  React 前端                                                          │
│  执行视图（步骤条+SSE 时间线）→ 报告/洞察/来源三 Tab → 导出           │
│  追踪项列表/详情（期次+变更摘要+评分趋势）· 图谱画布                  │
│  竞品管理（卡片 CRUD）· 画像模板/画像/对比 · 审计日志独立页面         │
│  AI 助手（多会话侧栏 + 对话面板，共享服务端历史）· 通知铃铛           │
│  个人中心（企业 Tab + RBAC 权限）· 套餐升级 · 管理后台                │
└────────────────────────────────────────────────────────────────────┘
```

### 4. Agent 流水线各阶段职责

| 阶段 | status | 职责 |
|------|--------|------|
| **规划** | `planning` | LLM 产出竞品清单 + 按套餐上限（4/8/12 组）的检索关键词，每组带维度标签；时效性内容的检索词自动带年份/"最新" |
| **检索** | `searching` | 并发调用 Tavily（每组最多 5 条，URL 去重，可指定 time_range），启发式来源分级 + 发布时间解析后全字段入库 |
| **去重/置信度** | (searching 内) | URL 去重 + 标题相似度去重（阈值 0.85）→ 置信度估算（层级权重 × 新鲜度衰减）→ 冲突检测（同一维度多来源标记 pending） |
| **快照存档** | (searching 内) | 每条来源入库后异步抓取页面存档（HTML 500KB + 纯文本 + 采集元数据），记录 access_status |
| **分析** | `analyzing` | 材料按维度分组呈现给 LLM（附来源类型/发布时间/距今天数/置信度），prompt 强制每条论断紧跟 `[n]` 引用 |
| **洞察** | (analyzing 内) | `_insights` 产出结构化 JSON：五维评分、SWOT、总体结论，存入 `report_data`；**失败不阻断报告** |
| **时间线** | (analyzing 内) | `_timeline` 产出结构化 JSON 合并入 `report_data.timeline`，最多 12 条事件；**失败不阻断报告** |
| **报告** | `reporting` | 生成 Markdown 报告，正文保持 `[n]` 引用；程序化统计来源分级构成/时间跨度/新鲜度分布/维度覆盖后注入"可信度说明"章节 |

追踪期次在此基础上额外执行：与上一期报告对比生成**变更摘要**（change_summary），并按追踪项配置推送站内通知/邮件/Webhook。

### 5. 输出交付物

| 交付物 | 说明 |
|--------|------|
| 调研报告 | Markdown 报告：执行摘要、功能对比表、定价对比、SWOT、结论建议、可信度说明；引用角标可点击溯源 |
| 数据洞察 | 结构化 JSON：五维评分（雷达图/条形对比）、SWOT 四象限、各产品一句话定位、总体结论 |
| 事件时间线 | 结构化 JSON：最多 12 条关键事件（date/title/summary/ref） |
| 来源存证 | 分级来源列表 + 页面快照（HTML/纯文本）+ 置信度 + 冲突标记；概览统计、可信度分布条、分级/维度筛选、三种排序、来源详情抽屉（含快照状态和原文摘录） |
| 变更摘要 | 追踪期次专属：与上一期对比的新增/变化/消失要点 Markdown，随通知推送 |
| 关系图谱 | 实体节点（企业/产品/机构/人物）+ 关系边（含类型/置信度/依据链接）的可视化网络 |
| 竞品画像 | 按冻结模板的固定维度生成结构化画像 → 冻结锁定 → 多份画像横向对比矩阵 |
| AI 问答 | 单报告追问 + 全局助手多轮对话（支持多会话），回答附"📄 报告名"引用链接 |
| 报告导出 | PDF（A4 自动分页）/ Word（页面视图 + A4 页边距）/ Markdown / 浏览器打印 |

### 6. 会员套餐与配额规则

| 套餐 | 价格 | 月度调研次数 | 检索关键词组/次 | 追踪项上限 | 优先队列 |
|------|------|------------|----------------|-----------|---------|
| 免费版 | ¥0 | 3 | 4 | 1 | — |
| 专业版 | ¥99/月 | 30 | 8 | 5 | ✓ |
| 企业版 | ¥399/月 | 不限 | 12 | 20 | ✓ |

**配额统计口径**（详见 HANDOFF.md 配额专章）：

- 按 **UTC 自然月**统计；用量 = 调研任务 + 图谱构建（各计 1 次），**失败任务不计入**
- 个人用户按个人有效套餐计；**加入企业后按企业套餐计，全员共享合并额度**；企业管理员可另设成员月额度（第二重限制）
- 系统管理员（role=admin）视同企业版，配额豁免
- 额度用尽：创建入口返回 403 与中文提示，前端预检禁用/红条附"前往套餐升级"链接；**定时追踪自动跳过本期并站内通知**（同一追踪项每月仅提醒一次），下期照常判断
- 报告问答、全局 AI 助手、竞品画像**不占**调研额度
- 额度达 80% 时自动推送站内预警通知（月内不重复）
- 升级走模拟支付：支付即生效 30 天，同套餐续费自动顺延，付费到期自动回落免费版；企业套餐由企业 owner 升级或系统管理员在后台调整

### 7. 快速开始

#### 环境要求

- Python 3.12+
- Node.js 20.19+
- LLM API Key（任意 OpenAI 兼容服务：DeepSeek / 通义千问 / Kimi / OpenAI 等）
- Tavily API Key（[tavily.com](https://tavily.com) 免费注册，1000 次/月）

#### 配置

```powershell
Copy-Item backend\.env.example backend\.env
```

编辑 `backend/.env`：

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`：例如 DeepSeek 填 `https://api.deepseek.com/v1` + `deepseek-chat`；通义千问填 `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen-plus`
- `TAVILY_API_KEY`：Tavily 检索密钥
- `APP_ENV`：本地使用 `development`，生产环境必须设为 `production`
- `JWT_SECRET`：生产环境必须使用至少 32 字符的随机字符串，否则应用拒绝启动
- `MASTER_KEY`：生产环境必须配置（Fernet 加密密钥，32 字节 base64）
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`：可选的首次管理员初始化；只有两项都显式填写时才创建
- SMTP 相关变量可选：未配置时邮件推送以演示模式落库（email_logs.status=demo）

#### 后端启动（端口 8000）

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

首次启动自动建表 + 轻量迁移，同时启动追踪调度器线程。若需初始化管理员，请先在 `.env` 中显式配置 `SEED_ADMIN_EMAIL` 与强密码 `SEED_ADMIN_PASSWORD`。API 文档在 `http://localhost:8000/docs`。

#### 前端启动（端口 5173）

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，Vite proxy 将 `/api` 请求转发到后端。

### 8. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, SSE, PyJWT, bcrypt |
| Agent | OpenAI 兼容 LLM（DeepSeek / 通义千问 / Kimi / StepFun 等），Tavily 联网检索 |
| 安全 | bcrypt · JWT + Refresh Token · Fernet 加密 · 令牌桶限流 · 审计日志 · 执行快照 |
| 调度 | 后端内置线程调度器（60 秒轮询，无外部依赖） |
| 前端 | React 18, TypeScript, Vite 7, Tailwind CSS 4, react-router 7 |
| 报告渲染 | react-markdown + remark-gfm, recharts, html2pdf.js |
| 数据校验 | Pydantic v2 |
| 存储 | SQLite（MVP），可迁移到 PostgreSQL |

### 9. 项目结构

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（CORS、路由注册、建表+轻量迁移、播种管理员、启动调度器）
│   │   ├── core/
│   │   │   ├── config.py        # 环境变量配置（pydantic-settings，含 JWT_SECRET/MASTER_KEY/SMTP）
│   │   │   ├── plans.py         # ★ 套餐权益唯一权威定义（PLANS/TRACKER_LIMITS/effective_plan/effective_org_plan）
│   │   │   ├── security.py      # bcrypt 密码哈希 + JWT 签发/校验（含会话版本 ver，Access 8h / Refresh 30d）
│   │   │   ├── crypto.py        # Fernet 对称加密（AES-128-CBC + HMAC）
│   │   │   ├── rate_limit.py    # 令牌桶限流（按 IP + 端点分类）
│   │   │   ├── rate_limit_user.py # ★ 用户级限流（补充 IP 级限流，防止 IP 共享滥用）
│   │   │   └── timeutil.py      # 时效引擎工具：baseline_now/parse_published/age_days_of/recency_weight
│   │   ├── db/
│   │   │   ├── database.py      # SQLAlchemy 引擎 + 会话工厂 + WAL 配置
│   │   │   ├── models.py        # 23 张表的 ORM 模型
│   │   │   └── audit_triggers.py # ★ 审计日志数据库级触发器（防 UPDATE/DELETE 篡改）
│   │   ├── schemas/             # Pydantic 模型：auth / research / org / tracker / graph / competitor / profiles
│   │   ├── api/
│   │   │   ├── deps.py          # 认证依赖 + 配额计算（月用量=任务+图谱，失败不计）+ RBAC 权限装饰器
│   │   │   ├── auth.py          # 注册/登录/资料/改密/登录历史/退出所有设备/注销/用量/忘记密码/重置密码
│   │   │   ├── research.py      # 调研任务 REST + SSE + 单报告问答 /ask + 邮件分享 /email
│   │   │   ├── trackers.py      # 定时追踪项 CRUD + run-now + 期次列表
│   │   │   ├── graph.py         # 关系图谱 CRUD + refresh（计入配额）
│   │   │   ├── org.py           # 企业组织：创建/加入/成员管理/退出/RBAC 权限
│   │   │   ├── competitors.py   # 竞品管理：CRUD + 企业/系统级隔离 + 爬虫
│   │   │   ├── profiles.py      # 画像模板 CRUD + 冻结 + 画像生成 + 对比
│   │   │   ├── crawl.py         # 竞品官网爬虫：结构化信息提取
│   │   │   ├── permissions.py   # RBAC 权限查询
│   │   │   ├── notifications.py # 站内通知：列表/未读数/标记已读
│   │   │   ├── assistant.py     # ★ 全局 AI 助手：多会话 CRUD + 跨报告问答（不占配额）
│   │   │   ├── billing.py       # 套餐列表/模拟支付升级（个人+企业）/订单
│   │   │   └── admin.py         # 管理后台：统计 + 用户管理 + 企业管理 + 审计日志 + 执行快照
│   │   └── services/
│   │       ├── agent.py         # ★ 调研 Agent 编排核心（分级/去重/置信度/快照/洞察/可信度/时效引擎）
│   │       ├── graph_agent.py   # 图谱构建（实体/关系抽取 + 分析报告）
│   │       ├── llm.py           # LLM 客户端（chat / chat_json / chat_messages 多轮）+ 审计埋点
│   │       ├── search.py        # Tavily 检索客户端（支持 time_range）
│   │       ├── dedup.py         # 来源去重 + 冲突检测 + 置信度估算
│   │       ├── snapshot.py      # 页面快照抓取（HTML + 纯文本，httpx + BeautifulSoup）
│   │       ├── digest.py        # 期次变更摘要生成（与上一期报告对比）
│   │       ├── notify.py        # 通知分发：站内/邮件(SMTP/演示)/Webhook(企微/钉钉/飞书/通用)
│   │       ├── scheduler.py     # ★ 追踪调度器（60s 扫描 + 配额跳过策略 + 执行快照，git hash 启动缓存）
│   │       ├── audit.py         # 审计日志写入
│   │       ├── profiles.py         # 竞品画像生成 + 冻结
│   │       ├── profile_extractor.py # 竞品画像结构化信息提取（含启动恢复 recover_stale_tasks）
│   │       ├── profile_report.py   # ★ 画像报告/洞察生成（预生成报告+洞察存入 profile_data 缓存）
│   │       ├── comparison.py       # 多份冻结画像横向对比
│   │       └── crawler.py          # 竞品官网爬虫核心逻辑（多语言站点 + consent overlay 移除）
│   ├── scripts/
│   │   └── seed_data.py            # ★ 测试数据播种脚本（用户/组织/竞品/画像/调研任务等）
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    └── src/
        ├── api/                 # types.ts + client.ts（Bearer 注入、401 Refresh 重试、SSE 订阅）
        ├── auth/                # AuthContext + 路由守卫（RequireAuth/RequireAdmin）
        ├── hooks/                # useErrorHandler / usePageTitle
        ├── layouts/             # 工作台侧边栏布局（含通知铃铛、AI 助手悬浮球、企业套餐徽章）
        ├── pages/               # 营销首页、登录/注册/忘记密码
        ├── pages/app/           # 仪表盘/新建调研/任务/追踪/图谱/竞品管理/画像模板/竞品画像/
        │                        # 横向对比/AI 助手/审计日志/套餐/个人中心/管理后台
        ├── components/          # 32 个组件：步骤条、时间线、报告渲染、来源抽屉、洞察图表、追踪表单、
        │                        # 评分趋势、图谱画布、AssistantChat/Widget、QuotaErrorBanner…
        └── utils/               # 报告导出（PDF/Word/Markdown 模板）、来源章节拆分、cn 类名合并、parseUtc
```

### 10. API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/register` · `/login` | 注册 / 登录，返回 JWT + Refresh Token | — |
| POST | `/api/auth/refresh` | Refresh Token 换新 | — |
| GET | `/api/auth/me` | 当前用户信息 | 用户 |
| PATCH | `/api/auth/profile` | 修改昵称/头像 | 用户 |
| POST | `/api/auth/change-password` | 修改密码（token_version+1，旧 token 全部失效） | 用户 |
| GET | `/api/auth/logins` | 最近 20 条登录历史 | 用户 |
| POST | `/api/auth/logout-all` | 退出所有设备（返回新 token） | 用户 |
| DELETE | `/api/auth/account` | 注销账号（密码确认，级联删除全部数据） | 用户 |
| GET | `/api/auth/usage` | 近 6 个月用量 + 本月配额 + 成员用量 | 用户 |
| POST | `/api/auth/forgot` · `/reset` | 忘记密码验证码(Fernet加密) / 重置 | — |
| GET | `/api/me/permissions` | 当前用户 RBAC 权限列表 | 用户 |
| GET | `/api/research/quota` | 本月配额与用量（企业口径优先） | 用户 |
| POST | `/api/research` | 创建调研任务（校验配额） | 用户 |
| GET | `/api/research` · `/{id}` | 任务列表（分页，默认 20）/ 详情（企业内共享可见） | 用户 |
| GET | `/api/research/{id}/sources/{sid}` | 来源详情（含 raw_content + access_status，属主校验） | 用户 |
| GET | `/api/research/{id}/events?token=…` | SSE 实时进度 | 用户 |
| POST | `/api/research/{id}/ask` | 针对单份报告追问（不占配额） | 用户 |
| POST | `/api/research/{id}/email` | 报告邮件分享（附件由前端导出上传） | 用户 |
| DELETE | `/api/research/{id}` | 删除任务（级联删 steps/sources） | 用户 |
| GET/POST | `/api/competitors` | 列出竞品（本企业+系统级）/ 创建 | 用户 |
| PATCH/DELETE | `/api/competitors/{id}` | 修改/删除竞品 | 用户/管理员 |
| POST | `/api/crawl/{cid}/crawl` | 爬取竞品官网信息 | 用户 |
| POST / GET | `/api/trackers` | 创建（套餐限数） / 列表（分页，默认 20） | 用户（需入企） |
| GET / PATCH / DELETE | `/api/trackers/{id}` | 详情 / 修改 / 删除 | 用户（创建人或企业管理员） |
| POST | `/api/trackers/{id}/run-now` | 立即运行一期（占触发人所在口径配额） | 用户（创建人或企业管理员） |
| GET | `/api/trackers/{id}/runs` | 期次任务列表（分页，默认 20） | 用户 |
| POST / GET | `/api/graph` | 创建图谱（占配额） / 列表 | 用户 |
| GET / DELETE | `/api/graph/{id}` | 图谱详情（实体+关系+report_markdown） / 删除 | 用户 |
| POST | `/api/graph/{id}/refresh` | 重建图谱（占配额） | 用户 |
| GET/POST/PATCH/DELETE | `/api/profiles/templates` | 画像模板 CRUD + 冻结 | 用户/管理员 |
| POST | `/api/profiles/generate` | 生成竞品画像 | 用户 |
| GET | `/api/profiles` | 列出画像 | 用户 |
| POST | `/api/profiles/{id}/freeze` | 冻结画像 | 管理员 |
| POST | `/api/profiles/compare` | 横向对比（≥2 份冻结画像） | 用户 |
| GET | `/api/profiles/{id}/report` | 画像报告（缓存优先，预生成报告+洞察） | 用户 |
| GET | `/api/profiles/{id}/insights` | 画像洞察（缓存优先） | 用户 |
| GET | `/api/profiles/{id}/report-full` | 一次性获取画像报告+洞察+来源索引 | 用户 |
| POST | `/api/org` · `/join` · `/leave` | 创建企业 / 邀请码加入 / 退出 | 用户 |
| GET | `/api/org/me` · `/members` | 我的企业 / 成员列表（含各自 month_used + permissions） | 用户 |
| PATCH | `/api/org` | 改企业名 | org owner/admin |
| POST | `/api/org/invite-code/reset` | 重置邀请码 | org owner/admin |
| POST | `/api/org/members/{id}/permissions` | 设置成员 RBAC 权限 | org owner/admin |
| PATCH / DELETE | `/api/org/members/{id}` | 改角色(admin|member)/月额度 / 移出（不能动 owner/自己） | org owner/admin |
| GET | `/api/notifications` · `/unread-count` | 通知列表 / 未读数 | 用户 |
| POST | `/api/notifications/read` | 标记已读 | 用户 |
| GET | `/api/assistant/sessions` | 会话列表（首次访问懒迁移旧消息） | 用户 |
| PATCH / DELETE | `/api/assistant/sessions/{id}` | 重命名 / 删除会话 | 用户 |
| GET / DELETE | `/api/assistant/sessions/{id}/messages` | 会话消息 / 清空 | 用户 |
| POST | `/api/assistant/ask` | 全局 AI 助手提问（不占配额） | 用户 |
| GET | `/api/billing/plans` · `/orders` | 套餐列表 / 我的订单 | — / 用户 |
| POST | `/api/billing/upgrade` | 模拟支付升级（个人或企业） | 用户 |
| GET | `/api/admin/stats` · `/users?q=` | 运营统计 / 用户搜索（分页） | 管理员 |
| PATCH | `/api/admin/users/{id}` | 调整用户套餐/角色 | 管理员 |
| GET | `/api/admin/orgs?q=` | 企业列表（套餐/成员数/本月用量，分页） | 管理员 |
| PATCH | `/api/admin/orgs/{id}` | 调整企业套餐 | 管理员 |
| GET | `/api/admin/audit-logs` | 审计日志（分页 + 5 种筛选） | 管理员 |
| GET | `/api/admin/execution-snapshots` | 执行快照列表 | 管理员 |

### 11. 管理员初始化

项目不再提供固定默认管理员。首次部署时，在 `backend/.env` 中同时填写 `SEED_ADMIN_EMAIL` 和 `SEED_ADMIN_PASSWORD`；创建完成后建议清空这两项。生产环境还必须配置强 `JWT_SECRET` 与 `MASTER_KEY`。

### 12. 详细文档

完整的交接与技术实现文档见 [HANDOFF.md](HANDOFF.md)，包含：

- 权限矩阵（系统管理员 / 企业 owner/admin/member / 个人用户）
- 配额规则专章（统计口径、双重校验、额度用尽行为、调度器跳过策略、记账主体）
- Agent 流水线、时效引擎、定时追踪与调度器、关系图谱、竞品画像、AI 助手实现细节
- 安全增强（JWT+Refresh Token、限流、Fernet 加密、审计日志、执行快照）
- 数据模型全量（23 张表）与轻量迁移机制
- 报告导出（PDF/Word）与其他踩坑备忘

---

## English Version

### 1. Overview

A production-ready SaaS competitive-intelligence platform. Around the core research-agent pipeline it adds scheduled tracking, industry-chain graphs, competitor profiles, report Q&A and a global AI assistant:

1. **Competitive research** — given a product/company name (optional competitors & focus), the agent plans keywords → searches the web via Tavily → analyzes per dimension (every claim carries an `[n]` citation) → generates insights (scores / SWOT / positioning) → event timeline → produces a Markdown report, exportable to PDF / Word / Markdown
2. **Recency engine** — every LLM prompt is injected with the current date; search queries carry recency hints; a search time-range (day/week/month/year) can be specified; source publish dates are parsed and freshness distribution is injected into the report's credibility notes
3. **Scheduled tracking** — runs research automatically on a daily/weekly/monthly cadence, generates a per-run **change digest** against the previous run, and pushes via in-app notification, email, or webhook (WeCom / DingTalk / Feishu / generic); a built-in scheduler scans due trackers every 60 s
4. **Relation graph** — extracts an industry-chain network (upstream/downstream, competitor, partner, investor, parent/subsidiary) around any root company/product, rendered on an interactive canvas with one-click rebuild
5. **Competitor profiles** — structured profile templates → generate profiles from existing sources → freeze lock → multi-profile horizontal comparison matrix
6. **Report Q&A & global AI assistant** — ask questions about a single report, or ask the global assistant from any page (floating bubble or dedicated page); the assistant auto-locates the most relevant reports as context and cites them with links; **does not consume research quota**
7. **Organizations** — invite-code joining, owner/admin/member org roles, org-plan shared quota, per-member monthly limits, RBAC fine-grained permissions, org-wide visibility of tasks/trackers/graphs
8. **Security hardening** — JWT + Refresh Token (Access 8h / Refresh 30d), session versioning, token bucket rate limiting, Fernet encryption, audit logs, execution snapshots
9. **Crawler enhancements** — Multi-language site intelligence (auto-detects /cn/, /en/ language path prefixes), sitemap multi-path discovery (`/{lang}/sitemap.xml`), privacy consent overlay auto-stripping (OneTrust/CCPA/GDPR), Chrome UA to reduce bot blocking
10. **Commercial account stack** — email registration/login, three-tier plans with monthly quotas, simulated payment upgrades, order history, in-app notifications, and an admin console (user + org management + audit logs + execution snapshots)
11. **Performance optimization** — SSE long-polling eliminated O(n) offset cost, tracker list N+1 fixed with window function batch loading, list pagination (page/page_size), account deletion batch cleanup, git hash cached at startup
12. **Security hardening** — Audit log DB-level triggers (tamper-proof), profile extractor task startup recovery, JWT_SECRET strength validation at startup, reset_code column corrected to VARCHAR(44) for Fernet output
13. **User-level rate limiting** — Per-user token bucket complements IP-level rate limiting (`core/rate_limit_user.py`)
14. **Profile report service** — New `services/profile_report.py` pre-generates profile reports + insights into `profile_data` cache; frontend reads cache first to avoid lazy-load failures
15. **Data seeding script** — New `scripts/seed_data.py` for one-click test data seeding (users, orgs, competitors, profiles, research tasks, etc.)

Execution progress is streamed in real time via SSE and rendered as a unified execution view (phase stepper + live timeline).

### 2. Design Principles

| # | Principle | Meaning |
|---|-----------|---------|
| P-01 | Full citation traceability | Every claim carries a clickable `[n]` superscript tracing back to the source card and verbatim excerpt; assistant answers cite source reports with links |
| P-02 | Explicit data gaps | Content not covered by retrieved material is explicitly marked insufficient — the LLM must not fabricate |
| P-03 | Tiered source credibility | Every source is tiered official / media / community / other, with relevance score, publish date, age in days, and confidence score |
| P-04 | Graceful degradation | Insights/digest failures never block the main report flow; assistant report-selection failure falls back to keyword matching |
| P-05 | Built-in commercialization | Search scale, monthly runs, and tracker counts are plan-driven (free / pro / enterprise; personal and org dimensions) |
| P-06 | Time awareness | Every LLM call is date-injected; recent information is prioritized; freshness distribution is reported |
| P-07 | Audit & traceability | Key operations write audit logs; LLM calls record token consumption and cost; scheduler generates execution snapshots |

### 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Entry points                                                       │
│  New research / Trackers (auto) / Graph / Profiles / Report Q&A / AI assistant │
└───────────────┬────────────────────────────────────────────────────┘
                │ REST (quota check: tasks + graphs count, failed
                │       excluded, assistant/profile free)
                ▼
┌────────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (REST + SSE)                                       │
│  JWT auth (session versioning + Refresh Token) · org/personal data isolation  │
│  ├─ Scheduler thread (60 s tracker scan, skips run on quota         │
│  │   exhaustion + notifies, generates execution snapshots)          │
│  ├─ Agent pipeline: planning → searching → dedup/confidence/conflict │
│  │   → snapshot → analyzing → insights/timeline → reporting         │
│  ├─ Graph builder (entity/relation extraction + analysis report)    │
│  ├─ Competitor profiles (templates → generate → freeze → compare)   │
│  ├─ Run digest (in-app / email / webhook push)                      │
│  └─ AI assistant: multi-session management + report locating        │
│      (LLM select + keyword fallback) → multi-turn answering         │
└───────────────┬────────────────────────────────────────────────────┘
                │ SQLite (users/orgs/tasks/steps/sources/source_archives/
                │         trackers/graph_*/notifications/assistant_sessions/
                │         assistant_messages/email_logs/competitors/profile_*
                │         user_permissions/audit_logs/execution_snapshots…)
                ▼
┌────────────────────────────────────────────────────────────────────┐
│  React Frontend                                                     │
│  Execution view (stepper + SSE timeline) → report/insights/sources  │
│  Trackers (runs + digests + score trend) · graph canvas             │
│  Competitor management · Profile templates/profiles/compare         │
│  AI assistant (multi-session sidebar + chat panel, shared server    │
│  history) · notify bell                                             │
│  Account (org tab + RBAC) · pricing · admin console (users + orgs + audit) │
└────────────────────────────────────────────────────────────────────┘
```

### 4. Pipeline Stages

| Stage | status | Responsibility |
|-------|--------|----------------|
| **Planning** | `planning` | LLM produces the competitor list plus plan-capped (4/8/12 groups) search keywords, each dimension-tagged; time-sensitive queries automatically carry the current year / "latest" |
| **Searching** | `searching` | Concurrent Tavily calls (max 5 results per group, URL-deduplicated, optional time_range); heuristic source tiering + publish-date parsing |
| **Dedup/Confidence/Conflict** | (within searching) | URL dedup + title similarity dedup (threshold 0.85) → confidence estimation (tier weight × freshness decay) → conflict detection (same dimension, multiple URLs → pending) |
| **Snapshot Archive** | (within searching) | Async page snapshot capture (HTML up to 500KB + pure text + collection metadata), records access_status |
| **Analyzing** | `analyzing` | Material grouped by dimension for the LLM (with tier / publish date / age / confidence); prompt enforces `[n]` citations |
| **Insights** | (within analyzing) | Extra `chat_json` call produces structured JSON (scores / SWOT / verdict) stored in `report_data`; failure never blocks |
| **Timeline** | (within analyzing) | Extra `chat_json` call extracts key event timeline (max 12 items), merged into `report_data.timeline`; failure never blocks |
| **Reporting** | `reporting` | Generates the Markdown report keeping `[n]` citations; programmatically computed tier composition / time span / freshness distribution / dimension coverage injected into credibility notes |

Tracker runs additionally produce a **change digest** against the previous run and push it via the tracker's configured channels.

### 5. Deliverables

| Deliverable | Description |
|-------------|-------------|
| Research report | Markdown: executive summary, feature & pricing comparisons, SWOT, conclusions, credibility notes; clickable citations |
| Data insights | Structured JSON: five-dimension scores (radar / bars), SWOT quadrants, one-line positioning, verdict |
| Event timeline | Structured JSON: up to 12 key events (date/title/summary/ref) |
| Source archives | Tiered list + page snapshots (HTML/text) + confidence scores + conflict flags; overview stats, credibility bar, tier/dimension filters, three sort orders, detail drawer with snapshot status |
| Change digest | Tracker runs only: added / changed / removed highlights vs. the previous run, pushed with notifications |
| Relation graph | Entity nodes (company/product/org/person) + typed relation edges (confidence + evidence URL) on a visual canvas |
| Competitor profiles | Structured profiles by frozen template dimensions → freeze lock → multi-profile horizontal comparison matrix |
| AI Q&A | Per-report follow-ups + global multi-turn assistant (multi-session), answers cite "📄 report" links |
| Export | PDF (A4 auto-pagination) / Word (Print view + A4 margins) / Markdown / browser print |

### 6. Plans & Quota Rules

| Plan | Price | Research runs / month | Keyword groups / run | Tracker limit | Priority queue |
|------|-------|----------------------|---------------------|---------------|----------------|
| Free | ¥0 | 3 | 4 | 1 | — |
| Pro | ¥99/mo | 30 | 8 | 5 | ✓ |
| Enterprise | ¥399/mo | Unlimited | 12 | 20 | ✓ |

**Quota accounting** (see HANDOFF.md for the full chapter):

- Counted per **UTC calendar month**; usage = research tasks + graph builds (1 each); **failed runs are excluded**
- Personal users are metered by their effective personal plan; **org members share the org plan's pooled quota**; org admins may set per-member monthly limits (second gate)
- System admins (role=admin) are treated as Enterprise — quota-exempt
- 80% threshold: automatic in-app quota warning notification (once per month)
- On exhaustion: creation endpoints return 403 with a localized message; the frontend pre-checks/disables or shows an error banner with an upgrade link; **scheduled trackers skip the current run and notify in-app** (once per tracker per month), retrying next period
- Report Q&A, global assistant, and competitor profiles are **quota-free**
- Upgrades use simulated payments: 30 days on payment, same-plan renewals extend, expired paid plans fall back to Free; org plans are upgraded by the org owner or adjusted by a system admin

### 7. Quick Start

#### Requirements

- Python 3.12+
- Node.js 20.19+
- An LLM API key (any OpenAI-compatible service: DeepSeek / Qwen / Kimi / OpenAI, etc.)
- A Tavily API key ([tavily.com](https://tavily.com), free tier 1000 calls/month)

#### Configuration

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env`:

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — e.g. DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`; Qwen: `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen-plus`
- `TAVILY_API_KEY` — Tavily search key
- `APP_ENV` — use `development` locally and set `production` in production
- `JWT_SECRET` — production requires a random string of at least 32 characters or startup is refused
- `MASTER_KEY` — required in production for Fernet encryption (32-byte base64)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — optional one-time admin bootstrap; both must be set explicitly
- SMTP variables optional: without them, email pushes are logged in demo mode (email_logs.status=demo)

#### Backend (port 8000)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Tables are created (with light migration) and the tracker scheduler starts on boot. To bootstrap an admin, explicitly set `SEED_ADMIN_EMAIL` and a strong `SEED_ADMIN_PASSWORD` in `.env`. API docs are available at `http://localhost:8000/docs`.

#### Frontend (port 5173)

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`; the Vite proxy forwards `/api` requests to the backend.

### 8. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, SSE, PyJWT, bcrypt |
| Agent | OpenAI-compatible LLM (DeepSeek / Qwen / Kimi / StepFun, etc.), Tavily web search |
| Security | JWT + Refresh Token, Fernet encryption, Token Bucket rate limiting, Audit logs, Execution snapshots |
| Scheduling | Built-in thread scheduler (60 s polling, no external dependency) |
| Frontend | React 18, TypeScript, Vite 7, Tailwind CSS 4, react-router-dom 7, react-markdown + remark-gfm, recharts, ReactFlow, html2pdf.js |
| Validation | Pydantic v2 |
| Storage | SQLite (MVP), migratable to PostgreSQL |

### 9. Project Layout

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry (CORS, routing, create_all + migration, admin seed, scheduler)
│   │   ├── core/                # config / plans / security / crypto / rate_limit / rate_limit_user / timeutil
│   │   ├── db/                  # SQLAlchemy engine + ORM models (23 tables, see HANDOFF §21)
│   │   │   └── audit_triggers.py # DB-level triggers preventing UPDATE/DELETE on audit_logs
│   │   ├── schemas/             # Pydantic models: auth / research / org / tracker / graph / competitor / profiles
│   │   ├── api/                 # deps (auth+quota+RBAC) / auth / research (+/ask/email) / trackers / graph /
│   │   │                        #   org / competitors / profiles / crawl / permissions / notifications /
│   │   │                        #   assistant (multi-session + ask) / billing / admin
│   │   └── services/            # llm (chat/chat_json/chat_messages) / search / agent / graph_agent /
│   │                            #   dedup / snapshot / digest / notify (in-app,email,webhook) /
│   │                            #   scheduler / audit / profiles / profile_extractor / profile_report /
│   │                            #   comparison / crawler
│   ├── scripts/
│   │   └── seed_data.py         # Test data seeding script
│   ├── requirements.txt
│   ├── .env.example
│   ├── start.bat                # Windows one-click startup
│   ├── start.ps1                # PowerShell one-click startup
│   └── _smtp_test.py            # SMTP connectivity test utility
└── frontend/
    └── src/
        ├── api/                 # types + client (Bearer injection, 401 handling + Refresh retry) + SSE subscription
        ├── auth/                # AuthContext + route guards (RequireAuth/RequireAdmin)
        ├── hooks/                # useErrorHandler / usePageTitle
        ├── layouts/             # workspace sidebar (notification bell, assistant bubble, org plan badge)
        ├── pages/ · pages/app/  # landing/auth pages · dashboard/research/tasks/trackers/graph/
        │                        #   competitors/profiles/compare/assistant/audit-logs/pricing/account/admin
        ├── components/          # 32 components: stepper, timeline, report view, source drawer, charts,
        │                        #   tracker form, score trend, graph canvas, AssistantChat/Widget,
        │                        #   QuotaErrorBanner, NotificationBell, OrgPanel, RunHistoryItem,
        │                        #   ConfirmDialog, Skeleton, ProfileGenProgress, cn utils…
        └── utils/               # report export templates (PDF/Word/Markdown), section splitting, cn, parseUtc
```

### 10. API Overview

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/register` · `/login` | Register / login, returns JWT + refresh_token | — |
| POST | `/api/auth/refresh` | Refresh Token → new access + refresh | — |
| GET | `/api/auth/me` | Current user | User |
| PATCH | `/api/auth/profile` | Update nickname/avatar | User |
| POST | `/api/auth/change-password` | Change password (invalidates old tokens) | User |
| GET | `/api/auth/logins` | Last 20 login records | User |
| POST | `/api/auth/logout-all` | Logout all devices (returns new token) | User |
| DELETE | `/api/auth/account` | Delete account (cascading) | User |
| GET | `/api/auth/usage` | 6-month usage + current quota + member usage | User |
| POST | `/api/auth/forgot` · `/reset` | Password reset code (Fernet encrypted) / reset | — |
| GET | `/api/me/permissions` | Current user RBAC permissions list | User |
| GET | `/api/research/quota` | Monthly quota & usage (org-aware) | User |
| POST | `/api/research` | Create research task (quota-checked) | User |
| GET | `/api/research` · `/{id}` | Task list / detail (org-shared visibility) | User |
| GET | `/api/research/{id}/sources/{sid}` | Source detail (verbatim excerpt + snapshot status) | User |
| GET | `/api/research/{id}/events?token=` | SSE live progress | User |
| POST | `/api/research/{id}/ask` | Ask about a single report (quota-free) | User |
| POST | `/api/research/{id}/email` | Email report (with optional attachments) | User |
| DELETE | `/api/research/{id}` | Delete task (cascading) | User |
| GET/POST | `/api/competitors` | List (org + system templates) / create | User |
| PATCH/DELETE | `/api/competitors/{id}` | Update / delete | User/Admin |
| POST | `/api/crawl/{cid}/crawl` | Crawl competitor website info | User |
| POST/GET | `/api/trackers` | Create (plan-capped) / list | User (org required) |
| GET/PATCH/DELETE | `/api/trackers/{id}` | Detail / update / delete | User (creator or org admin) |
| POST | `/api/trackers/{id}/run-now` | Run one period immediately (metered to trigger user's scope) | User (creator or org admin) |
| GET | `/api/trackers/{id}/runs` | Run (period) task list | User |
| POST / GET | `/api/graph` | Create graph (metered) / list | User |
| GET / DELETE | `/api/graph/{id}` | Graph detail (entities + relations + report_markdown) / delete | User |
| POST | `/api/graph/{id}/refresh` | Rebuild graph (metered) | User |
| GET/POST/PATCH/DELETE | `/api/profiles/templates` | Template CRUD + freeze | User/Admin |
| POST | `/api/profiles/generate` | Generate competitor profile | User |
| GET | `/api/profiles` | List profiles | User |
| POST | `/api/profiles/{id}/freeze` | Freeze profile | Admin |
| POST | `/api/profiles/compare` | Horizontal comparison (≥2 frozen profiles) | User |
| GET | `/api/profiles/{id}/report` | Profile report (cache-first, pre-generated report+insights) | User |
| GET | `/api/profiles/{id}/insights` | Profile insights (cache-first) | User |
| GET | `/api/profiles/{id}/report-full` | Get profile report + insights + source index in one call | User |
| POST | `/api/org` · `/join` · `/leave` | Create org / join by invite code / leave | User |
| GET | `/api/org/me` · `/members` | My org / member list (with month usage + permissions) | User |
| PATCH | `/api/org` | Rename org | Org admin |
| POST | `/api/org/invite-code/reset` | Reset invite code | Org admin |
| POST | `/api/org/members/{id}/permissions` | Set member RBAC permissions | Org admin |
| PATCH / DELETE | `/api/org/members/{id}` | Change member role/limit / remove member | Org admin |
| GET | `/api/notifications` · `/unread-count` | Notification list / unread count | User |
| POST | `/api/notifications/read` | Mark read | User |
| GET | `/api/assistant/sessions` | Session list (migrates legacy messages on first visit) | User |
| PATCH / DELETE | `/api/assistant/sessions/{id}` | Rename / delete session | User |
| GET / DELETE | `/api/assistant/sessions/{id}/messages` | Session messages (100 max, ascending) / clear | User |
| POST | `/api/assistant/ask` | Ask the global AI assistant (quota-free) | User |
| GET | `/api/billing/plans` · `/orders` | Plans / my orders | — / User |
| POST | `/api/billing/upgrade` | Simulated payment upgrade (personal or org) | User |
| GET | `/api/admin/stats` | Ops stats | Admin |
| GET/PATCH | `/api/admin/users?q=` | User list (paginated) / adjust plan/role | Admin |
| GET/PATCH | `/api/admin/orgs?q=` | Org list (paginated) / adjust plan | Admin |
| GET | `/api/admin/audit-logs` | Audit logs (paginated + filtered) | Admin |
| GET | `/api/admin/execution-snapshots` | Execution snapshots list | Admin |

### 11. Admin Bootstrap

There is no fixed default administrator. On first deployment, set both `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `backend/.env`, then clear them after the account is created. Production also requires strong `JWT_SECRET` and `MASTER_KEY` values.

### 12. Documentation

See [HANDOFF.md](HANDOFF.md) for the full handoff & implementation document, covering:

- The permission matrix (system admin / org owner/admin/member / personal user)
- The quota chapter (accounting scope, double gating, exhaustion behavior, scheduler skip policy, metering subject)
- Pipeline, recency engine, trackers & scheduler, relation graph, competitor profiles, and AI assistant internals
- Security hardening (JWT+Refresh Token, rate limiting, Fernet encryption, audit logs, execution snapshots)
- The full data model (23 tables) and the lightweight migration mechanism
- Report export (PDF/Word) pitfalls and other gotchas
