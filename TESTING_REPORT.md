# 竞品调研 Agent — 功能测试与可用性评估报告

> **版本**: v6.0.0 | **日期**: 2026-08-03 | **分支**: agent-v6
> **更新说明**：基于 agent-v6 实际代码更新，反映 Agent 7 全面实现 + 爬虫 v5.1 修复后的状态

---

## 目录

1. [项目架构概览](#1-项目架构概览)
2. [模块间数据流与关联关系](#2-模块间数据流与关联关系)
3. [功能可用性测试矩阵](#3-功能可用性测试矩阵)
4. [集成测试场景](#4-集成测试场景)
5. [用户可用性评估](#5-用户可用性评估)
6. [潜在问题与改进建议](#6-潜在问题与改进建议)
7. [测试执行优先级](#7-测试执行优先级)

---

## 1. 项目架构概览

### 1.1 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + SQLAlchemy 2.0 + SQLite（WAL 模式） |
| 前端 | React 18 + TypeScript + React Router 6 + Tailwind CSS v4 |
| AI/搜索 | OpenAI 兼容 API (LLM) + Tavily (搜索) |
| 邮件 | Python smtplib (SSL/STARTTLS) |
| 调度 | asyncio 60s 轮询（进程内线程） |
| 安全 | JWT + Refresh Token + Fernet 加密 + 令牌桶限流 |
| 审计 | AuditLog + ExecutionSnapshot + LLM 自动埋点 + DB 级触发器防篡改 |

### 1.2 核心模块

| 模块 | 后端路由 | 前端页面 | 数据模型 |
|---|---|---|---|
| **A. 竞品调研管道** | `POST /api/research` | `TaskDetailPage` | ResearchTask, TaskStep, Source, SourceArchive |
| **B. 定时追踪** | `TrackersPage/TrackerDetailPage` | Tracker, Notification | |
| **C. 产业链图谱** | `GraphPage/GraphDetailPage` | GraphProject, GraphEntity, GraphRelation | |
| **D. 报告问答与AI助手** | `AssistantPage` | AssistantSession, AssistantMessage | |
| **E. 组织管理** | `AccountPage (org tab)` | Organization, User, UserPermission | |
| **F. 计费与套餐** | `PricingPage` | Order | |
| **G. 竞品管理** | `CompetitorsPage` | Competitor | |
| **H. 画像系统** | `ProfilesPage, ProfileTemplatesPage, ComparisonPage, ProfileDetailPage` | ProfileTemplate, CompetitorProfile | |
| **I. 安全与审计** | `AdminPage, AuditLogsPage` | AuditLog, LoginLog, UserPermission, ExecutionSnapshot | |
| **J. 通知系统** | NotificationBell | Notification, EmailLog | |
| **K. 竞品爬虫** | `CrawlPage (via CompetitorsPage)` | CrawlTask | |

---

## 2. 模块间数据流与关联关系

### 2.1 核心数据流图

```
┌─────────────┐     创建任务       ┌──────────────────┐
│  用户操作    │ ──────────────►  │  调研管道 (A)     │
│  (前端页面)  │                  │  _plan → _search  │
└─────────────┘                  │  → dedup/conf     │
         │                       │  → snapshot       │
         │                       │  → _analyze       │
         │                       │  → _insights      │
         │                       │  → _timeline      │
         │                       │  → _report        │
         │                       └────────┬─────────┘
         │                                │
         │    ┌───────────────────────────┼───────────────────────────┐
         │    │                           │                           │
         ▼    ▼                           ▼                           ▼
  ┌─────────────┐                ┌──────────────┐           ┌──────────────┐
  │ 定时追踪 (B) │                │ 通知系统     │           │ AI 助手 (D)  │
  │ scheduler    │                │ (站内+邮件+  │           │ 读取报告+来源 │
  │ 60s轮询      │                │ webhook)     │           │ 跨报告问答    │
  └──────┬──────┘                └──────────────┘           └──────────────┘
         │
         │   触发调研
         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                   变更摘要 (digest.py)                          │
  │  对比本期 vs 上期报告 → 4 段摘要 → 写入 task.change_summary    │
  └─────────────────────────────────────────────────────────────────┘
         │
         │ 使用报告
         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  画像系统 (H)                                                   │
  │  读取 completed 任务 → Sources → LLM 生成画像 → 模板冻结 → 横向对比 │
  └─────────────────────────────────────────────────────────────────┘
         │
         │ 使用来源
         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  来源存证 (快照)                                                  │
  │  SourceArchive：HTML + 纯文本 + 采集元数据 + access_status       │
  └─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键关联关系

| 关联 | 触发条件 | 涉及模块 | 数据路径 |
|---|---|---|---|
| **调研 → 通知** | 任务完成 | A → 通知 | 一次性任务发邮件给创建人；追踪任务三渠道推送 |
| **追踪 → 变更摘要** | 追踪任务完成 | B → digest | 对比 task_id 关联的上一期 completed 任务 |
| **追踪 → 调研** | 调度器触发 | B → A | scheduler 创建 ResearchTask → run_research |
| **调研 → 画像** | 手动生成画像 | A → H | 读取 completed 任务的 Source → LLM 填充模板 |
| **画像 → 对比** | 手动对比 | H | ≥2 个 frozen profile → 矩阵报告 |
| **图谱 → 来源** | 图谱构建 | C → A | graph_agent 使用 SearchClient 检索 |
| **用户 → 配额** | 所有消耗操作 | F ↔ 所有 | 双门控: 企业套餐 + 成员个人限额 |
| **AI 助手 → 报告** | 跨报告问答 | D → A | 选择相关报告 + 来源 → 多轮对话 |
| **组织 → 共享资源** | 成员操作 | E → A/B/C/H/G | org_id 隔离: tasks/trackers/graphs/competitors |
| **RBAC → 权限** | 所有 API | I → 所有 | require_permission 装饰器 + 60s 缓存 |
| **爬虫 → 竞品** | 获取竞品信息 | K → G | crawl.py → 结构化提取竞品官网信息 |
| **审计 → 全部** | 关键操作 | I → 所有 | log_audit() + _log_llm_audit() |

---

## 3. 功能可用性测试矩阵

### 3.1 模块 A：竞品调研管道

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| A-1: 创建调研任务 (免费用户, 3次/月) | POST `/api/research` | 201 Created + quota decremented | ✅ 已验证 | 低 |
| A-2: 创建调研任务 (超额拦截) | 超过月度额度后创建 | 403 "额度已用完" | ✅ 已验证 | 低 |
| A-3: 5阶段执行流程 | 创建任务 → SSE 监听 | 状态流: pending→planning→searching→analyzing→reporting→completed | ✅ 管道正常 | 中 |
| A-4: 搜索去重 | 同一 URL 出现多次 | 仅保留一条 Source | ✅ dedup.py 已实现 | 低 |
| A-5: 来源分级 | 检查不同域名 | 正确标记 official/media/community/other | ✅ 已验证 | 低 |
| A-6: 冲突检测 | 同一维度来源矛盾 | conflict_status 标记为 pending | ✅ 已验证 | 低 |
| A-7: 报告生成 | 任务完成后 | report_markdown 非空 + report_data 含 insights + timeline | ✅ 已验证 | 低 |
| A-8: 报告问答 (不占额度) | POST `/api/research/{id}/ask` | 返回答案, quota 不变 | ✅ 已验证 | 低 |
| A-9: 邮件发送报告 | POST `/api/research/{id}/email` | 附件上传 → SMTP 发送/演示模式落库 | ✅ 已验证 | 低 |
| A-10: 配额不足时的降级 | 关闭 LLM/Tavily API | 任务标记 failed, 不 crash | ✅ 已验证 | 低 |
| A-11: 调研失败不影响报告 | 洞察阶段 LLM 异常 | 报告仍生成, 仅无 insights | ✅ 已验证 | 低 |
| A-12: 时间范围过滤 | 设置 time_range=day/week/month/year | Tavily 搜索使用对应时间参数 | ✅ 已验证 | 低 |
| A-13: 竞品清单 LLM 生成 | 不指定竞品 | LLM 自动确定竞品 | ✅ 已验证 | 低 |
| A-14: SSE 断线重连 | 关闭 SSE 再打开 | 前端轮询获取最新状态 | ✅ 已修复（单 session 复用 + seq 增量查询） | 低 |
| A-15: 批量账号注销 | 用户 500+ tasks 时注销 | 秒级完成 | ✅ 已修复（批量 SQL DELETE） | 低 |
| A-16: reset_code 加密长度 | 检查列类型 | VARCHAR(44) 容纳 Fernet 44 字符 | ✅ 已修复 | 低 |
| A-15: 来源置信度 | 检查 Source.confidence | 0~1 范围，基于层级权重×新鲜度衰减 | ✅ 已验证 | 低 |
| A-16: 来源快照存档 | 检查 SourceArchive | 每条来源有对应快照记录 | ✅ 已验证 | 低 |

### 3.2 模块 B：定时追踪

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| B-1: 创建追踪项 | POST `/api/trackers` | next_run_at 正确计算 | ✅ 已验证 | 低 |
| B-2: 调度器触发 | 等待 next_run_at | 自动创建 ResearchTask + 执行 | ✅ 已验证 | 低 |
| B-3: 变更摘要 | 两期追踪完成 | change_summary 含 4 个标准章节 | ✅ 已验证 | 低 |
| B-4: 首期基线 | 第一期追踪 | change_summary = "基线报告" | ✅ 已验证 | 低 |
| B-5: 额度不足跳过 | 企业额度用完 | 跳过本期, 顺延 next_run_at, 通知创建人 | ✅ 已验证 | 低 |
| B-6: 手动触发 | POST `/api/trackers/{id}/run-now` | 立即执行一次 | ✅ 已验证 | 低 |
| B-7: 三重推送 | 追踪完成 | 站内通知 + 邮件 + webhook (按配置) | ✅ 已验证 | 低 |
| B-8: 频率切换 | daily/weekly/monthly | advance_next_run 正确推算 | ✅ 已验证 | 低 |
| B-9: 防重入 | 连续到期 | _running set 防止并发 | ✅ 已验证 | 低 |
| B-10: 禁用追踪 | PATCH enabled=false | 不再触发 | ✅ 已验证 | 低 |
| B-11: 执行快照 | 调度器触发 | 生成 ExecutionSnapshot | ✅ 已验证 | 低 |

### 3.3 模块 C：产业链图谱

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| C-1: 图谱构建 | POST `/api/graph` | 生成实体 + 关系 + 报告 | ✅ 已验证 | 低 |
| C-2: 7种关系类型 | 检查 GraphRelation | 上游/下游/竞争/合作/投资/供应/隶属 | ✅ 已验证 | 低 |
| C-3: 4种实体类型 | 检查 GraphEntity | company/product/org/person | ✅ 已验证 | 低 |
| C-4: 刷新图谱 | POST `/api/graph/{id}/refresh` | 重建全部 | ✅ 已验证 | 低 |
| C-5: 图谱报告 | 构建完成后 | report_markdown 含分析 | ✅ 已验证 | 低 |

### 3.4 模块 D：报告问答与 AI 助手

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| D-1: 报告内问答 | POST `/api/research/{id}/ask` | 基于报告 + 来源回答 | ✅ 已验证 | 低 |
| D-2: AI 助手会话管理 | 创建/重命名/删除会话 | CRUD 正常 | ✅ 已验证 | 低 |
| D-3: 跨报告问答 | 助手提问 | 选择相关报告 → 多轮对话 | ✅ 已验证 | 低 |
| D-4: 助手消息引用 | 回答含报告引用 | refs 字段正确关联报告 | ✅ 已验证 | 低 |
| D-5: 历史对话迁移 | 首次访问助手 | 旧消息归入"历史对话" | ✅ 已验证 | 低 |

### 3.5 模块 E：组织管理

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| E-1: 创建组织 | POST `/api/org` | 返回 invite_code | ✅ 已验证 | 低 |
| E-2: 加入组织 | POST `/api/org/join` | 用户 org_id 更新 | ✅ 已验证 | 低 |
| E-3: 角色变更 | owner/admin/member | 权限正确隔离 | ✅ 已验证 | 低 |
| E-4: 管理员不能修改 owner | admin 尝试修改 owner | 403 拒绝 | ✅ 已验证 | 低 |
| E-5: 共享配额 | 多个成员 | 共享企业月度额度 | ✅ 已验证 | 低 |
| E-6: 成员个人限额 | admin 设置 member_limit | 个人额度独立校验 | ✅ 已验证 | 低 |
| E-7: 离开组织 | POST `/api/org/leave` | org_id 清空, 资源保留 | ✅ 已验证 | 低 |
| E-8: 重置邀请码 | POST `/api/org/invite-code/reset` | 新码生成 | ✅ 已验证 | 低 |
| E-9: RBAC 权限设置 | POST `/api/org/members/{id}/permissions` | 权限数组更新 | ✅ 已验证 | 低 |
| E-10: 权限缓存失效 | 修改权限后 | 60s 内生效 | ✅ 已验证 | 低 |

### 3.6 模块 F：计费与套餐

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| F-1: 套餐升级 | POST `/api/billing/upgrade` | plan 更新 + 30 天有效期 | ✅ 已验证 | 低 |
| F-2: 续费延长 | 同套餐再次升级 | 有效期延长 | ✅ 已验证 | 低 |
| F-3: 过期降级 | plan_expires_at 过期 | 自动退回 free | ✅ 已验证 | 低 |
| F-4: 企业版无限额度 | enterprise 用户 | UNLIMITED 配额 | ✅ 已验证 | 低 |
| F-5: 双门控配额 | 企业 member_limit | 先查企业额度, 再查个人限额 | ✅ 已验证 | 低 |
| F-6: 额度预警 | 使用 ≥80% | 推送通知 | ✅ 已验证 | 低 |
| F-7: 80% 不重复通知 | 每月只推送一次 | 同一用户本月不再推送 | ✅ 已验证 | 低 |

### 3.7 模块 G：竞品管理

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| G-1: 竞品 CRUD | CRUD 操作 | 增删改查正常 | ✅ 已验证 | 低 |
| G-2: 组织隔离 | 不同 org 用户 | 仅看到本组织竞品 | ✅ 已验证 | 低 |
| G-3: 系统级竞品 | admin 视角 | 可见系统级模板竞品 | ✅ 已验证 | 低 |
| G-4: 爬虫（多语言站点） | POST `/api/crawl/{cid}/crawl` 使用多语言 URL | 结构化提取官网信息 | ✅ 已验证 | 低 |

### 3.7.1 爬虫多语言修复测试（v5.1）

| 测试项 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|
| 语言前缀检测 | URL 含 `/cn/` 时自动提取 `cn` 作为语言前缀 | ✅ PASS | 低 |
| Sitemap 语言过滤 | Sitemap 中的 `/en/` URL 被过滤，仅保留 `/cn/` URL | ✅ PASS | 低 |
| 启发式路径带前缀 | `/pricing` 变为 `/cn/pricing`，不返回 404 | ✅ PASS | 低 |
| Consent overlay 移除 | OneTrust/CCPA/GDPR 弹层 DOM 被正则移除 | ✅ PASS | 低 |
| Readability 质量回退 | 提取 < 3000 字符且匹配 consent 标记时回退 body 文本 | ✅ PASS | 低 |
| 实例验证（insta360.com/cn） | 从 1377 字符（英文弹层）提升到 ~4648 字符（中文产品内容） | ✅ PASS | 低 |

### 3.8 模块 H：画像系统

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| H-1: 模板创建 | POST `/api/profiles/templates` | 自定义维度模板 | ✅ 已验证 | 低 |
| H-2: 模板冻结 | POST `/api/profiles/templates/{id}/freeze` | 冻结后不可修改 | ✅ 已验证 | 低 |
| H-3: 画像生成 | POST `/api/profiles/generate` | 基于 completed 任务 + 来源 | ✅ 已验证 | 低 |
| H-4: 画像冻结 | POST `/api/profiles/{id}/freeze` | draft → frozen | ✅ 已验证 | 低 |
| H-5: 横向对比 | POST `/api/profiles/compare` | ≥2 个 frozen profile → 矩阵 | ✅ 已验证 | 低 |
| H-6: 版本化 | 修改模板 | 创建新版本, 旧版本保留 | ✅ 已验证 | 低 |

### 3.9 模块 I：安全与审计

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| I-1: JWT 认证 | 无 token 访问 | 401 | ✅ 已验证 | 低 |
| I-2: Token 版本控制 | 改密码 / 登出全部 | 旧 token 失效 | ✅ 已验证 | 低 |
| I-3: 密码加密 | 数据库查询 | password_hash 不可逆 | ✅ 已验证 | 低 |
| I-4: 密码重置 | 忘记密码流程 | 6 位 code → 重置 | ✅ 已验证 | 低 |
| I-5: 登录日志 | 每次登录 | 记录 IP + UA | ✅ 已验证 | 低 |
| I-6: 账号删除 | DELETE `/api/auth/account` | 级联删除关联数据 | ✅ 已验证 | 低 |
| I-7: 审计日志 | LLM 调用 + 关键操作 | 记录 tokens/cost/model/IP + DB 级防篡改 | ✅ 已验证 | 低 |
| I-9: 审计日志防篡改 | 尝试修改 audit_logs | 数据库 abort 操作 | ✅ 已验证（触发器） | 低 |
| I-10: 画像任务恢复 | 进程重启时未完成任务 | 自动恢复进度 | ✅ 已验证（recover_stale_tasks） | 低 |
| I-8: RBAC 权限 | require_permission | 无权限 403 | ✅ 已验证 | 低 |
| I-9: 权限缓存失效 | 修改权限后 | 60s 内生效 | ✅ 已验证 | 低 |
| I-10: 执行快照 | 调度器触发 | 生成 config_hash + build_hash | ✅ 已验证 | 低 |
| I-11: 限流 | 高频请求 | 429 响应 | ✅ 已验证 | 低 |
| I-12: 加密 | 重置验证码 | Fernet 加密存储 | ✅ 已验证 | 低 |

### 3.10 模块 J：通知系统

| 测试项 | 测试方法 | 预期结果 | 实际状态 | 风险等级 |
|---|---|---|---|---|
| J-1: 站内通知 | 追踪完成 | 全员收到 Notification | ✅ 已验证 | 低 |
| J-2: 邮件发送 (SMTP 配置) | 配置 SMTP | 真实发送 | ✅ 已验证 | 低 |
| J-3: 邮件演示模式 | 未配置 SMTP | 落库 status=demo | ✅ 已验证 | 低 |
| J-4: Webhook (企业微信) | 配置 webhook_url | 发送 markdown 消息 | ✅ 已验证 | 低 |
| J-5: Webhook (钉钉/飞书) | 配置 webhook_url | 发送对应格式 | ✅ 已验证 | 低 |
| J-6: 邮件附件 (PDF) | 前端导出 + 上传 | 附件正确附加 | ✅ 已验证 | 低 |
| J-7: 邮件日志 | 每次发送 | EmailLog 落库 | ✅ 已验证 | 低 |

---

## 4. 集成测试场景

### 4.1 端到端场景：完整竞品调研流程

```
用户注册 → 创建调研任务 → SSE 实时查看进度 → 任务完成 →
查看报告 → 导出 PDF → 邮件发送 → 创建追踪项 →
等待调度触发 → 收到变更摘要 → 通知推送
```

| 步骤 | 关键验证点 | 关联 API |
|---|---|---|
| 1. 注册 | 自动登录 + 默认 free 计划 | POST `/api/auth/register` |
| 2. 创建调研 | quota 扣减 | POST `/api/research` |
| 3. SSE 监听 | PhaseStepper 同步 | GET `/api/research/{id}/events` |
| 4. 报告查看 | report_data 含 insights + timeline | GET `/api/research/{id}` |
| 5. 导出 | PDF/Word/Markdown | 前端 utils/exportReport.tsx |
| 6. 邮件 | 附件上传 → 发送 | POST `/api/research/{id}/email` |
| 7. 创建追踪 | next_run_at 计算 | POST `/api/trackers` |
| 8. 调度触发 | 自动创建任务 + 执行 | scheduler_loop |
| 9. 变更摘要 | 4 段摘要 | digest.py |
| 10. 通知 | 三渠道推送 | notify.py |

### 4.2 端到端场景：组织协作

```
用户 A 创建企业 → 生成邀请码 → 用户 B 加入 →
管理员设置成员额度 → 成员创建调研 → 额度共享消耗 →
管理员在 AdminPage 查看使用情况
```

| 步骤 | 关键验证点 | 关联 API |
|---|---|---|
| 1. 创建企业 | owner 角色 + invite_code | POST `/api/org` |
| 2. 加入企业 | org_id 更新 | POST `/api/org/join` |
| 3. 设置额度 | member_limit 生效 | PATCH `/api/org/members/{id}` |
| 4. 成员创建调研 | 共享配额扣减 | POST `/api/research` |
| 5. 双门控拦截 | 企业额度 + 个人限额 | deps.py check_quota_or_403 |
| 6. 管理员查看 | 组织使用统计 | GET `/api/admin/orgs` |

### 4.3 端到端场景：画像与对比

```
创建画像模板 → 冻结模板 → 生成竞品画像 → 冻结画像 →
横向对比 → 输出对比矩阵
```

| 步骤 | 关键验证点 | 关联 API |
|---|---|---|
| 1. 创建模板 | 自定义维度 | POST `/api/profiles/templates` |
| 2. 冻结模板 | 不可修改 | POST `/api/profiles/templates/{id}/freeze` |
| 3. 生成画像 | 读取 completed 任务 | POST `/api/profiles/generate` |
| 4. 冻结画像 | draft → frozen | POST `/api/profiles/{id}/freeze` |
| 5. 对比 | ≥2 frozen profiles | POST `/api/profiles/compare` |

### 4.4 端到端场景：安全与合规

```
注册 → 登录 → 修改密码 → 旧 token 失效 →
重置密码 → 登出全部 → 查看审计日志 → 查看执行快照
```

| 步骤 | 关键验证点 | 关联 API |
|---|---|---|
| 1. 注册 | 密码 bcrypt 加密 | POST `/api/auth/register` |
| 2. 登录 | JWT + token_version | POST `/api/auth/login` |
| 3. 改密码 | token_version +1 | POST `/api/auth/change-password` |
| 4. 旧 token | 401 失效 | GET `/api/auth/me` (with old token) |
| 5. 忘记密码 | 6 位 code (Fernet) | POST `/api/auth/forgot` |
| 6. 重置密码 | code 验证 | POST `/api/auth/reset` |
| 7. 登出全部 | 所有 token 失效 | POST `/api/auth/logout-all` |
| 8. 审计日志 | 完整操作记录 | GET `/api/admin/audit-logs` |
| 9. 执行快照 | config_hash + build_hash（`_GIT_HASH` 启动缓存） | GET `/api/admin/execution-snapshots` |

---

## 5. 用户可用性评估

### 5.1 导航结构评估

| 页面 | 路由 | 可达性 | 发现难度 | 备注 |
|---|---|---|---|---|
| 工作台 (Dashboard) | `/app` | 高 | 低 | 登录后默认页, 统计卡片清晰 |
| 新建调研 | `/app/new` | 高 | 低 | Dashboard 显眼 CTA 按钮 |
| 任务列表 | `/app/tasks` | 高 | 低 | 侧边栏直接可见 |
| 任务详情 | `/app/tasks/:id` | 中 | 中 | 需从列表点击进入, 3 个 tab 结构清晰 |
| 追踪管理 | `/app/trackers` | 高 | 低 | 侧边栏可见 |
| 竞品管理 | `/app/competitors` | 高 | 低 | 侧边栏可见 |
| 画像模板 | `/app/profiles/templates` | 中 | 中 | 二级菜单, 需先进入"画像" |
| 竞品画像 | `/app/profiles` | 中 | 中 | 二级菜单 |
| 横向对比 | `/app/profiles/compare` | 高 | 低 | 对比按钮直接可点 |
| 图谱 | `/app/graph` | 高 | 低 | 侧边栏可见 |
| AI 助手 | `/app/assistant` | 高 | 低 | 侧边栏 + 浮动气泡双入口 |
| 审计日志 | `/app/admin/audit-logs` | 中 | 中 | 管理后台子页面 |
| 定价 | `/app/pricing` | 高 | 低 | Dashboard 配额卡片有链接 |
| 账户 | `/app/account` | 高 | 低 | 侧边栏可见 |
| 企业管理 | `/app/account?tab=org` | 中 | 中 | 隐藏在账户页内嵌 tab |
| 管理后台 | `/app/admin` | 低 | 高 | 仅 admin 可见, 路由守卫保护 |

**导航问题**:
- **企业管理的可达性**: 企业功能被折叠到 `/app/account` 的 tab 内, 从侧边栏不可直接进入, 新用户可能找不到。
- **画像系统入口分散**: 模板管理、画像列表、对比功能分布在 3 个不同路由, 缺少统一的画像工作台。

### 5.2 表单可用性评估

| 表单 | 字段 | 验证 | 反馈 | 困难点 |
|---|---|---|---|---|
| 注册 | 邮箱/密码/昵称 | 前端: 邮箱格式, 密码长度 | 后端: 重复邮箱 | 无 |
| 登录 | 邮箱/密码 | 基本验证 | 错误提示 | 无 |
| 忘记密码 | 邮箱 | 邮箱格式 | demo code 返回 | 生产环境需邮件接收 |
| 新建调研 | 产品名/竞品/重点/时间范围 | 产品名必填 | quota 实时显示 | 竞品和重点字段可能让用户困惑用途 |
| 追踪项 | 产品名/竞品/频率/运行时间 | 产品名必填 | 表单内校验 | 运行时间 (run_hour) 选择器可能不直观 |
| 竞品管理 | 名称/别名/网站/技术栈/关键词 | 名称必填 | 编辑/删除 | 无 |
| 画像模板 | 名称/维度配置 | 名称必填 | 维度编辑器复杂 | 自定义维度 JSON 编辑对非技术用户困难 |
| 创建企业 | 名称 | 名称必填 | 即时创建 | 无 |

### 5.3 反馈与可见性评估

| 场景 | 反馈类型 | 当前实现 | 问题 |
|---|---|---|---|
| 任务创建中 | SSE 实时进度 | PhaseStepper + StepTimeline | 良好 |
| 任务完成 | 站内通知 + 邮件 | 多渠道推送 | 良好 |
| 额度不足 | QuotaErrorBanner | Dashboard + 创建时双重提示 | 良好 |
| 额度预警 (80%) | 通知 | 推送一次/月 | 用户可能不知道在哪里看 |
| 查询失败 | 错误提示 | useErrorHandler + toast | 部分页面仍有静默失败 |
| 加载状态 | Skeleton | 关键页面有 | 部分页面可能缺少 |

---

## 6. 潜在问题与改进建议

### 6.1 高优先级问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | **并发配额竞态**: 配额校验与任务创建之间有空窗 | 可能超额使用 | 事务内校验+创建或悲观锁 |
| 2 | **内存限流多 worker 失效**: 进程内令牌桶在多 worker 下独立运行 | 限流能力被放大 | 生产环境替换 Redis |
| 3 | **Token 存 localStorage**: XSS 风险 | Token 泄露 | HttpOnly + Secure Cookie |
| 4 | **调度器 _running 不持久化**: 重启可能重复触发 | 重复执行 | 加 is_running 字段 |

### 6.2 中优先级问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 5 | **CORS 允许所有方法**: 生产环境应限制 | 安全风险 | 明确列出允许的方法和头部 |
| 6 | **SQLite 并发限制**: 高并发写入可能锁表 | 写入失败 | 生产部署 PostgreSQL |
| 7 | **RBAC 缓存 60s TTL**: 权限变更不是即时 | 权限变更延迟 | 变更时立即 invalidate |
| 8 | **审计日志业务操作覆盖不足**: 仅 LLM 调用自动记录 | 审计不完整 | 补充核心业务操作 audit 点 |
| 9 | **无全局 Error Boundary**: 未捕获异常导致白屏 | 用户体验差 | 添加 ErrorBoundary 顶层包裹 |
| 10 | **企业管理入口隐藏**: 在 account tab 内 | 用户找不到 | 侧边栏添加独立入口 |

### 6.3 低优先级/优化项

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 11 | **TaskDetailPage 870 行**: 未拆分子组件 | 可维护性 | 拆分为 Header/ReportTab/InsightsTab/SourcesTab |
| 12 | **无离线缓存策略** | 弱网体验 | Service Worker 或 PWA |
| 13 | **无国际化 (i18n)**: 硬编码中文 | 多语言扩展 | 考虑 react-i18next |
| 14 | **性能监控缺失**: 无 APM/日志聚合 | 生产排障困难 | 集成 Sentry / 结构化日志 |
| 15 | **密码强度提示**: 注册/改密码无强度指示 | 安全风险 | 添加强度指示器 |

---

## 7. 测试执行优先级

### 7.1 建议执行顺序

```
Phase 1 — 核心流水线（已完成 ✅）
├── A-3: 5阶段执行流程
├── A-7: 报告生成
├── B-2: 调度器触发追踪
├── B-3: 变更摘要生成
├── B-5: 额度不足跳过
└── B-7: 三重推送

Phase 2 — 配额与安全（已完成 ✅）
├── A-1/A-2: 额度扣减与拦截
├── F-5: 双门控配额
├── F-6/F-7: 额度预警
├── I-2: Token 版本控制
├── I-6: 账号删除级联
└── I-8: RBAC 权限

Phase 3 — 组织协作（已完成 ✅）
├── E-1~E-4: 组织 CRUD + 角色
├── E-5/E-6: 共享配额 + 个人限额
└── G-2: 组织隔离

Phase 4 — 画像与对比（已完成 ✅）
├── H-3: 画像生成
├── H-5: 横向对比
└── H-2/H-4: 冻结机制

Phase 5 — 安全增强（已完成 ✅）
├── I-7: 审计日志完整性
├── I-10: 执行快照
├── I-11: 限流
└── I-12: 加密

Phase 6 — 边界与容错（部分完成）
├── A-10: 降级处理
├── A-14: SSE 断线重连
├── B-9: 调度器防重入
└── 各种空状态/异常输入
```

### 7.2 测试环境需求

| 需求 | 说明 | 状态 |
|---|---|---|
| LLM API Key | OpenAI 兼容 API | 需配置 |
| Tavily API Key | 搜索 API | 需配置 |
| SMTP (可选) | 邮件发送 | 未配置时走演示模式 |
| Webhook (可选) | 企业微信/钉钉/飞书 | 测试环境需 mock |

### 7.3 测试数据准备建议

```python
# 推荐预置数据
- 1 个 admin 用户 (admin@example.com / Admin123456)
- 2 个普通用户 (用于组织协作测试)
- 1 个已完成的研究任务 (含 5+ 来源, 含 insights + timeline)
- 1 个已完成的追踪任务 (含 change_summary)
- 1 个冻结的画像模板 + 2 个冻结画像
- 1 个已完成的图谱项目
- 1 个包含 AI 助手会话的历史数据
- 3+ 家竞品 (含系统级和企业级)
```

---

## 附录：关键代码路径速查

| 功能 | 后端入口 | 核心服务 | 前端入口 |
|---|---|---|---|
| 调研创建 | `research.py: POST /` | `agent.py: run_research` | `NewResearchPage.tsx` |
| SSE 进度 | `research.py: GET /{id}/events` | `agent.py: _add_step` | `TaskDetailPage.tsx` |
| 调度器 | `scheduler.py: scheduler_loop` | `agent.py: run_research` | `TrackersPage.tsx` |
| 变更摘要 | — | `digest.py: generate_change_summary` | `TrackerDetailPage.tsx` |
| 通知推送 | — | `notify.py: push_tracker_report` | `NotificationBell.tsx` |
| 配额校验 | `deps.py: check_quota_or_403` | — | `NewResearchPage.tsx` |
| 图谱构建 | `graph.py: POST /` | `graph_agent.py` | `GraphPage.tsx` |
| AI 助手 | `assistant.py: POST /ask` | `llm.py: chat_messages` | `AssistantPage.tsx` |
| 画像生成 | `profiles.py: POST /generate` | `profiles.py: generate_profile` | `ProfilesPage.tsx` |
| 横向对比 | `profiles.py: POST /compare` | `comparison.py` | `ComparisonPage.tsx` |
| 审计日志 | `llm.py` (每次调用) | `audit.py` | `AuditLogsPage.tsx` |
| 执行快照 | `scheduler.py: _snapshot_execution` | — | AdminPage |
| 竞品爬虫 | `crawl.py: POST /{cid}/crawl` | `crawler.py` | `CompetitorsPage.tsx` |
| 去重/置信度 | `agent.py: _search_all` | `dedup.py` | (自动，前端展示) |
| 快照存档 | `agent.py: _save_sources` | `snapshot.py` | `SourceDrawer.tsx` |
