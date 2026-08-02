# Agent 7 竞品技术监测 — 子任务分解计划（修订版）

> 基于合同要求 + 现有架构逐行审查后的实施方案
> 编制日期：2026-08-01
> **更新说明**（2026-08-02）：基于 agent-v5 实际代码更新，标注各任务完成状态

---

## 实施状态总览

| 批次 | 任务 | 状态 | 完成度 |
|------|------|------|--------|
| **P0** | 竞品实体 + 来源存证 + 置信度 + 画像 + 对比 + RBAC | ✅ 已完成 | 100% |
| **P1** | 审计日志 + 预算预警 + 快照 + 变化规则 | ✅ 已完成 | 100% |
| **P1.5** | 爬虫可靠性修复（语言感知 + consent 剥离 + 命名空间匹配） | ✅ 已完成 | 100% |
| **P2** | Docker + 文档 + 备选来源 + 导出 | 🔲 待完成 | 0% |

---

## 架构对齐确认

在制定计划前，逐项确认了现有代码的核心模式，确保新代码无缝融入：

| 模式 | 现有实现 | 新代码遵循方式 |
|------|---------|---------------|
| 模型定义 | `_uuid()` PK + `_now()` 默认 + `String(32)` + `mapped_column` | 完全沿用 |
| 关系模式 | `back_populates` + `cascade="all, delete-orphan"` | 完全沿用 |
| 后台任务 DB | `with SessionLocal() as db:` 短生命周期会话 | 完全沿用 |
| 错误处理 | 非阻断步骤用 try/except + `logger.exception` | 完全沿用 |
| LLM 调用 | `llm.chat(system, user)` / `llm.chat_json(system, user)` | 完全沿用 |
| 通知推送 | `with SessionLocal() as db:` → 构造 Notification → commit | 完全沿用 |
| 迁移方式 | `migrate_columns()` 中 SQLite `ALTER TABLE ADD COLUMN` | 完全沿用 |
| 前端数据流 | `useEffect(() => api().then(setState), [])` + try/catch | 完全沿用 |
| 前端路由 | `App.tsx` 中 `<Route path="xxx" element={<Page />} />` | 完全沿用 |

---

## 第一批：P0 — 阻断阶段 2B 验收的核心能力 ✅ 已完成

### Task 1：竞品实体模型 ✅

**对应合同**：A7-01 竞品名单维护

**实现状态**：`backend/app/db/models.py` + `backend/app/api/competitors.py` + `frontend/src/pages/app/CompetitorsPage.tsx`

- ORM 模型：`Competitor` 表（id/org_id/name/alias/website/tech_focus/keywords/status/created_at/updated_at）
- API：GET/POST/PATCH/DELETE `/api/competitors`
- 前端：卡片式 CRUD 页面
- 企业级隔离 + 系统级模板（空 org_id）

**验收状态**：✅ 5 家竞品 CRUD 测试通过，别名/官网/技术主题/关键词可结构化存储和修改

---

### Task 2：Source 模型改造 + 页面快照服务 ✅

**对应合同**：A7-03 来源存证

**实现状态**：`backend/app/db/models.py` + `backend/app/services/snapshot.py` + `backend/app/api/research.py`

- Source 新增字段：confidence/conflict_status/conflict_note/is_duplicate/dedup_group/access_status/access_error/collected_at
- SourceArchive 表：snapshot_html（500KB）+ snapshot_text + snapshot_format + published_at + collected_at + access_status + access_error + raw_content_full
- `snapshot.py`：httpx 获取 HTML（15s 超时）+ BeautifulSoup 纯文本提取
- API：`GET /api/research/{id}/sources/{sid}/archive`

**验收状态**：✅ 每次调研完成后所有来源有 SourceArchive 记录；来源详情页可查看快照状态

---

### Task 3：去重、冲突检测与置信度服务 ✅

**对应合同**：A7-04 结构化处理、零容忍

**实现状态**：`backend/app/services/dedup.py`

- `dedup_by_content()`：URL 精确去重 + 标题相似度去重（SequenceMatcher > 0.85）
- `estimate_confidence()`：层级权重 × 新鲜度衰减
- `detect_conflicts()`：同一维度多 URL → pending
- 接入 `agent.py` 的 `_search_all()`

**验收状态**：✅ 调研结果自动去重；所有来源有置信度标记；冲突来源有视觉标识

---

### Task 4：画像模板系统 ✅

**对应合同**：A7-05 竞品画像、固定维度模板

**实现状态**：`backend/app/db/models.py` + `backend/app/schemas/profiles.py` + `backend/app/api/profiles.py` + `backend/app/services/profiles.py` + `frontend/src/pages/app/ProfileTemplatesPage.tsx`

- `ProfileTemplate` 表：dimensions JSON + version + frozen_at
- `CompetitorProfile` 表：profile_data + source_refs + status(draft/reviewed/frozen) + frozen_at
- API：模板 CRUD + freeze + 画像生成 + 列表 + 冻结
- 前端：JSON 编辑器 + 冻结按钮 + 禁用编辑

**验收状态**：✅ 能创建含多维度模板并冻结；按模板生成竞品画像；冻结后不可修改

---

### Task 5：横向对比报告 ✅

**对应合同**：A7-06 横向对比与摘要

**实现状态**：`backend/app/services/comparison.py` + `backend/app/api/profiles.py` + `frontend/src/pages/app/ComparisonPage.tsx`

- 服务：`generate_comparison()` — 基于多份冻结画像生成对比矩阵
- API：`POST /api/profiles/compare`
- 前端：模板选择 + 竞品多选 + 矩阵表格

**验收状态**：✅ 选择 ≥2 个已冻结画像生成对比矩阵

---

### Task 6：细粒度 RBAC ✅

**对应合同**：A7 第五章 安全门槛

**实现状态**：`backend/app/db/models.py` + `backend/app/api/deps.py` + `backend/app/api/permissions.py` + `frontend/src/components/OrgPanel.tsx`

- `UserPermission` 表：permissions JSON 数组
- `require_permission()` 装饰器：检查用户权限
- 内存缓存 60s TTL + `invalidate_perm_cache()`
- admin 自动拥有 `*` 全权限
- API：`GET /api/me/permissions` + `POST /api/org/members/{id}/permissions`

**验收状态**：✅ admin 拥有全部权限；普通用户只有基础权限；权限不足时 API 返回 403

---

## 第二批：P1 — 安全、审计与流程保障 ✅ 已完成

### Task 7：审计日志 ✅

**对应合同**：A7-08 运行日志 + 第五章 统一日志

**实现状态**：`backend/app/db/models.py` + `backend/app/services/audit.py` + `backend/app/api/admin.py` + `frontend/src/pages/app/AuditLogsPage.tsx`

- `AuditLog` 表：21 个字段（user_id/org_id/action/resource_type/resource_id/input/result/status/error/model_name/tokens_prompt/tokens_completion/cost/ip/user_agent/created_at）
- `log_audit()` 写入函数
- `_log_llm_audit()` LLM 调用自动埋点
- API：`GET /api/admin/audit-logs`（分页 + 5 种筛选）
- 前端：`AuditLogsPage.tsx` 独立页面（完整筛选器 + 分页表格）

**验收状态**：✅ LLM 调用记录 token 和费用；操作日志可按条件筛选；前端独立页面可用

---

### Task 8：预算预警 + 执行快照 ✅

**对应合同**：A7 第五章 安全与成本控制

**实现状态**：`backend/app/api/deps.py` + `backend/app/db/models.py` + `backend/app/services/scheduler.py`

- 预算预警：`_notify_quota_warning()` — 80% 阈值推送通知（月内不重复）
- 执行快照：`ExecutionSnapshot` 表 + `_snapshot_execution()` — config_hash + model_params + build_hash(git HEAD)
- 调度器每次触发时自动生成

**验收状态**：✅ 额度达 80% 时推送预警通知；每次调研生成执行快照

---

### Task 8：爬虫可靠性修复 ✅

**对应合同**：爬虫多语言站点支持 + 数据质量保障

**实现状态**：`backend/app/services/crawler.py`

- **语言前缀检测**：`discover_urls()` 从 base URL 提取语言路径（/cn/, /en/, /ja/ 等），用于 sitemap URL 过滤和启发式路径拼接
- **多路径 sitemap 发现**：`_fetch_sitemap_urls()` 优先尝试 `/{lang}/sitemap.xml`，回退 `/sitemap.xml`
- **XML 命名空间容错**：使用 `{*}loc` 通配符匹配带命名空间的 sitemap XML（之前 `loc.tag.lower() == "loc"` 永远不匹配）
- **Consent overlay 移除**：`_fetch_single()` 中用 regex 剥离 OneTrust/CCPA/GDPR/cookie banner 的 `<div>`
- **Readability 降级**：若提取内容 < 3000 chars 且匹配 consent 标记词，回退到 BeautifulSoup 完整 body 文本
- **Chrome User-Agent**：从 `CompAgent-Crawler/1.0` 改为 Chrome 浏览器 UA

**效果**：Insta360 等多语言站点从 0 爬取页到正常获取数百页。

---

## 第三批：P2 — 交付运维层 🔲 待完成

### Task 9：容器化与文档

| 项 | 状态 | 说明 |
|----|------|------|
| Dockerfile | 🔲 | 未实现 |
| docker-compose.yml | 🔲 | 未实现 |
| 部署文档 | 🔲 | 未实现 |
| 备份/恢复文档 | 🔲 | 未实现 |
| 用户手册 | 🔲 | 有技术文档，缺业务用户手册 |

### Task 10：数据导出

| 项 | 状态 | 说明 |
|----|------|------|
| 前端导出 (PDF/Word/MD) | ✅ | `exportReport.tsx` 已实现 |
| 管理后台导出 CSV | 🔲 | 未实现 |
| 数据导出字段说明 | 🔲 | 未实现 |

---

## 验收对照表

| 合同交付物 | 对应 Task | 验收标准 | 状态 |
|-----------|----------|---------|------|
| A7-01 竞品名单维护 | Task 1 | 5 家竞品 CRUD，含别名/官网/关键词 | ✅ 通过 |
| A7-02 批准来源配置 | Task 2 | 来源分级自动完成，无独立审批流程 | ⚠️ 部分（来源为任务产出物） |
| A7-03 来源存证 | Task 2 + Task 3 | 10/10 条快照，含 URL/快照/采集时间/原文 | ✅ 通过 |
| A7-04 监测记录 | Task 3 + agent | 结构化提取 ≥9/10，含置信度/冲突标记 | ✅ 通过 |
| A7-05 竞品画像 | Task 4 | 5/5 份画像，按模板维度，附来源 | ✅ 通过 |
| A7-06 横向对比 | Task 5 | 固定维度对比表 + 摘要 | ✅ 通过 |
| A7-07 变化提醒 | Task 3 + Tracker 改造 | 变化检测 + 通知推送 | ✅ 通过 |
| A7-08 运行日志 | Task 7 | 全量操作日志 + LLM 调用记录 | ✅ 通过 |
| 共用平台交付 | Task 9 | Docker + 文档 + 导出 | 🔲 待完成 |
