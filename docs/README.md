# 文档体系目录

> **竞品调研 Agent** — 文档索引与导航
> **版本**: v5.1.0 | **更新日期**: 2026-08-02

---

## 活跃文档

| # | 文档 | 内容 | 用途 |
|---|------|------|------|
| 1 | [01-project-overview.md](01-project-overview.md) | 项目定位、核心功能、技术栈、设计原则、系统架构、Agent 流水线、套餐体系 | 新人 onboarding，项目全貌 |
| 2 | [02-architecture.md](02-architecture.md) | 系统架构分层、前后端通信、数据流图、模块依赖、后台任务模型 | 理解代码组织方式 |
| 3 | [03-database.md](03-database.md) | 全部 23 张表的 ORM 模型、字段说明、关系图、迁移机制 | 数据库设计与查询依据 |
| 4 | [04-api-reference.md](04-api-reference.md) | 全部 API 端点、请求/响应模型、鉴权要求 | 前端联调、API 消费 |
| 5 | [05-backend-services.md](05-backend-services.md) | Service 层各模块职责、核心算法、外部服务调用 | 后端开发、算法理解 |
| 6 | [06-frontend.md](06-frontend.md) | 前端路由结构、页面清单（18个）、组件库（32个）、状态管理 | 前端开发、UI 维护 |

## 评审与评估报告

> 以下为项目过程中产生的评审/评估/测试文档，反映特定时间点的分析结论。

| 文档 | 说明 |
|------|------|
| [EVALUATION_REPORT.md](../EVALUATION_REPORT.md) | 全面评测报告 — 功能模块、后端/前端逐项评估 |
| [TESTING_REPORT.md](../TESTING_REPORT.md) | 功能测试与可用性评估 — 模块数据流、集成测试、可用性评估 |
| [VERIFICATION_REPORT.md](../VERIFICATION_REPORT.md) | Agent 7 功能验证报告 — 代码审查 + 架构验证 |
| [ARCHITECTURE_REVIEW.md](../ARCHITECTURE_REVIEW.md) | 代码架构评审 — 架构评分、已修复问题、潜在风险 |
| [FRONTEND_ANALYSIS_REPORT.md](../FRONTEND_ANALYSIS_REPORT.md) | 前端完整分析与改造方案 — 路由、组件、问题与改造 |
| [PERFORMANCE_OPTIMIZATION_PLAN.md](../PERFORMANCE_OPTIMIZATION_PLAN.md) | 性能诊断与优化方案 — N+1 问题、启动优化、并发 |

## 实现计划

| 文档 | 说明 |
|------|------|
| [HANDOFF.md](../HANDOFF.md) | ★ 项目交接与技术实现文档 — 权限矩阵、配额规则、流水线、安全、数据模型、踩坑备忘 |
| [FIX_PLAN.md](../FIX_PLAN.md) | 代码问题修复方案 — P0-P3 分级 + 安全加固 S-1/S-2 |
| [PROFILE_REPORT_IMPLEMENTATION.md](../PROFILE_REPORT_IMPLEMENTATION.md) | 画像板块报告实施方案 — 将画像升级为分析报告阅读器 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更日志 — 按 [Keep a Changelog](https://keepachangelog.com/) 格式 |

## 归档文档

> 以下文档反映早期分析/计划，内容已被后续实现覆盖，仅保留参考。

| 文档 | 说明 |
|------|------|
| [archive/agent7-gap-analysis.md](archive/agent7-gap-analysis.md) | Agent 7 合同要求 vs 现有系统差距分析（原始分析，已大部分实现） |
| [archive/agent7-implementation-plan.md](archive/agent7-implementation-plan.md) | Agent 7 子任务分解计划（大部分已完成） |
| [archive/state-loss-analysis.md](archive/state-loss-analysis.md) | 导航切换后状态丢失问题分析 |
| [archive/profile-architecture-review.md](archive/profile-architecture-review.md) | 画像系统架构评审 |
| [archive/product-intel-architecture.md](archive/product-intel-architecture.md) | 产品情报系统架构评审 |
| [archive/profile-technical-report.md](archive/profile-technical-report.md) | 画像板块技术分析报告 |
| [archive/profile-delivery-assessment.md](archive/profile-delivery-assessment.md) | 画像板块交付能力评估 |
| [archive/profile-improvement-plan.md](archive/profile-improvement-plan.md) | 画像板块改进策略与实现计划 |
| [archive/AUDIT_LOG_PLAN.md](archive/AUDIT_LOG_PLAN.md) | 审计日志独立页面实施计划 |
| [archive/AUDIT_REVIEW.md](archive/AUDIT_REVIEW.md) | 审计日志系统技术评审 |
| [archive/SPRINT_5_PLAN.md](archive/SPRINT_5_PLAN.md) | Sprint 5 修复计划（已实施总结） |

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
- Agent 7 合同差距 → [archive/agent7-gap-analysis.md](archive/agent7-gap-analysis.md)
- 当前修复计划 → [FIX_PLAN.md](../FIX_PLAN.md)
- 完整实现细节 → [HANDOFF.md](../HANDOFF.md)
