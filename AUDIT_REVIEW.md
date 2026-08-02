# 审计日志系统 — 技术评审文档

> 评审对象：当前 `agent-v5` 分支审计日志实现
> 评审日期：2026-08-02
> 评审目标：评估是否满足企业级合规审计要求，输出改造方案
> **更新说明**：基于 agent-v5 实际代码更新，反映审计日志已实现的状态

---

## 一、架构总览

### 1.1 当前架构

```
┌──────────────┐    log_audit()     ┌──────────────┐
│  各 API 端点   │ ──手动调用──▶      │  audit.py    │
│ (auth/research │                   │  (同步写入)    │
│  org/graph/   │                   └──────┬───────┘
│  trackers/    │                          │
│  admin/       │                    ┌─────▼──────┐
│  competitors) │                    │ audit_logs │
│  crawl        │                    │   (SQLite)  │
└──────────────┘                    └─────┬──────┘
                                          │
                                  GET /api/admin/audit-logs
                                          │
                                    ┌─────▼──────┐
                                    │ AuditLogs  │
                                    │   Page     │
                                    │ (React)    │
                                    └───────────┘

┌──────────────┐    _log_llm_audit() ┌──────────────┐
│  services/llm.py │ ──自动调用──▶  │  audit.py    │
│  (每次LLM调用)  │                   │  (异步写入)    │
└──────────────┘                   └──────┬───────┘
                                          │
                                    ┌─────▼──────┐
                                    │ audit_logs │
                                    │ (LLM记录)   │
                                    └───────────┘
```

### 1.2 关键设计约束（必须尊重）

| 约束 | 来源 | 影响 |
|---|---|---|
| SQLite + WAL 模式 | `database.py` | 无行级锁，并发写入有限 |
| `log_audit` 开独立 `SessionLocal()` | `audit.py:31` | 不阻塞调用方的 db session |
| 限流：内存令牌桶，按 IP+endpoint | `rate_limit.py` | 生产可换 Redis，接口不变 |
| 前端非组件模块 HMR 不热替换 | HANDOFF §24.1 | 改 `utils/*.ts` 需整页刷新 |
| `migrate_columns()` 启动时跑 | `main.py:40` | 新列加在 `required` 字典即可 |
| 后端通常无 `--reload` | HANDOFF §24.2 | 改后端代码需手动重启 |

---

## 二、当前实现状态

### 2.1 已实现能力

| 能力 | 状态 | 说明 |
|------|------|------|
| AuditLog 模型 | ✅ | 21 个字段，设计完善 |
| log_audit() 写入函数 | ✅ | 同步写入，独立 Session |
| LLM 审计埋点 | ✅ | 每次 chat/chat_json/chat_messages 后自动记录 |
| API 端点 | ✅ | `GET /api/admin/audit-logs` 支持 5 种筛选 + 分页 |
| 前端类型 | ✅ | `AuditLog` 接口已定义 |
| 前端独立页面 | ✅ | `AuditLogsPage.tsx` 已实现（完整筛选器 + 分页表格） |
| AdminPage 集成 | ✅ | 审计日志作为管理后台一部分 |

### 2.2 已知缺口

| 缺口 | 严重程度 | 说明 |
|------|----------|------|
| 审计注入点覆盖不足 | Medium | 核心业务操作（任务创建/删除、组织变更、竞品增删、爬虫操作已记录、画像操作等）均未记录审计日志 |
| IP/User-Agent 覆盖率 | Medium | LLM 审计的 IP/UA 取决于调用方透传，部分端点可能遗漏 |
| Cost 计算 | Low | 当前 `cost` 字段在所有调用点都是默认值 0.0，无模型定价表 |
| DB 索引 | Low | audit_logs 只有 user_id 和 org_id 两个索引，按 action/resource_type/created_at 筛选将触发全表扫描 |
| 审计日志不可篡改 | Medium | 同一进程有写权限即可修改 audit_logs，无应用层保护 |
| 异常行为告警 | Low | 完全未实现（暴力破解检测、批量删除告警等） |

---

## 三、Bug 清单

### B-1 MEDIUM — `update_org` 引用未定义变量

**文件**：`backend/app/api/admin.py:155-178`
**现象**：`update_org` 函数缺少 `admin: User = Depends(get_current_admin)` 参数，但第171行引用了 `admin.id` 和 `admin.org_id`。
**根因**：对比同文件 `update_user`（第71行）正确声明了 `admin` 参数，`update_org` 复制时遗漏。
**后果**：`NameError` 被 try/except 静默吞掉 — **所有管理员修改企业套餐的操作完全无审计追踪**。
**修复**：给 `update_org` 添加 `admin: User = Depends(get_current_admin)` 参数。

### B-2 MEDIUM — 登录失败无审计记录

**文件**：`backend/app/api/auth.py:92-94`
**现象**：密码验证失败时直接 `raise 401`，无 `log_audit` 调用。
**根因**：审计只在成功分支内。
**后果**：暴力破解、撞库攻击完全不可见。
**修复**：在 401 分支添加 `log_audit(user_id="", action="user.login_failed", ...)`。

### B-3 MEDIUM — 三个端点完全无审计

| 端点 | 应有 action | 当前 |
|---|---|---|
| `PATCH /api/auth/profile` | `user.profile_update` | ❌ 无 |
| `POST /api/auth/forgot` | `user.password_forgot` | ❌ 无 |
| `POST /api/auth/reset` | `user.password_reset` | ❌ 无 |

### B-4 LOW — 两个 CRUD 端点缺审计

| 端点 | 应有 action |
|---|---|
| `PATCH /api/competitors/{id}` | `competitor.update` |
| `POST /api/graph/{id}/refresh` | `graph.refresh` |
| `PATCH /api/trackers/{id}` | `tracker.update` |

---

## 四、数据质量差距

### 4.1 IP / User-Agent 覆盖率

`_log_llm_audit()`（`llm.py:12-32`）接受 `ip`/`user_agent` 参数，但调用方（`agent.py`）可能未传入。

**方案**：在 `LLMClient.__init__` 增加可选 `ip`/`user_agent` 参数，在实例化时从 deps 层透传。

### 4.2 Cost 始终为 0.0

当前 `log_audit` 的 `cost` 参数在所有调用点都是默认值 `0.0`。

**方案**：
1. 新增 `core/model_pricing.py` — 维护一个模型定价字典
2. 在 `_log_llm_audit` 中根据 `model_name` 查定价，计算 cost
3. 定价数据可随 `get_settings()` 缓存

### 4.3 DB 索引缺失

当前 `audit_logs` 只有 `user_id` 和 `org_id` 两个索引。当数据量增长后，按 `action`、`resource_type`、`created_at` 筛选将触发全表扫描。

**修复**：在 `models.py` 的 `AuditLog` 类中增加复合索引，同时在 `migrate_columns()` 中补 DDL。

---

## 五、API 层面缺口

### 5.1 缺少 org_id 筛选

管理后台需要按企业隔离审计数据，当前 API 不支持。

**修改**：`list_audit_logs` 增加 `org_id: str = Query("")` 参数。

### 5.2 缺少统计端点

`GET /api/admin/audit-logs/stats` — 返回审计概览统计，供 AdminPage 仪表盘展示。

### 5.3 缺少导出端点

`GET /api/admin/audit-logs/export` — 支持筛选参数，返回 CSV。

---

## 六、前端层面差距

### 6.1 类型安全

`client.ts` — `listAuditLogs` 应返回独立的 `AuditLogListResponse` 类型，而非复用 `AdminUserListResponse`。

### 6.2 高级功能

| 功能 | 优先级 | 说明 |
|---|---|---|
| 列排序 | P1 | 按时间/token/状态排序 |
| 详情展开 | P1 | input/result 字段可展开查看 |
| 操作类型下拉 | P2 | 已知 action 枚举，减少拼写错误 |
| 导出按钮 | P2 | 调用 `/export` 端点 |
| 审计统计面板 | P2 | AdminPage 新增审计概览卡 |

---

## 七、企业级缺失能力

### 7.1 审计日志不可篡改

**现状**：`audit_logs` 表和业务数据在同一 SQLite 数据库中，有写权限的账号可以 UPDATE/DELETE 审计记录。

**方案 A（推荐，低成本）**：在 `AuditLog` ORM 模型中增加 `__mapper_args__` 事件钩子，拦截 UPDATE 和 DELETE 操作并抛异常。

### 7.2 异常行为告警

完全未实现。企业级需要检测：

| 告警规则 | 触发条件 | 动作 |
|---|---|---|
| 暴力破解 | 同一 IP 10 分钟内登录失败 ≥ 5 次 | 推送通知 + 记录告警 |
| 批量删除 | 1 小时内删除 ≥ 10 条资源 | 推送通知 |
| 管理员高危操作 | admin 修改用户角色/企业套餐 | 站内通知（可选） |
| 异常时间 | 非工作时间（22:00-08:00）管理员操作 | 记录告警 |

---

## 八、改造方案

### 8.1 阶段划分

```
阶段 0 — Bug 修复（半天）
   ├─ B-1: 修 update_org 的 admin 参数
   ├─ B-2: 补登录失败审计
   ├─ B-3: 补 profile/forgot/reset 审计
   └─ B-4: 补 competitor.update / graph.refresh / tracker.update 审计

阶段 1 — 数据质量（1 天）
   ├─ IP/User-Agent 透传到 _log_llm_audit
   ├─ 模型定价表 + cost 计算
   └─ DB 索引（action/resource_type/created_at）

阶段 2 — API 增强（1 天）
   ├─ org_id 筛选
   ├─ 审计统计端点 /stats
   └─ 导出端点 /export

阶段 3 — 前端修复（半天）
   ├─ 类型修复（独立 AuditLogListResponse）
   ├─ 列排序 + 详情展开
   └─ 导出按钮

阶段 4 — 企业级保障（1 天）
   ├─ ORM 层防篡改拦截
   └─ 异常告警（暴力破解/批量删除）
```

---

## 九、评审结论

### 9.1 当前状态评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 基础架构 | ★★★★☆ | 模型+API+前端独立页面齐全，LLM 自动埋点已实现 |
| 数据完整性 | ★★★☆☆ | LLM 调用覆盖完整，但业务操作注入点不足 |
| 数据质量 | ★★★☆☆ | IP/UA 部分覆盖，cost 恒 0，无索引 |
| 可查询性 | ★★★☆☆ | 5种筛选+分页可用，但缺 org 筛选/全文搜索 |
| 可导出 | ★☆☆☆☆ | 完全缺失 |
| 不可抵赖性 | ★★☆☆☆ | ORM 层可篡改，无应用层保护 |
| 可告警 | ★☆☆☆☆ | 完全缺失 |
| 前端体验 | ★★★★☆ | 独立页面可用，含完整筛选器+分页 |

**综合评级：约 55%，核心功能已实现，需补充业务操作注入点和企业级保障**

### 9.1.1 爬虫审计更新（agent-v5.1）

`POST /api/crawl/{cid}/crawl` 端点已实现 `log_audit()` 调用，记录 `action=crawl.run`、`resource_type=crawl`、输入参数（competitor_id + max_pages）和结果状态。这是审计注入点覆盖改进的第一步。

### 9.2 风险评估

| 风险 | 等级 | 说明 |
|---|---|---|
| `update_org` bug | **Medium** | 已确认：admin 改企业套餐时审计静默丢失 |
| 登录失败无审计 | **Medium** | 已确认：暴力破解完全不可见 |
| 审计日志可篡改 | **Medium** | 同一进程有写权限即可修改 audit_logs |
| 覆盖度不足 | **Medium** | 竞品/通知/助手等模块完全无审计 |
| Cost 恒为 0 | **Low** | 不影响审计功能完整性，但影响成本分析 |

### 9.3 建议

1. **立即修复 B-1 和 B-2** — 它们是正在生产环境中实际产生数据空洞的 bug
2. **阶段 0 优先执行** — 所有审计注入点补全是低成本高回报的工作
3. **阶段 1 的 IP 透传和 cost 计算** — 设计清晰，改动隔离，可独立验证
4. **阶段 4 的防篡改** — ORM 事件拦截是最小可行方案，不改变现有架构
5. **阶段 3 前端** — 可在阶段 0/1/2 完成后独立迭代，不影响后端

---

## 十、附录：审计 action 枚举规范

建议统一管理所有 action 值，避免拼写不一致：

```python
# core/audit_constants.py

AUTH_ACTIONS = {
    "register": "user.register",
    "login": "user.login",
    "login_failed": "user.login_failed",
    "logout": "user.logout",
    "password_change": "user.password_change",
    "password_forgot": "user.password_forgot",
    "password_reset": "user.password_reset",
    "profile_update": "user.profile_update",
    "delete": "user.delete",
}

TASK_ACTIONS = {
    "create": "task.create",
    "delete": "task.delete",
    "ask": "task.ask",
    "email": "task.email_share",
}

ORG_ACTIONS = {
    "create": "org.create",
    "update": "org.update",
    "invite_code_reset": "org.invite_code_reset",
    "join": "org.join",
    "leave": "org.leave",
    "member_update": "org.member_update",
    "member_remove": "org.member_remove",
    "permission_set": "org.permission_set",
}

COMPETITOR_ACTIONS = {
    "create": "competitor.create",
    "update": "competitor.update",
    "delete": "competitor.delete",
    "crawl": "crawl.run",
}

GRAPH_ACTIONS = {
    "create": "graph.create",
    "refresh": "graph.refresh",
    "delete": "graph.delete",
}

TRACKER_ACTIONS = {
    "create": "tracker.create",
    "update": "tracker.update",
    "delete": "tracker.delete",
    "run": "tracker.run",
}

PROFILE_ACTIONS = {
    "template_create": "profile.template_create",
    "template_update": "profile.template_update",
    "template_freeze": "profile.template_freeze",
    "generate": "profile.generate",
    "freeze": "profile.freeze",
    "compare": "profile.compare",
}

ADMIN_ACTIONS = {
    "user_update": "admin.user_update",
    "org_update": "admin.org_update",
}

SYSTEM_ACTIONS = {
    "llm_call": "llm.call",
}
```
