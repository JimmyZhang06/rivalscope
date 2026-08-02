# 审计日志独立页面 — 实施计划

> **更新说明**：基于 agent-v5 实际代码更新。审计日志独立页面（`AuditLogsPage.tsx`）已在 Sprint 5 中实现，本计划记录实施状态和剩余工作。

## 已完成 ✅

### 前端独立页面

- **`AuditLogsPage.tsx`**：独立路由 `/app/admin/audit-logs`
  - 筛选栏：操作类型（action）、资源类型（resource_type）、操作用户 ID（user_id）、开始时间 / 结束时间
  - 表格列（完整展示）：时间、操作用户、组织、操作类型、资源类型/ID、状态（成功/失败 badge）、模型名、Token 数、错误信息
  - 分页控件 + 加载状态和空状态提示
- **`App.tsx`**：新增路由 `<Route path="admin/audit-logs" element={<RequireAdmin><AuditLogsPage /></RequireAdmin>} />`
- **`client.ts`**：`listAuditLogs` 函数支持完整筛选参数

### 后端 API

- **`GET /api/admin/audit-logs`**：支持 5 种筛选 + 分页，功能齐全
- **LLM 审计埋点**：`services/llm.py` 每次 chat/chat_json/chat_messages 后自动调用 `_log_llm_audit()`
- **爬虫审计**：`POST /api/crawl/{cid}/crawl` 端点已通过 `log_audit()` 记录爬取操作（action=`crawl.run`，resource_type=`crawl`）—— 见 `backend/app/api/crawl.py`

## 待完成 🔲

### 阶段一补充：更多审计注入点

在以下操作的 API 端点中，成功执行后调用 `log_audit()`：

| 操作 | 端点 | action 值 | resource_type |
|------|------|-----------|---------------|
| 用户注册 | `POST /api/auth/register` | `user.register` | `user` |
| 用户登录 | `POST /api/auth/login` | `user.login` | `user` |
| 登录失败 | `POST /api/auth/login` (401) | `user.login_failed` | `user` |
| 用户注销 | `POST /api/auth/logout-all` | `user.logout` | `user` |
| 账号删除 | `DELETE /api/auth/account` | `user.delete` | `user` |
| 密码修改 | `POST /api/auth/change-password` | `user.password_change` | `user` |
| 个人资料修改 | `PATCH /api/auth/profile` | `user.profile_update` | `user` |
| 忘记密码 | `POST /api/auth/forgot` | `user.password_forgot` | `user` |
| 重置密码 | `POST /api/auth/reset` | `user.password_reset` | `user` |
| 任务创建 | `POST /api/research` | `task.create` | `research_task` |
| 任务删除 | `DELETE /api/research/{id}` | `task.delete` | `research_task` |
| 组织创建 | `POST /api/org` | `org.create` | `organization` |
| 组织更新 | `PATCH /api/org` | `org.update` | `organization` |
| 竞品创建 | `POST /api/competitors` | `competitor.create` | `competitor` |
| 竞品更新 | `PATCH /api/competitors/{id}` | `competitor.update` | `competitor` |
| 竞品删除 | `DELETE /api/competitors/{id}` | `competitor.delete` | `competitor` |
| 爬虫执行 | `POST /api/crawl/{cid}/crawl` | `crawl.run` | `crawl` |
| 图谱创建 | `POST /api/graph` | `graph.create` | `graph` |
| 图谱刷新 | `POST /api/graph/{id}/refresh` | `graph.refresh` | `graph` |
| 图谱删除 | `DELETE /api/graph/{id}` | `graph.delete` | `graph` |
| 追踪器创建 | `POST /api/trackers` | `tracker.create` | `tracker` |
| 追踪器更新 | `PATCH /api/trackers/{id}` | `tracker.update` | `tracker` |
| 追踪器删除 | `DELETE /api/trackers/{id}` | `tracker.delete` | `tracker` |
| 管理员操作用户 | `PATCH /api/admin/users/{id}` | `admin.user_update` | `user` |
| 管理员操作企业 | `PATCH /api/admin/orgs/{id}` | `admin.org_update` | `organization` |

**注意**：
- `log_audit` 内部自己开 `SessionLocal()`，不需要在调用方的 db session 中执行
- `user_id` 和 `org_id` 从当前登录用户（deps 中的 `get_current_user`）获取
- 失败记录不阻断主流程，try/except 包裹

### 阶段二：后端 API 补充（可选，按需）

#### 2.1 `GET /api/admin/audit-logs/stats` — 审计统计

返回各操作类型的计数、成功/失败比例、日趋势，方便管理后台首页展示审计概览。

#### 2.2 `GET /api/admin/audit-logs/export` — 导出 CSV

支持导出筛选后的审计日志为 CSV 文件，用于合规归档。

### 阶段三：企业级保障

#### 3.1 ORM 层防篡改拦截

在 `AuditLog` ORM 模型中注册 `before_update`/`before_delete` 事件拦截：

```python
from sqlalchemy import event

@event.listens_for(AuditLog, "before_update")
@event.listens_for(AuditLog, "before_delete")
def prevent_audit_modification(*_):
    raise RuntimeError("审计日志不可修改或删除")
```

#### 3.2 DB 索引补充

在 `models.py` 的 `AuditLog` 类中增加复合索引：

```python
__table_args__ = (
    Index("idx_audit_action_resource", "action", "resource_type"),
    Index("idx_audit_created_at", "created_at"),
)
```

同时在 `migrate_columns()` 中补 DDL。

#### 3.3 异常告警

新增 `AnomalyDetector` 类：时间窗口 + 计数检测（暴力破解、批量删除等）。

---

## 文件变更清单

### 已完成
- `frontend/src/pages/app/AuditLogsPage.tsx` — 审计日志独立页面 ✅
- `frontend/src/App.tsx` — 新增路由 ✅
- `frontend/src/api/client.ts` — 扩展 `listAuditLogs` 参数 ✅
- `backend/app/api/admin.py` — `GET /api/admin/audit-logs` 端点 ✅
- `backend/app/services/llm.py` — LLM 调用审计埋点 ✅
- `backend/app/services/audit.py` — `log_audit()` 写入函数 ✅

### 待修改
- `backend/app/api/auth.py` — 注册/登录/注销/改密/删号/忘记密码/重置密码/个人资料 8 个端点加 audit
- `backend/app/api/research.py` — 创建/删除任务 加 audit
- `backend/app/api/org.py` — 创建/更新组织 加 audit
- `backend/app/api/competitors.py` — 创建/更新/删除竞品 加 audit
- `backend/app/api/crawl.py` — 爬虫执行 加 audit
- `backend/app/api/graph.py` — 创建/刷新/删除图谱 加 audit
- `backend/app/api/trackers.py` — 创建/更新/删除/执行追踪器 加 audit
- `backend/app/api/admin.py` — 管理后台操作用户/企业 加 audit（含修复 B-1 update_org bug）
- `backend/app/db/models.py` — AuditLog 增加 `__table_args__` 复合索引 + 防篡改事件钩子
- `backend/app/main.py` — `migrate_columns()` 中 audit_logs 增加索引 DDL

---

## 实施顺序

```
阶段 0（Bug 修复 + 审计注入） → 阶段一（数据质量） → 阶段二（API 增强） → 阶段三（企业级保障）
```

**预估工时：**
- 阶段 0：~1 小时（Bug 修复 + 约 20 个端点逐个加 audit）
- 阶段一：~1 天（IP 透传 + cost 计算 + DB 索引）
- 阶段二：~1 天（stats + export 端点 + 前端增强）
- 阶段三：~1 天（防篡改 + 异常告警）
