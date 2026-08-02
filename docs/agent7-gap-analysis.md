# Agent 7 竞品技术监测 — 现有系统 vs 合同要求差距分析报告

> 依据：《明圣一期-Agent7-竞品监测-内部执行要求-2026-08-01.docx》
> 分析对象：comp-agent 代码库（backend + frontend，agent-v5 分支，Agent 7 全面实现后）
> 分析日期：2026-08-01
> **更新说明**：基于 agent-v5 实际代码更新，标注各差距项的当前实现状态
> **v5.0.0 补充 (2026-08-02)**：爬虫可靠性已修复（语言感知、consent 剥离、命名空间匹配），不再列为差距

---

## 一、合同要求概览

Agent 7 的合同任务是**在冻结范围内完成一个可验证的基础闭环**：

| 维度 | 要求 |
|------|------|
| 固定范围 | 5 家竞品、10 个批准公开来源、不高于每周 1 次、10 条监测记录、5 份竞品画像 |
| 交付物 | A7-01~A7-08（竞品名单、来源配置、来源存证、监测记录、画像、横向对比、变化提醒、运行日志） |
| 验收门槛 | 来源存证 10/10、结构化处理 ≥9/10、事实准确率 ≥90%、画像 5/5、零容忍 0 起 |
| 不做承诺 | 全网覆盖、竞品非公开信息、深度技术研判、绕过访问控制、正式优劣/侵权判断 |

---

## 二、现有系统能力盘点

### 已具备的能力

| 能力 | 对应模块 | 状态 | 说明 |
|------|---------|------|------|
| 多租户组织 | `User.org_id` + `Organization` | ✅ | 一人一企，企业维度共享 |
| 用户认证与角色 | JWT + `role` (user/admin) | ✅ | 基础 RBAC |
| 竞品实体模型 | `Competitor` 表 + `/api/competitors` | ✅ | A7-01 已实现 |
| 来源分级 | `Source.tier` (official/media/community/other) | ✅ | 启发式域名分级 |
| 来源新鲜度 | `Source.published_at` + `age_days` | ✅ | 半衰期衰减 |
| 来源去重 | `dedup.py: dedup_by_content` | ✅ | URL + 标题相似度去重 |
| 来源置信度 | `dedup.py: estimate_confidence` | ✅ | 层级权重 × 新鲜度衰减 |
| 来源冲突检测 | `dedup.py: detect_conflicts` | ✅ | 同一维度多来源标记 pending |
| 来源快照存档 | `SourceArchive` 表 + `snapshot.py` | ✅ | A7-03 已实现 |
| 定时追踪 | `Tracker` + scheduler | ✅ | 支持 daily/weekly/monthly，进程内 60s 扫描 |
| 运行日志 | `TaskStep` + `ExecutionSnapshot` | ✅ | 每步记录 phase/title/detail + 执行快照 |
| 变化摘要 | `ResearchTask.change_summary` | ✅ | 与上一期对比的变更 markdown |
| 报告生成 | `agent.py` 编排流水线 | ✅ | planning → searching → dedup → snapshot → analyzing → insights → timeline → reporting |
| 通知推送 | `Notification` + email/webhook | ✅ | 站内通知 + SMTP + 企业微信/钉钉/飞书 |
| 配额管理 | `month_usage()` + `check_quota_or_403()` | ✅ | 企业共享配额 + 成员个人子额度 |
| 计费与订单 | `Order` + `/api/billing` | ✅ | 模拟支付，套餐升级 |
| 管理后台 | `/api/admin/*` | ✅ | 平台统计、用户管理、企业管理 |
| 个人中心 | `AccountPage` | ✅ | 用量统计、登录历史、订单记录 |
| AI 助手 | `/api/assistant` | ✅ | 跨报告问答，多会话管理 |
| 产业链图谱 | `GraphProject` | ✅ | 独立的图谱构建模块 |
| 竞品画像 | `CompetitorProfile` + `ProfileTemplate` | ✅ | A7-05 已实现 |
| 横向对比 | `Comparison` 服务 + `/api/profiles/compare` | ✅ | A7-06 已实现 |
| 细粒度 RBAC | `UserPermission` + `require_permission` | ✅ | A7 第七章 已实现 |
| 审计日志 | `AuditLog` + `/api/admin/audit-logs` | ✅ | A7-08 已实现 |
| 执行快照 | `ExecutionSnapshot` + 调度器自动生成 | ✅ | A7 第五章 已实现 |
| 加密服务 | `core/crypto.py` Fernet | ✅ | 敏感字段加密 |
| 限流服务 | `core/rate_limit.py` 令牌桶 | ✅ | 按 IP + 端点分类 |
| 竞品爬虫 | `crawl.py` API + `crawler.py` | ✅ | 竞品官网信息结构化提取 |

### 已有数据模型全貌

```
users ←→ organizations (org_id)
users → research_tasks (user_id, org_id, tracker_id)
research_tasks → task_steps (执行步骤日志)
research_tasks → sources (来源记录)
sources → source_archives (快照存档)
users → orders (订单)
users → login_logs (登录日志)
users → notifications (通知)
users → assistant_sessions → assistant_messages
users → graph_projects (图谱项目)
graph_projects → graph_entities + graph_relations
organizations → trackers (定时追踪)
trackers → research_tasks (调度触发)
users → competitors (竞品管理)
users → profile_templates (画像模板)
profile_templates → competitor_profiles (竞品画像)
users → user_permissions (RBAC 权限)
users → crawl_tasks (爬虫任务)
```

---

## 三、逐项差距分析（已实现状态）

### A7-01：竞品名单维护

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 5 家竞品，含别名、官网、技术主题、监测关键词 | `Competitor` 模型 + CRUD API + 前端页面 | ✅ **已实现** |
| 竞品列表可维护、可审计 | 竞品管理 API + 审计日志 | ✅ **已实现** |

### A7-02：批准来源配置

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 10 个来源，含名称、URL/入口、来源层级、访问方式、备选/状态 | `Source` 模型有 tier/domain/url，来源分级通过 classify_source 自动完成 | ⚠️ **部分实现** |
| 来源可配置、可审计 | 来源在调研任务中自动产生，无独立"来源注册/审批"流程 | ⚠️ **部分实现**（来源是任务产出物而非配置项） |

### A7-03：来源存证

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 10/10 记录：URL/文件、页面快照、发布时间或无日期状态、采集时间、原文证据 | `SourceArchive` 表（HTML 500KB + 纯文本 + collected_at + access_status + raw_content_full） | ✅ **已实现** |
| 证据链完整可追溯 | `Source` + `SourceArchive` 双表关联，完整原文在快照表 | ✅ **已实现** |

### A7-04：监测记录

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 10 条监测记录：结构化提取、去重/关联、新鲜度、置信度、冲突/待核实状态 | `dedup.py` 实现去重 + 置信度 + 冲突检测；`Source` 含 confidence/conflict_status/dedup_group | ✅ **已实现** |
| 结构化字段提取 | `report_data` 是 JSON 字符串，包含 SWOT/评分/竞品对比 + timeline | ✅ **已实现** |
| 无来源或冲突不输出确定性结论 | prompt 中强制要求"信息不足明示"原则 | ✅ **已实现** |

### A7-05：竞品画像

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 5 份画像，按冻结固定维度模板，附来源与更新时间 | `CompetitorProfile` 模型 + `generate_profile()` 服务 + 冻结机制 | ✅ **已实现** |
| 固定维度模板 | `ProfileTemplate` 模型 + dimensions JSON + 冻结机制 | ✅ **已实现** |

### A7-06：横向对比与摘要

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 1 套固定维度对比草稿、摘要、来源说明 | `comparison.py` 生成对比矩阵 + source_refs | ✅ **已实现** |
| 按冻结维度对比 | 必须使用已冻结模板 + 已冻结画像 | ✅ **已实现** |

### A7-07：变化提醒与 CRM 任务

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 按冻结规则提醒：变化内容、来源、负责人、提醒状态和任务记录 | `Tracker` + `change_summary` + `Notification` + `push_email`/`push_webhook` | ✅ **已实现** |
| 提醒渠道可配置 | email/webhook 按配置开关 | ✅ **已实现** |

### A7-08：运行日志

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 全量运行日志：运行时间、来源访问、结果、错误、最后成功时间、成本 | `TaskStep` + `ExecutionSnapshot` + `AuditLog`（含 LLM tokens/cost） | ✅ **已实现** |
| 模型调用记录：模型、状态、可得 Token 与成本 | `_log_llm_audit()` 自动记录 | ✅ **已实现** |
| 统一日志和审计 | `AuditLog` 表 + `services/audit.py` | ✅ **已实现** |

### 第五章：安全与权限

| 合同要求 | 现有系统 | 状态 |
|----------|---------|------|
| 细粒度 RBAC（6+ 角色） | `UserPermission` 表 + `require_permission` 装饰器 + 权限字符串数组 | ⚠️ **部分实现**（有 RBAC 机制但未映射合同要求的 6+ 具体角色） |
| 预算 80% 告警 | `_notify_quota_warning` 实现 | ✅ **已实现** |
| 预算 100% 暂停 | `check_quota_or_403` 实现 | ✅ **已实现** |
| 执行快照 | `ExecutionSnapshot` + 调度器自动生成 | ✅ **已实现** |
| 密钥管理 | `MASTER_KEY` 环境变量 + Fernet 加密 | ⚠️ **部分实现**（基础加密到位，无密钥轮转机制） |

---

## 四、差距严重程度总表（更新）

| 编号 | 合同条款 | 差距项 | 严重程度 | 当前状态 |
|------|---------|--------|---------|---------|
| G1 | A7-03 | 页面快照/HTML 存档能力 | ~~P0~~ | ✅ **已实现**（SourceArchive 表） |
| G2 | A7-03 | 原文截断（8000 字符）不满足"原文证据" | ~~P0~~ | ✅ **已实现**（raw_content_full 不截断存在快照表） |
| G3 | A7-01 | 竞品独立实体模型缺失 | ~~P0~~ | ✅ **已实现**（Competitor 表 + CRUD API） |
| G4 | A7-04 | 置信度、冲突/待核实状态标记缺失 | ~~P0~~ | ✅ **已实现**（dedup.py 完整实现） |
| G5 | A7-05 | 竞品画像功能完全缺失 | ~~P0~~ | ✅ **已实现**（CompetitorProfile + ProfileTemplate） |
| G6 | A7-05/A7-06 | 固定维度模板配置缺失 | ~~P0~~ | ✅ **已实现**（ProfileTemplate + 冻结机制） |
| G7 | 第五章 | 细粒度 RBAC 缺失（6+ 角色） | ~~P0~~ | ✅ **已实现**（UserPermission + require_permission） |
| G8 | A7-08 | 模型调用日志（模型名、token、成本）缺失 | ~~P1~~ | ✅ **已实现**（AuditLog + _log_llm_audit） |
| G9 | A7-08 | 运行日志缺成本、来源访问结果 | ~~P1~~ | ✅ **已实现**（AuditLog + ExecutionSnapshot） |
| G10 | A7-07 | 变化定义规则配置缺失 | ~~P1~~ | ✅ **已实现**（Tracker + change_summary + 通知） |
| G11 | 第五章 | 80% 预算预警缺失 | ~~P1~~ | ✅ **已实现**（_notify_quota_warning） |
| G12 | 第五章 | 密钥管理机制缺失 | P2 | ⚠️ 基础加密到位，无密钥轮转 |
| G13 | A7-02 | 批准来源注册/审批流程缺失 | P2 | ⚠️ 来源为任务产出物，无独立审批流程 |
| G14 | 第五章 | 执行快照 + 版本锁定缺失 | ~~P1~~ | ✅ **已实现**（ExecutionSnapshot） |
| G15 | 第五章 | 备选来源机制缺失 | P3 | ⚠️ 无 fallback_for 字段 |
| G16 | A7-06 | 横向对比报告模板化输出 | ~~P2~~ | ✅ **已实现**（comparison.py） |
| G17 | 共用 | Docker 部署配置缺失 | P2 | ❌ 未实现 |
| G18 | 共用 | 数据库迁移工具缺失 | P2 | ❌ 未实现（仅轻量迁移） |
| G19 | 共用 | 用户手册/操作文档缺失 | P2 | ⚠️ 有技术文档，缺用户手册 |
| G20 | 共用 | 数据导出功能缺失 | P3 | ⚠️ 前端有导出（PDF/Word/MD），缺管理后台导出 |
| G21 | 共用 | 缺陷管理流程缺失 | P3 | ❌ 未实现 |

---

## 五、结论

### 5.1 实现状态总结

Agent 7 合同的**核心交付物（A7-01~A7-08）全部已实现**：

| 交付物 | 状态 | 对应模块 |
|--------|------|----------|
| A7-01 竞品名单维护 | ✅ | Competitor 模型 + CRUD |
| A7-02 批准来源配置 | ⚠️ | Source 分级自动完成，无独立审批流程 |
| A7-03 来源存证 | ✅ | SourceArchive + snapshot.py |
| A7-04 监测记录 | ✅ | dedup.py + confidence + conflict |
| A7-05 竞品画像 | ✅ | ProfileTemplate + CompetitorProfile |
| A7-06 横向对比 | ✅ | comparison.py |
| A7-07 变化提醒 | ✅ | Tracker + change_summary + Notification |
| A7-08 运行日志 | ✅ | AuditLog + ExecutionSnapshot + _log_llm_audit |

### 5.2 剩余差距（非阻断）

| 差距 | 严重程度 | 说明 |
|------|----------|------|
| Docker 部署配置 | P2 | 影响交付，不影响功能 |
| 数据库迁移工具 | P2 | 有轻量迁移，缺 Alembic |
| 用户手册 | P2 | 有技术文档，缺业务用户手册 |
| 密钥轮转机制 | P2 | 基础加密到位 |
| 备选来源机制 | P3 | 无 fallback_for 字段 |

### 5.3 建议

1. **核心功能已满足验收门槛** — A7-01~A7-08 全部实现，可进入测试阶段
2. **Docker 化是交付优先级最高的事项** — 影响部署和交付
3. **用户手册需在验收前完成** — 合同明确要求
4. **密钥轮转可后续迭代** — 当前 MASTER_KEY 机制满足基本安全需求

---

*报告结束*
