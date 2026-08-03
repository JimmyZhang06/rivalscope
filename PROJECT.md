# Comp-Agent 项目说明

> **版本**: v7.0.0 | **更新**: 2026-08-03 | **分支**: agent-v7
> 本作品采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 协议授权

---

## 目录

- [项目简介](#1-项目简介)
- [核心功能](#2-核心功能)
- [系统架构](#3-系统架构)
- [Agent 流水线](#4-agent-流水线)
- [技术栈](#5-技术栈)
- [项目结构](#6-项目结构)
- [快速上手](#7-快速上手)
- [API 概览](#8-api-概览)
- [会员套餐与配额](#9-会员套餐与配额)
- [设计原则](#10-设计原则)
- [LLM 供应商适配](#11-llm-供应商适配)
- [部署说明](#12-部署说明)
- [文档索引](#13-文档索引)

---

## 1. 项目简介

**Comp-Agent**（Competitive Research Agent）是一个面向 SaaS 场景的竞品情报平台。用户输入产品或公司名称后，系统自动完成：联网检索 → 多维度对比分析 → 数据洞察 → 事件时间线 → Markdown 报告生成，全程通过 SSE 实时推送执行进度。

在核心调研能力之上，平台还集成了定时追踪、产业链关系图谱、竞品画像、报告问答与全局 AI 助手、企业组织与商业化账号体系，可直接作为独立产品交付。

**典型使用场景**：

- 产品经理定期追踪竞品功能变化
- 投资人了解目标公司竞品格局
- 市场团队监测行业动态与竞品定价
- 企业内多人协作管理竞品情报

---

## 2. 核心功能

### 2.1 竞品调研（核心流水线）

输入竞品名称与调研重点，Agent 自动完成全流程调研：

1. **规划阶段** — 基于竞品清单和套餐配额，LLM 产出检索关键词（每组带维度标签）
2. **检索阶段** — 并发调用 Tavily 联网搜索，自动带时效约束，支持指定时间范围
3. **去重与置信度** — URL 去重 + 标题相似度去重，来源分级（official / media / community / other），置信度评分
4. **快照存档** — 异步抓取页面 HTML + 纯文本存档，记录访问状态
5. **分析阶段** — 按维度分组呈现给 LLM，每条论断附带引用角标 `[n]`
6. **洞察生成** — 五维评分、SWOT 分析、一句话定位、总体结论
7. **时间线** — 自动提取关键事件，最多 12 条
8. **报告生成** — Markdown 报告含可信度说明，支持导出 PDF / Word / Markdown

### 2.2 时效引擎

- 所有 LLM 提示词注入当前日期
- 检索词自带时效约束（年份、"最新"等关键词）
- 来源发布时间解析、距今天数计算
- 报告自动统计来源新鲜度分布

### 2.3 定时追踪

- 按日 / 周 / 月频率自动执行调研
- 期次间自动生成"变更摘要"（与上一期对比）
- 支持站内通知、邮件、Webhook（企业微信 / 钉钉 / 飞书 / 通用）推送
- 内置调度器每 60 秒扫描到期追踪项

### 2.4 关系图谱

- 以任意企业 / 产品为根对象，联网抽取产业链关系网络
- 关系类型：上下游、竞争、合作、投资、母子公司
- 可视化画布展示，支持一键重建
- 图谱构建计入调研配额

### 2.5 竞品画像

- 结构化画像模板（维度可自定义）
- 基于已有来源自动生成竞品画像
- 管理员可冻结锁定画像
- 多份画像横向对比矩阵
- 画像详情含报告、洞察、来源、维度四个 Tab
- 预生成报告 + 洞察缓存，避免前端懒加载失败

### 2.6 报告问答与全局 AI 助手

- **单报告问答**：针对单份调研报告进行追问（不占配额）
- **全局 AI 助手**：任意页面通过右下角悬浮球或独立页面向 AI 提问
- 助手自动定位最相关的报告作为上下文，回答附引用链接
- 多会话管理，历史记录服务端共享

### 2.7 企业组织

- 邀请码加入 / 创建企业
- 三级角色：owner / admin / member
- 企业套餐共享配额，全员共享合并额度
- 管理员可设置成员月额度（第二重限制）
- RBAC 细粒度权限控制
- 任务 / 追踪 / 图谱企业内共享可见

### 2.8 安全管理

- JWT + Refresh Token（Access 8h / Refresh 30d）
- 会话版本控制（改密码后旧 token 全部失效）
- 令牌桶限流（IP 级 + 用户级双重）
- Fernet 对称加密（敏感字段存储）
- 审计日志（数据库级触发器防篡改）
- 执行快照（Agent 流水线各阶段快照）

### 2.9 商业化账号体系

- 邮箱注册登录
- 三级会员套餐（免费 / 专业 / 企业）
- 模拟支付升级
- 订单记录
- 站内通知
- 管理员后台（用户 + 企业管理 + 审计日志 + 执行快照）

### 2.10 爬虫增强

- 多语言网站智能识别（自动检测 `/cn/`、`/en/` 等语言路径前缀）
- Sitemap 多路径发现（`/{lang}/sitemap.xml`）
- 隐私 consent overlay 自动 stripping（OneTrust / CCPA / GDPR）
- Chrome UA 降低被拦截率

---

## 3. 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│  用户入口                                                                  │
│  新建调研 · 定时追踪（自动） · 关系图谱 · 竞品画像 · 报告问答 · AI 助手     │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ REST API
                    ┌──────────▼──────────┐
                    │   FastAPI 后端       │
                    │                     │
                    │  JWT 鉴权            │
                    │  企业 / 个人数据隔离  │
                    │  BackgroundTasks     │
                    │                     │
                    │  ├── Agent 编排      │
                    │  │   planning → search │
                    │  │   → dedup → analyze │
                    │  │   → insights → report│
                    │  │                    │
                    │  ├── 图谱构建        │
                    │  ├── 竞品画像        │
                    │  ├── 变更摘要        │
                    │  ├── AI 助手         │
                    │  ├── 安全层          │
                    │  └── 竞品爬虫        │
                    └──────────┬──────────┘
                               │ SQLite
        ┌──────────────────────▼──────────────────────┐
        │  React 前端                                  │
        │                                              │
        │  执行视图（步骤条 + SSE 时间线）              │
        │  报告 / 洞察 / 来源三 Tab → 导出              │
        │  追踪项列表 · 关系图谱画布                    │
        │  竞品管理 · 画像模板 / 画像 / 对比            │
        │  AI 助手（多会话侧栏 + 对话面板）            │
        │  通知铃铛 · 个人中心 · 管理后台               │
        └──────────────────────────────────────────────┘
```

### 数据流

1. 用户通过前端发起调研请求
2. FastAPI 后端鉴权 + 配额校验
3. Agent 流水线异步执行（规划 → 检索 → 分析 → 报告）
4. 通过 SSE 实时推送各阶段进度到前端
5. 前端以执行视图（阶段步骤条 + 时间线）展示
6. 结果存入数据库，支持后续查询、追问、导出

---

## 4. Agent 流水线

调研 Agent 执行以下阶段，每个阶段对应一个 `status` 值：

| 阶段 | Status | 职责 |
|------|--------|------|
| **规划** | `planning` | LLM 产出竞品清单 + 按套餐上限的检索关键词，每组带维度标签；时效性检索词自动带年份 |
| **检索** | `searching` | 并发调用 Tavily（每组最多 5 条），URL 去重，启发式来源分级 + 发布时间解析 |
| **去重 / 置信度** | （检索内） | URL 去重 + 标题相似度去重（阈值 0.85）→ 置信度估算 → 冲突检测 |
| **快照存档** | （检索内） | 异步抓取页面存档（HTML + 纯文本 + 采集元数据） |
| **分析** | `analyzing` | 材料按维度分组呈现给 LLM，prompt 强制每条论断携带 `[n]` 引用 |
| **洞察** | （分析内） | 产出结构化 JSON：五维评分、SWOT、定位；**失败不阻断主流程** |
| **时间线** | （分析内） | 产出结构化 JSON 事件时间线；**失败不阻断主流程** |
| **报告** | `reporting` | 生成 Markdown 报告，注入可信度说明 |

**追踪任务**在以上基础上额外执行：与上一期对比生成变更摘要，并按配置推送通知。

---

## 5. 技术栈

| 层 | 技术选型 |
|----|---------|
| **后端框架** | Python 3.12 · FastAPI · SQLAlchemy 2.0 · Pydantic v2 |
| **数据库** | SQLite（MVP），可迁移 PostgreSQL |
| **LLM 接口** | OpenAI 兼容协议，支持 DeepSeek / 通义千问 / Kimi / StepFun / OpenAI 等 |
| **联网检索** | Tavily API |
| **认证安全** | JWT + Refresh Token · bcrypt · Fernet 加密 · 令牌桶限流 |
| **调度** | 后端内置线程调度器（60 秒轮询，无外部依赖） |
| **前端框架** | React 18 · TypeScript · Vite 5 |
| **UI 样式** | Tailwind CSS 4 |
| **路由** | react-router-dom 6 |
| **图表** | recharts · ReactFlow |
| **报告渲染** | react-markdown + remark-gfm |
| **报告导出** | html2pdf.js（PDF）· 浏览器打印（Word） |
| **SSE** | Server-Sent Events 实时推送 |

---

## 6. 项目结构

```
comp-agent/
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI 入口
│   │   │                             # （CORS、路由注册、建表、播种管理员、启动调度器）
│   │   ├── core/
│   │   │   ├── config.py             # 环境变量配置（pydantic-settings）
│   │   │   ├── plans.py              # 套餐权益唯一权威定义
│   │   │   ├── security.py           # bcrypt + JWT（含会话版本控制）
│   │   │   ├── crypto.py             # Fernet 对称加密
│   │   │   ├── rate_limit.py         # IP 级令牌桶限流
│   │   │   ├── rate_limit_user.py    # 用户级令牌桶限流
│   │   │   ├── model_pricing.py      # LLM 模型定价表（成本统计）
│   │   │   └── timeutil.py           # 时效引擎工具函数
│   │   ├── db/
│   │   │   ├── database.py           # SQLAlchemy 引擎 + 会话工厂
│   │   │   ├── models.py             # 数据库 ORM 模型（23 张表）
│   │   │   └── audit_triggers.py     # 审计日志数据库级触发器
│   │   ├── schemas/                  # Pydantic 请求 / 响应模型
│   │   │   ├── auth.py
│   │   │   ├── research.py
│   │   │   ├── org.py
│   │   │   ├── tracker.py
│   │   │   ├── graph.py
│   │   │   ├── competitor.py
│   │   │   └── profiles.py
│   │   ├── api/                      # REST 端点
│   │   │   ├── deps.py               # 认证依赖 + 配额计算 + RBAC
│   │   │   ├── auth.py               # 注册 / 登录 / 改密 / 注销 / 用量
│   │   │   ├── research.py           # 调研任务 + SSE + 问答 + 邮件
│   │   │   ├── trackers.py           # 定时追踪 CRUD + 立即执行
│   │   │   ├── graph.py              # 关系图谱 CRUD + 重建
│   │   │   ├── org.py                # 企业组织管理
│   │   │   ├── competitors.py        # 竞品管理 + 爬虫触发
│   │   │   ├── profiles.py           # 画像模板 / 生成 / 冻结 / 对比
│   │   │   ├── crawl.py              # 竞品官网爬虫
│   │   │   ├── permissions.py        # RBAC 权限查询
│   │   │   ├── notifications.py      # 站内通知
│   │   │   ├── assistant.py          # 全局 AI 助手（多会话）
│   │   │   ├── billing.py            # 套餐 + 模拟支付
│   │   │   └── admin.py              # 管理后台
│   │   └── services/                 # 业务逻辑层
│   │       ├── llm.py                # LLM 客户端（统一入口）
│   │       ├── agent.py              # 调研 Agent 编排（核心）
│   │       ├── graph_agent.py        # 图谱构建 Agent
│   │       ├── search.py             # Tavily 检索客户端
│   │       ├── dedup.py              # 来源去重 + 置信度
│   │       ├── snapshot.py           # 页面快照抓取
│   │       ├── digest.py             # 变更摘要生成
│   │       ├── notify.py             # 通知分发（站内 / 邮件 / Webhook）
│   │       ├── scheduler.py          # 追踪调度器
│   │       ├── audit.py              # 审计日志
│   │       ├── profiles.py           # 竞品画像生成 + 冻结
│   │       ├── profile_extractor.py  # 竞品画像信息提取（含启动恢复）
│   │       ├── profile_report.py     # 画像报告 / 洞察预生成
│   │       ├── comparison.py         # 多份画像横向对比
│   │       └── crawler.py            # 竞品官网爬虫核心逻辑
│   ├── scripts/
│   │   └── seed_data.py              # 测试数据播种脚本
│   ├── requirements.txt
│   ├── .env.example
│   ├── start.bat                     # Windows 一键启动
│   └── start.ps1                     # PowerShell 一键启动
│
└── frontend/
    └── src/
        ├── api/                      # API 客户端 + 类型定义
        │   ├── client.ts             # HTTP 客户端（Bearer 注入、401 刷新重试）
        │   └── types.ts              # TypeScript 类型
        ├── auth/
        │   └── AuthContext.tsx        # 认证状态管理
        ├── hooks/
        │   ├── useErrorHandler.ts
        │   └── usePageTitle.ts
        ├── layouts/
        │   └── AppLayout.tsx          # 工作台布局（侧边栏 + 通知 + AI 悬浮球）
        ├── pages/
        │   ├── LandingPage.tsx        # 营销首页
        │   ├── LoginPage.tsx
        │   ├── RegisterPage.tsx
        │   ├── ForgotPasswordPage.tsx
        │   └── app/                   # 应用内页面
        │       ├── DashboardPage.tsx        # 仪表盘
        │       ├── NewResearchPage.tsx      # 新建调研
        │       ├── TaskDetailPage.tsx       # 调研详情（执行视图 + 报告）
        │       ├── TasksPage.tsx            # 调研列表
        │       ├── TrackersPage.tsx         # 追踪列表
        │       ├── TrackerDetailPage.tsx    # 追踪详情
        │       ├── GraphPage.tsx            # 图谱列表
        │       ├── GraphDetailPage.tsx      # 图谱详情
        │       ├── CompetitorsPage.tsx      # 竞品管理
        │       ├── ProfileTemplatesPage.tsx # 画像模板
        │       ├── ProfileTasksPage.tsx     # 画像生成任务
        │       ├── ProfilesPage.tsx         # 竞品画像列表
        │       ├── ProfileDetailPage.tsx    # 画像详情
        │       ├── ComparisonPage.tsx       # 画像横向对比
        │       ├── AssistantPage.tsx        # AI 助手
        │       ├── AuditLogsPage.tsx        # 审计日志
        │       ├── PricingPage.tsx          # 套餐升级
        │       ├── AccountPage.tsx          # 个人中心
        │       └── AdminPage.tsx            # 管理后台
        ├── components/                # 可复用组件（32 个）
        │   ├── PhaseStepper.tsx       # 阶段步骤条
        │   ├── StepTimeline.tsx       # SSE 实时时间线
        │   ├── ReportView.tsx         # 报告渲染
        │   ├── SourceCard.tsx         # 来源卡片
        │   ├── SourceDrawer.tsx       # 来源详情抽屉
        │   ├── ScoreRadar.tsx         # 雷达图
        │   ├── ScoreBars.tsx          # 条形评分图
        │   ├── ScoreTrend.tsx         # 评分趋势图
        │   ├── SwotGrid.tsx           # SWOT 四象限
        │   ├── ChartCard.tsx          # 图表卡片容器
        │   ├── TrackerForm.tsx        # 追踪项表单
        │   ├── AssistantChat.tsx      # AI 助手对话面板
        │   ├── AssistantWidget.tsx    # AI 助手悬浮球
        │   ├── NotificationBell.tsx   # 通知铃铛
        │   ├── OrgPanel.tsx           # 企业面板
        │   ├── QuotaErrorBanner.tsx   # 配额错误横幅
        │   ├── ConfirmDialog.tsx      # 确认对话框
        │   ├── Skeleton.tsx           # 骨架屏
        │   └── ...                    # 更多组件
        ├── App.tsx                    # 根组件 + 路由配置
        ├── main.tsx                   # 入口文件
        └── index.css                  # 全局样式（Tailwind）
```

---

## 7. 快速上手

### 环境要求

- **Python 3.12+**
- **Node.js 18+**
- **LLM API Key**（任意 OpenAI 兼容服务）
- **Tavily API Key**（[tavily.com](https://tavily.com) 注册，免费 1000 次/月）

### 步骤一：克隆与配置

```bash
# 克隆仓库
git clone <repo-url>
cd comp-agent

# 后端环境变量
cd backend
cp .env.example .env
# 编辑 .env，填入 LLM / Tavily / JWT / SMTP 配置
```

### 步骤二：启动后端

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

首次启动自动完成：
- 创建 23 张数据库表
- 播种默认管理员账号
- 启动追踪调度器线程

API 文档：`http://localhost:8000/docs`

### 步骤三：启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，Vite 自动代理 `/api` 到后端。

### 默认账号（仅开发环境）

| 项目 | 值 |
|------|-----|
| 邮箱 | `admin@example.com` |
| 密码 | `Admin123456` |

> 生产部署前务必修改默认密码、`JWT_SECRET` 和 `MASTER_KEY`。

---

## 8. API 概览

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录（返回 JWT + Refresh Token） |
| POST | `/api/auth/refresh` | Refresh Token 换新 |
| GET | `/api/auth/me` | 当前用户信息 |
| PATCH | `/api/auth/profile` | 修改昵称 / 头像 |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/auth/logins` | 最近登录历史 |
| POST | `/api/auth/logout-all` | 退出所有设备 |
| DELETE | `/api/auth/account` | 注销账号 |
| POST | `/api/auth/forgot` | 忘记密码（获取验证码） |
| POST | `/api/auth/reset` | 重置密码 |

### 调研

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/research/quota` | 本月配额与用量 |
| POST | `/api/research` | 创建调研任务 |
| GET | `/api/research` | 任务列表（分页） |
| GET | `/api/research/{id}` | 任务详情 |
| GET | `/api/research/{id}/events` | SSE 实时进度 |
| POST | `/api/research/{id}/ask` | 针对报告追问 |
| POST | `/api/research/{id}/email` | 邮件分享报告 |
| DELETE | `/api/research/{id}` | 删除任务 |

### 追踪

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/trackers` | 创建追踪项（套餐限数） |
| GET | `/api/trackers` | 追踪列表（分页） |
| GET | `/api/trackers/{id}` | 追踪详情 |
| PATCH | `/api/trackers/{id}` | 修改追踪项 |
| DELETE | `/api/trackers/{id}` | 删除追踪项 |
| POST | `/api/trackers/{id}/run-now` | 立即运行一期 |
| GET | `/api/trackers/{id}/runs` | 期次任务列表 |

### 图谱

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/graph` | 创建图谱（占配额） |
| GET | `/api/graph` | 图谱列表 |
| GET | `/api/graph/{id}` | 图谱详情 |
| DELETE | `/api/graph/{id}` | 删除图谱 |
| POST | `/api/graph/{id}/refresh` | 重建图谱（占配额） |

### 竞品与画像

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/competitors` | 竞品列表 / 创建 |
| PATCH/DELETE | `/api/competitors/{id}` | 修改 / 删除竞品 |
| POST | `/api/crawl/{cid}/crawl` | 爬取竞品官网 |
| GET/POST/PATCH/DELETE | `/api/profiles/templates` | 画像模板 CRUD + 冻结 |
| POST | `/api/profiles/generate` | 生成竞品画像 |
| GET | `/api/profiles` | 画像列表 |
| POST | `/api/profiles/{id}/freeze` | 冻结画像 |
| POST | `/api/profiles/compare` | 横向对比 |
| GET | `/api/profiles/{id}/report` | 画像报告 |
| GET | `/api/profiles/{id}/insights` | 画像洞察 |

### 企业组织

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/org` | 创建企业 |
| POST | `/api/org/join` | 邀请码加入 |
| POST | `/api/org/leave` | 退出企业 |
| GET | `/api/org/me` | 我的企业信息 |
| GET | `/api/org/members` | 成员列表 |
| PATCH | `/api/org` | 修改企业名 |
| POST | `/api/org/invite-code/reset` | 重置邀请码 |
| POST | `/api/org/members/{id}/permissions` | 设置 RBAC 权限 |
| PATCH / DELETE | `/api/org/members/{id}` | 改角色 / 移出成员 |

### AI 助手

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/assistant/sessions` | 会话列表 |
| PATCH / DELETE | `/api/assistant/sessions/{id}` | 重命名 / 删除会话 |
| GET / DELETE | `/api/assistant/sessions/{id}/messages` | 消息列表 / 清空 |
| POST | `/api/assistant/ask` | 全局问答（不占配额） |

### 管理后台

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 运营统计 |
| GET | `/api/admin/users?q=` | 用户搜索（分页） |
| PATCH | `/api/admin/users/{id}` | 调整用户套餐 / 角色 |
| GET | `/api/admin/orgs?q=` | 企业列表（分页） |
| PATCH | `/api/admin/orgs/{id}` | 调整企业套餐 |
| GET | `/api/admin/audit-logs` | 审计日志（筛选 + 分页） |
| GET | `/api/admin/execution-snapshots` | 执行快照列表 |

---

## 9. 会员套餐与配额

| 套餐 | 月费 | 月度调研次数 | 关键词组/次 | 追踪项上限 | 优先队列 |
|------|------|------------|------------|-----------|---------|
| 免费版 | ¥0 | 3 | 4 | 1 | — |
| 专业版 | ¥99/月 | 30 | 8 | 5 | 支持 |
| 企业版 | ¥399/月 | 不限 | 12 | 20 | 支持 |

### 配额规则

- **统计口径**：UTC 自然月；用量 = 调研任务数 + 图谱构建数（各计 1 次）；**失败任务不计入**
- **个人用户**：按个人有效套餐计
- **企业用户**：按企业套餐计，全员共享合并额度；管理员可额外设置成员月额度
- **系统管理员**：视同企业版，配额豁免
- **不占配额**：报告问答、全局 AI 助手、竞品画像
- **额度预警**：达 80% 时自动推送站内预警（月内不重复）
- **额度用尽**：创建入口返回 403；前端预检禁用 / 红条提示；定时追踪自动跳过本期并通知
- **升级方式**：模拟支付，支付即生效 30 天，同套餐续费自动顺延，过期自动回落免费版

---

## 10. 设计原则

| 编号 | 原则 | 说明 |
|------|------|------|
| **P-01** | 全链路引用溯源 | 每条论断携带 `[n]` 引用角标，可点击回溯到来源卡片与原文摘录 |
| **P-02** | 信息不足明示 | 检索未覆盖的内容标注"信息不足"，不允许 LLM 编造 |
| **P-03** | 来源分级可信 | 来源分 official / media / community / other，附相关度、发布时间、置信度 |
| **P-04** | 渐进式降级 | 洞察 / 变更摘要生成失败不阻断主流程 |
| **P-05** | 商业化内建 | 检索规模、月度次数、追踪项数量均由套餐决定 |
| **P-06** | 时间意识 | 所有 LLM 调用注入当前日期，优先采信近期信息 |
| **P-07** | 可审计可追溯 | 关键操作写入审计日志，LLM 调用记录 token 消耗与费用 |

---

## 11. LLM 供应商适配

项目从设计上基于 OpenAI 兼容接口，切换 LLM 供应商仅需修改环境变量，无需改动任何业务代码。

**当前支持的供应商**：

| 供应商 | Base URL 示例 | 推荐模型 |
|--------|-------------|---------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| StepFun | `https://api.stepfun.com/step_plan/v1` | `step-3.7-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |

**切换方式**（以 StepFun 为例）：

1. 修改 `backend/.env` 中的三个值：
   ```
   LLM_BASE_URL=https://api.stepfun.com/step_plan/v1
   LLM_API_KEY=your-stepfun-key
   LLM_MODEL=step-3.7-flash
   ```
2. 在 `backend/app/core/model_pricing.py` 中添加模型定价
3. 重启服务

> 详见 [STEPFUN_MIGRATION.md](STEPFUN_MIGRATION.md)

---

## 12. 部署说明

### 生产环境检查清单

- [ ] 修改 `JWT_SECRET` 为高强度随机字符串
- [ ] 配置 `MASTER_KEY`（Fernet 加密密钥，32 字节 base64）
- [ ] 修改默认管理员密码
- [ ] 配置 `SMTP` 相关环境变量（用于邮件推送）
- [ ] 修改 `frontend_base` 为实际域名
- [ ] 配置 `frontend_origins` CORS 白名单
- [ ] 数据库从 SQLite 迁移到 PostgreSQL（可选，适用于高并发场景）

### Docker 部署（建议）

```bash
# 构建镜像
docker build -t comp-agent-backend ./backend
docker build -t comp-agent-frontend ./frontend

# 启动
docker-compose up -d
```

### 性能提示

- SQLite 配合 WAL 模式已足够支撑中小规模使用
- 如需更高并发，将 `database_url` 切换为 PostgreSQL 连接串即可
- Agent 流水线耗时主要取决于 LLM API 响应时间，建议使用高速模型（如 `gpt-4o-mini` 用于规划）

---

## 13. 文档索引

| 文档 | 说明 |
|------|------|
| [README.md](README.md) | 本文档 — 项目总览 |
| [HANDOFF.md](HANDOFF.md) | 完整技术交接文档（权限矩阵、配额规则、数据模型、踩坑备忘） |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [STEPFUN_MIGRATION.md](STEPFUN_MIGRATION.md) | StepFun 供应商迁移指南 |
| [FIX_PLAN.md](FIX_PLAN.md) | 已知问题修复计划 |
| [PERFORMANCE_OPTIMIZATION_PLAN.md](PERFORMANCE_OPTIMIZATION_PLAN.md) | 性能优化计划 |
| [OPTIMIZATION_TODO.md](OPTIMIZATION_TODO.md) | 优化待办事项 |
| [docs/01-project-overview.md](docs/01-project-overview.md) | 项目概述 |
| [docs/02-architecture.md](docs/02-architecture.md) | 系统架构详解 |
| [docs/03-database.md](docs/03-database.md) | 数据库设计 |
| [docs/04-api-reference.md](docs/04-api-reference.md) | API 参考 |
| [docs/05-backend-services.md](docs/05-backend-services.md) | 后端服务详解 |
| [docs/06-frontend.md](docs/06-frontend.md) | 前端说明 |

---

*本文档对应项目版本 v6.0.0，最后更新于 2026-08-03。*
