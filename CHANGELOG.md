# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v6.0.0] - 2026-08-03

### Added
- **User-level rate limiting**: `core/rate_limit_user.py` complements IP-level rate limiting with per-user token bucket, preventing abuse in IP-sharing scenarios
- **Profile report service**: `services/profile_report.py` pre-generates profile reports and insights into `profile_data` cache during background extraction tasks; frontend reads cache first to avoid lazy-load failures
- **Profile report/insight API endpoints**: `GET /api/profiles/{id}/report`, `GET /api/profiles/{id}/insights`, and `GET /api/profiles/{id}/report-full` with cache-first strategy
- **Data seeding script**: `scripts/seed_data.py` for one-click test data seeding (users, orgs, competitors, profiles, research tasks, trackers, graphs, etc.)
- **Profile fix plan documentation**: `PROFILE_REPORT_FIX.md`, `PROFILE_REPORT_FIX_PLAN.md`, `PROFILE_REPORT_IMPLEMENTATION.md` — comprehensive plan for profile report quality improvements
- **StepFun migration guide**: `STEPFUN_MIGRATION.md` — zero-code-change migration to StepFun LLM provider
- **Code fix plan**: `FIX_PLAN.md` — P0-P3 bug fixes + security hardening (proactive token refresh, SSE reconnect, CORS env-driven, logout cleanup, etc.)

### Changed
- Profile detail page now reads pre-generated report and insights from `profile_data` cache, with lazy-load as fallback for older profiles
- `services/profile_extractor.py` appends report/insight pre-generation after profile creation in background tasks (non-blocking on LLM failure)
- `services/scheduler.py`: `initial_next_run()` uses UTC timezone; git hash cached at startup via `_load_git_hash()`
- `reset_code` column type corrected from VARCHAR(10) to VARCHAR(44) to accommodate Fernet-encrypted values

### Performance
- SSE long-polling eliminated O(n) offset cost — replaced with `seq > sent` index-friendly query
- Tracker list N+1 fixed — window function batch loads max 10 tasks per tracker in one query
- Account deletion batch cleanup — bulk SQL DELETE replaces per-row Python loop
- Git hash computed once at startup instead of per-snapshot subprocess call

## [v5.1.0] - 2026-08-02

### Added
- **Crawler language-aware sitemap parsing**: Detects language path prefixes (e.g., `/cn/`, `/en/`, `/ja/`) from the competitor's website URL, filters sitemap URLs to only the matching language, and adds the language prefix to heuristic path discovery
- **Multi-path sitemap discovery**: The crawler now tries `/{lang}/sitemap.xml` in addition to `/sitemap.xml` for multi-language sites
- **Privacy/consent overlay stripping**: Before readability extraction, the crawler strips common cookie/consent/privacy overlay HTML (OneTrust, CCPA, GDPR banners) using regex. If readability extracts less than 3000 chars and the content matches consent notice markers, it falls back to full body text extraction
- **Chrome User-Agent**: Changed from `CompAgent-Crawler/1.0` to a Chrome browser UA to reduce bot detection
- **Audit log DB-level trigger protection**: SQLite triggers prevent UPDATE/DELETE on `audit_logs` table (`backend/app/db/audit_triggers.py`)
- **Profile extractor startup recovery**: `recover_stale_tasks()` restores interrupted profile extraction tasks after process restart
- **SSE single-session with seq-based queries**: `research_events` endpoint reuses a single DB session and uses `seq > sent` instead of `offset(sent)` to avoid O(n) pagination cost
- **List pagination**: `GET /api/research`, `GET /api/trackers`, and `GET /api/trackers/{id}/runs` now support `page`/`page_size` query parameters (default 20)
- **Tracker batch extras loading**: `_with_extras_batch()` uses window function (row_number) to load at most 10 recent tasks per tracker in a single query, replacing N+1 per-tracker queries
- **Git hash caching**: `_load_git_hash()` reads git HEAD once at startup and caches it in `_GIT_HASH`, replacing per-call subprocess invocation in `_snapshot_execution`

### Changed
- `backend/app/services/crawler.py`: Core crawler engine rewritten with multi-language site support and consent overlay removal
- `backend/app/main.py`: Lifespan now creates audit log triggers and recovers stale profile extract tasks on startup; production security warnings for weak JWT_SECRET
- `backend/app/api/research.py`: SSE endpoint reuses single DB session with seq-based incremental queries; list endpoint paginated
- `backend/app/api/trackers.py`: `_with_extras_batch()` with window function for efficient batch loading; list and runs endpoints paginated
- `backend/app/api/auth.py`: Account deletion uses bulk `delete(synchronize_session=False)` instead of Python loop
- `backend/app/services/scheduler.py`: `initial_next_run()` uses UTC timezone; git hash cached at startup via `_load_git_hash()`
- `reset_code` column type corrected from VARCHAR(10) to VARCHAR(44) to accommodate Fernet-encrypted values

### Performance
- SSE long-polling eliminated O(n) offset cost — replaced with `seq > sent` index-friendly query
- Tracker list N+1 fixed — window function batch loads max 10 tasks per tracker in one query
- Account deletion batch cleanup — bulk SQL DELETE replaces per-row Python loop
- Git hash computed once at startup instead of per-snapshot subprocess call

## [v5.0.0] - 2026-08-02

### Added
- **Agent 7 竞品技术监测**完整实现（竞品实体、来源存证、画像系统、横向对比、审计日志、执行快照）
- 竞品管理模块：结构化竞品 CRUD + 企业/系统级隔离 + API 爬虫 (`crawl.py`)
- 来源去重/置信度/冲突检测：`services/dedup.py`（URL 去重 + 标题相似度 + 置信度估算）
- 页面快照存档：`services/snapshot.py` + `SourceArchive` 表（HTML 快照 + 纯文本提取 + 采集元数据）
- 竞品画像系统：模板管理 → 基于来源生成画像 → 冻结锁定（`services/profiles.py` + `services/profile_extractor.py`）
- 画像横向对比：`services/comparison.py` + `/api/profiles/compare` 端点
- RBAC 细粒度权限：`UserPermission` 表 + `require_permission` 装饰器 + 60s 内存缓存
- 审计日志：`AuditLog` 表 + `services/audit.py` + LLM 调用自动埋点
- 执行快照：`ExecutionSnapshot` 表 + 调度器自动生成（config_hash + build_hash + git HEAD）
- 加密服务：`core/crypto.py` Fernet 对称加密（AES-128-CBC + HMAC）
- 限流服务：`core/rate_limit.py` 令牌桶限流（按 IP + 端点分类）
- 增强安全：JWT + Refresh Token（Access 8h / Refresh 30d）、会话版本控制、限流、Fernet 加密
- 额度预警：80% 阈值自动推送站内通知（月内不重复）
- 忘记密码：邮箱验证码（Fernet 加密存储）+ 重置流程
- 退出所有设备：`token_version + 1` 使旧 token 全部失效
- 注销账号：密码确认 + 级联删除全部关联数据
- 前端新增：`AuditLogsPage`（审计日志独立页面）、`ProfileDetailPage`、`ConfirmDialog`、`Skeleton`、`useErrorHandler`、`usePageTitle`、`ProfileGenProgress`、`cn.ts` 工具
- 一键启动脚本：`start.bat`（Windows）+ `start.ps1`（PowerShell）
- SMTP 测试工具：`backend/_smtp_test.py`

### Changed
- 后端新增 `crawl.py` API（竞品官网信息爬取 + 结构化提取）
- `services/llm.py` 增加 LLM 调用审计埋点（model_name / tokens / cost）
- `services/scheduler.py` 增加执行快照生成 + 配额不足跳过策略优化
- `services/agent.py` 流水线增强：去重 → 置信度 → 冲突检测 → 快照存档 → 洞察 → 时间线 → 报告
- `db/models.py` 扩展至 23 张表（新增 competitors、profile_templates、competitor_profiles、user_permissions、audit_logs、execution_snapshots、service_keys、source_archives）
- `frontend/src/App.tsx` 路由扩展至 18 个页面（新增 audit-logs、compare、profile-detail）
- 前端组件扩展至 32 个组件
- `docs/` 技术文档体系建立（7 篇文档，01-06 + agent7 分析/计划）

### Fixed
- Admin Users 列表序列化 Bug（`AdminListOut` 泛型参数不生效）
- ProfileTemplate/CompetitorProfile 序列化失败（JSON 字段缺少 validator）
- `run_research` UnboundLocalError（task 变量引用顺序）
- BackgroundTasks 无法执行 async 函数（线程内事件循环包装）
- LLM 审计日志 user_id/org_id 为空
- SSE 断连后永久停止订阅
- 引用编号排序后错位
- 额度 API 静默失败无提示
- **爬虫零页问题**：多语言站点（如 `insta360.com/cn`）因缺少语言前缀感知、隐私 consent overlay 干扰正文提取，导致爬取结果 0 页。修复：语言前缀自动检测 + Sitemap 语言过滤 + 启发式路径适配语言前缀 + 隐私弹层 DOM 移除 + readability 提取质量回退检测

## [v4.0.0] - 2026-08-01

### Added
- One-click launch scripts: `start.bat` (Windows) and `start.ps1` (PowerShell) to start backend + frontend together
- `backend/_smtp_test.py` — standalone utility to verify SMTP connectivity and credentials
- CHANGELOG.md for version tracking

### Changed
- **SMTP config security hardening**: `backend/app/core/config.py` no longer contains hardcoded Outlook credentials; defaults are now empty strings, requiring SMTP settings to be provided via environment variables. When credentials are empty, the system falls back to demo mode (email logs to `email_logs` table without actual sending)

### Fixed
- Security risk of committing live SMTP credentials to version control

---

## [v3.0.0] - 2026-07-31

### Added
- Complete v3 rewrite: multi-session AI assistant with conversation management
- Graph module for competitive landscape visualization
- Organization management (multi-org support)
- Trackers module for monitoring competitor changes over time
- Email notification system (SMTP, attachments, manual send)
- JWT-based authentication with session versioning
- Dual-language README (Chinese / English)
