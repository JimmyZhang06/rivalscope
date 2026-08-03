# 03. 数据库设计

> **竞品调研 Agent**
> 版本：v5.5.0 · 日期：2026-08-03 · 分支：agent-v5

## 3.1 表结构总览

共 **23 张表**（含关联表），使用 SQLAlchemy 2.0 ORM 定义，SQLite 存储（WAL 模式）。

```
users                   用户账号
├── orders              升级订单
├── login_logs          登录日志
├── research_tasks      调研任务
│   ├── task_steps      执行步骤
│   └── sources         信息来源
│       └── source_archives  来源快照存档
├── assistant_sessions  AI 助手会话
│   └── assistant_messages  会话消息
├── notifications       站内通知
├── crawl_tasks         爬虫任务
└── (via org_id)        企业组织

organizations           企业组织
├── (via members)       成员（users.org_id 关联）

competitors             竞品
profile_templates       画像模板
profile_generation_tasks 画像生成后台任务
competitor_profiles     竞品画像
user_permissions        RBAC 权限
trackers                定时追踪
graph_projects          图谱项目
├── graph_entities      图谱实体
└── graph_relations     图谱关系
audit_logs              审计日志
execution_snapshots     执行快照
service_keys            加密服务密钥
email_logs              邮件发送记录
```

## 3.2 全部表结构

### users — 用户账号

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| email | VARCHAR(255) UNIQUE | 登录邮箱 |
| password_hash | VARCHAR(128) | bcrypt 哈希 |
| nickname | VARCHAR(50) | 昵称 |
| avatar | TEXT | 预设色键或 base64 头像 |
| role | VARCHAR(10) | `user` / `admin` |
| plan | VARCHAR(20) | `free` / `pro` / `enterprise` |
| plan_expires_at | DATETIME | 套餐过期时间，NULL = 永不过期 |
| token_version | INTEGER | 会话版本，改密/退出所有设备时 +1 |
| reset_code | VARCHAR(44) | 忘记密码验证码（Fernet 加密后约 44 字符） |
| reset_code_expires_at | DATETIME | 验证码过期时间 |
| org_id | VARCHAR(32) | 所属企业，空串 = 无 |
| org_role | VARCHAR(10) | `owner` / `admin` / `member`，空串 = 无企业 |
| org_monthly_limit | INTEGER | 企业管理员设置的成员月额度，-1 = 不限 |
| created_at | DATETIME | 注册时间 |

**索引**：email(unique), org_id, role

**关系**：1:N → orders, login_logs, tasks; 1:1 → org (via org_id)

---

### organizations — 企业组织

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| name | VARCHAR(100) | 企业名称 |
| plan | VARCHAR(20) | `free` / `pro` / `enterprise` |
| plan_expires_at | DATETIME | 套餐过期时间 |
| owner_id | VARCHAR(32) | 所有者 user_id |
| invite_code | VARCHAR(8) UNIQUE | 8 位邀请码 |
| created_at | DATETIME | 创建时间 |

**索引**：owner_id, invite_code(unique)

---

### orders — 升级订单

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) FK → users.id | 购买用户 |
| plan | VARCHAR(20) | 目标套餐 |
| amount | INTEGER | 金额（元） |
| status | VARCHAR(10) | `paid` / `refunded` |
| created_at | DATETIME | 下单时间 |
| paid_at | DATETIME | 支付时间 |

**索引**：user_id

---

### login_logs — 登录/注册/重置日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) FK → users.id | 关联用户 |
| action | VARCHAR(20) | `login` / `register` / `reset` |
| ip | VARCHAR(64) | 客户端 IP |
| user_agent | VARCHAR(300) | UA 字符串（截断） |
| created_at | DATETIME | 操作时间 |

**索引**：user_id

---

### research_tasks — 调研任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) FK → users.id | 创建者 |
| org_id | VARCHAR(32) | 所属企业，空串 = 个人任务 |
| tracker_id | VARCHAR(32) | 由追踪项调度时记录，空串 = 手动创建 |
| product_name | VARCHAR(200) | 调研对象名称 |
| competitors | TEXT | 指定竞品，逗号分隔 |
| focus | TEXT | 调研重点 |
| time_range | VARCHAR(10) | 检索时效：`''`/day/week/month/year |
| status | VARCHAR(20) | `pending`/`planning`/`searching`/`analyzing`/`reporting`/`completed`/`failed` |
| error | TEXT | 错误信息 |
| report_markdown | TEXT | 最终 Markdown 报告 |
| report_data | TEXT | 结构化洞察 JSON（评分/SWOT/结论/时间线） |
| change_summary | TEXT | 与上一期报告的变更摘要（追踪任务） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：user_id, org_id, tracker_id, status

**关系**：1:N → task_steps, sources

---

### task_steps — 执行步骤日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| task_id | VARCHAR(32) FK → research_tasks.id ON DELETE CASCADE | 所属任务 |
| seq | INTEGER | 步骤序号 |
| phase | VARCHAR(20) | `planning`/`searching`/`analyzing`/`reporting`/`done`/`error` |
| title | VARCHAR(200) | 步骤标题 |
| detail | TEXT | 步骤详情 |
| created_at | DATETIME | 创建时间 |

**索引**：task_id

---

### sources — 信息来源

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 ID |
| task_id | VARCHAR(32) FK → research_tasks.id ON DELETE CASCADE | 所属任务 |
| title | VARCHAR(500) | 页面标题 |
| url | VARCHAR(1000) | 原始 URL |
| snippet | TEXT | 内容摘要（截断） |
| score | FLOAT | Tavily 相关度分 (0~1) |
| domain | VARCHAR(255) | 域名 |
| tier | VARCHAR(20) | `official`/`media`/`community`/`other` |
| published_at | VARCHAR(50) | 来源发布时间（原始字符串） |
| dimension | VARCHAR(100) | 来自哪组检索维度 |
| raw_content | TEXT | 原文摘录（截断 8000 字符） |
| confidence | FLOAT | 置信度 (0~1) |
| conflict_status | VARCHAR(20) | `none`/`pending` |
| conflict_note | TEXT | 冲突说明 |
| is_duplicate | BOOLEAN | 是否重复 |
| dedup_group | VARCHAR(32) | 去重组 ID |
| access_status | VARCHAR(20) | 页面访问状态 |
| access_error | TEXT | 访问错误信息 |
| collected_at | DATETIME | 采集时间 |

**索引**：task_id

**计算属性**：`age_days` — 距今天数（基于 published_at 解析）

---

### source_archives — 来源快照存档

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| task_id | VARCHAR(32) | 所属任务 |
| source_id | INTEGER | 关联 source.id |
| snapshot_html | TEXT | 页面 HTML 快照（上限 500KB） |
| snapshot_text | TEXT | 纯文本提取 |
| snapshot_format | VARCHAR(20) | `html` |
| published_at | VARCHAR(50) | 发布时间 |
| collected_at | DATETIME | 采集时间 |
| access_status | VARCHAR(20) | `success`/`failed` |
| access_error | TEXT | 错误信息 |
| raw_content_full | TEXT | 完整原文（未截断） |

---

### profile_templates — 画像模板

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| org_id | VARCHAR(32) | 所属企业，空串 = 系统模板 |
| name | VARCHAR(200) | 模板名称 |
| dimensions | TEXT | JSON：`[{"key","label","fields":[{"key","label","type"}]}]` |
| version | INTEGER | 版本号，修改时 +1 |
| frozen_at | DATETIME | 冻结时间，NULL = 可编辑 |
| created_by | VARCHAR(32) | 创建者 user_id |
| created_at | DATETIME | 创建时间 |

**索引**：org_id

---

### competitor_profiles — 竞品画像

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| org_id | VARCHAR(32) | 所属企业 |
| competitor_id | VARCHAR(32) | 关联 competitor.id |
| template_id | VARCHAR(32) | 关联 profile_template.id |
| template_version | INTEGER | 生成时的模板版本号 |
| profile_data | TEXT | JSON：按模板维度填充的结构化数据 |
| source_refs | TEXT | JSON：来源快照引用列表 |
| status | VARCHAR(20) | `draft`/`reviewed`/`frozen` |
| frozen_at | DATETIME | 冻结时间 |
| generation_source | VARCHAR(20) | 生成来源（`research` / `crawl` 等） |
| report_markdown | TEXT | 预生成报告 Markdown（独立列，避免每次解析 profile_data） |
| insights_json | TEXT | 预生成洞察 JSON（独立列） |
| source_index_json | TEXT | 来源索引 JSON（独立列） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：org_id, competitor_id, template_id

> **v5.5.0 新增**：`template_version`、`report_markdown`、`insights_json`、`source_index_json` 四列，用于预生成内容独立存储，减少 JSON 解析开销。

---

### organizations — 企业组织

（见上方）

---

### trackers — 定时追踪项

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| org_id | VARCHAR(32) | 所属企业 |
| creator_id | VARCHAR(32) | 创建者 user_id |
| product_name | VARCHAR(200) | 追踪目标 |
| competitors | TEXT | 竞品列表 |
| focus | TEXT | 调研重点 |
| time_range | VARCHAR(10) | 检索时效 |
| frequency | VARCHAR(10) | `daily`/`weekly`/`monthly` |
| run_hour | INTEGER | 每天运行整点 (0-23) |
| next_run_at | DATETIME | 下次运行时间 |
| last_run_at | DATETIME | 上次运行时间 |
| enabled | BOOLEAN | 是否启用 |
| push_email | BOOLEAN | 邮件推送 |
| push_webhook | BOOLEAN | Webhook 推送 |
| webhook_type | VARCHAR(20) | `wecom`/`dingtalk`/`feishu`/`generic` |
| webhook_url | VARCHAR(1000) | Webhook URL |
| created_at | DATETIME | 创建时间 |

**索引**：org_id, creator_id, enabled

---

### graph_projects — 关系图谱项目

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 创建者 |
| org_id | VARCHAR(32) | 所属企业 |
| root_name | VARCHAR(200) | 根对象名称 |
| industry | VARCHAR(100) | 所属行业 |
| time_range | VARCHAR(10) | 检索时效 |
| status | VARCHAR(20) | `pending`/`building`/`completed`/`failed` |
| error | TEXT | 错误信息 |
| report_markdown | TEXT | 分析报告 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：user_id, org_id, status

**关系**：1:N → graph_entities, graph_relations

---

### graph_entities — 图谱实体节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| project_id | VARCHAR(32) FK → graph_projects.id ON DELETE CASCADE | 所属图谱 |
| name | VARCHAR(200) | 实体名称 |
| type | VARCHAR(20) | `company`/`product`/`org`/`person` |
| industry | VARCHAR(100) | 行业 |
| description | TEXT | 描述 |
| is_root | BOOLEAN | 是否为根对象 |

**索引**：project_id

---

### graph_relations — 图谱关系边

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| project_id | VARCHAR(32) FK → graph_projects.id ON DELETE CASCADE | 所属图谱 |
| source_id | VARCHAR(32) | 源实体 ID |
| target_id | VARCHAR(32) | 目标实体 ID |
| relation_type | VARCHAR(30) | `upstream_supplier`/`downstream_customer`/`competitor`/`partner`/`investor`/`parent`/`subsidiary` |
| description | TEXT | 关系描述 |
| confidence | FLOAT | 置信度 (0~1) |
| source_url | VARCHAR(1000) | 关系依据来源 |

**索引**：project_id, source_id, target_id

---

### competitors — 竞品

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| org_id | VARCHAR(32) | 所属企业，空串 = 系统模板 |
| name | VARCHAR(200) | 竞品名称 |
| alias | VARCHAR(500) | 别名 |
| website | VARCHAR(500) | 官网 |
| tech_focus | TEXT | 技术方向 |
| keywords | TEXT | 关键词（JSON 数组字符串） |
| status | VARCHAR(20) | `active` / `paused` / `archived` |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：org_id

---

### user_permissions — RBAC 权限

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 关联用户 |
| permissions | TEXT | JSON 数组：`["source:register", "profile:generate", ...]` |
| created_at | DATETIME | 创建时间 |

**索引**：user_id

---

### audit_logs — 审计日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 操作用户 |
| org_id | VARCHAR(32) | 所属企业 |
| action | VARCHAR(50) | 操作类型 |
| resource_type | VARCHAR(50) | 资源类型 |
| resource_id | VARCHAR(32) | 资源 ID |
| input | TEXT | 输入参数（截断 2000 字符） |
| result | TEXT | 返回结果（截断） |
| status | VARCHAR(20) | `success`/`error` |
| error | TEXT | 错误信息（截断 500 字符） |
| model_name | VARCHAR(100) | LLM 模型名称 |
| tokens_prompt | INTEGER | 输入 token 数 |
| tokens_completion | INTEGER | 输出 token 数 |
| cost | FLOAT | 费用（元） |
| ip | VARCHAR(64) | 客户端 IP |
| user_agent | VARCHAR(300) | UA 字符串（截断） |
| created_at | DATETIME | 操作时间 |

**索引**：user_id, org_id

---

### execution_snapshots — 执行快照

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| org_id | VARCHAR(32) | 所属企业 |
| tracker_id | VARCHAR(32) | 关联追踪项 |
| task_id | VARCHAR(32) | 关联调研任务 |
| config_hash | VARCHAR(64) | SHA256(config) |
| model_params | TEXT | 模型参数 |
| kb_version | VARCHAR(50) | 知识库版本 |
| deployment_env | VARCHAR(100) | 部署环境 |
| candidate_version | VARCHAR(50) | 候选版本 |
| build_hash | VARCHAR(64) | 构建 hash |
| created_by | VARCHAR(32) | 创建者 |
| created_at | DATETIME | 创建时间 |

**索引**：org_id, tracker_id, task_id

---

### service_keys — 加密服务密钥

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| service | VARCHAR(50) | `llm`/`tavily`/`smtp` |
| encrypted_value | TEXT | Fernet 加密的值 |
| label | VARCHAR(100) | 标签 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

---

### assistant_sessions — AI 助手会话

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 所属用户 |
| title | VARCHAR(200) | 会话标题 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：user_id

---

### assistant_messages — AI 助手消息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 所属用户 |
| session_id | VARCHAR(32) | 所属会话 |
| role | VARCHAR(10) | `user`/`assistant` |
| content | TEXT | 消息内容 |
| refs | TEXT | 引用的报告 JSON：`[{"task_id","product_name"}]` |
| created_at | DATETIME | 创建时间 |

**索引**：user_id, session_id

---

### email_logs — 邮件发送记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| to_email | VARCHAR(255) | 收件人 |
| subject | VARCHAR(300) | 主题 |
| body | TEXT | 邮件内容 |
| status | VARCHAR(10) | `sent`/`demo`/`failed` |
| created_at | DATETIME | 发送时间 |

**索引**：to_email

---

### notifications — 站内通知

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| user_id | VARCHAR(32) | 接收用户 |
| org_id | VARCHAR(32) | 所属企业 |
| title | VARCHAR(200) | 标题 |
| body | TEXT | 内容 |
| link | VARCHAR(500) | 跳转链接（前端路由） |
| read | BOOLEAN | 是否已读 |
| created_at | DATETIME | 创建时间 |

**索引**：user_id, org_id

---

### profile_generation_tasks — 画像生成后台任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| competitor_id | VARCHAR(32) | 关联竞品 |
| template_id | VARCHAR(32) | 关联模板 |
| user_id | VARCHAR(32) | 创建者 |
| org_id | VARCHAR(32) | 所属企业 |
| status | VARCHAR(20) | `running`/`done`/`error` |
| current_step | VARCHAR(100) | 当前步骤描述 |
| result | TEXT | 完成后的结果 JSON |
| error | TEXT | 错误信息（截断 500 字符） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

> **v5.5.0 变更**：表名从 `profile_extract_tasks` 改为 `profile_generation_tasks`，ORM 模型对应改为 `ProfileGenerationTask`。支持进程重启后从数据库恢复任务状态（内存缓存 + DB 回退双保险），DB 写入带 SQLite 锁重试机制。

---

### crawl_tasks — 爬虫任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | UUID hex |
| competitor_id | VARCHAR(32) | 关联竞品 |
| url | VARCHAR(1000) | 爬取目标 URL |
| status | VARCHAR(20) | `pending`/`running`/`completed`/`failed` |
| content | TEXT | 原始内容 |
| extracted_data | TEXT | 结构化提取结果（JSON） |
| error | TEXT | 错误信息 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**索引**：competitor_id

## 3.3 审计日志保护

启动时通过 `audit_triggers.py` 创建 SQLite 触发器，防止 `audit_logs` 表的 UPDATE/DELETE 操作（`backend/app/db/audit_triggers.py`）。

| 保护机制 | 实现 |
|----------|------|
| 防 UPDATE | BEFORE UPDATE 触发器，RAISE(ABORT, '审计日志不可修改') |
| 防 DELETE | BEFORE DELETE 触发器，RAISE(ABORT, '审计日志不可删除') |

## 3.4 数据库管理方式

### 初始化与迁移

| 操作 | 实现 | 文件 |
|------|------|------|
| 建表 | `Base.metadata.create_all(bind=engine)` | `main.py:28` |
| 轻量迁移 | `migrate_columns()` — PRAGMA table_info + ALTER TABLE ADD COLUMN | `main.py:39-160` |
| 播种管理员 | `seed_admin()` — 若无 admin 账号则创建默认账号 | `main.py:166-185` |

### 数据库引擎配置

- **驱动**：SQLite (`sqlite:///./research.db`)
- **WAL 模式**：`PRAGMA journal_mode=WAL` — 支持并发读
- **外键约束**：`PRAGMA foreign_keys=ON`
- **超时**：`PRAGMA busy_timeout=30000` — 30 秒等待锁释放
- **线程安全**：`check_same_thread=False`（SQLite 特有）

### 会话管理

- **短生命周期会话**：所有 DB 操作使用 `with SessionLocal() as db:` 上下文管理器
- **请求级会话**：FastAPI `Depends(get_db)` 提供请求级会话（自动关闭）
- **自动提交**：非阻断操作中个别地方使用 `db.commit()`，大部分依赖 ORM 级联

### JSON 字段存储

复杂类型（来源列表、画像数据、权限数组等）以 **TEXT 字段存储 JSON 字符串**，Pydantic schema 通过 `mode="before"` validator 在序列化时自动解析。
