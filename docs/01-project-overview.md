# 01. 项目概览

> **竞品调研 Agent** / Competitive Research Agent
> 版本：v6.0.0 | 日期：2026-08-03 | 分支：agent-v6

## 1.1 定位

一个可商用交付的 **SaaS 化竞品情报平台**。围绕"竞品调研 Agent"核心流水线，扩展出定时追踪、产业链关系图谱、竞品画像、报告问答与全局 AI 助手等能力。

## 1.2 核心功能模块

| 模块 | 说明 | 入口页面 |
|------|------|----------|
| **竞品调研** | 输入产品名称（可选竞品/调研重点/检索时效），Agent 自动完成：规划关键词 → 联网检索 → 去重/置信度/冲突检测 → 快照存档 → 对比分析 → 数据洞察 → 事件时间线 → Markdown 报告，支持导出 PDF / Word / Markdown | `/app/new` → 调研记录 |
| **定时追踪** | 按日/周/月频率自动执行调研，期次间自动生成"变更摘要"，支持站内通知、邮件与 Webhook（企业微信/钉钉/飞书/通用）推送 | `/app/trackers` |
| **关系图谱** | 以任意企业/产品为根对象，联网抽取产业链关系网络（上下游/竞争/合作/投资/母子公司），可视化画布展示 | `/app/graph` |
| **竞品管理** | 结构化注册竞品信息（名称/别名/官网/技术主题/关键词），企业级隔离，支持官网爬虫 | `/app/competitors` |
| **竞品画像** | 结构化画像模板 → 基于已有来源生成竞品画像 → 冻结锁定 → 多份画像横向对比 | `/app/profiles` |
| **AI 问答** | 单报告追问 + 全局 AI 助手（悬浮球/独立页），自动定位最相关的报告作为上下文并附引用链接，不占调研额度 | `/app/assistant` |
| **企业组织** | 邀请码加入、owner/admin/member 三级企业角色、企业套餐共享配额、成员月额度管控、RBAC 细粒度权限、任务/追踪/图谱企业内共享可见 | `/app/account?tab=org` |
| **管理后台** | 运营统计 + 用户管理 + 企业管理 + 审计日志 + 执行快照 | `/app/admin` |
| **安全增强** | JWT + Refresh Token（Access 8h / Refresh 30d）、会话版本控制、令牌桶限流（按 IP+端点）、Fernet 加密、审计日志、执行快照 | 全局 |

## 1.3 设计原则

| 编号 | 原则 | 含义 |
|------|------|------|
| P-01 | 全链路引用溯源 | 报告中每条论断携带 `[n]` 角标，可点击回溯到来源卡片与原文摘录 |
| P-02 | 信息不足明示 | 检索材料未覆盖的内容明确标注"信息不足"，不允许 LLM 编造 |
| P-03 | 来源分级可信 | 每条来源按 official / media / community / other 分级，附相关度评分、发布时间与距今天数、置信度 |
| P-04 | 渐进式降级 | 数据洞察/变更摘要生成失败不阻断报告主流程 |
| P-05 | 商业化内建 | 检索规模、月度次数、追踪项数量均由套餐决定（免费/专业/企业三级，个人与企业双维度） |
| P-06 | 时间意识 | 所有 LLM 调用注入当前日期，优先采信近期信息 |
| P-07 | 可审计可追溯 | 关键操作写入审计日志，LLM 调用记录 token 消耗与费用，调度器生成执行快照 |

## 1.4 技术栈

| 层 | 技术 | 版本 |
|------|------|------|
| 后端框架 | FastAPI | >=0.115.0 |
| ORM | SQLAlchemy 2.0 | >=2.0.35 |
| 数据库 | SQLite | （WAL 模式） |
| 数据校验 | Pydantic + pydantic-settings | >=2.9.0 |
| LLM 客户端 | OpenAI 兼容接口 | openai >=1.55.0 |
| 联网检索 | Tavily API | tavily-python >=0.5.0 |
| 实时推送 | SSE (sse-starlette) | >=2.1.3 |
| 认证 | JWT (PyJWT) + bcrypt | >=2.9.0 / >=4.2.0 |
| 加密 | Fernet (cryptography) | >=42.0.0 |
| 前端框架 | React + TypeScript | 18.x / ~5.6.2 |
| 构建 | Vite | ^5.4.10 |
| 样式 | Tailwind CSS | v4 |
| 路由 | react-router-dom | v6 |
| 图表 | recharts | ^3.10.1 |
| 图谱可视化 | ReactFlow | ^11.11.4 |
| Markdown | react-markdown + remark-gfm | ^9.0.1 |
| PDF 导出 | html2pdf.js | ^0.14.0 |
| 图标 | lucide-react | ^1.28.0 |
| 爬虫 | httpx + BeautifulSoup4 | — |

## 1.5 目录结构

```
comp-agent/
├─ backend/
│  ├─ .env                          # 环境变量（不提交）
│  ├─ research.db                   # SQLite 数据库文件
│  ├─ research.db-shm / .db-wal     # WAL 共享内存与日志
│  ├─ requirements.txt              # Python 依赖
│  ├─ start.bat                     # Windows 一键启动
│  ├─ start.ps1                     # PowerShell 一键启动
│  ├─ _smtp_test.py                 # SMTP 连通性测试工具
│  └─ app/
│     ├─ main.py                    # 应用入口（create_all + migrate + seed_admin + lifespan）
│     ├─ core/
│     │  ├─ config.py               # 配置管理（Settings + get_settings）
│     │  ├─ plans.py                # 套餐权益定义（PLANS / TRACKER_LIMITS / effective_plan）
│     │  ├─ security.py             # 密码哈希 + JWT 签发/校验（Access 8h / Refresh 30d）
│     │  ├─ crypto.py               # Fernet 对称加密
│     │  ├─ rate_limit.py           # 令牌桶限流
│     │  └─ timeutil.py             # 时效性工具（基准时间 / 日期解析 / 衰减权重）
│     ├─ db/
│     │  ├─ database.py             # SQLAlchemy 引擎 + 会话工厂 + WAL 配置
│     │  └─ models.py               # 23 张表的 ORM 模型
│     ├─ schemas/                   # Pydantic 请求/响应模型
│     │  ├─ auth.py                 # 认证/用户/账单/审计 schemas
│     │  ├─ research.py             # 调研任务 schemas
│     │  ├─ tracker.py              # 定时追踪 schemas
│     │  ├─ graph.py                # 关系图谱 schemas
│     │  ├─ org.py                  # 企业组织 schemas
│     │  ├─ competitor.py           # 竞品管理 schemas
│     │  ├─ profiles.py             # 竞品画像 schemas
│     │  └─ crawl.py                # 竞品爬虫 schemas
│     ├─ api/                       # FastAPI 路由
│     │  ├─ deps.py                 # 共享依赖（认证 / 配额 / 权限 / 限流）
│     │  ├─ auth.py                 # 认证相关端点
│     │  ├─ research.py             # 调研任务 CRUD + SSE + 问答 + 邮件
│     │  ├─ trackers.py             # 定时追踪 CRUD + 手动触发
│     │  ├─ graph.py                # 关系图谱 CRUD + 重建
│     │  ├─ org.py                  # 企业组织管理
│     │  ├─ competitors.py          # 竞品管理
│     │  ├─ profiles.py             # 画像模板 + 画像生成 + 对比
│     │  ├─ crawl.py                # 竞品爬虫
│     │  ├─ permissions.py          # RBAC 权限查询
│     │  ├─ billing.py              # 套餐升级 + 订单
│     │  ├─ admin.py                # 管理后台（统计 / 用户 / 企业 / 审计日志 / 执行快照）
│     │  ├─ notifications.py        # 站内通知
│     │  └─ assistant.py            # AI 助手（会话 + 问答）
│     └─ services/                   # 业务逻辑层
│        ├─ agent.py                # ★ 调研 Agent 编排核心
│        ├─ graph_agent.py          # 图谱构建管线
│        ├─ llm.py                  # LLM 客户端封装 + 审计埋点
│        ├─ search.py               # Tavily 搜索客户端
│        ├─ dedup.py                # 来源去重 + 冲突检测 + 置信度
│        ├─ snapshot.py             # 页面快照存档
│        ├─ digest.py               # 期次变更摘要
│        ├─ notify.py               # 通知分发（站内 / 邮件 / Webhook）
│        ├─ scheduler.py            # ★ 定时追踪调度器
│        ├─ audit.py                # 审计日志写入
│        ├─ profiles.py             # 竞品画像生成 + 冻结
│        ├─ profile_extractor.py    # 竞品画像结构化信息提取
│        ├─ comparison.py           # 画像横向对比
│        └─ crawler.py              # 竞品官网爬虫核心逻辑
│
└─ frontend/
   └─ src/
      ├─ App.tsx                    # 路由定义（18 个页面）
      ├─ api/
      │  ├─ client.ts               # 全部 API 调用封装（Bearer 注入、401 Refresh 重试、SSE 订阅）
      │  └─ types.ts                # TypeScript 类型定义
      ├─ auth/
      │  └─ AuthContext.tsx          # 认证上下文 + 路由守卫
      ├─ hooks/
      │  ├─ useErrorHandler.ts       # 错误处理 hook
      │  └─ usePageTitle.ts          # 页面标题 hook
      ├─ layouts/
      │  └─ AppLayout.tsx            # 侧边栏布局 shell
      ├─ utils/
      │  ├─ cn.ts                    # 类名合并 + 输入框样式常量
      │  ├─ time.ts                  # UTC 日期解析
      │  ├─ reportSections.ts        # 报告 Markdown 分割
      │  └─ exportReport.tsx         # 报告导出（PDF/Word/MD）
      ├─ components/                 # 32 个可复用 UI 组件
      └─ pages/                      # 页面组件
         ├─ LandingPage.tsx          # 公开首页
         ├─ LoginPage.tsx            # 登录
         ├─ RegisterPage.tsx         # 注册
         ├─ ForgotPasswordPage.tsx   # 忘记密码
         └─ app/                     # 需要认证的页面（18 个）
            ├─ DashboardPage.tsx     # 仪表盘
            ├─ NewResearchPage.tsx   # 新建调研
            ├─ TasksPage.tsx         # 调研记录列表
            ├─ TaskDetailPage.tsx    # 调研详情 + 报告
            ├─ TrackersPage.tsx      # 定时追踪列表
            ├─ TrackerDetailPage.tsx # 追踪详情 + 趋势
            ├─ CompetitorsPage.tsx   # 竞品管理
            ├─ ProfileTemplatesPage.tsx # 画像模板
            ├─ ProfilesPage.tsx      # 竞品画像
            ├─ ProfileDetailPage.tsx # 画像详情
            ├─ ComparisonPage.tsx    # 画像横向对比
            ├─ GraphPage.tsx         # 关系图谱列表
            ├─ GraphDetailPage.tsx   # 图谱详情 + 可视化
            ├─ AssistantPage.tsx     # AI 助手
            ├─ AuditLogsPage.tsx     # 审计日志（独立页面）
            ├─ AdminPage.tsx         # 管理后台
            ├─ AccountPage.tsx       # 个人中心
            └─ PricingPage.tsx       # 套餐升级
```

## 1.6 套餐体系速览

| 套餐 | 月费 | 月度调研次数 | 检索关键词组/次 | 追踪项上限 | 说明 |
|------|------|------------|----------------|-----------|------|
| 免费版 (free) | ¥0 | 3 | 4 | 1 | 个人体验 |
| 专业版 (pro) | ¥99 | 30 | 8 | 5 | 个人/小团队 |
| 企业版 (enterprise) | ¥399 | 不限 | 12 | 20 | 企业级不限量 |

> 详细配额规则 → [02-architecture.md](../02-architecture.md)
