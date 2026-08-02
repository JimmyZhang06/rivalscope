# 文档体系目录

> **竞品调研 Agent** — 完整技术文档索引

> **更新说明**：基于 agent-v5 (v5.0.0) 实际代码更新，反映 Agent 7 全面实现后的文档体系

---

## v5.0.0 更新日志 (2026-08-02)

- **爬虫可靠性修复**：语言感知 sitemap 解析、隐私 consent overlay 自动移除、Chrome User-Agent、多路径 sitemap 发现
- Agent 7 全部核心交付物（A7-01~A7-08）已实现
- 竞品画像搜索优先重构、产品情报三层架构、前端状态持久化方案

---

| # | 文档 | 内容 | 用途 |
|---|------|------|------|
| 1 | [01-project-overview.md](01-project-overview.md) | 项目定位、核心功能、技术栈、设计原则、系统架构、Agent 流水线、套餐体系 | 新人 onboarding，项目全貌 |
| 2 | [02-architecture.md](02-architecture.md) | 系统架构分层、前后端通信、数据流图、模块依赖、后台任务模型 | 理解代码组织方式 |
| 3 | [03-database.md](03-database.md) | 全部 23 张表的 ORM 模型、字段说明、关系图、迁移机制 | 数据库设计与查询依据 |
| 4 | [04-api-reference.md](04-api-reference.md) | 全部 API 端点、请求/响应模型、鉴权要求 | 前端联调、API 消费 |
| 5 | [05-backend-services.md](05-backend-services.md) | Service 层各模块职责、核心算法、外部服务调用 | 后端开发、算法理解 |
| 6 | [06-frontend.md](06-frontend.md) | 前端路由结构、页面清单（18个）、组件库（32个）、状态管理 | 前端开发、UI 维护 |
| 7 | [agent7-gap-analysis.md](agent7-gap-analysis.md) | Agent 7 合同要求 vs 现有系统差距分析（原始分析，已大部分实现） | 合同合规参考 |
| 8 | [agent7-implementation-plan.md](agent7-implementation-plan.md) | Agent 7 子任务分解计划（原始计划，大部分已完成） | 实施参考 |

---

## 快速导航

**我想了解...**
- 项目整体做什么 → [01-project-overview.md](01-project-overview.md)
- 代码怎么组织的 → [02-architecture.md](02-architecture.md)
- 数据库有哪些表 → [03-database.md](03-database.md)
- 前端有哪些页面 → [06-frontend.md](06-frontend.md)
- 调研任务怎么跑完 → [01-project-overview.md](01-project-overview.md#4-agent-流水线各阶段职责)
- 用户怎么认证的 → [04-api-reference.md](04-api-reference.md#41-认证相关)
- 配额怎么计算的 → [01-project-overview.md](01-project-overview.md#6-会员套餐与配额规则)
- 安全机制有哪些 → [04-api-reference.md](04-api-reference.md#41-认证相关) + [02-architecture.md](02-architecture.md)
- Agent 7 合同差距 → [agent7-gap-analysis.md](agent7-gap-analysis.md)
