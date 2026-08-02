# 竞品调研 Agent — 项目交接与技术实现文档 v5.1

> 版本：v5.1.0 | 日期：2026-08-02

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [环境配置与启动](#4-环境配置与启动)
5. [账号体系与权限矩阵](#5-账号体系与权限矩阵)
6. [安全增强](#6-安全增强)
7. [配额规则专章](#7-配额规则专章)
8. [Agent 调研流水线与时效引擎](#8-agent-调研流水线与时效引擎)
9. [来源去重、置信度与冲突检测](#9-来源去重置信度与冲突检测)
10. [来源快照存档](#10-来源快照存档)
11. [定时追踪与调度器](#11-定时追踪与调度器)
12. [关系图谱](#12-关系图谱)
13. [竞品管理](#13-竞品管理)
14. [竞品画像与横向对比](#14-竞品画像与横向对比)
15. [RBAC 细粒度权限](#15-rbac-细粒度权限)
16. [审计日志与执行快照](#16-审计日志与执行快照)
17. [加密服务](#17-加密服务)
18. [限流服务](#18-限流服务)
19. [AI 助手（报告问答 + 全局助手）](#19-ai-助手报告问答--全局助手)
20. [前端功能](#20-前端功能)
21. [数据模型](#21-数据模型)
22. [API 一览](#22-api-一览)
23. [当前状态](#23-当前状态)
24. [踩坑备忘](#24-踩坑备忘)

---

## 1. 项目概览

一个**商业化的 AI 竞品情报 SaaS**，九大能力模块：

1. **竞品调研 Agent**：输入产品名称（可选竞品/调研重点/检索时效），后台自动完成"规划检索关键词 → 联网检索 → 去重/置信度/冲突检测 → 快照存档 → 对比分析 → 数据洞察 → 事件时间线 → 生成报告"全流程，前端 SSE 实时进度，交付带 `[n]` 引用溯源的 Markdown 报告、可视化数据洞察（雷达图/评分对比/SWOT/时间线）与分级可信的信息来源列表，一键导出 PDF / Word / Markdown
2. **定时追踪**：按日/周/月自动重跑调研，期次间生成变更摘要，站内/邮件/Webhook 推送；内置线程调度器
3. **关系图谱**：以任意企业/产品为根，联网抽取产业链关系网络（上下游/竞争/合作/投资/母子公司），画布可视化
4. **竞品管理**：结构化注册竞品信息（名称/别名/官网/技术主题/关键词），企业级隔离，支持官网爬虫
5. **竞品画像**：结构化画像模板 → 基于已有来源生成竞品画像 → 冻结锁定 → 多份画像横向对比
6. **AI 问答**：单报告追问 + 全局 AI 助手（悬浮球/独立页），自动定位相关报告作答并附引用链接，不占配额
7. **管理后台**：运营统计 + 用户管理 + 企业管理 + 审计日志 + 执行快照 + 权限管理
8. **安全增强**：JWT + Refresh Token、令牌桶限流、Fernet 加密、审计日志、执行快照
8.5 **审计保护**：审计日志数据库级触发器（防 UPDATE/DELETE 篡改）
9. **企业组织**：邀请码加入、owner/admin/member 三级企业角色、企业套餐共享配额、成员月额度管控、RBAC 细粒度权限、任务/追踪/图谱企业内共享可见

内置完整账号体系（注册/登录/改密/忘记密码/Refresh Token/登录历史/退出所有设备/注销/用量）、三级会员（个人 + 企业双维度）、模拟支付订单、站内通知、来源快照存档与审计追踪。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy 2.0 · SQLite · sse-starlette · PyJWT · bcrypt · pydantic-settings |
| LLM | OpenAI 兼容接口（当前配置 DeepSeek），`app/services/llm.py` 封装 `chat` / `chat_json` / `chat_messages`（多轮），内置审计埋点 |
| 检索 | Tavily API（`tavily-python`，`include_raw_content=True`，支持 time_range） |
| 安全 | bcrypt · JWT + Refresh Token · Fernet 对称加密 · 令牌桶限流 · 审计日志 · 执行快照 |
| 调度 | `services/scheduler.py` 守护线程，60 秒轮询（无 celery/cron 外部依赖）；启动时自动恢复未完成的画像提取任务 |
| 前端 | React 18 · TypeScript · Vite 5 · Tailwind CSS 4 · react-router-dom 6 · react-markdown + remark-gfm · recharts · ReactFlow · **html2pdf.js** |
| 爬虫 | httpx + BeautifulSoup4（竞品官网信息结构化提取） |

## 3. 目录结构

```
agent/
├── backend/
│   ├── .env                      # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / TAVILY_API_KEY / JWT_SECRET / MASTER_KEY / SMTP*
│   ├── research.db               # SQLite 数据库（WAL 模式）
│   ├── research.db-shm / .db-wal # WAL 共享内存与日志
│   ├── requirements.txt
│   ├── start.bat                 # Windows 一键启动
│   ├── start.ps1                 # PowerShell 一键启动
│   ├── _smtp_test.py             # SMTP 连通性测试工具
│   └── app/
│     ├── main.py                # ★ 入口：create_all + migrate_columns() + seed_admin() + 启动校验 + 启动调度器线程
│     ├── core/
│     │  ├─ config.py           # Settings（@lru_cache 缓存，改 .env 必须重启后端！）
│     │  ├─ plans.py            # ★ 套餐权益唯一权威定义（PLANS/TRACKER_LIMITS/effective_plan/effective_org_plan）
│     │  ├─ security.py         # ★ bcrypt 哈希 + JWT 签发/校验（Access 8h / Refresh 30d，payload 带 ver + type）
│     │  ├─ crypto.py           # Fernet 对称加密（AES-128-CBC + HMAC），加密 DB 敏感字段
│     │  ├─ rate_limit.py       # 令牌桶限流（按 IP + 端点分类）
│     │  └─ timeutil.py         # 时效引擎工具：baseline_now/parse_published/age_days_of/recency_weight
│     ├── db/
│     │  ├─ database.py         # SQLAlchemy 引擎 + WAL/外键/busy_timeout 配置
│     │  └─ models.py           # ★ 23 张表 ORM（见 §21）
│     ├── schemas/               # auth.py / research.py / org.py / tracker.py / graph.py / competitor.py / profiles.py / crawl.py
│     ├── api/                   # deps (auth+quota+RBAC) / auth / research (+/ask/email) / trackers / graph /
│     │                        #   org / competitors / profiles / crawl / permissions / notifications /
│     │                        #   assistant (multi-session + ask) / billing / admin
│     └── services/
│        ├─ agent.py            # ★ 调研 Agent 编排核心（规划→检索→去重/置信度/快照→分析→洞察→时间线→报告）
│        ├─ graph_agent.py      # 图谱构建（实体/关系抽取 + 分析报告）
│        ├─ llm.py              # LLM 客户端（chat / chat_json / chat_messages），内置审计埋点
│        ├─ search.py           # Tavily 客户端
│        ├─ dedup.py            # 来源去重 + 冲突检测 + 置信度估算
│        ├─ snapshot.py         # 页面快照抓取（HTML + 纯文本，httpx + BeautifulSoup）
│        ├─ digest.py           # 期次变更摘要（与上一期报告对比）
│        ├─ notify.py           # 通知分发：站内 Notification / SMTP 邮件(缺配置转 demo) / Webhook 四格式
│        ├─ scheduler.py        # ★ 追踪调度器（60s 扫描 + 配额跳过策略 + 执行快照，见 §11）
│        ├─ audit.py            # 审计日志写入
│        ├─ profiles.py         # 竞品画像生成 + 冻结
│        ├─ profile_extractor.py # 竞品画像结构化信息提取
│        ├─ comparison.py       # 多份冻结画像横向对比
│        └─ crawler.py          # 竞品官网爬虫核心逻辑
└── frontend/
   └── src/
      ├─ api/types.ts + client.ts   # 全部类型与 API 封装（token key = 'cr_token'，401 自动跳登录 + Refresh 重试）
      ├─ auth/AuthContext.tsx       # 登录态上下文 + RequireAuth/RequireAdmin 路由守卫
      ├─ hooks/                     # useErrorHandler / usePageTitle
      ├─ layouts/AppLayout.tsx      # 侧边栏布局（通知铃铛 + AI 悬浮球 + PlanBadge）
      ├─ pages/                     # LandingPage / LoginPage / RegisterPage / ForgotPasswordPage
      ├─ pages/app/                 # Dashboard / NewResearch / Tasks / TaskDetail / Trackers / TrackerDetail
      │                           #   / Graph / GraphDetail / Competitors / ProfileTemplates / Profiles
      │                           #   / Comparison / Assistant / AuditLogs / Pricing / Account / Admin
      ├─ components/                # 32 个组件（见 §20.3）
      └─ utils/
         ├─ exportReport.tsx        # ★ 报告导出（PDF/Word/Markdown 离屏模板）
         ├─ reportSections.ts       # splitSourcesSection：从 markdown 剥离"信息来源"章节
         ├─ cn.ts                   # 类名合并 + 输入框样式常量
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

- `backend/.env` 必填：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`TAVILY_API_KEY`、`JWT_SECRET`；生产环境务必配置 `MASTER_KEY`；SMTP 变量可选（缺省时邮件走演示模式落库 email_logs）
- 默认管理员（启动自动播种）：`admin@example.com` / `Admin123456`（role=admin，配额豁免）
- Windows 注意：pip 需用 `python -m pip`；PowerShell 用 `;` 分隔命令（不支持 `&&`）

### 4.2 配置生效机制 ★

1. `get_settings()` 带 `@lru_cache`，配置**只在进程启动时读一次**——修改 `.env` 后必须重启后端才生效
2. `env_file=".env"` 是相对路径——uvicorn 必须**在 backend 目录下启动**，否则读不到 .env
3. 后端通常不带 `--reload` 启动，**改任何后端代码都要手动重启**
4. 启动时自动校验 `JWT_SECRET` 必填，缺失则抛 RuntimeError 阻止启动

配置缺失时任务直接 failed 并给出中文提示；LLM key 缺失时问答类接口返回 503。

## 5. 账号体系与权限矩阵

### 5.1 三套角色体系

- **系统角色 `users.role`**：`user` / `admin`。admin = 平台运营方，配额豁免（视同 enterprise）
- **企业角色 `users.org_role`**：`owner` / `admin` / `member`，空串 = 未入企。一人同时只属于一个企业（`users.org_id`）
- **RBAC 权限 `user_permissions.permissions`**：JSON 字符串数组，如 `["source:register", "profile:generate"]`，admin 自动拥有 `*` 全权限

### 5.2 权限矩阵

| 操作 | 个人用户 | 企业 member | 企业 admin | 企业 owner | 系统 admin |
|---|---|---|---|---|---|
| 创建调研/图谱/追踪 | ✓（个人配额） | ✓（企业配额+成员额度） | ✓ | ✓ | ✓（配额豁免） |
| 查看任务/图谱/追踪 | 仅本人 | 本企业全部 | 本企业全部 | 本企业全部 | 全部 |
| 竞品管理 | ✓（个人） | ✓（企业共享） | ✓ | ✓ | ✓ |
| 画像生成/对比 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 创建企业 / 邀请码加入 | ✓ | —（需先退出） | — | — | ✓ |
| 改企业名 / 重置邀请码 | — | — | ✓ | ✓ | —（走 admin orgs 端点改套餐） |
| 改成员角色 / 成员月额度 / 移出成员 | — | — | ✓（不能动 owner） | ✓（不能动 owner） | — |
| 设置成员 RBAC 权限 | — | — | ✓（不能动 owner） | ✓（不能动 owner） | — |
| 退出企业 | — | ✓ | ✓ | 仅当企业只剩自己（退出即解散并清理追踪项） | — |
| 升级套餐（模拟支付） | ✓ 个人 | 个人套餐仍可买（入企后不生效） | ✓ | ✓ 企业套餐 | — |
| 管理后台（统计/用户/企业/审计/快照） | — | — | — | — | ✓ |
| 改任意用户套餐/角色、改任意企业套餐 | — | — | — | — | ✓（不能取消自己的 admin） |
| 注销账号 | ✓ | ✓ | ✓ | ✓ | —（管理员不可注销） |

要点：

- 企业 owner 由创建者担任，不可被改角色/移出；owner 退出企业时若仍有其他成员则被拒绝
- 属主规则：普通用户只能访问本人或本企业的资源；系统 admin 可访问全部任务
- 系统管理员进入企业时的口径以企业为准，但因其配额豁免（视同 enterprise 不限额）无实际影响
- RBAC 权限有 60 秒内存缓存，权限变更后调用 `invalidate_perm_cache()` 清除

## 6. 安全增强

### 6.1 JWT + Refresh Token

- **Access Token**：有效期 8 小时，payload 含 `sub(user_id)` + `ver(token_version)` + `type=access`
- **Refresh Token**：有效期 30 天，payload 含 `sub` + `ver` + `type=refresh`
- 登录/改密/退出所有设备时 `token_version + 1`，所有旧 token 立即失效
- 前端 401 时自动用 Refresh Token 换新 Access Token，换失败跳登录页
- SSE 场景：EventSource 不支持 Header，鉴权走 `?token=` 查询参数（仅接受 `type=access`）

### 6.2 限流（令牌桶）

按 IP + 端点路径分类限速（`core/rate_limit.py`，内存实现，生产可替换 Redis）：

| 端点 | 容量/速率 |
|---|---|
| `POST /api/auth/login` | 5 次/秒 |
| `POST /api/auth/register` | 3 次/秒 |
| `POST /api/auth/forgot` | 2 次/秒 |
| `POST /api/auth/reset` | 3 次/秒 |
| 默认（其他端点） | 60 次/秒 |

超过阈值返回 429。

### 6.3 加密（Fernet）

- `core/crypto.py`：基于 AES-128-CBC + HMAC 的 Fernet 对称加密
- 用于加密数据库中敏感字段（如密码重置验证码 `users.reset_code`）
- 密钥从 `MASTER_KEY` 环境变量加载，缺失时抛 RuntimeError
- 同一个明文每次加密结果不同（含随机 IV）

### 6.4 审计日志

- `services/audit.py` + `audit_logs` 表：记录关键操作 + LLM 调用 + 来源访问
- LLM 每次调用自动记录（model_name / prompt_tokens / completion_tokens / cost）
- `services/llm.py::_log_llm_audit()` 在每次 chat/chat_messages/chat_json 后异步埋点
- 管理后台可按 action / resource_type / user_id / 时间范围筛选查询

### 6.5 执行快照

- `execution_snapshots` 表：记录调研任务的运行时环境与配置指纹
- 字段：config_hash（SHA256 搜索配置）/ model_params / kb_version / deployment_env / candidate_version / build_hash（git HEAD）/ created_by / created_at
- 调度器每次触发时自动生成（`build_hash` 启动时由 `_load_git_hash()` 缓存到 `_GIT_HASH`，不每次调用 subprocess）
- 前端 API：`GET /api/admin/execution-snapshots?task_id=` + 无参全量列表

## 7. 配额规则专章

**权威定义**：套餐数值全部硬编码于 `core/plans.py`（PLANS + TRACKER_LIMITS），不做数据库化配置，改套餐权益只改这一处。

### 7.1 统计口径

- 周期：**UTC 自然月**（`month_start_utc()`），每月 1 日归零
- 计数（`deps.py::month_usage`）：**调研任务 + 图谱构建**（GraphProject）各计 1 次；**`status='failed'` 不计入**（失败不扣额）
- 维度：入企用户按 `org_id` 聚合**全员共享**企业配额；未入企按 `user_id` 个人计
- 生效套餐：个人 `effective_plan()`（admin 视同 enterprise；付费过期回落 free）；入企 `effective_org_plan(org)`
- 套餐：free(3次/月, 4组查询) / pro(30次/月, 8组) / enterprise(不限, 12组)

### 7.2 双重校验（deps.py::check_quota_or_403）

1. **第一重**：本月总用量 ≥ 套餐 `monthly_tasks`（-1 不限）→ 403
2. **第二重**（仅入企用户）：企业管理员给成员设置的 `users.org_monthly_limit`（-1 不限），按成员个人本月用量（`member_month_usage`，同样任务+图谱、排除 failed）校验 → 403

### 7.3 额度预警

- 配额使用达 **80%** 时自动推送站内通知"额度预警"，本月内不重复推送

### 7.4 额度用尽的行为

| 入口 | 行为 |
|---|---|
| POST /api/research、/api/graph、graph refresh、tracker run-now | 403 + 中文提示（"XX本月 N 次调研额度已用完，请升级套餐"） |
| 前端 NewResearchPage | 预检 quota 禁用提交按钮 |
| 前端 GraphPage / TrackersPage / TrackerDetailPage | 红条回显后端文案，`QuotaErrorBanner` 检测到"额度已用完/请升级"自动附"前往套餐升级 →"链接（/app/pricing） |
| 调度器自动期次 | **跳过本期**：next_run_at 照常顺延（防 60s 重试风暴），不创建任务，给创建者发站内通知"定时追踪因额度不足跳过本期"；同一追踪项**每月仅通知一次**（按 user_id+title+link+月初查重） |
| 报告问答 /ask、全局助手、竞品画像 | 不校验、不占额 |

### 7.5 记账主体差异 ★

- **run-now 手动触发**：记在**触发人**所在配额口径（个人或其企业）
- **调度器自动期次**：记在**追踪项创建人**（creator_id）口径，配额校验也以创建人身份执行
- 系统管理员创建的一切任务均豁免

## 8. Agent 调研流水线与时效引擎

`run_research(task_id)`（services/agent.py）由 BackgroundTasks 触发，status 依次流转，每步写 TaskStep 供 SSE 推送。

### 8.1 阶段流转

1. **planning 规划**：LLM 产出竞品清单 + 按套餐上限（4/8/12 组）的检索关键词，每组带 `dimension` 维度标签
2. **searching 检索**：`_search_all` 并发调用 Tavily（每组最多 5 条，URL 去重，携带任务的 time_range），每条结果带 `score/raw_content/published_date` 并打上检索组 `dimension`
3. **去重/置信度/冲突检测**（searching 内）：`dedup.py` 执行 URL 去重 + 标题相似度去重（阈值 0.85）→ `estimate_confidence` 层级权重 × 新鲜度衰减 → `detect_conflicts` 标记 pending
4. **快照存档**（searching 内）：`_save_sources` 全字段入库后异步调用 `snapshot.py` 抓取页面存档（HTML + 纯文本 + 采集元数据）
5. **analyzing 分析**：材料按维度分组呈现给 LLM（每条附来源类型/发布时间/距今天数/置信度），prompt 强制每条论断紧跟 `[n]` 引用
6. **数据洞察**（analyzing 内，额外 1 次 `chat_json`）：`_insights` 产出结构化 JSON 存 `report_data`（契约见 §8.4）；**失败不阻断报告**
7. **事件时间线**（analyzing 内，非阻断）：`_timeline` 产出结构化 JSON 合并入 `report_data.timeline`，最多 12 条事件（date/title/summary/ref）；**失败不阻断报告**
8. **reporting 报告**：正文保持 `[n]` 引用；"可信度说明"章节由 `_credibility_summary` 程序化统计分级构成/时间跨度/**新鲜度分布**（≤30天/≤180天/≤365天/更早/无日期）/维度覆盖后注入 prompt

### 8.2 时效引擎（core/timeutil.py）

- `_date_header()`：**所有 system prompt 头部注入当前日期**，要求模型以此判断时效、优先近期信息
- 规划阶段要求时效性检索词自带年份/"最新"；任务可指定 `time_range`（''/day/week/month/year）传给 Tavily
- `parse_published` 解析各种格式的发布时间；`age_days_of` 计算距今天数；`recency_weight` 供排序加权
- 支持 `research_now_override` 配置（ISO 日期），便于演示/回测
- 前端来源卡片展示发布时间与"距今 N 天"

### 8.3 来源分级规则（classify_source 启发式）

| 分级 | 判定 |
|---|---|
| **official** | 域名主体归一化后与竞品/产品名匹配 |
| **media** | 命中 `MEDIA_DOMAINS` 清单（36kr/techcrunch/ifanr/sspai/theverge 等 28 个） |
| **community** | 命中 `COMMUNITY_DOMAINS` 清单（zhihu/reddit/github/v2ex/producthunt/g2 等 20 个） |
| **other** | 其余 |

### 8.4 数据洞察 JSON 契约（report_data）

```json
{"dimensions": ["功能完备性","定价竞争力","用户口碑","市场声量","发展潜力"],
 "competitors": [{"name": "...", "scores": {"功能完备性": 8}, "positioning": "一句话定位"}],
 "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
 "verdict": "总体结论",
 "timeline": [{"date": "2025-03", "title": "...", "summary": "...", "ref": 3}]}
```

`timeline` 字段为 Agent 7 新增（§8.1 第 7 步），可能缺失，前端需优雅降级。

## 9. 来源去重、置信度与冲突检测

`services/dedup.py` 提供三层处理，均在检索完成后、入库前执行：

### 9.1 去重（dedup_by_content）

- **URL 完全相同** → 直接去重（保留第一条）
- **域名相同 + 标题相似度 > 0.85** → 标记为重复（`is_duplicate=True`，`dedup_group=gXXXXXX`）
- 使用 `difflib.SequenceMatcher` 计算相似度

### 9.2 置信度估算（estimate_confidence）

规则评分：来源层级权重 × 新鲜度衰减

| 来源层级 | 权重 |
|---|---|
| official | 0.9 |
| media | 0.7 |
| community | 0.4 |
| other | 0.2 |

新鲜度衰减：

| 年龄 | 衰减系数 |
|---|---|
| ≤30 天 | 1.0 |
| ≤180 天 | 0.85 |
| ≤365 天 | 0.6 |
| >365 天 | 0.3 |
| 无日期 / 未来日期 | 0.25 |

最终置信度 = 层级权重 × 衰减系数，范围 0~1，保留 3 位小数。

### 9.3 冲突检测（detect_conflicts）

- 同一维度内存在多个不同 URL 的来源时标记为 `conflict_status="pending"`
- 保守策略：标记待复核，人工确认一致性

## 10. 来源快照存档

`services/snapshot.py` + `SourceArchive` 表：

- 每条来源入库后异步抓取页面存档
- 策略：httpx 获取 HTML（15s 超时 + 跟随重定向 + Mozilla User-Agent）+ BeautifulSoup 纯文本提取
- 网络失败时降级为保存 raw_content，标记 `access_status`
- 存档内容：`snapshot_html`（截断 500KB）+ `snapshot_text` + `raw_content_full` + `published_at`（从 HTTP headers 提取）+ `collected_at`
- 存储字段：`snapshot_format`（固定 "html"）+ `access_status`（success/failed）+ `access_error`

## 11. 定时追踪与调度器

### 11.1 追踪项（trackers 表）

- 配置：product_name/competitors/focus/time_range + `frequency`（daily/weekly/monthly）+ `run_hour`（本地整点 0-23）+ enabled
- 推送渠道：站内通知（始终）、`push_email`、`push_webhook`（webhook_type: wecom/dingtalk/feishu/generic + webhook_url）
- 数量限额：`TRACKER_LIMITS = {free:1, pro:5, enterprise:20}`，**企业维度**计数
- 归属：`org_id`（企业共享）+ `creator_id`（记账与调度身份）

### 11.2 调度器（services/scheduler.py）

- main.py 启动守护线程，`_scan_once` 每 60 秒扫描 `enabled=True 且 next_run_at <= now` 的追踪项
- **防重入**：`_running` 集合记录正在执行的 tracker_id，上一期没跑完不触发下一期
- **执行快照**：每次触发时生成 `ExecutionSnapshot`（config_hash + model_params + build_hash(git HEAD) + deployment_env）
- **配额校验**：以 creator 身份调 `check_quota_or_403`；不足时跳过本期——`next_run_at = advance_next_run(...)` 照常顺延 + 站内通知（月内单次，见 §7.4）
- **首次运行时间**：`initial_next_run()` 计算下一个 run_hour 整点（服务器本地时区转 UTC 存储）
- **顺延逻辑**：`advance_next_run()` 按频率倍数推算，跳过已错过的期数
- 正常触发：创建 ResearchTask（tracker_id 关联，kind 为期次）、推进 next_run_at、跑完流水线后由 `digest.py` 生成 `change_summary`（与上一期报告对比的变更 Markdown），`notify.py` 分发站内/邮件/Webhook
- run-now 手动触发同样产出期次任务但记账主体不同（§7.5）

### 11.3 前端

- TrackersPage：列表 + TrackerForm 创建（超限/超额红条 QuotaErrorBanner）
- TrackerDetailPage：配置编辑 + 期次列表（RunHistoryItem 含变更摘要折叠）+ 运行中状态指示

## 12. 关系图谱

- `POST /api/graph`（root_name + industry + time_range）→ `graph_agent.py` 后台构建：联网检索 → LLM 抽取实体（company/product/org/person）与关系边（7 种类型，含 confidence + source_url）→ 生成关系网络分析报告
- **创建与 refresh 均校验并计入调研配额**（与调研任务同口径，failed 不计）
- 状态机：pending → building → completed/failed；完成后生成 `report_markdown`
- GraphProject 新增 `report_markdown` 字段存储分析报告
- 归属与可见性与任务一致（org 共享）
- 实体去重：归一化名称（去空格/符号、小写）
- 关系去重：(source_id, target_id, relation_type) 三元组去重

## 13. 竞品管理

新增 `competitors` 表 + `/api/competitors` 端点 + `/api/crawl` 端点：

- **结构化注册竞品**：name / alias / website / tech_focus / keywords（JSON 数组）
- 维度隔离：`org_id` 企业级隔离，空 `org_id` 表示系统级模板竞品（仅管理员可修改/删除）
- status 字段：active / paused / archived
- CRUD：列表（本企业 + 系统级）/ 创建（需入企）/ 修改（企业级或管理员）/ 删除（企业级或管理员，系统级仅管理员）
- 爬虫：`crawl.py` 端点支持爬取竞品官网信息，结构化提取后存储
- **多语言站点支持**：从 website URL 自动提取语言前缀（如 /cn/），Sitemap 只取该语言版本，启发式路径带前缀
- **隐私弹层过滤**：提取正文前移除 consent/cookie/privacy overlay DOM；readability 提取质量低于阈值时回退 body 文本

## 14. 竞品画像与横向对比

### 14.1 画像模板（profile_templates 表 + `/api/profiles/templates`）

- 定义维度结构：`dimensions` JSON 数组，每条含 `key`/`label`/`fields[]`
- 支持版本管理（`version` 递增）+ 冻结（`frozen_at`，冻结后不可修改，仅管理员可冻结）
- 企业级隔离 + 系统级模板

### 14.2 画像生成（services/profiles.py + services/profile_extractor.py）

- 基于冻结模板 + 竞品 + 关联来源材料 → LLM 生成结构化画像
- 来源收集：查找与该竞品相关的已完成调研任务 → 取高置信度来源（最多 20 条）
- 输出：`profile_data`（JSON，按维度字段填充）+ `source_refs`（快照副本）
- 状态：draft → reviewed → frozen

### 14.3 横向对比（services/comparison.py + `/api/profiles/compare`）

- 至少 2 份已冻结画像 → 按模板维度生成对比矩阵
- 输出：`template_name` + `dimensions` + `matrix`（每行一个维度，每列一个竞品）+ `source_refs`

## 15. RBAC 细粒度权限

- 表：`user_permissions`（user_id + permissions JSON 数组）
- 端点：`GET /api/me/permissions`（当前用户权限列表）+ `POST /api/org/members/{id}/permissions`（企业管理员设置）
- admin 自动拥有 `*` 全权限
- 内存缓存（60s TTL），变更后 `invalidate_perm_cache()` 清除
- 权限字符串示例：`["source:register", "profile:generate", "tracker:manage"]`

## 16. 审计日志与执行快照

### 16.1 审计日志（audit_logs 表 + `/api/admin/audit-logs`）

- 字段：user_id / org_id / action / resource_type / resource_id / input / result / status / error / model_name / tokens_prompt / tokens_completion / cost / ip / user_agent / created_at
- 自动记录 LLM 调用（model_name + token 用量 + cost）
- `services/llm.py::_log_llm_audit()` 在每次 chat/chat_messages/chat_json 后异步埋点
- 管理后台可按 action / resource_type / user_id / 时间范围筛选查询
- 前端独立页面：`AuditLogsPage`（完整筛选器 + 分页表格）

### 16.2 执行快照（execution_snapshots 表）

- 记录调研任务的运行时环境与配置指纹
- 字段：config_hash（SHA256 搜索配置）/ model_params / kb_version / deployment_env / candidate_version / build_hash（git HEAD）/ created_by / created_at
- 调度器每次触发时自动生成（`build_hash` 启动时由 `_load_git_hash()` 缓存到 `_GIT_HASH`，不每次调用 subprocess）
- 前端 API：`GET /api/admin/execution-snapshots?task_id=` + 无参全量列表

## 17. 加密服务

`core/crypto.py`：Fernet 对称加密（AES-128-CBC + HMAC）

- `encrypt(plaintext)` → Fernet token（URL-safe base64）
- `decrypt(ciphertext)` → 原文，解密失败返回空串
- 同一个明文每次加密结果不同（含随机 IV）
- 密钥从 `MASTER_KEY` 环境变量加载（通过 pydantic-settings）
- **当前用途**：加密密码重置验证码（`users.reset_code`）
- `ServiceKey` 模型预留外部服务 API 密钥加密存储接口

## 18. 限流服务

`core/rate_limit.py`：基于内存的令牌桶（Token Bucket）

- 按 `IP:endpoint_path` 分类限速
- 容量可动态调整（检测到规则变更时截断当前令牌）
- 生产环境可替换为 Redis 实现，接口不变

## 19. AI 助手（报告问答 + 全局助手）

### 19.1 单报告追问（research.py::/{task_id}/ask）

针对当前报告上下文回答，附对话历史，不占配额。额外附带来源材料（最多 15 条，每条摘要 600 字符）。

### 19.2 全局助手（api/assistant.py）★

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

### 19.3 前端

- `components/AssistantChat.tsx`：共用对话面板（消息列表/markdown 渲染/refs 链接/输入框/清空）
- `components/AssistantWidget.tsx`：右下角悬浮球 + 浮动面板（w-96 h-[560px]），挂在 AppLayout；在 /app/assistant 页自动隐藏
- `pages/app/AssistantPage.tsx`：独立页（侧栏"AI 助手"入口），左侧会话历史侧栏（新建/重命名/删除会话），右侧共用 `AssistantChat`；与悬浮球共用服务端历史

## 20. 前端功能

### 20.1 页面清单

- **营销首页 `/`**、登录/注册/忘记密码
- **工作台 `/app`**（AppLayout：侧边栏 + PlanBadge + NotificationBell + AssistantWidget）：
  - 仪表盘：配额进度、统计卡、最近调研
  - 新建调研 `/app/new`：提交前校验配额；创建成功后路由 state 直传秒开执行视图
  - 调研记录 `/app/tasks`、任务详情 `/app/tasks/:id`（见 §20.2）
  - 定时追踪 `/app/trackers` + `/app/trackers/:id`（期次/变更摘要/运行状态）
  - 关系图谱 `/app/graph` + `/app/graph/:id`（画布 + 分析报告）
  - 竞品管理 `/app/competitors`（卡片 CRUD + 爬虫）
  - 画像模板 `/app/profiles/templates`、竞品画像 `/app/profiles`、横向对比 `/app/profiles/compare`
  - AI 助手 `/app/assistant`
  - 审计日志 `/app/admin/audit-logs`（独立页面，完整筛选 + 分页）
  - 套餐升级 `/app/pricing`（个人/企业口径自适应）
  - 个人中心 `/app/account`（概览/安全/订单/企业 四 Tab；企业 Tab = OrgPanel：创建/加入/成员管理/成员月额度/RBAC 权限/邀请码）
  - 管理后台 `/app/admin`（仅系统 admin：运营统计 + 用户管理 + 企业管理 + 审计日志 + 执行快照）

### 20.2 任务详情页

**运行中**：渐变状态头 + 秒级计时（`now - created_at`，用 `parseUtc` 补 Z 解析）+ `PhaseStepper` 六阶段步骤条（planning → searching → analyzing[洞察] → analyzing[时间线] → reporting → done）+ `StepTimeline` SSE 时间线（EventSource `?token=` 鉴权）；完成后收起为折叠按钮。

**完成后三 Tab**：

1. **调研报告**：`ReportView` + 右侧 `ReportToc`（scroll spy）；`[n]` 转可点击角标开来源抽屉；LLM 生成的"信息来源"章节被 `splitSourcesSection` 剥离，改由结构化卡片渲染；追踪期次附变更摘要块；事件时间线（timeline 卡片）；底部"报告问答"框
2. **数据洞察**（report_data 为 null 时隐藏）：verdict 结论条 + `ScoreRadar` + `ScoreBars` + `SwotGrid` + 定位卡 + 时间线
3. **信息来源**：统计卡 + 可信度分布条 + 分级/维度筛选 + 三种排序 + `SourceCard` 双列 + 详情抽屉（raw_content 阅读模式，含快照状态）

**报告导出**：PDF / Word / Markdown / 打印，实现在 `utils/exportReport.tsx`（改前必读 §24.1）。

### 20.3 组件清单（frontend/src/components/）

`PhaseStepper` `ReportView` `ReportToc` `ScoreRadar` `ScoreBars` `SwotGrid` `ScoreTrend` `SourceCard` `SourceDrawer` `TierBadge` `StepTimeline` `StatusBadge` `PlanBadge` `AuthShell` `BackToTop` `ChartCard` `ReadingProgress` `NotificationBell` `OrgPanel` `TrackerForm` `RunHistoryItem` `QuotaErrorBanner` `AssistantChat` `AssistantWidget` `ConfirmDialog` `Skeleton` `ProfileGenProgress` `ErrorBoundary` `PlanBadge`

## 21. 数据模型

### 21.1 表结构（SQLite，23 张，WAL 模式）

- **users**：id/email/password_hash/nickname/avatar/role(user|admin)/plan/plan_expires_at/token_version/reset_code(+expires)/**org_id**/**org_role**(owner|admin|member)/**org_monthly_limit**(-1 不限)
- **organizations**：name/plan/plan_expires_at/owner_id/invite_code(8 位)
- **orders**：模拟支付订单 plan/amount/status(paid|refunded)/paid_at
- **login_logs**：action(login|register|reset)/ip/user_agent
- **research_tasks**：product_name/competitors/focus/**time_range**/status/error/report_markdown/report_data/**org_id**/**tracker_id**(期次归属)/**change_summary**(与上一期对比 markdown)
- **task_steps**：seq/phase/title/detail（进度时间线）
- **sources**：title/url/snippet/score/domain/tier/**published_at**/dimension/raw_content/**confidence**/**conflict_status**/**conflict_note**/is_duplicate/dedup_group/**access_status**/**access_error**/**collected_at**（属性 age_days）
- **source_archives**：task_id/source_id/snapshot_html/snapshot_text/snapshot_format/published_at/collected_at/access_status/access_error/raw_content_full（Agent 7 新增）
- **trackers**：org_id/creator_id/product_name/competitors/focus/time_range/frequency(daily|weekly|monthly)/run_hour/next_run_at/last_run_at/enabled/push_email/push_webhook/webhook_type/webhook_url
- **notifications**：user_id/org_id/title/body/link(前端路由)/read
- **assistant_sessions**：user_id/title（多会话列表）/created_at/updated_at
- **assistant_messages**：user_id/**session_id**/role(user|assistant)/content/**refs**(JSON 数组 [{task_id, product_name}])
- **email_logs**：to_email/subject/body/status(sent|demo|failed)
- **graph_projects**：user_id/org_id/root_name/industry/time_range/status(pending|building|completed|failed)/error/**report_markdown**（关系网络分析报告）
- **graph_entities**：project_id/name/type(company|product|org|person)/industry/description/is_root
- **graph_relations**：project_id/source_id/target_id/relation_type(7 种)/description/confidence/source_url
- **competitors**：org_id/name/alias/website/tech_focus/keywords/status(active|paused|archived)/created_at/updated_at（Agent 7 新增）
- **profile_templates**：org_id/name/dimensions(JSON)/version/frozen_at/created_by/created_at（Agent 7 新增）
- **competitor_profiles**：org_id/competitor_id/template_id/profile_data(JSON)/source_refs(JSON)/status(draft|reviewed|frozen)/frozen_at/created_at/updated_at（Agent 7 新增）
- **user_permissions**：user_id/permissions(JSON 数组)/created_at（Agent 7 新增）
- **audit_logs**：user_id/org_id/action/resource_type/resource_id/input/result/status/error/model_name/tokens_prompt/tokens_completion/cost/ip/user_agent/created_at（Agent 7 新增）
- **execution_snapshots**：org_id/tracker_id/task_id/config_hash/model_params/kb_version/deployment_env/candidate_version/build_hash/created_by/created_at（Agent 7 新增）
- **service_keys**：service/encrypted_value/label/created_at/updated_at（Agent 7 新增，预留）
- **crawl_tasks**：competitor_id/url/status/content/extracted_data(JSON)/error/created_at/updated_at（Agent 7 新增）

### 21.2 轻量迁移机制

`main.py::migrate_columns()` 启动时用 `PRAGMA table_info` 检测缺失列并 `ALTER TABLE ADD COLUMN`（create_all 不改已有表）。**新加列**时在该函数 `required` 字典补 DDL；**新加表**（如 competitors、profile_templates）由 create_all 自动建，无需迁移。

## 22. API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | /api/auth/register · /login | 注册/登录，返回 token+user（含 refresh_token） | — |
| POST | /api/auth/refresh | Refresh Token 换新 | — |
| GET | /api/auth/me | 当前用户 | 用户 |
| PATCH | /api/auth/profile | 修改昵称/头像 | 用户 |
| POST | /api/auth/change-password | 改密码（token_version+1，返回新 token） | 用户 |
| GET | /api/auth/logins | 最近 20 条登录历史 | 用户 |
| POST | /api/auth/logout-all | 退出所有设备（返回新 token） | 用户 |
| DELETE | /api/auth/account | 注销账号（密码确认，级联删除） | 用户 |
| GET | /api/auth/usage | 近 6 个月用量 + 本月配额 + 成员用量 | 用户 |
| POST | /api/auth/forgot · /reset | 忘记密码验证码(Fernet加密) / 重置 | — |
| GET | /api/me/permissions | 当前用户 RBAC 权限列表 | 用户 |
| GET | /api/research/quota | 本月配额（企业口径优先，plan 为生效套餐） | 用户 |
| POST | /api/research | 创建任务（双重配额校验），后台启动 Agent | 用户 |
| GET | /api/research · /{id} | 任务列表 / 详情（企业内共享；sources 不含 raw_content） | 用户 |
| GET | /api/research/{id}/sources/{sid} | 来源详情（含 raw_content + access_status，属主校验） | 用户 |
| GET | /api/research/{id}/events?token= | SSE 实时进度（step/status 事件） | 用户 |
| POST | /api/research/{id}/ask | 单报告追问（不占配额，附来源材料） | 用户 |
| POST | /api/research/{id}/email | 报告邮件分享（附件由前端导出上传） | 用户 |
| DELETE | /api/research/{id} | 删除任务（级联删 steps/sources） | 用户 |
| GET/POST | /api/competitors | 列出竞品（本企业+系统级）/ 创建 | 用户 |
| PATCH/DELETE | /api/competitors/{id} | 修改/删除竞品 | 用户/管理员 |
| POST | /api/crawl/{cid}/crawl | 爬取竞品官网信息 | 用户 |
| POST/GET | /api/trackers | 创建追踪项（TRACKER_LIMITS 校验）/ 列表 | 用户 |
| GET/PATCH/DELETE | /api/trackers/{id} | 详情 / 修改 / 删除 | 用户 |
| POST | /api/trackers/{id}/run-now | 立即运行一期（记触发人配额） | 用户 |
| GET | /api/trackers/{id}/runs | 期次任务列表 | 用户 |
| POST / GET | /api/graph | 创建图谱（**校验并计入配额**）/ 列表 | 用户 |
| GET / DELETE | /api/graph/{id} | 详情（实体+关系+report_markdown）/ 删除 | 用户 |
| POST | /api/graph/{id}/refresh | 重建（**计入配额**） | 用户 |
| GET/POST/PATCH/DELETE | /api/profiles/templates | 画像模板 CRUD + 冻结 | 用户/管理员 |
| POST | /api/profiles/generate | 生成竞品画像 | 用户 |
| GET | /api/profiles | 列出画像 | 用户 |
| POST | /api/profiles/{id}/freeze | 冻结画像 | 管理员 |
| POST | /api/profiles/compare | 横向对比（≥2 份冻结画像） | 用户 |
| POST | /api/org · /join · /leave | 创建企业 / 邀请码加入 / 退出（owner 仅剩自己时退出即解散） | 用户 |
| GET | /api/org/me · /members | 我的企业 / 成员列表（含各自 month_used + permissions） | 用户 |
| PATCH | /api/org | 改企业名 | org owner/admin |
| POST | /api/org/invite-code/reset | 重置邀请码 | org owner/admin |
| POST | /api/org/members/{id}/permissions | 设置成员 RBAC 权限 | org owner/admin |
| PATCH / DELETE | /api/org/members/{id} | 改角色(admin|member)/月额度 / 移出（不能动 owner/自己） | org owner/admin |
| GET | /api/notifications · /unread-count | 通知列表 / 未读数 | 用户 |
| POST | /api/notifications/read | 标记已读 | 用户 |
| GET | /api/assistant/sessions | 会话列表（懒迁移旧消息） | 用户 |
| PATCH / DELETE | /api/assistant/sessions/{id} | 重命名 / 删除会话（含消息） | 用户 |
| GET / DELETE | /api/assistant/sessions/{id}/messages | 某会话消息（最近 100 升序）/ 清空 | 用户 |
| POST | /api/assistant/ask | 全局助手提问（多会话，不占配额） | 用户 |
| GET | /api/billing/plans · /orders | 套餐/订单 | —/用户 |
| POST | /api/billing/upgrade | 模拟支付升级（个人或企业口径） | 用户 |
| GET | /api/admin/stats | 运营统计 | 系统 admin |
| GET/PATCH | /api/admin/users?q= | 用户列表(分页) / 改套餐/角色 | 系统 admin |
| GET/PATCH | /api/admin/orgs?q= | 企业列表(分页) / 改套餐 | 系统 admin |
| GET | /api/admin/audit-logs | 审计日志(分页 + 筛选) | 系统 admin |
| GET | /api/admin/execution-snapshots | 执行快照列表 | 系统 admin |

属主规则：普通用户只能访问本人或本企业资源，系统 admin 可访问全部任务。

## 23. 当前状态

全部完成并验证（agent-v5 分支，核心功能完整）：

- 商业化账号体系、会员/支付/管理后台（含企业管理 + 审计日志 + 执行快照）
- Agent 全流程（规划→检索→去重/置信度/冲突检测→快照存档→分析→洞察→时间线→报告）
- 任务详情三 Tab、报告导出（PDF/Word/MD）
- 时效引擎、定时追踪 + 调度器 + 变更摘要推送（站内/邮件/Webhook）
- 关系图谱（含分析报告生成）
- 竞品管理（结构化 CRUD + 企业/系统级隔离 + 官网爬虫 + 多语言站点修复）
- 爬虫多语言/consent overlay 修复（v5.0.1）：语言前缀自动检测、Sitemap 语言过滤、隐私弹层 DOM 移除
- 竞品画像系统（模板管理 → 生成 → 冻结 → 横向对比）
- 报告问答、全局 AI 助手（多会话 + 两阶段回答 + 引用链接）
- 企业组织（邀请码/角色/成员额度/RBAC 权限/共享可见性）
- 站内通知铃铛 + 额度预警（80% 阈值）
- 安全增强：Refresh Token、限流、Fernet 加密、审计埋点、执行快照
- 来源去重/置信度/冲突检测、页面快照存档
- 代码托管：`https://github.com/JimmyZhang06/competitive-intel-agent.git` 分支 **agent-v5**

## 24. 踩坑备忘

### 24.0 爬虫多语言站点处理（crawler.py）

- 竞品官网 URL 可能含语言前缀（如 `/cn/`, `/en/`, `/ja/`），爬虫启动时从 URL 自动提取
- Sitemap 通常包含所有语言版本的 URL，必须按语言前缀过滤
- 启发式路径（/pricing 等）需带上语言前缀访问，否则 404
- 隐私 consent overlay（OneTrust/GDPR/CCPA）会干扰 readability 正文提取，需先移除相关 DOM
- readability 提取结果做质量检测：如果少于 3000 字符且匹配 consent 标记，回退到完整 body 文本
- 当前 User-Agent 为 Chrome 浏览器 UA，减少被 WAF/Bot 拦截

### 24.1 报告导出（utils/exportReport.tsx）★★★

- **html2pdf 三大坑**：
  1. 偏移样式（`fixed;left:-10000px`）只能放**外层 wrapper**——html2pdf 连内联样式克隆目标元素，目标自带偏移会导致 PDF 全白（文件仅十几 KB）；`from(content)` 传干净的内层
  2. content 宽度必须 = **A4 内容区宽** (210-12-12)mm ≈ **703px**，按整页 794px 设置会右侧截断 91px（表格缺列）
  3. html2canvas 克隆整个 document 会重载页面上其他外部图片，需 `imageTimeout:1500` + `ignoreElements` 排除 wrapper 外的 IMG
- **Word (.doc = HTML) 要点**：
  1. 必须 mso 声明 `<w:View>Print</w:View>` + `@page Section1`（A4 尺寸/页边距）+ `div.Section1` 包裹，否则 Word 以 Web 版式打开
  2. Word 不支持 `display:none`——封面外重复的 h1 要用正则从 HTML 直接移除
  3. **Word 的 HTML 引擎对 CSS `page-break-*` 支持不可靠**：分页规则只给 PDF 用（`PDF_PAGEBREAK_CSS`）；Word 换页用手动分页符 `<br clear="all" style="mso-special-character:line-break;page-break-before:always">`
- Vite 下改 `utils/*.ts(x)` 非组件模块 **HMR 不会热替换**，浏览器必须整页刷新后再验证导出

### 24.2 通用

- 改 `.env` → **必须重启后端**（lru_cache）；后端通常无 `--reload`，改代码也要手动重启
- SQLite 加列 → 在 `migrate_columns()` 补 DDL；加表 → create_all 自动处理
- PowerShell：内联 `python -c` / 复杂引号易碎，写临时 .ps1/.py 执行；命令分隔用 `;`；pip 用 `python -m pip`
- 报告引用编号 = 来源入库顺序 = 详情接口 sources 数组顺序，三者严禁错位（前端筛选/排序保留原始 index）
- SSE 的 EventSource 不支持自定义 Header，鉴权走 `?token=` 查询参数（仅接受 type=access 的 token）
- **时区约定**：后端一律 UTC 且序列化不带 Z 后缀，前端解析必须走 `utils/time.ts::parseUtc`（补 Z）；直接 `new Date(str)` 会被按本地时区误读
- 调度器与配额都依赖 UTC 自然月口径（`month_start_utc`），排查配额问题先确认时间维度
- Pydantic：ORM 字段存 JSON 字符串（如 assistant_messages.refs）时不要 `model_validate(orm_obj)` 直转含 list 的 schema，会类型冲突——手动 json.loads 构造
- 8000 端口可能被其他项目占用（curl `openapi.json` 看 title 判断），启动前先确认
- 去重/置信度/冲突检测在检索完成后、入库前批量执行，`_save_sources` 已改为 async 以支持快照存档的异步 I/O
- 前端 401 自动 Refresh Token 重试：刷新失败后跳登录页并清除 token；刷新期间并发请求只发一次 refresh（`refreshPromise` 锁）
- LLM 调用审计在 `_log_llm_audit` 中异步执行，失败不阻断主流程；记录 model_name / prompt_tokens / completion_tokens
- 密码重置验证码 Fernet 加密后存入 `users.reset_code`，验证时解密比较；10 分钟有效期
- 调度器 `_snapshot_execution` 记录 git HEAD 作为 build_hash，git 不可用时留空
- `MASTER_KEY` 生产环境必须配置（Fernet 加密密钥），缺失时后端启动报 RuntimeError
