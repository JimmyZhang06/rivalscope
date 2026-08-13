# Agent v9 执行看板

更新时间：2026-08-13

| 工作包 | 执行方式 | 交付 | 状态 | 验证/备注 |
|---|---|---|---|---|
| P 产品与信息架构 | 子 Agent | `01-platform-product.md` | 已完成 | 五核心对象、目标导航、Phase 0–5 |
| A 技术架构与迁移路线 | 子 Agent | `03-architecture-roadmap.md` | 已完成 | 模块化单体、Job/outbox、Alembic、A–E 包 |
| S 安全风险登记 | 安全审阅 + 主会话收口 | `02-security-risk-register.md` | 已完成 | 14 项具体风险与上线门禁 |
| E 事件流/监测中心 | 独立 Codex 会话/worktree | 事件聚合 API、摘要、页面、测试 | 已合并 | 提交 `8cefd5c`；无 DB 迁移 |
| R 情报资产中心 | 独立 Codex 会话/worktree | 四类资产统一投影、筛选、页面、测试 | 已合并 | 提交 `49c1cb3`；无 DB 迁移 |
| H SSE 凭据安全 | 主会话 | 60 秒任务绑定 ticket、前端续连、测试 | 已完成 | 不再把 access token 放入 URL |
| B 生产计费保护 | 子 Agent | 模拟支付默认关闭、生产强制拒绝、权限测试 | 已完成 | 正式支付供应商仍待接入 |
| U 审计可靠性 | 子 Agent | required/best-effort 审计、敏感操作事务一致性 | 已完成第一阶段 | 管理员与组织敏感写已 fail-closed |
| C CI 安全门禁 | 子 Agent | pip-audit、Bandit、npm audit | 已完成 | Python/前端依赖 0 已知漏洞，高危扫描 0 |
| T TenantScope | 独立 Codex 会话/worktree | 集中式租户策略、聚合 API 迁移、矩阵测试 | 已完成第一阶段 | 事件/资产已迁移；旧资源后续逐类迁移 |
| J 持久化 Job 内核 | 独立 Codex 会话/worktree | Job/Step/Outbox、幂等、租约、fencing、恢复测试 | 已完成内核 | 尚未替换现有 BackgroundTasks |
| V 整体回归 | 主会话 | pytest、compile、tsc、Vite build、依赖与静态扫描 | 已完成 | 后端 65 项；前端构建通过；漏洞/高危 0 |

## 下一波（尚未启动，等待当前门禁通过）

1. M1-A：Alembic baseline + Workspace/Object/LegacyMapping；为已有 Job/Outbox 补版本迁移。
2. M1-B：将 research/tracker/profile/graph 分批迁入持久化 Job worker。
3. M1-C：将旧资源逐类迁入 TenantScope，并增加 `/api/v2/objects`、`/api/v2/jobs`。
4. M1-D：PostgreSQL CI、迁移/租户/恢复/兼容测试。
5. M1-E：对象详情与统一任务中心 feature-flag 薄切片。

合并门禁和文件独占边界以 `03-architecture-roadmap.md` 第 14–15 节为准。
