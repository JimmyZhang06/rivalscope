# 聚合情报平台：技术架构与执行路线图

> 基线：`agent-v8`（审阅日期：2026-08-13）
> 范围：从“竞品调研工具”渐进演进为“多来源、持续运行、以情报对象和事件为中心的聚合平台”。
> 原则：不做大爆炸重写；优先新增稳定内核，以兼容层承接现有调研、画像、图谱、追踪能力。

## 1. 结论与架构决策

当前工程已经拥有聚合平台所需的多数“能力零件”：调研流水线、官网采集、来源存证、画像、对比、图谱、定时追踪、通知、AI 助手、组织/RBAC 和审计。但这些能力分别围绕 `ResearchTask`、`Competitor`、`Tracker`、`GraphProject`、`ProfileGenerationTask` 建模，缺少统一的对象、证据、事件和任务语义，因此难以形成跨来源时间线、全局检索、统一预警和连接器生态。

建议采用以下决策：

1. **先演进为模块化单体，不立即拆微服务。** FastAPI 保留为 API/BFF，按领域拆分应用层；耗时执行从 Web 进程迁到独立 Worker。只有当吞吐量、团队边界或独立扩缩容确实需要时再拆服务。
2. **以四个核心概念收口现有功能：** `IntelligenceObject`（情报对象）、`EvidenceDocument`（证据文档）、`IntelligenceEvent`（情报事件）、`Job`（统一任务）。调研只是 `Job(kind=research)`；竞品只是 `IntelligenceObject(kind=company|product)`。
3. **PostgreSQL 是正式平台数据库。** SQLite 仅保留开发/单机演示。数据库结构由 Alembic 管理，停止在应用启动时重建表。
4. **任务执行必须可恢复、可重试、可幂等。** 第一阶段可以采用“数据库任务表 + 租约 Worker + outbox”；生产扩展时接 Redis + Dramatiq/Celery，业务层不感知队列实现。
5. **检索分两层演进。** 首先使用 PostgreSQL 全文检索与 `pg_trgm`；语义检索需要时加 `pgvector`。数据量或复杂查询达到阈值后才引入 OpenSearch，避免过早形成双写负担。
6. **所有新 API 使用 `/api/v2`，旧 `/api/*` 至少兼容两个发布周期。** 旧端点作为适配器调用新应用服务，而不是维护两套业务实现。

## 2. 当前架构盘点与主要约束

### 2.1 当前形态

- 后端是单进程 FastAPI + SQLAlchemy，同一进程内包含 API、调度器、LLM 编排、爬虫和通知。
- `backend/app/db/models.py` 中 20 余种实体集中声明；跨模块大量 JSON 使用 `Text` 存储。
- 调研使用 `BackgroundTasks`，爬虫和画像使用 `asyncio.create_task`，定时追踪由 lifespan 内的 60 秒扫描器触发。
- SQLite 使用 `StaticPool`、WAL 和启动时轻量迁移；尚无 Alembic 版本链。
- 前端按“调研/追踪/画像/图谱”功能分组，缺少对象详情、事件流、统一任务中心、跨资产检索。
- 测试目前只覆盖访问控制、SQLite 迁移、URL 安全三个方向；CI 仅编译、pytest 和前端 build。

### 2.2 阻碍聚合平台的具体问题

| 问题 | 当前证据 | 平台化影响 |
|---|---|---|
| 后台任务依赖进程内协程 | `api/research.py`、`api/crawl.py`、`services/profile_extractor.py`、`api/graph.py` | Web 重启会丢任务；多实例重复执行；无法独立扩缩容 |
| 定时器只有进程内 `_running` 集合 | `services/scheduler.py` | 多副本会重复调度，缺少租约、幂等键与失败重试策略 |
| 多套任务模型/状态机 | `ResearchTask`、`CrawlTask`、`ProfileGenerationTask`、`GraphProject` | 无法统一展示、取消、重试、统计和限额 |
| 租户字段和外键不一致 | 部分表仅有 `user_id`，部分为裸字符串，图关系 `source_id/target_id` 无 FK | 跨组织隔离容易遗漏，孤儿记录和串租户风险高 |
| JSON/Text 承载核心业务结构 | `profile_data`、`report_data`、`dimensions`、`permissions`、`crawl_config` | 无法可靠约束、索引、筛选和演进；契约易漂移 |
| 启动时执行自研迁移 | `main.py::migrate_columns()` | 发布与数据迁移耦合；多实例启动竞争；回滚和审计困难 |
| SSE 使用查询参数 token | `api/research.py`、`api/deps.py` | token 可能进入代理/浏览器/访问日志，且长连接撤销策略弱 |
| 权限判断分散且缓存仅进程内 | 多个 `_get_owned_*` 与 `deps.py::_PERM_CACHE` | 新模块容易遗漏隔离；多实例缓存失效不一致 |
| 外部服务调用和业务编排强耦合 | `services/search.py`、`llm.py`、`crawler.py`、`notify.py` | 难以增加更多来源、做供应商切换、熔断、计费和追踪 |
| 只有外部搜索，没有内部统一索引 | Tavily 结果、官网页面、归档、报告分别存储 | AI 助手和控制台无法对所有资产做统一检索与引用 |
| 审计记录常被 `except: pass` 吞掉 | 多个 API 创建/删除路径 | 安全操作可能无审计，不能形成可验证合规链路 |
| `ServiceKey` 缺组织归属和用途范围 | `models.py::ServiceKey` | 多租户连接器密钥边界不清；难以做轮换、禁用和最小权限 |
| 原始 HTML、邮件正文和模型上下文长期入库 | `CompetitorPage`、`SourceArchive`、`EmailLog` | XSS/敏感信息/数据保留风险，存储增长不可控 |

## 3. 目标领域模型

### 3.1 核心实体

| 实体 | 关键字段 | 用途与约束 |
|---|---|---|
| `intelligence_objects` | `id, org_id, kind, canonical_name, status, attributes_json, created_by` | 公司、产品、技术、品牌、市场、人物、机构的统一注册表；`org_id + kind + normalized_name` 建候选唯一约束 |
| `object_aliases` | `object_id, alias, normalized_alias, source` | 名称消歧与多语言别名；支持导入时去重 |
| `tags` / `object_tags` | `org_id, name` / `object_id, tag_id` | 用户自定义分类，不把标签继续塞进字符串 |
| `evidence_documents` | `id, org_id, object_id?, connector_id?, canonical_url?, content_hash, title, text, metadata_json, observed_at, published_at, classification` | 官网页面、搜索结果、上传文件、报告和外部系统内容的统一证据；按 hash/URL 幂等去重 |
| `evidence_chunks` | `document_id, ordinal, text, token_count, search_vector, embedding?` | 全文/语义检索的最小单位；引用必须回到原文档和定位信息 |
| `intelligence_events` | `id, org_id, event_type, title, summary, occurred_at, detected_at, severity, confidence, status, fingerprint` | 统一动态时间线；`org_id + fingerprint` 去重；支持待确认/已确认/忽略 |
| `event_objects` / `event_evidence` | 事件与对象/证据关联 | 一个事件可影响多个对象，且必须可追溯到证据 |
| `object_relationships` | `source_object_id, target_object_id, relation_type, valid_from, valid_to, confidence` | 取代“每个图谱项目复制一套节点”的主关系层；图谱项目变为查询/视图 |
| `jobs` | `id, org_id, kind, requested_by, status, idempotency_key, priority, input_json, progress, attempt, max_attempts, lease_owner, lease_until` | 调研、采集、画像、图谱、索引、通知的统一执行记录 |
| `job_steps` / `job_artifacts` | 阶段事件与输出引用 | 统一任务中心、SSE、诊断、成本统计与可恢复执行 |
| `connectors` | `id, org_id, type, name, status, config_json, secret_ref, capabilities, cursor_json` | 外部数据源/通知渠道实例；密钥只存引用，不进入 config/log |
| `monitor_rules` | `org_id, name, query/filter, schedule, severity_rule, channels` | 对象/关键词/来源监测规则，逐步替代只支持产品名的 `Tracker` |
| `alerts` | `event_id, rule_id, assignee_id?, status, acknowledged_at` | 将“通知”提升为可处理的业务事项；通知只是投递记录 |
| `outbox_events` | `topic, aggregate_id, payload, published_at, attempts` | 数据提交与异步发布保持原子性，防止“写库成功但任务未投递” |

所有业务表必须具备明确的 `org_id`（系统级记录使用单独 `scope`，不再以空字符串暗示）、时间戳、外键及必要的删除策略。`attributes_json/metadata_json/input_json` 只保存扩展字段，核心筛选字段必须结构化。

### 3.2 现有数据的映射

| 现有模型 | 目标映射 | 迁移策略 |
|---|---|---|
| `Competitor` | `IntelligenceObject` | 双写并回填；保留 `competitor_id -> object_id` 映射，旧 ID/URL 不失效 |
| `CompetitorPage`、`Source`、`SourceArchive` | `EvidenceDocument/Chunk` | 先异步回填 hash、归一化 URL、对象关联；原表只读保留一个版本周期 |
| `ResearchTask` | `Job(kind=research)` + 报告类 `EvidenceDocument` | 新建任务双写；旧端点返回旧 schema，内部指向同一 Job |
| `CrawlTask` | `Job(kind=crawl)` | 统一状态与进度，旧 crawl status 由 adapter 投影 |
| `ProfileGenerationTask` | `Job(kind=profile_generation)` | 移除内存任务真源；结果作为 artifact 关联画像 |
| `Tracker` | `MonitorRule` | 先一对一迁移，后续支持对象集合、事件类型和渠道策略 |
| `GraphEntity/Relation` | `IntelligenceObject/ObjectRelationship` | 对候选实体做人工/自动消歧；图项目暂保留为关系查询快照 |
| `Notification` | `AlertDelivery`/普通通知投影 | 保留现有铃铛 API；高优事件建立可确认 Alert |

## 4. 目标代码结构与依赖方向

建议逐步形成以下模块化单体结构，旧目录在迁移完成前保留：

```text
backend/app/
  api/v1/                 # 现有 API 兼容适配器
  api/v2/                 # 新平台 API，仅负责 HTTP/DTO
  domains/
    intelligence/         # 对象、事件、关系、证据
    jobs/                 # 任务、租约、重试、进度
    connectors/           # 连接器注册、同步游标、密钥引用
    monitoring/           # 规则、告警、投递
    identity/             # 用户、组织、权限、套餐
  application/            # use case / transaction boundary
  infrastructure/
    db/                   # SQLAlchemy repository + Alembic
    queue/                # DatabaseQueue / RedisQueue 适配器
    search/               # Postgres/pgvector/OpenSearch 适配器
    connectors/           # Tavily、Website、Webhook 等实现
    observability/
  worker/                 # 独立 worker 入口与 job handlers
```

依赖只能从 `api/worker -> application -> domains`，基础设施通过接口注入；领域层不得直接导入 FastAPI、Tavily、OpenAI 或具体队列。前端建议按 `features/dashboard|objects|events|jobs|assets|monitoring` 拆分，`src/api` 由 OpenAPI 自动生成基础类型，再包一层 feature client。

## 5. API 兼容与演进

### 5.1 新 API 面

- `GET/POST /api/v2/objects`，`GET/PATCH /api/v2/objects/{id}`
- `GET /api/v2/objects/{id}/timeline|evidence|relationships|reports`
- `GET /api/v2/events`，`POST /api/v2/events/{id}/confirm|ignore`
- `GET/POST /api/v2/jobs`，`GET /api/v2/jobs/{id}`，`POST .../cancel|retry`
- `GET /api/v2/jobs/{id}/events`（短期仍为 SSE）
- `GET /api/v2/search?q=...&types=...`
- `GET/POST /api/v2/connectors`，`POST .../test|sync`
- `GET/POST /api/v2/monitor-rules`，`GET/PATCH /api/v2/alerts`
- `GET /api/v2/dashboard/summary|timeline|attention`

统一约定：游标分页；RFC 9457 风格错误体；UTC ISO-8601；请求 `X-Request-ID`；写请求支持 `Idempotency-Key`；列表按 `org_id` 强制作用域；任务返回 `202 + job_id`。

### 5.2 兼容策略

1. `/api/research`、`/api/competitors`、`/api/profiles`、`/api/graph`、`/api/trackers` 不立刻删除。
2. 第一阶段先让旧端点通过 application service 写入新表；响应继续由旧 Pydantic schema 投影。
3. 返回 `Deprecation`、`Sunset`、文档迁移链接，但至少保持两个发布周期。
4. 前端逐页面切换至 v2；每切一个页面就增加 v1/v2 契约测试，避免静默字段漂移。
5. 不复用含糊旧 ID：新增 `legacy_resource_mappings(resource_type, legacy_id, new_id)`；所有旧深链接通过映射解析。

## 6. 可靠任务与事件架构

### 6.1 第一阶段：数据库队列

- API 创建 `jobs` 与 `outbox_events` 于同一事务，不直接 `create_task`。
- Worker 使用 `SELECT ... FOR UPDATE SKIP LOCKED`（PostgreSQL）领取任务；SQLite 开发模式使用单 Worker 原子状态更新。
- Job 具备 `idempotency_key`、租约、心跳、重试次数、指数退避、取消标记和最终失败原因。
- Handler 的每个副作用都使用稳定幂等键：外部采集以 URL/hash，事件以 fingerprint，通知以 `alert_id + channel`。
- `job_steps` 是进度真源；SSE 仅订阅/轮询它，不依赖运行中进程内对象。
- Outbox publisher 发布 `document.ingested`、`event.detected`、`job.completed` 等领域事件，供索引、告警和统计处理。

### 6.2 第二阶段：Redis 队列

- 保持 `JobDispatcher`/`JobLeaseRepository` 接口，切换到 Dramatiq 或 Celery；数据库仍为状态真源。
- 调度器成为独立 singleton 服务或使用分布式锁；周期任务仅“投递 job”，不执行实际业务。
- 设置队列分区：`interactive`、`ingest`、`llm`、`notification`；分别限并发、限速和超时。
- 明确交付语义为 at-least-once，因此所有 handler 必须幂等，不承诺不可实现的 exactly-once。

## 7. 搜索与索引方案

1. 采集后先做 URL canonicalization、正文抽取、content hash、语言检测、对象关联和分类。
2. PostgreSQL `tsvector + GIN` 支持中文时需配置合适分词方案；初期可同时使用标准化标题/正文的 trigram 模糊检索。
3. 文档切片保留 `document_id + ordinal + char offsets`，AI 回答的每条引用都返回可定位证据。
4. 语义检索开启前先定义离线评测集（查询、期望证据、NDCG/Recall@K）；无评测不引入 embedding。
5. `pgvector` 作为中等规模默认；当单租户/全库文档量、写入吞吐、聚合能力超过预定阈值后，通过 SearchPort 迁移 OpenSearch。
6. 索引通过 outbox 异步更新；搜索结果携带 index version，支持重建和蓝绿切换。

## 8. 连接器与插件边界

连接器不是任意 Python 插件，而是受控能力适配器。统一接口：

```python
class Connector(Protocol):
    type: str
    capabilities: set[str]  # discover/fetch/search/push
    async def test(self, context) -> TestResult: ...
    async def pull(self, cursor, context) -> PullBatch: ...
    async def fetch(self, ref, context) -> EvidencePayload: ...
    async def push(self, message, context) -> DeliveryResult: ...
```

- 首批内置：Website、Tavily Search、Generic Webhook、SMTP；现有实现迁入 adapter，不改变行为。
- Connector manifest 声明 schema、能力、所需出站域名、限速、数据分类；用户配置经 Pydantic/JSON Schema 校验。
- 密钥存储使用 `secret_ref`，生产接 KMS/Vault/云 Secret Manager；数据库只存加密引用及密钥版本。
- 每个连接器强制组织作用域、权限检查、用量预算、超时/重试/熔断和审计。
- 网络连接复用现有 SSRF 安全层，但必须对每次 DNS 解析和重定向逐跳验证；可配置域名 allowlist，禁止 file/gopher 等协议。
- 第三方代码未来采用独立进程/容器或远程 MCP/HTTP 边界，不允许在主 API 进程内动态 import 未信任代码。

## 9. 安全整改要求

### P0（进入平台开发前）

1. 将 SSE 查询 token 替换为短期一次性 stream ticket，或改为 fetch streaming 携带 Authorization；代理日志明确脱敏。
2. 建立唯一 `TenantScope`/policy 层，禁止各 API 自行拼 org/user 过滤；管理员跨租户访问必须显式选择 scope 并完整审计。
3. `ServiceKey` 增加 `org_id, connector_id, purpose, key_version, rotated_at, disabled_at`；禁止明文出现在日志、异常、任务 input。
4. 审计写入失败不得静默吞掉；敏感管理操作采用 fail-closed，普通业务使用可靠 outbox 补偿。
5. 移除 Web 进程内任务作为生产路径，防止任务丢失与多实例重复副作用。

### P1

1. 原始 HTML 展示必须 sanitize，并以纯文本为 AI 默认输入；归档下载使用 attachment/CSP，禁止同源脚本执行。
2. 建立数据分类与保留策略：原始页面、模型输入输出、邮件正文、访问日志分别设置 TTL、删除和导出机制。
3. 连接器实施 SSRF、DNS rebinding、重定向、响应体大小、压缩炸弹、MIME、超时、并发上限防护。
4. 为 LLM 增加 prompt injection 隔离：外部内容标为不可信数据；工具调用 allowlist；引用追溯；敏感字段脱敏；组织预算和模型白名单。
5. 权限缓存迁移至带版本号的共享缓存，或先取消缓存；权限变更立即使 token/session 和缓存失效。
6. 对 auth、忘记密码、连接器 test、AI ask、导入/上传分别限流；生产信任代理头必须限定可信代理。
7. 建立依赖/SAST/secret scan/SBOM、容器非 root、只读文件系统和最小出站网络策略。

## 10. 可观测性与运行保障

- 结构化 JSON 日志字段：`timestamp, level, request_id, trace_id, org_id, user_id, job_id, connector_id, operation`；敏感输入默认不记录。
- OpenTelemetry 覆盖 HTTP、SQLAlchemy、队列、外部 HTTP、LLM；请求到 Job 使用 trace link 串联异步链路。
- 指标至少包括：HTTP p50/p95/error、队列深度/等待时间、job 成功率/重试/租约过期、连接器限流与错误、LLM token/成本/延迟、索引延迟、事件重复率、告警投递率。
- 健康端点拆分 `/health/live` 与 `/health/ready`；ready 校验 DB、队列（必要依赖），不把可选外部供应商故障误判为实例死亡。
- 告警阈值和 SLO：交互 API 可用性、任务入队成功率、任务最大排队时长、索引新鲜度、跨租户访问拒绝异常数。
- Job 记录错误码和安全化摘要，原始堆栈进入受限日志；提供管理员重试/取消/死信页面。

## 11. 数据库迁移路线

1. **基线冻结：** 为当前 `agent-v8` schema 生成 Alembic baseline，只标记已有库，不重复建表；CI 校验 `alembic upgrade head`。
2. **扩展（expand）：** 仅新增核心表、映射表和 nullable 外键；旧服务继续运行。
3. **回填（backfill）：** 分批、可断点、可校验地导入对象/证据/任务；每批记录行数、hash 和失败项。禁止在应用启动期执行大回填。
4. **双写与校验：** application service 同事务写旧/新模型；对读结果做影子比对，监控差异率。
5. **切读：** 按 feature flag/组织灰度把新 API 和首页切至新表；保留快速回退。
6. **收缩（contract）：** 至少两个稳定版本后才移除旧列/表和启动迁移代码；删除前导出映射与回滚包。

迁移门禁：备份恢复演练通过；生产库样本迁移耗时可接受；外键/唯一约束/租户行数校验为零差异；回滚脚本或向前修复策略已演练。

## 12. 测试策略与质量门禁

### 12.1 测试金字塔

- 单元测试：领域状态机、对象消歧、URL/hash 去重、事件 fingerprint、配额、权限 policy、连接器输入校验。
- Repository/迁移测试：真实 PostgreSQL（CI service container），验证 FK、唯一约束、租户条件、Alembic 从 baseline 到 head 及 downgrade/forward-fix。
- 契约测试：OpenAPI breaking-change 检查；v1 adapter 与 v2 use case 等价；连接器使用录制响应/本地 fake，不依赖真实付费 API。
- 集成测试：API → outbox → worker → document/event/index/alert 全链路；覆盖崩溃恢复、重复投递、重试、取消和死信。
- 安全测试：每一种资源跨租户矩阵、IDOR、SSE ticket、SSRF/重定向/DNS、上传炸弹、存储型 XSS、prompt injection、密钥脱敏。
- 前端：Vitest/Testing Library 覆盖 store/关键交互，Playwright 覆盖登录、对象创建、任务流、事件确认、跨权限 UI。
- 负载与韧性：k6/Locust 测列表/SSE/搜索，模拟队列积压、供应商 429、Worker 崩溃、数据库切换。

### 12.2 CI 门禁

必须新增 lint/typecheck、pytest coverage（先 60%，逐步到 80%）、PostgreSQL migration、OpenAPI diff、npm audit/pip audit、Bandit/Semgrep、secret scan、前端组件测试和最小 E2E。任何新数据表必须有租户隔离测试；任何新 Job handler 必须有幂等和重试测试。

## 13. 里程碑

### M0：安全与迁移地基（1–2 周）

- Alembic baseline + PostgreSQL CI；生产 SQLite 迁移说明。
- TenantScope/policy 统一入口；SSE stream ticket；审计失败策略。
- 定义新领域 DTO、状态枚举、错误码和架构依赖约束。
- 完成第一阶段最小切片（见第 14 节）。

**退出条件：** 原 API/前端无回归；新表可独立升级；跨租户矩阵全通过；重启不丢最小切片任务。

### M1：统一对象、任务与控制台（2–4 周）

- IntelligenceObject、Job/Step/Artifact、legacy mapping 正式启用。
- 竞品和四类现有任务双写/投影；统一任务中心与对象详情骨架。
- 首页改为事件/待办/任务摘要，竞品调研移入分析工作台。

**退出条件：** 旧深链接可用；所有新任务可恢复/取消/重试；首页不再依赖各模块客户端拼接。

### M2：证据、事件、检索与监测（3–5 周）

- EvidenceDocument/Chunk、Postgres 全文检索、事件抽取/去重、对象时间线。
- Tracker 迁移 MonitorRule，Alert 可确认/忽略/分派；通知成为投递通道。
- AI 助手只通过统一检索层引用证据。

**退出条件：** 证据引用可定位；索引延迟/事件重复率可观测；至少三种事件类型达到评测基线。

### M3：连接器平台与生产化（3–5 周）

- Website/Tavily/SMTP/Webhook 迁入 connector contract；连接器管理页、测试与同步游标。
- Redis 队列按需接入；worker 分池；OpenTelemetry/SLO/死信运维完成。
- 数据保留、导出/删除、备份恢复和安全扫描闭环。

**退出条件：** 新连接器无需修改领域服务；故障注入与恢复演练通过；生产发布/回滚手册可执行。

### M4：扩展分析能力（持续）

- 产品、技术、人物、市场等对象类型；专题工作台；趋势与相似事件聚类。
- 关系有效期与证据版本；对象合并/拆分和人工审核台。
- 基于已验证检索评测再引入 pgvector/OpenSearch 和更高级 Agent 工作流。

## 14. 第一阶段可立即实现的最小切片

### 14.1 切片目标

用一个端到端“**创建情报对象 → 创建官网采集 Job → Worker 领取并记录步骤 → 查询统一任务/对象摘要**”证明新内核可行。首切片不改现有页面导航、不迁移所有历史数据、不引入 Redis，也不删除任何旧 API。

### 14.2 明确文件边界

**工作包 A：迁移与模型（独占数据库文件）**

- 新增 `backend/alembic.ini`
- 新增 `backend/alembic/env.py`
- 新增 `backend/alembic/versions/<baseline>.py`
- 新增 `backend/alembic/versions/<platform_core>.py`
- 新增 `backend/app/domains/intelligence/models.py`
- 新增 `backend/app/domains/jobs/models.py`
- 仅修改 `backend/app/db/models.py` 的 Base 注册方式（若拆表后确有需要）
- 仅修改 `backend/app/main.py`：移除生产路径的启动自迁移，保留开发兼容开关

首批表只建 `intelligence_objects`、`legacy_resource_mappings`、`jobs`、`job_steps`、`job_artifacts`、`outbox_events`；不要在本切片同时创建全套事件/连接器表。

**工作包 B：领域与 Worker（不得修改 API/前端）**

- 新增 `backend/app/domains/intelligence/entities.py`
- 新增 `backend/app/domains/jobs/entities.py`
- 新增 `backend/app/application/objects.py`
- 新增 `backend/app/application/jobs.py`
- 新增 `backend/app/infrastructure/queue/database_queue.py`
- 新增 `backend/app/worker/main.py`
- 新增 `backend/app/worker/handlers/website_crawl.py`
- 复用 `services/crawler.py` 时仅通过 adapter 调用；不得复制爬虫逻辑

完成 Job 状态机、领取/心跳/重试、幂等键和重启恢复。SQLite 开发模式明确限制为单 Worker。

**工作包 C：v2 API 与契约（不得修改 DB 模型/迁移）**

- 新增 `backend/app/api/v2/router.py`
- 新增 `backend/app/api/v2/objects.py`
- 新增 `backend/app/api/v2/jobs.py`
- 新增 `backend/app/schemas/v2/objects.py`
- 新增 `backend/app/schemas/v2/jobs.py`
- 修改 `backend/app/main.py` 仅挂载 v2 router（与工作包 A 在同一文件冲突，最终由集成人统一合并）

端点仅实现对象 CRUD 的最小集合、创建 crawl job、任务详情/步骤/SSE；统一使用 TenantScope 和 problem error。

**工作包 D：测试与 CI（不得修改实现文件）**

- 新增 `backend/tests/platform/test_objects_api.py`
- 新增 `backend/tests/platform/test_job_lifecycle.py`
- 新增 `backend/tests/platform/test_job_recovery.py`
- 新增 `backend/tests/platform/test_tenant_isolation.py`
- 新增 `backend/tests/platform/test_v1_compat.py`
- 修改 `.github/workflows/ci.yml`，加入 PostgreSQL、Alembic 和上述测试

**工作包 E：前端薄切片（在后端契约冻结后开始）**

- 新增 `frontend/src/features/objects/*`
- 新增 `frontend/src/features/jobs/*`
- 新增 `frontend/src/pages/app/ObjectsPage.tsx`
- 新增 `frontend/src/pages/app/UnifiedJobsPage.tsx`
- 修改 `frontend/src/App.tsx` 添加隐藏/feature-flag 路由
- 修改 `frontend/src/api/client.ts` 仅加入 v2 typed client；不重构旧 client

### 14.3 最小切片验收

- 同一 `Idempotency-Key` 重复提交只产生一个 Job。
- API 进程在 Job 运行时重启，Worker 能在租约到期后继续/重试且无重复证据。
- A 组织无法枚举或读取 B 组织的对象/Job/step，管理员跨租户访问有审计。
- 旧 `/api/competitors` 和 `/api/research` 行为、OpenAPI 和现有前端构建不回归。
- SQLite 单机演示与 PostgreSQL CI 都通过；生产配置拒绝在启动时自动结构迁移。
- Job SSE 不暴露 access token；日志中无密钥、正文和 Authorization。

## 15. 多 Agent / 多会话执行拆分与合并协议

推荐同时最多四个执行会话，减少共享工作区冲突。第一波并行 A/B/D，A 模型契约冻结后启动 C；后端 v2 OpenAPI 冻结后启动 E。每个 Agent 使用独立 `codex/<work-package>` 分支或 worktree，不在同一目录并发编辑。

| 包 | 负责范围 | 前置 | 可并行 | 禁止触碰 |
|---|---|---|---|---|
| A 数据库地基 | Alembic、核心表、迁移 | 无 | B、D | API/前端/业务 handler |
| B Job 内核 | 状态机、DB queue、Worker、crawl adapter | 先采用书面 schema，最终 rebase A | A、D | main、v2 API、CI |
| C v2 API | DTO、TenantScope、router、SSE ticket | A/B 接口冻结 | D | migrations、worker、前端 |
| D 验证安全 | 测试、CI、安全矩阵 | 可先写 contract/failing tests | A/B/C | 生产实现 |
| E 前端薄切片 | 对象/统一任务只读与创建体验 | C OpenAPI 冻结 | 后续 M2 工作 | 后端/旧页面重构 |

合并顺序：

1. 集成人先记录干净基线和用户已有未跟踪文件，禁止纳入提交。
2. 合并 A，运行 Alembic 全新安装 + baseline 标记 + upgrade 测试。
3. rebase 并合并 B，运行 Job 单元/恢复测试；检查无 `create_task` 新生产路径。
4. 合并 C，由集成人手工处理 `main.py` 唯一冲突；生成并 diff OpenAPI。
5. 合并 D；全量后端、前端 build、安全扫描通过后才合并 E。
6. E 仅在 feature flag 下发布；端到端验收后开启测试组织灰度。
7. 每个工作包一个意图明确的提交；禁止 squash 掉迁移版本历史。合并后由集成人统一修订文档、版本和 changelog。

任何 Agent 若需跨越文件边界，先向集成人报告，不直接修改；共享接口通过 `contracts.md` 或已合并 schema 确认。迁移文件一旦被别的分支引用，不修改 revision ID，只增加后继 migration。

## 16. 暂不做的事项

- 不立即拆分用户、搜索、爬虫、Agent 为多个网络微服务。
- 不先上 Kafka、Kubernetes、OpenSearch 或向量数据库来“证明平台化”。
- 不把所有历史 JSON 一次性结构化；只迁移会被筛选、约束和关联的核心字段。
- 不先开放任意第三方代码插件；第一阶段仅支持受控内置 connector。
- 不移除旧 URL/数据库表，也不把现有画像、图谱和报告全部重写。
- 不在缺少离线检索/事件评测集时承诺“智能洞察准确率”。

## 17. 成功衡量

- 产品：用户首页可回答“最近发生了什么、为什么重要、证据是什么、需要处理什么”。
- 平台：新增一个数据来源无需修改情报对象、事件、搜索或告警核心逻辑。
- 可靠性：任务重启可恢复，重复投递无重复副作用，队列等待和失败原因可观测。
- 安全：自动化跨租户矩阵零越权；密钥/令牌不进入 URL 和日志；所有高风险操作有不可丢审计。
- 数据：事件可追溯到证据和对象；对象可合并/消歧；搜索结果有稳定定位。
- 工程：正式 schema 全由 Alembic 管理；v1 兼容有契约门禁；发布具备灰度、回滚和迁移演练。
