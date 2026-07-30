# 竞品调研 Agent — 项目交接与技术实现文档 v1.0

> 更新时间：交互优化（秒开执行视图 + 阶段步骤条）完成后。当前所有功能均已上线并通过浏览器端到端验证，`tsc --noEmit` 零错误。

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [环境配置与启动](#4-环境配置与启动)
5. [账号体系与会员](#5-账号体系与会员)
6. [Agent 调研流水线](#6-agent-调研流水线)
7. [前端功能](#7-前端功能)
8. [数据模型](#8-数据模型)
9. [API 一览](#9-api-一览)
10. [当前状态](#10-当前状态)
11. [踩坑备忘](#11-踩坑备忘)

---

## 1. 项目概览

一个**商业化的 AI 竞品调研 SaaS**：用户输入产品名称（可选竞品与调研重点），后台 Agent 自动完成"规划检索关键词 → 联网检索 → 对比分析 → 数据洞察 → 生成报告"全流程，前端实时展示进度，最终交付带引用溯源的 Markdown 报告、可视化数据洞察（雷达图/评分对比/SWOT）与分级可信的信息来源列表，并支持一键导出 PDF / Word / Markdown。

内置完整账号体系（注册/登录/改密/忘记密码/登录历史/退出所有设备/注销）、三级会员（免费/专业/企业）、JWT + 会话版本控制、模拟支付订单与管理后台。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy 2.0 · SQLite · sse-starlette · PyJWT · bcrypt · pydantic-settings |
| LLM | OpenAI 兼容接口（当前配置 DeepSeek），`app/services/llm.py` 封装 `chat` / `chat_json` |
| 检索 | Tavily API（`tavily-python`，`include_raw_content=True`） |
| 前端 | React 18 · TypeScript · Vite 5 · Tailwind CSS 4 · react-router-dom 6 · react-markdown + remark-gfm · recharts · **html2pdf.js** |

## 3. 目录结构

```
agent/
├─ backend/
│  ├─ .env                      # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / TAVILY_API_KEY / JWT_SECRET
│  ├─ research.db               # SQLite 数据库
│  └─ app/
│     ├─ main.py                # 应用入口：create_all + migrate_columns() 轻量迁移 + seed_admin()
│     ├─ core/config.py         # Settings（@lru_cache 缓存，改 .env 必须重启后端！）
│     ├─ core/plans.py          # 套餐权益表 + effective_plan()（付费到期回落 free）
│     ├─ core/security.py       # bcrypt 哈希 + JWT 签发/校验（payload 带会话版本 ver）
│     ├─ db/models.py           # User / Order / LoginLog / ResearchTask / TaskStep / Source
│     ├─ api/                   # auth.py / research.py / billing.py / admin.py / deps.py
│     ├─ schemas/               # auth.py / research.py（TaskDetail.report_data 带 JSON 解析 validator）
│     └─ services/
│        ├─ agent.py            # ★ Agent 编排核心（分级/洞察/可信度全在这里）
│        ├─ llm.py              # LLM 客户端
│        └─ search.py           # Tavily 客户端
└─ frontend/
   └─ src/
      ├─ api/types.ts + client.ts   # 全部类型与 API 封装（token key = 'cr_token'，401 自动跳登录）
      ├─ auth/AuthContext.tsx       # 登录态上下文 + RequireAuth/RequireAdmin 路由守卫
      ├─ layouts/AppLayout.tsx      # 工作台侧边栏布局
      ├─ pages/                     # LandingPage / LoginPage / RegisterPage / ForgotPasswordPage
      ├─ pages/app/                 # Dashboard / NewResearch / Tasks / TaskDetail / Pricing / Account / Admin
      ├─ components/                # 见 §7.3 组件清单
      └─ utils/
         ├─ exportReport.tsx        # ★ 报告导出模块（PDF/Word/Markdown 独立离屏模板），坑极多，见 §11.1
         └─ reportSections.ts       # splitSourcesSection：从 markdown 剥离"信息来源"章节
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

- `backend/.env` 必填：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`TAVILY_API_KEY`；生产环境务必改 `JWT_SECRET`
- 默认管理员（启动自动播种）：`admin@example.com` / `Admin123456`（角色 admin，视同企业版）
- Windows 注意：pip 需用 `python -m pip`；PowerShell 用 `;` 分隔命令（不支持 `&&`）

### 4.2 配置生效机制 ★（Tavily 密钥"用不了"问题诊断结论）

**密钥本身没有问题。** 历史失败任务的真实原因：任务创建于 .env 填写完整**之前**，或填写后**未重启后端**。

两个必须知道的机制：

1. `get_settings()` 带 `@lru_cache`，配置**只在进程启动时读一次**——修改 `.env` 后必须重启后端才生效
2. `env_file=".env"` 是相对路径——uvicorn 必须**在 backend 目录下启动**，否则读不到 .env

配置缺失时任务直接 failed 并给出中文提示。

## 5. 账号体系与会员

### 5.1 套餐权益

| 套餐 | 价格 | 每月调研次数 | 检索关键词组数 | 优先队列 |
|---|---|---|---|---|
| free 免费版 | ¥0 | 3 | 4 | — |
| pro 专业版 | ¥99/月 | 30 | 8 | ✓ |
| enterprise 企业版 | ¥399/月 | 不限（-1） | 12 | ✓ |

- 升级走模拟支付：`POST /api/billing/upgrade` 直接生成已支付订单并生效 30 天，同套餐续费顺延；`effective_plan()` 判断到期自动回落 free
- 管理员可在后台改任意用户的套餐/角色（不能取消自己的 admin）；配额按自然月统计已创建任务数

### 5.2 安全机制

- **JWT + 会话版本控制**：token payload 带 `ver`，与 `users.token_version` 比对；修改密码 / 退出所有设备时版本 +1，全部旧 token 立即失效（当前设备接口返回新 token 实现无感换新）
- JWT 有效期 7 天；前端 token 存 `localStorage['cr_token']`，401 自动清 token 跳登录页
- 密码 bcrypt 加密，注册校验 ≥8 位且含字母数字；**忘记密码**走验证码重置（演示模式接口直接返回验证码，`users.reset_code` + 过期时间）
- **登录历史**：`login_logs` 表记录 login/register/reset 动作 + IP + UA，个人中心展示最近 20 条
- **注销账号**：密码确认后级联删除用户全部数据（任务/来源/订单/日志），管理员不可注销
- **头像**：8 种预设色键或上传图片（前端 canvas 压缩为 128×128 的 data URL 存 `users.avatar`）

## 6. Agent 调研流水线

`run_research(task_id)`（backend/app/services/agent.py）由 BackgroundTasks 触发，五个阶段（status 依次流转，每步写 TaskStep 供 SSE 推送）。

### 6.1 阶段流转

1. **planning 规划**：LLM 产出竞品清单 + 按套餐上限（4/8/12 组）的检索关键词，每组带 `dimension` 维度标签
2. **searching 检索**：`_search_all` 并发调用 Tavily（每组最多 5 条，URL 去重），每条结果带 `score/raw_content/published_date` 并打上其检索组的 `dimension`；随后按 §6.2 分级；`_save_sources` 全字段入库（raw_content 截断 8000 字符）；**入库顺序 = 材料编号 = 前端引用角标编号**
3. **analyzing 分析**：材料按维度分组呈现给 LLM，prompt 强制每条论断紧跟 `[n]` 引用编号
4. **数据洞察**（analyzing 阶段内，额外 1 次 `chat_json` 调用）：`_insights` 产出结构化 JSON 存 `report_data`（契约见 §6.3）；调研对象本身参与评分；SWOT 针对调研对象；**失败不阻断报告**（加"数据洞察生成失败"步骤后继续）
5. **reporting 报告**：正文保持 `[n]` 引用格式；含"可信度说明"章节——`_credibility_summary` 程序化统计来源分级构成/时间跨度/维度覆盖后注入 prompt

### 6.2 来源分级规则（classify_source 启发式）

| 分级 | 判定 |
|---|---|
| **official** | 域名主体归一化后与竞品/产品名匹配 |
| **media** | 命中 `MEDIA_DOMAINS` 清单（36kr/techcrunch/ifanr/sspai/theverge 等） |
| **community** | 命中 `COMMUNITY_DOMAINS` 清单（zhihu/reddit/github/v2ex/producthunt/g2 等） |
| **other** | 其余 |

### 6.3 数据洞察 JSON 契约（report_data）

```json
{"dimensions": ["功能完备性","定价竞争力","用户口碑","市场声量","发展潜力"],
 "competitors": [{"name": "...", "scores": {"功能完备性": 8}, "positioning": "一句话定位"}],
 "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
 "verdict": "总体结论"}
```

## 7. 前端功能

### 7.1 页面清单

- **营销首页 `/`**：Hero、功能卡、工作流、定价表，未登录可浏览
- **登录/注册/忘记密码** `/login` `/register` `/forgot`
- **工作台 `/app`**（AppLayout 侧边栏 + PlanBadge）：
  - 仪表盘：配额进度、统计卡、最近调研
  - 新建调研 `/app/new`：产品名 + 可选竞品/重点，提交前校验配额；**创建成功后 `navigate` 携带 `state:{task}` 跳详情页，详情页用路由 state 初始化，秒进执行视图无"加载中"闪屏**
  - 调研记录 `/app/tasks`：列表 + 删除
  - **任务详情 `/app/tasks/:id`**（见 §7.2）
  - 套餐升级 `/app/pricing`
  - **个人中心 `/app/account`（三 Tab）**：概览（头像编辑/昵称行内编辑/本月用量进度条/近 6 个月用量柱状图/套餐状态）、安全（改密码/登录历史/退出所有设备/注销账号）、订单（订单记录表）
  - 管理后台 `/app/admin`（仅 admin：运营统计/用户搜索/改套餐与角色）

### 7.2 任务详情页

**运行中——一体化执行视图**（报告 main 区域不渲染）：

- 渐变状态头（blue→cyan）：「🤖 Agent 正在调研「{产品名}」」+ 秒级用时计时（绝对时差 `now - created_at`，后台标签页节流可自校正；后端时间无时区后缀需补 Z 解析，见 `parseUtc`）
- `PhaseStepper` 四阶段步骤条（规划方案/联网检索/对比分析/生成报告）：已完成实心✓、进行中 animate-pulse + ring 高亮、未开始置灰
- `StepTimeline` 实时 SSE 时间线（EventSource 用 `?token=` 鉴权），max-h 内自动滚动到最新步骤
- 完成/失败后执行视图收起为「🕐 执行过程」折叠按钮

**完成后——三 Tab**：

1. **调研报告**：正文 `ReportView` + **右侧** `ReportToc`（竖线导航样式，sticky + scroll spy，`lg` 断点以下隐藏）；正则 `\[(\d+)\](?!\()` 把 `[n]` 转为可点击上标角标，点击打开来源抽屉；**正文中 LLM 生成的"信息来源"章节被 `splitSourcesSection` 剥离**，改由结构化双列卡片（编号徽标 + 标题 + TierBadge + 域名 + 日期）渲染，点击同样打开抽屉
2. **数据洞察**（`report_data` 为 null 时整个 Tab 隐藏）：verdict 结论条 + `ScoreRadar` 雷达图 + `ScoreBars` 分维度条形对比 + `SwotGrid` 四象限 + 各竞品一句话定位卡
3. **信息来源**：概览统计卡 + 可信度堆叠分布条 + 分级/维度筛选 + 相关度/编号/时间排序 + 双列 `SourceCard` + 来源详情抽屉

页面级挂载 `SourceDrawer`（右滑抽屉）：报告引用角标与来源卡片共用；懒加载 `GET /sources/{id}` 展示 raw_content 阅读模式；ESC/遮罩关闭。

**报告导出**：头部"导出"下拉菜单 → PDF / Word / Markdown / 浏览器打印。实现在 `utils/exportReport.tsx`，走独立离屏模板（封面 + 正文 + 来源附录），与页面布局完全解耦。**改这个文件前必读 §11.1 踩坑备忘。**

### 7.3 组件清单（frontend/src/components/）

`PhaseStepper` `ReportView` `ReportToc` `ScoreRadar` `ScoreBars` `SwotGrid` `SourceCard` `SourceDrawer` `TierBadge`（导出 `TIER_LABELS`）`StepTimeline` `StatusBadge` `PlanBadge` `AuthShell` `BackToTop` `ChartCard` `ReadingProgress`

## 8. 数据模型

### 8.1 表结构（SQLite）

- **users**：id/email/password_hash/nickname/**avatar**(预设色键或 data:image base64)/role(user|admin)/plan/plan_expires_at/**token_version**/**reset_code**/**reset_code_expires_at**
- **orders**：模拟支付订单 plan/amount/status(paid|refunded)/paid_at
- **login_logs**：action(login|register|reset)/ip/user_agent（安全日志）
- **research_tasks**：product_name/competitors/focus/status/error/report_markdown/**report_data**(洞察 JSON 字符串)
- **task_steps**：seq/phase/title/detail（进度时间线）
- **sources**：title/url/snippet/**score**(0~1)/**domain**/**tier**/**published_at**/**dimension**/**raw_content**

### 8.2 轻量迁移机制

`main.py::migrate_columns()` 启动时用 `PRAGMA table_info` 检测缺失列并 `ALTER TABLE ADD COLUMN`（SQLite create_all 不改已有表）。新加列时在该函数的 `required` 字典补 DDL 即可，旧库无需删除。

## 9. API 一览

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
| GET | /api/research/quota | 本月配额 | 用户 |
| POST | /api/research | 创建任务（校验配额），后台启动 Agent | 用户 |
| GET | /api/research · /{id} | 任务列表 / 详情（sources 不含 raw_content） | 用户 |
| GET | /api/research/{id}/sources/{sid} | 来源详情（含 raw_content，属主校验） | 用户 |
| GET | /api/research/{id}/events?token= | SSE 实时进度（step/status 事件） | 用户 |
| DELETE | /api/research/{id} | 删除任务（级联删 steps/sources） | 用户 |
| GET | /api/billing/plans · /orders | 套餐/订单 | —/用户 |
| POST | /api/billing/upgrade | 模拟支付升级 | 用户 |
| GET | /api/admin/stats · /users?q= | 管理统计/用户列表 | admin |
| PATCH | /api/admin/users/{id} | 改套餐/角色 | admin |

属主规则：普通用户只能访问自己的任务，admin 可访问全部。

## 10. 当前状态

全部完成并验证：

- 商业化账号体系（11 个 auth 端点）、会员/支付/管理后台、Agent 全流程、任务详情三 Tab、来源 Tab 重设计、报告导出（PDF/Word/MD）
- 交互优化：新建调研秒开执行视图（路由 state 直传）+ 一体化执行视图（渐变状态头/四阶段步骤条/自动滚动时间线/用时计时），端到端验证通过
- `tsc --noEmit` 零错误；README.md 已对齐最新状态（双语格式）
- 导出验证结论：PDF 4MB/9 页排版正常（含附录密集分页）；Word .doc 以页面视图 + A4 打开，附录整体另起一页且不再一条一页
- 代码托管：`https://github.com/JimmyZhang06/competitive-intel-agent.git` 分支 **agent-v2**（main 是另一个项目，勿强推覆盖）

无已知遗留缺陷。

## 11. 踩坑备忘

### 11.1 报告导出（utils/exportReport.tsx）★★★

- **html2pdf 三大坑**：
  1. 偏移样式（`fixed;left:-10000px`）只能放**外层 wrapper**——html2pdf 连内联样式克隆目标元素，目标自带偏移会导致 PDF 全白（文件仅十几 KB）；`from(content)` 传干净的内层
  2. content 宽度必须 = **A4 内容区宽** (210-12-12)mm ≈ **703px**，按整页 794px 设置会右侧截断 91px（表格缺列）
  3. html2canvas 克隆整个 document 会重载页面上其他外部图片，需 `imageTimeout:1500` + `ignoreElements` 排除 wrapper 外的 IMG
- **Word (.doc = HTML) 要点**：
  1. 必须 mso 声明 `<w:View>Print</w:View>` + `@page Section1`（A4 尺寸/页边距）+ `div.Section1` 包裹，否则 Word 以 Web 版式打开（无页面概念）
  2. Word 不支持 `display:none`——封面外重复的 h1 要用正则从 HTML 直接移除
  3. **Word 的 HTML 引擎对 CSS `page-break-*` 支持不可靠**：`page-break-inside:avoid` 会被错误解释成每个 div 独占一页；`page-break-before:always` 挂在 class 上触发位置也不对。分页规则只能给 PDF 用（`PDF_PAGEBREAK_CSS`）；Word 换页用**手动分页符标记** `<br clear="all" style="mso-special-character:line-break;page-break-before:always">`（Word 另存 HTML 的原生写法），插在附录 div 之前
- **PDF 排版验证方法**：图片型 PDF 按 `FFD8FF`/`FFD9` 标记提取内嵌 JPEG 逐页目视检查（写临时 py 脚本，用完即删）
- Vite 下改 `utils/*.ts(x)` 这类非组件模块 **HMR 不会热替换**，浏览器必须整页刷新后再验证导出

### 11.2 通用

- 改 `.env` → **必须重启后端**（lru_cache）
- SQLite 加列 → 在 `migrate_columns()` 补 DDL，勿依赖 create_all
- PowerShell：内联 `python -c` / 复杂引号易碎，写临时 .ps1/.py 执行；命令分隔用 `;`
- pip 直接运行会 Access denied，用 `python -m pip`
- 报告引用编号 = 来源入库顺序 = 详情接口 sources 数组顺序，三者严禁错位（前端筛选/排序时保留原始 index）
- SSE 的 EventSource 不支持自定义 Header，鉴权走 `?token=` 查询参数
- 后端时间为 UTC 且序列化可能不带时区后缀，前端解析需补 Z（`parseUtc`）
- 8000 端口可能被其他项目占用（curl `openapi.json` 看 title 判断是谁），启动前先确认
- browser-use MCP：React 受控输入用 native setter + dispatchEvent('input')；点按钮勿按 type=submit 泛匹配（会误点"退出登录"）；take_screenshot 对 PDF 查看器会超时，验证下载文件改查 Downloads 目录 + 内容断言
