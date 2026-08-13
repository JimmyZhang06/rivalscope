# Agent v9 聚合情报平台总改造计划

## 1. 决策摘要

当前项目不是“功能少”，而是能力以调研、追踪、画像、图谱和助手为中心分别生长，缺少统一对象、事件、资产、任务和工作区语义。改造采用**模块化单体 + 兼容聚合层**：先把现有数据统一投影和统一导航，再逐步引入正式领域表、持久化任务和证据链；不立即拆微服务，不删除旧 API，不进行高风险一次性迁移。

平台定位为“持续收集、组织、解释并推动处置外部变化的竞争情报聚合平台”。竞品调研保留为分析工作台中的深度研究能力，而非整个产品本体。

## 2. 已确认的主要不足

| 维度 | 现状 | 影响 | 目标 |
|---|---|---|---|
| 产品入口 | 首页以发起报告为核心 | 用户无法快速看到变化与待办 | 事件优先总览 |
| 领域模型 | Competitor/Tracker/Profile/Graph/Task 各自闭环 | 关联依赖名称或松散 ID | Workspace/Object/Event/Asset/Job |
| 情报复用 | 成果散落在各页面 | 搜索、引用、回溯困难 | 统一资产目录与证据链 |
| 执行可靠性 | Web 进程内 `BackgroundTasks/create_task` | 重启丢任务、多实例重复 | 持久化 Job、租约、幂等、Outbox |
| 数据库 | SQLite + 启动期迁移兼容 | 并发、迁移和生产运维风险 | PostgreSQL + Alembic；SQLite 仅开发 |
| 租户安全 | 各模块自行拼 user/org 条件 | 容易产生 IDOR/越权差异 | 唯一 TenantScope/Policy 层 |
| AI 安全 | 外部网页与报告直接进入提示词 | Prompt injection、数据泄露 | 不可信内容隔离、引用、工具白名单 |
| 运维 | 审计异常多处被静默吞掉 | 敏感操作无法可靠追踪 | 审计 outbox 与 fail-closed 分级 |

## 3. 目标能力与边界

五个核心对象：

1. `Workspace`：所有权限、配额、连接器和审计的边界。
2. `IntelligenceObject`：公司、产品等长期关注目标。
3. `IntelligenceEvent`：可验证、可去重、可处置的变化。
4. `IntelligenceAsset`：报告、画像、来源、图谱等可复用成果。
5. `Job`：所有长任务的统一状态、重试、成本和产物外壳。

首期不做：微服务拆分、Kafka/Kubernetes/OpenSearch、任意代码插件市场、全量历史 JSON 结构化、删除旧表或旧路由。

## 4. 分阶段执行

### M0：兼容聚合层与安全地基（当前批次）

- 统一事件流/摘要 API 与事件中心页面。
- 统一资产投影/筛选 API 与资产中心页面。
- SSE access token 查询串替换为 60 秒任务绑定 ticket。
- 固化产品、架构、安全计划与质量门禁。

门禁：旧 API 不变；跨组织隔离测试；后端全量测试、前端类型检查和生产构建通过。

### M1：对象、工作区和统一任务（2–4 周）

- Alembic baseline；新增 Workspace、Object、LegacyMapping、Job/Step/Artifact、Outbox。
- Competitor 幂等回填为 company 对象，旧服务双写并影子比对。
- TenantScope/Policy 统一入口；统一任务中心；对象详情聚合页。
- PostgreSQL CI；SQLite 明确限制为单机开发。

### M2：事件与证据闭环（3–5 周）

- EvidenceDocument/Chunk、事件指纹/去重/置信度、状态历史。
- 监测结果抽取为带证据事件，支持确认、忽略、解决、负责人。
- 首页切为事件/待办/任务摘要；通知仅作为投递渠道。

### M3：资产检索、AI 与协作（3–5 周）

- 资产索引、全文检索、标签/收藏/版本/反向引用。
- AI 仅从授权检索层取证，回答强制引用可定位证据。
- 评论、分派、摘要订阅、活动时间线；审计可靠写入。

### M4：受控连接器与生产化（持续）

- Website/Tavily/SMTP/Webhook 统一 connector contract。
- 密钥版本/轮换、同步游标、限流、重试、响应体上限和出站策略。
- 按指标再引入 Redis worker、pgvector 或 OpenSearch。

## 5. 执行与合并规则

- 每个工作包使用独立分支/worktree；共享的 `models.py`、迁移 revision、`main.py`、`App.tsx`、`AppLayout.tsx` 由集成人处理。
- 合并顺序：模型/迁移 → Job 内核 → v2 API → 安全与测试 → 前端薄切片。
- 每次提交必须兼容旧深链接和旧 API；任何迁移先 expand/backfill/dual-write，至少两个稳定版本后 contract。
- 禁止把工作区内既有未跟踪脚本、数据库和画像文档误纳入提交。

## 6. 量化验收

- 跨工作区访问测试 0 失败；已发布事件证据可追溯率 100%。
- 事件/资产列表 P95 < 500ms；长任务最终状态可观测率 100%。
- 资产索引覆盖率 ≥ 99%；同一变化 7 日重复事件率 < 10%。
- 关键写操作和 AI 调用审计覆盖率 100%。
- 迁移前后行数、关联、租户和 hash 校验零差异，并完成备份恢复演练。

详细产品计划见 `01-platform-product.md`，安全风险见 `02-security-risk-register.md`，技术路线见 `03-architecture-roadmap.md`，当前执行状态见 `04-execution-board.md`。
