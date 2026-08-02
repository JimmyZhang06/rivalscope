# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v5.1.0] - 2026-08-02

### Added
- **Crawler language-aware sitemap parsing**: Detects language path prefixes (e.g., `/cn/`, `/en/`, `/ja/`) from the competitor's website URL, filters sitemap URLs to only the matching language, and adds the language prefix to heuristic path discovery
- **Multi-path sitemap discovery**: The crawler now tries `/{lang}/sitemap.xml` in addition to `/sitemap.xml` for multi-language sites
- **Privacy/consent overlay stripping**: Before readability extraction, the crawler strips common cookie/consent/privacy overlay HTML (OneTrust, CCPA, GDPR banners) using regex. If readability extracts less than 3000 chars and the content matches consent notice markers, it falls back to full body text extraction
- **Chrome User-Agent**: Changed from `CompAgent-Crawler/1.0` to a Chrome browser UA to reduce bot detection

### Changed
- `backend/app/services/crawler.py`: Core crawler engine rewritten with multi-language site support and consent overlay removal

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
