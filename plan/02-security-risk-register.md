# 安全与可靠性风险登记册

本登记册基于 agent-v8 实际代码审阅。严重度按 P0（上线阻断）、P1（近期必须）、P2（计划整改）排序；“已缓解”不等于完成生产级治理。

| ID | 级别 | 代码证据/风险 | 可利用或故障路径 | 整改与验收 | 状态 |
|---|---|---|---|---|---|
| SEC-01 | P0 | `frontend/src/api/client.ts` 原将 8 小时 access token 放入 SSE URL | 浏览历史、代理/网关 access log、Referer 或截图泄漏后可接管会话 | Authorization 换取 60 秒、任务绑定 ticket；access/refresh token 不能用于 SSE；URL 日志脱敏 | 本批已缓解 |
| SEC-02 | P0 | `backend/app/api/billing.py:32-55` “模拟支付”直接创建 paid 订单并升级套餐 | 任意登录用户无需支付即可扩容，企业管理员亦可免费升级组织 | 生产环境禁用该端点；接支付供应商签名 webhook，订单状态机和幂等键；测试伪造/重放 webhook | 未修复 |
| SEC-03 | P0 | 多个 API 的 `log_audit()` 被 `except Exception: pass` 吞掉 | 删除、权限/组织变更成功但审计缺失，攻击与误操作不可追溯 | 敏感管理操作 fail-closed；普通写入同事务 outbox；故障注入验证最终可达 | 未修复 |
| SEC-04 | P0 | 资源访问在各 API 自行组合 `user_id/org_id/role` | 新增聚合资源时漏过滤造成 IDOR/跨租户泄露；管理员路径边界含糊 | 单一 `TenantScope`/policy/repository；每种资源建立 A/B 组织矩阵和不可枚举 404 测试 | 部分缓解 |
| REL-01 | P0 | `BackgroundTasks`、scheduler/profile 中 `create_task()` 执行业务长任务 | API 重启丢任务；多实例重复执行、重复扣额或产物；内存状态与 DB 偏离 | 持久化 Job + lease/heartbeat/idempotency + outbox；重启/重复投递故障测试 | 未修复 |
| SEC-05 | P1 | access/refresh token 均保存在 `localStorage` | 任一存储型/依赖 XSS 可直接读取 30 天 refresh token | refresh token 改 HttpOnly+Secure+SameSite cookie，access token 仅内存；CSRF 与登出吊销测试 | 未修复 |
| SEC-06 | P1 | 外部网页/报告/摘要直接拼入 LLM prompt，缺少明确不可信边界 | 网页指令诱导模型泄密、偏转结论或触发未来工具 | 内容分区与指令优先级、工具 allowlist、敏感字段脱敏、引用追溯、prompt injection 评测集 | 未修复 |
| SEC-07 | P1 | URL 安全层先 DNS 校验再由 httpx 再解析 | 恶意 DNS 在校验后 rebinding 到内网；同时存在大响应/压缩炸弹风险 | 连接目标 IP pinning 或受控出站代理；逐跳复验；流式响应体/解压上限；DNS rebinding 集成测试 | 部分缓解 |
| SEC-08 | P1 | 邮件上传整文件 `await file.read()`；扩展名未知也按附件转发；昵称/产品名未 HTML escape | 并发大文件造成内存峰值；HTML 注入邮件；危险附件被系统背书发送 | 流式上限、扩展名/MIME/magic allowlist、文件名清理、HTML escape、单用户频率与收件人域策略 | 未修复 |
| SEC-09 | P1 | `rate_limit.py`/`rate_limit_user.py` 使用进程内字典，默认阈值宽且非分布式 | 多实例绕过；攻击者构造大量 key 造成内存增长；高成本 AI/登录接口缺少差异化策略 | Redis 滑窗/令牌桶、TTL、可信代理链；auth/AI/upload/connector 分级；429 与并发测试 | 未修复 |
| SEC-10 | P1 | ServiceKey/外部密钥缺少完整租户、用途、版本与轮换语义 | 密钥混租户误用、日志泄漏后无法精确吊销，任务输入可能复制明文 | `org_id/connector_id/purpose/key_version/rotated_at/disabled_at`；密钥引用而非值进入 Job | 未修复 |
| REL-02 | P1 | 生产仍以 SQLite/StaticPool 和启动期 schema 兼容为基础 | 并发锁、事务隔离弱、迁移失败影响启动、回滚困难 | PostgreSQL + Alembic baseline；expand/backfill/dual-write/contract；恢复演练 | 部分缓解 |
| SEC-11 | P2 | 原始 HTML/归档内容长期保存，缺少统一 TTL/下载 CSP/删除机制 | 存储型 XSS、敏感网页长期驻留、数据主体删除不完整 | 原文默认纯文本展示；下载 attachment + CSP；分类保留期限、导出和级联删除测试 | 未修复 |
| REL-03 | P2 | 广泛的通用异常捕获和前端 `.catch(() => {})` | 真实故障被当成空状态，监控无法区分业务无数据与系统失败 | 结构化错误码、request/job ID、SLO 指标；禁止吞敏感路径异常 | 未修复 |
| SUP-01 | P2 | 当前依赖审计已为 0，但缺少持续 SAST/secret/SBOM/容器基线 | 新依赖或配置回归在发布前不被发现 | CI 加 pip-audit/npm audit、Bandit/Semgrep、gitleaks、SBOM；容器非 root/只读文件系统 | 未修复 |

## 上线门禁

1. 正式对外收费前必须关闭模拟升级（SEC-02）。
2. 正式多租户前必须完成 TenantScope 和全资源越权矩阵（SEC-04）。
3. 多实例或生产长任务前必须完成持久化 Job（REL-01）。
4. 所有 P0 必须有自动化负向测试；P1 必须有负责人、截止版本和可观测指标。
5. 任何连接器必须具备 SSRF、重定向、DNS、响应大小、并发、凭据隔离和审计测试。
