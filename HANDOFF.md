# 竞品调研 Agent — 项目交接与技术实现文档 v2.0

> 更新时间：配额治理 + 管理后台企业管理 + 全局 AI 助手完成后。涵盖调研流水线、时效引擎、定时追踪与调度器、关系图谱、企业组织、通知、AI 助手与配额规则全量说明。

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [环境配置与启动](#4-环境配置与启动)
5. [账号体系与权限矩阵](#5-账号体系与权限矩阵)
6. [配额规则专章](#6-配额规则专章)
7. [Agent 调研流水线与时效引擎](#7-agent-调研流水线与时效引擎)
8. [定时追踪与调度器](#8-定时追踪与调度器)
9. [关系图谱](#9-关系图谱)
10. [AI 助手（报告问答 + 全局助手）](#10-ai-助手报告问答--全局助手)
11. [前端功能](#11-前端功能)
12. [数据模型](#12-数据模型)
13. [API 一览](#13-api-一览)
14. [当前状态](#14-当前状态)
15. [踩坑备忘](#15-踩坑备忘)

---

## 1. 项目概览

一个**商业化的 AI 竞品情报 SaaS**，四大能力模块：

1. **竞品调研 Agent**：输入产品名称（可选竞品/调研重点/检索时效），后台自动完成"规划检索关键词 → 联网检索 → 对比分析 → 数据洞察 → 生成报告"全流程，前端 SSE 实时进度，交付带 `[n]` 引用溯源的 Markdown 报告、可视化数据洞察（雷达图/评分对比/SWOT）与分级可信的信息来源列表，一键导出 PDF / Word / Markdown
2. **定时追踪**：按日/周/月自动重跑调研，期次间生成变更摘要，站内/邮件/Webhook 推送；内置线程调度器
3. **关系图谱**：以任意企业/产品为根，联网抽取产业链关系网络（上下游/竞争/合作/投资/母子公司），画布可视化
4. **AI 问答**：单报告追问 + 全局 AI 助手（悬浮球/独立页），自动定位相关报告作答并附引用链接，不占配额

内置完整账号体系（注册/登录/改密/忘记密码/登录历史/退出所有设备/注销）、三级会员（个人 + 企业双维度）、企业组织（邀请码/角色/成员额度）、JWT + 会话版本控制、模拟支付订单、站内通知与管理后台（用户 + 企业管理）。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy 2.0 · SQLite · sse-starlette · PyJWT · bcrypt · pydantic-settings |
| LLM | OpenAI 兼容接口（当前配置 DeepSeek），`app/services/llm.py` 封装 `chat` / `chat_json` / `chat_messages`（多轮） |
| 检索 | Tavily API（`tavily-python`，`include_raw_content=True`，支持 time_range） |
| 调度 | `services/scheduler.py` 守护线程，60 秒轮询（无 celery/cron 外部依赖） |
| 前端 | React 18 · TypeScript · Vite 5 · Tailwind CSS 4 · react-router-dom 6 · react-markdown + remark-gfm · recharts · **html2pdf.js** |

## 3. 目录结构

```
agent/
├─ backend/
│  ├─ .env                      # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / TAVILY_API_KEY / JWT_SECRET / SMTP*
│  ├─ research.db               # SQLite 数据库
│  └─ app/
│     ├─ main.py                # 入口：create_all + migrate_columns() + seed_admin() + 启动调度器线程
│     ├─ core/config.py         # Settings（@lru_cache 缓存，改 .env 必须重启后端！）
│     ├─ core/plans.py          # ★ 套餐权益唯一权威定义（PLANS/TRACKER_LIMITS/effective_plan/effective_org_plan）
│     ├─ core/security.py       # bcrypt 哈希 + JWT 签发/校验（payload 带会话版本 ver）
│     ├─ core/timeutil.py       # 时效引擎工具：baseline_now/parse_published/age_days_of/recency_weight
│     ├─ db/models.py           # 15 张表 ORM（见 §12）
│     ├─ api/                   # auth/research/trackers/graph/org/notifications/assistant/billing/admin/deps
│     ├─ schemas/               # auth.py / research.py / org.py / tracker.py / graph.py
│     └─ services/
│        ├─ agent.py            # ★ 调研 Agent 编排核心（分级/洞察/可信度/时效引擎）
│        ├─ graph_agent.py      # 图谱构建（实体/关系抽取）
│        ├─ digest.py           # 期次变更摘要（与上一期报告对比）
│        ├─ notify.py           # 通知分发：站内 Notification / SMTP 邮件(缺配置转 demo) / Webhook 四格式
│        ├─ scheduler.py        # ★ 追踪调度器（60s 扫描 + 配额跳过策略，见 §8）
│        ├─ llm.py              # LLM 客户端（chat / chat_json / chat_messages）
│        └─ search.py           # Tavily 客户端
└─ frontend/
   └─ src/
      ├─ api/types.ts + client.ts   # 全部类型与 API 封装（token key = 'cr_token'，401 自动跳登录）
      ├─ auth/AuthContext.tsx       # 登录态上下文 + RequireAuth/RequireAdmin 路由守卫
      ├─ layouts/AppLayout.tsx      # 侧边栏布局（通知铃铛 NotificationBell + AI 悬浮球 AssistantWidget
      │                             #   + PlanBadge 用 getQuota().plan 反映企业套餐口径）
      ├─ pages/                     # LandingPage / LoginPage / RegisterPage / ForgotPasswordPage
      ├─ pages/app/                 # Dashboard / NewResearch / Tasks / TaskDetail / Trackers / TrackerDetail
      │                             #   / Graph / GraphDetail / Assistant / Pricing / Account / Admin
      ├─ components/                # 见 §11.3 组件清单
      └─ utils/
         ├─ exportReport.tsx        # ★ 报告导出（PDF/Word/Markdown 离屏模板），坑极多，见 §15.1
         ├─ reportSections.ts       # splitSourcesSection：从 markdown 剥离"信息来源"章节
         └─ time.ts                 # parseUtc：后端 UTC 时间无 Z 后缀，前端解析必须补 Z
```

## 4. 环境配置与启动

### 4.1 启动命令

```powershell
# 后端（必须在 backend 目录下启动，.env 按相对路径加载）
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# 前端
cd frontend
npm run dev   # http://localhost:5173，/api 代理到 8000
```

- `backend/.env` 必填：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`TAVILY_API_KEY`；生产环境务必改 `JWT_SECRET`；SMTP 变量可选（缺省时邮件走演示模式落库 email_logs）
- 默认管理员（启动自动播种）：`admin@example.com` / `Admin123456`（role=admin，配额豁免）
- Windows 注意：pip 需用 `python -m pip`；PowerShell 用 `;` 分隔命令（不支持 `&&`）

### 4.2 配置生效机制 ★

1. `get_settings()` 带 `@lru_cache`，配置**只在进程启动时读一次**——修改 `.env` 后必须重启后端才生效
2. `env_file=".env"` 是相对路径——uvicorn 必须**在 backend 目录下启动**，否则读不到 .env
3. 后端通常不带 `--reload` 启动，**改任何后端代码都要手动重启**

配置缺失时任务直接 failed 并给出中文提示；LLM key 缺失时问答类接口返回 503。

## 5. 账号体系与权限矩阵

### 5.1 两套角色体系

- **系统角色 `users.role`**：`user` / `admin`。admin = 平台运营方
- **企业角色 `users.org_role`**：`owner` / `admin` / `member`，空串 = 未入企。一人同时只属于一个企业（`users.org_id`）

### 5.2 权限矩阵

| 操作 | 个人用户 | 企业 member | 企业 admin | 企业 owner | 系统 admin |
|---|---|---|---|---|---|
| 创建调研/图谱/追踪 | ✓（个人配额） | ✓（企业配额+成员额度） | ✓ | ✓ | ✓（配额豁免） |
| 查看任务/图谱/追踪 | 仅本人 | 本企业全部 | 本企业全部 | 本企业全部 | 全部 |
| 创建企业 / 邀请码加入 | ✓ | —（需先退出） | — | — | ✓ |
| 改企业名 / 重置邀请码 | — | — | ✓ | ✓ | —（走 admin orgs 端点改套餐） |
| 改成员角色 / 成员月额度 / 移出成员 | — | — | ✓（不能动 owner） | ✓（不能动 owner） | — |
| 退出企业 | — | ✓ | ✓ | 仅当企业只剩自己（退出即解散并清理追踪项） | — |
| 升级套餐（模拟支付） | ✓ 个人 | 个人套餐仍可买（入企后不生效） | ✓ | ✓ 企业套餐 | — |
| 管理后台（统计/用户/企业） | — | — | — | — | ✓ |
| 改任意用户套餐/角色、改任意企业套餐 | — | — | — | — | ✓（不能取消自己的 admin） |
| 注销账号 | ✓ | ✓ | ✓ | ✓ | —（管理员不可注销） |

要点：

- 企业 owner 由创建者担任，不可被改角色/移出；owner 退出企业时若仍有其他成员则被拒绝
- 属主规则：普通用户只能访问本人或本企业的资源；系统 admin 可访问全部任务
- 系统管理员进入企业时的口径以企业为准，但因其配额豁免（视同 enterprise 不限额）无实际影响

## 6. 配额规则专章

**权威定义**：套餐数值全部硬编码于 `core/plans.py`（PLANS + TRACKER_LIMITS），不做数据库化配置，改套餐权益只改这一处。

### 6.1 统计口径

- 周期：**UTC 自然月**（`month_start_utc()`），每月 1 日归零
- 计数（`deps.py::month_usage`）：**调研任务 + 图谱构建**（GraphProject）各计 1 次；**`status='failed'` 不计入**（失败不扣额）
- 维度：入企用户按 `org_id` 聚合**全员共享**企业配额；未入企按 `user_id` 个人计
- 生效套餐：个人 `effective_plan()`（admin 视同 enterprise；付费过期回落 free）；入企 `effective_org_plan(org)`

### 6.2 双重校验（deps.py::check_quota_or_403）

1. **第一重**：本月总用量 ≥ 套餐 `monthly_tasks`（-1 不限）→ 403
2. **第二重**（仅入企用户）：企业管理员给成员设置的 `users.org_monthly_limit`（-1 不限），按成员个人本月用量（`member_month_usage`，同样任务+图谱、排除 failed）校验 → 403

### 6.3 额度用尽的行为

| 入口 | 行为 |
|---|---|
| POST /api/research、/api/graph、graph refresh、tracker run-now | 403 + 中文提示（"XX本月 N 次调研额度已用完，请升级套餐"） |
| 前端 NewResearchPage | 预检 quota 禁用提交按钮 |
| 前端 GraphPage / TrackersPage / TrackerDetailPage | 红条回显后端文案，`QuotaErrorBanner` 检测到"额度已用完/请升级"自动附"前往套餐升级 →"链接（/app/pricing） |
| 调度器自动期次 | **跳过本期**：next_run_at 照常顺延（防 60s 重试风暴），不创建任务，给创建者发站内通知"定时追踪因额度不足跳过本期"；同一追踪项**每月仅通知一次**（按 user_id+title+link+月初查重） |
| 报告问答 /ask、全局助手 | 不校验、不占额 |

### 6.4 记账主体差异 ★

- **run-now 手动触发**：记在**触发人**所在配额口径（个人或其企业）
- **调度器自动期次**：记在**追踪项创建人**（creator_id）口径，配额校验也以创建人身份执行
- 系统管理员创建的一切任务均豁免

## 7. Agent 调研流水线与时效引擎

`run_research(task_id)`（services/agent.py）由 BackgroundTasks 触发，status 依次流转，每步写 TaskStep 供 SSE 推送。

### 7.1 阶段流转

1. **planning 规划**：LLM 产出竞品清单 + 按套餐上限（4/8/12 组）的检索关键词，每组带 `dimension` 维度标签
2. **searching 检索**：`_search_all` 并发调用 Tavily（每组最多 5 条，URL 去重，携带任务的 time_range），每条结果带 `score/raw_content/published_date` 并打上检索组 `dimension`；按 §7.3 分级；`_save_sources` 全字段入库（raw_content 截断 8000 字符，published_date 解析为 YYYY-MM-DD）；**入库顺序 = 材料编号 = 前端引用角标编号**
3. **analyzing 分析**：材料按维度分组呈现给 LLM（每条附来源类型/发布时间/距今天数），prompt 强制每条论断紧跟 `[n]` 引用
4. **数据洞察**（analyzing 内，额外 1 次 `chat_json`）：`_insights` 产出结构化 JSON 存 `report_data`（契约见 §7.4）；**失败不阻断报告**
5. **reporting 报告**：正文保持 `[n]` 引用；"可信度说明"章节由 `_credibility_summary` 程序化统计分级构成/时间跨度/**新鲜度分布**（≤30天/≤180天/≤365天/更早/无日期）/维度覆盖后注入 prompt

### 7.2 时效引擎（core/timeutil.py）

- `_date_header()`：**所有 system prompt 头部注入当前日期**，要求模型以此判断时效、优先近期信息
- 规划阶段要求时效性检索词自带年份/"最新"；任务可指定 `time_range`（''/day/week/month/year）传给 Tavily
- `parse_published` 解析各种格式的发布时间；`age_days_of` 计算距今天数；`recency_weight` 供排序加权
- 前端来源卡片展示发布时间与"距今 N 天"

### 7.3 来源分级规则（classify_source 启发式）

| 分级 | 判定 |
|---|---|
| **official** | 域名主体归一化后与竞品/产品名匹配 |
| **media** | 命中 `MEDIA_DOMAINS` 清单（36kr/techcrunch/ifanr/sspai/theverge 等） |
| **community** | 命中 `COMMUNITY_DOMAINS` 清单（zhihu/reddit/github/v2ex/producthunt/g2 等） |
| **other** | 其余 |

### 7.4 数据洞察 JSON 契约（report_data）

```json
{"dimensions": ["功能完备性","定价竞争力","用户口碑","市场声量","发展潜力"],
 "competitors": [{"name": "...", "scores": {"功能完备性": 8}, "positioning": "一句话定位"}],
 "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
 "verdict": "总体结论"}
```

## 8. 定时追踪与调度器

### 8.1 追踪项（trackers 表）

- 配置：product_name/competitors/focus/time_range + `frequency`（daily/weekly/monthly）+ `run_hour`（本地整点）+ enabled
- 推送渠道：站内通知（始终）、`push_email`、`push_webhook`（webhook_type: wecom/dingtalk/feishu/generic + webhook_url）
- 数量限额：`TRACKER_LIMITS = {free:1, pro:5, enterprise:20}`，**企业维度**计数
- 归属：`org_id`（企业共享）+ `creator_id`（记账与调度身份）

### 8.2 调度器（services/scheduler.py）

- main.py 启动守护线程，`_scan_once` 每 60 秒扫描 `enabled=True 且 next_run_at <= now` 的追踪项
- **配额校验**：以 creator 身份调 `check_quota_or_403`；不足时跳过本期——`next_run_at = advance_next_run(...)` 照常顺延 + 站内通知（月内单次，见 §6.3）
- 正常触发：创建 ResearchTask（tracker_id 关联，kind 为期次）、推进 next_run_at、跑完流水线后由 `digest.py` 生成 `change_summary`（与上一期报告对比的变更 Markdown），`notify.py` 分发站内/邮件/Webhook
- run-now 手动触发同样产出期次任务但记账主体不同（§6.4）

### 8.3 前端

- TrackersPage：列表 + TrackerForm 创建（超限/超额红条 QuotaErrorBanner）
- TrackerDetailPage：配置编辑 + 期次列表（RunHistoryItem 含变更摘要折叠）+ `ScoreTrend` 期次评分趋势图

## 9. 关系图谱

- `POST /api/graph`（root_name + industry + time_range）→ `graph_agent.py` 后台构建：联网检索 → LLM 抽取实体（company/product/org/person）与关系边（upstream_supplier/downstream_customer/competitor/partner/investor/parent/subsidiary，含 confidence + source_url）
- **创建与 refresh 均校验并计入调研配额**（与调研任务同口径，failed 不计）
- 状态机：pending → building → completed/failed；GraphDetailPage 画布渲染（节点类型着色/关系类型图例/点选详情）
- 归属与可见性与任务一致（org 共享）

## 10. AI 助手（报告问答 + 全局助手）

### 10.1 单报告追问（research.py::/{task_id}/ask）

针对当前报告上下文回答，附对话历史，不占配额。

### 10.2 全局助手（api/assistant.py）★

**多会话模型**：一个用户可拥有多个 `AssistantSession`，消息按 `session_id` 归属；
首次访问会话列表时，旧的无归属消息（`session_id=""`）懒迁移到一个「历史对话」会话，保证存量数据可见。

**两阶段回答**：

1. **检索定位**：取用户可见（本人+同企业）的 completed 报告目录（最近 50 条，含 id/产品名/竞品/时效/日期/变更摘要前 100 字），`chat_json` 让 LLM 选出最相关 ≤3 个 task id；LLM 失败时**回退**为按问题关键词命中 product_name/competitors 的最近 3 条；再兜底取最新 3 条
2. **回答**：上下文 = 选中报告（各截 8000 字符，追踪期次附 change_summary 前 2000 字）+ 最近 6 条对话历史 + 问题，走 `LLMClient.chat_messages`（多轮）；system 提示词要求标注来源报告名、信息不足明示、中文

**会话 CRUD**：

- `GET /sessions`：当前用户全部会话（最近活跃优先），首次访问触发懒迁移
- `PATCH /sessions/{id}`：重命名会话（标题最多 200 字）
- `DELETE /sessions/{id}`：删除会话及其全部消息
- `GET /sessions/{id}/messages`：某会话最近 100 条消息（升序）
- `DELETE /sessions/{id}/messages`：清空会话消息（保留会话本身）

**约束与行为**：

- 不占调研配额；LLM key 缺失返回 503；LLM 调用失败 502
- 提问时 `session_id` 为空则自动新建会话，标题取首条提问前 30 字
- 用户消息与 AI 回复均落库；AI 回复的 `refs` 字段存被引用报告 `[{task_id, product_name}]`，前端渲染为"📄 产品名"跳转链接
- 无可用报告时不调 LLM，直接返回引导文案

### 10.3 前端

- `components/AssistantChat.tsx`：共用对话面板（消息列表/markdown 渲染/refs 链接/输入框/清空）
- `components/AssistantWidget.tsx`：右下角悬浮球 + 浮动面板（w-96 h-[560px]），挂在 AppLayout；在 /app/assistant 页自动隐藏
- `pages/app/AssistantPage.tsx`：独立页（侧栏"AI 助手"入口），左侧会话历史侧栏（新建/重命名/删除会话），右侧共用 `AssistantChat`；与悬浮球共用服务端历史

## 11. 前端功能

### 11.1 页面清单

- **营销首页 `/`**、登录/注册/忘记密码
- **工作台 `/app`**（AppLayout：侧边栏 + PlanBadge（getQuota().plan 口径，反映企业套餐与过期回落）+ NotificationBell + AssistantWidget）：
  - 仪表盘：配额进度、统计卡、最近调研
  - 新建调研 `/app/new`：提交前校验配额；创建成功后路由 state 直传秒开执行视图
  - 调研记录 `/app/tasks`、任务详情 `/app/tasks/:id`（见 §11.2）
  - 定时追踪 `/app/trackers` + `/app/trackers/:id`（期次/变更摘要/评分趋势）
  - 关系图谱 `/app/graph` + `/app/graph/:id`（画布）
  - AI 助手 `/app/assistant`
  - 套餐升级 `/app/pricing`（个人/企业口径自适应）
  - 个人中心 `/app/account`（概览/安全/订单/**企业** 四 Tab；企业 Tab = OrgPanel：创建/加入/成员管理/成员月额度/邀请码）
  - 管理后台 `/app/admin`（仅系统 admin：运营统计 + 用户管理 + **企业管理**（改企业套餐，free 清到期、付费 30 天））

### 11.2 任务详情页

**运行中**：渐变状态头 + 秒级计时（`now - created_at`，用 `parseUtc` 补 Z 解析）+ `PhaseStepper` 四阶段步骤条 + `StepTimeline` SSE 时间线（EventSource `?token=` 鉴权）；完成后收起为折叠按钮。

**完成后三 Tab**：

1. **调研报告**：`ReportView` + 右侧 `ReportToc`（scroll spy）；`[n]` 转可点击角标开来源抽屉；LLM 生成的"信息来源"章节被 `splitSourcesSection` 剥离，改由结构化卡片渲染；追踪期次附变更摘要块；底部"报告问答"框
2. **数据洞察**（report_data 为 null 时隐藏）：verdict 结论条 + `ScoreRadar` + `ScoreBars` + `SwotGrid` + 定位卡
3. **信息来源**：统计卡 + 可信度分布条 + 分级/维度筛选 + 三种排序 + `SourceCard` 双列 + 详情抽屉（raw_content 阅读模式）

**报告导出**：PDF / Word / Markdown / 打印，实现在 `utils/exportReport.tsx`（改前必读 §15.1）。

### 11.3 组件清单（frontend/src/components/）

`PhaseStepper` `ReportView` `ReportToc` `ScoreRadar` `ScoreBars` `SwotGrid` `ScoreTrend` `SourceCard` `SourceDrawer` `TierBadge` `StepTimeline` `StatusBadge` `PlanBadge` `AuthShell` `BackToTop` `ChartCard` `ReadingProgress` `NotificationBell` `OrgPanel` `TrackerForm` `RunHistoryItem` `QuotaErrorBanner` `AssistantChat` `AssistantWidget`

## 12. 数据模型

### 12.1 表结构（SQLite，15 张）

- **users**：id/email/password_hash/nickname/avatar/role(user|admin)/plan/plan_expires_at/token_version/reset_code(+expires)/**org_id**/**org_role**(owner|admin|member)/**org_monthly_limit**(-1 不限)
- **organizations**：name/plan/plan_expires_at/owner_id/invite_code(8 位)
- **orders**：模拟支付订单 plan/amount/status(paid|refunded)/paid_at
- **login_logs**：action(login|register|reset)/ip/user_agent
- **research_tasks**：product_name/competitors/focus/**time_range**/status/error/report_markdown/report_data/**org_id**/**tracker_id**(期次归属)/**change_summary**(与上一期对比 markdown)
- **task_steps**：seq/phase/title/detail（进度时间线）
- **sources**：title/url/snippet/score/domain/tier/**published_at**/dimension/raw_content（属性 age_days）
- **trackers**：org_id/creator_id/product_name/competitors/focus/time_range/frequency(daily|weekly|monthly)/run_hour/next_run_at/last_run_at/enabled/push_email/push_webhook/webhook_type/webhook_url
- **notifications**：user_id/org_id/title/body/link(前端路由)/read
- **assistant_sessions**：user_id/title（多会话列表）/created_at/updated_at
- **assistant_messages**：user_id/**session_id**/role(user|assistant)/content/**refs**(JSON 数组 [{task_id, product_name}])
- **email_logs**：to_email/subject/body/status(sent|demo|failed)
- **graph_projects**：user_id/org_id/root_name/industry/time_range/status(pending|building|completed|failed)/error
- **graph_entities**：project_id/name/type(company|product|org|person)/industry/description/is_root
- **graph_relations**：project_id/source_id/target_id/relation_type(7 种)/description/confidence/source_url

### 12.2 轻量迁移机制

`main.py::migrate_columns()` 启动时用 `PRAGMA table_info` 检测缺失列并 `ALTER TABLE ADD COLUMN`（create_all 不改已有表）。**新加列**时在该函数 `required` 字典补 DDL；**新加表**（如 assistant_messages）由 create_all 自动建，无需迁移。

## 13. API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | /api/auth/register · /login | 注册/登录，返回 token+user | — |
| GET | /api/auth/me | 当前用户 | 用户 |
| PATCH | /api/auth/profile | 修改昵称/头像 | 用户 |
| POST | /api/auth/change-password | 改密码（token_version+1，返回新 token） | 用户 |
| GET | /api/auth/logins | 最近 20 条登录历史 | 用户 |
| POST | /api/auth/logout-all | 退出所有设备（返回新 token） | 用户 |
| DELETE | /api/auth/account | 注销账号（密码确认，级联删除） | 用户 |
| GET | /api/auth/usage | 近 6 个月用量 + 本月配额 | 用户 |
| POST | /api/auth/forgot · /reset | 忘记密码验证码 / 重置 | — |
| GET | /api/research/quota | 本月配额（企业口径优先，plan 为生效套餐） | 用户 |
| POST | /api/research | 创建任务（双重配额校验），后台启动 Agent | 用户 |
| GET | /api/research · /{id} | 任务列表 / 详情（企业内共享；sources 不含 raw_content） | 用户 |
| GET | /api/research/{id}/sources/{sid} | 来源详情（含 raw_content，属主校验） | 用户 |
| GET | /api/research/{id}/events?token= | SSE 实时进度（step/status 事件） | 用户 |
| POST | /api/research/{id}/ask | 单报告追问（不占配额） | 用户 |
| DELETE | /api/research/{id} | 删除任务（级联删 steps/sources） | 用户 |
| POST / GET | /api/trackers | 创建追踪项（TRACKER_LIMITS 校验）/ 列表 | 用户 |
| GET / PATCH / DELETE | /api/trackers/{id} | 详情 / 修改 / 删除 | 用户 |
| POST | /api/trackers/{id}/run-now | 立即运行一期（记触发人配额） | 用户 |
| GET | /api/trackers/{id}/runs | 期次任务列表 | 用户 |
| POST / GET | /api/graph | 创建图谱（**校验并计入配额**）/ 列表 | 用户 |
| GET / DELETE | /api/graph/{id} | 详情（实体+关系）/ 删除 | 用户 |
| POST | /api/graph/{id}/refresh | 重建（**计入配额**） | 用户 |
| POST | /api/org · /join · /leave | 创建企业 / 邀请码加入 / 退出（owner 仅剩自己时退出即解散） | 用户 |
| GET | /api/org/me · /members | 我的企业 / 成员列表（含各自 month_used） | 用户 |
| PATCH | /api/org | 改企业名 | org owner/admin |
| POST | /api/org/invite-code/reset | 重置邀请码 | org owner/admin |
| PATCH / DELETE | /api/org/members/{id} | 改角色(admin|member)/月额度 / 移出（不能动 owner/自己） | org owner/admin |
| GET | /api/notifications · /unread-count | 通知列表 / 未读数 | 用户 |
| POST | /api/notifications/read | 标记已读 | 用户 |
| GET | /api/assistant/sessions | 会话列表（懒迁移旧消息） | 用户 |
| PATCH / DELETE | /api/assistant/sessions/{id} | 重命名 / 删除会话（含消息） | 用户 |
| GET / DELETE | /api/assistant/sessions/{id}/messages | 某会话消息（最近 100 升序）/ 清空 | 用户 |
| POST | /api/assistant/ask | 全局助手提问（多会话，不占配额） | 用户 |
| GET | /api/billing/plans · /orders | 套餐/订单 | —/用户 |
| POST | /api/billing/upgrade | 模拟支付升级（个人或企业口径） | 用户 |
| GET | /api/admin/stats · /users?q= | 管理统计 / 用户列表 | 系统 admin |
| PATCH | /api/admin/users/{id} | 改用户套餐/角色（不能取消自己 admin） | 系统 admin |
| GET | /api/admin/orgs?q= | 企业列表（名称/套餐/到期/成员数/本月用量，limit 200） | 系统 admin |
| PATCH | /api/admin/orgs/{id} | 改企业套餐（free 清到期时间；付费生效 30 天） | 系统 admin |

属主规则：普通用户只能访问本人或本企业资源，系统 admin 可访问全部任务。

## 14. 当前状态

全部完成并验证：

- 商业化账号体系、会员/支付/管理后台（含企业管理）、Agent 全流程、任务详情三 Tab、报告导出（PDF/Word/MD）
- 时效引擎、定时追踪 + 调度器 + 变更摘要推送（站内/邮件/Webhook）、关系图谱、报告问答
- 企业组织（邀请码/角色/成员额度/共享可见性）、站内通知铃铛
- **配额治理 v2**：失败不扣额、图谱计入用量、调度器配额跳过 + 月内单次通知、侧栏徽章企业口径、额度红条升级引导
- **全局 AI 助手**：两阶段报告定位 + 多轮问答 + 引用链接，悬浮球 + 独立页共用服务端历史
- 代码托管：`https://github.com/JimmyZhang06/competitive-intel-agent.git` 分支 **agent-v2**（main 是另一个项目，勿强推覆盖）

## 15. 踩坑备忘

### 15.1 报告导出（utils/exportReport.tsx）★★★

- **html2pdf 三大坑**：
  1. 偏移样式（`fixed;left:-10000px`）只能放**外层 wrapper**——html2pdf 连内联样式克隆目标元素，目标自带偏移会导致 PDF 全白（文件仅十几 KB）；`from(content)` 传干净的内层
  2. content 宽度必须 = **A4 内容区宽** (210-12-12)mm ≈ **703px**，按整页 794px 设置会右侧截断 91px（表格缺列）
  3. html2canvas 克隆整个 document 会重载页面上其他外部图片，需 `imageTimeout:1500` + `ignoreElements` 排除 wrapper 外的 IMG
- **Word (.doc = HTML) 要点**：
  1. 必须 mso 声明 `<w:View>Print</w:View>` + `@page Section1`（A4 尺寸/页边距）+ `div.Section1` 包裹，否则 Word 以 Web 版式打开
  2. Word 不支持 `display:none`——封面外重复的 h1 要用正则从 HTML 直接移除
  3. **Word 的 HTML 引擎对 CSS `page-break-*` 支持不可靠**：分页规则只给 PDF 用（`PDF_PAGEBREAK_CSS`）；Word 换页用手动分页符 `<br clear="all" style="mso-special-character:line-break;page-break-before:always">`
- Vite 下改 `utils/*.ts(x)` 非组件模块 **HMR 不会热替换**，浏览器必须整页刷新后再验证导出

### 15.2 通用

- 改 `.env` → **必须重启后端**（lru_cache）；后端通常无 `--reload`，改代码也要手动重启
- SQLite 加列 → 在 `migrate_columns()` 补 DDL；加表 → create_all 自动处理
- PowerShell：内联 `python -c` / 复杂引号易碎，写临时 .ps1/.py 执行；命令分隔用 `;`；pip 用 `python -m pip`
- 报告引用编号 = 来源入库顺序 = 详情接口 sources 数组顺序，三者严禁错位（前端筛选/排序保留原始 index）
- SSE 的 EventSource 不支持自定义 Header，鉴权走 `?token=` 查询参数
- **时区约定**：后端一律 UTC 且序列化不带 Z 后缀，前端解析必须走 `utils/time.ts::parseUtc`（补 Z）；直接 `new Date(str)` 会被按本地时区误读
- 调度器与配额都依赖 UTC 自然月口径（`month_start_utc`），排查配额问题先确认时间维度
- Pydantic：ORM 字段存 JSON 字符串（如 assistant_messages.refs）时不要 `model_validate(orm_obj)` 直转含 list 的 schema，会类型冲突——手动 json.loads 构造
- 8000 端口可能被其他项目占用（curl `openapi.json` 看 title 判断），启动前先确认
- browser-use MCP：React 受控输入用 native setter + dispatchEvent('input')；点按钮勿按 type=submit 泛匹配（会误点"退出登录"）；take_screenshot 对 PDF 查看器会超时，验证下载文件改查 Downloads 目录 + 内容断言
