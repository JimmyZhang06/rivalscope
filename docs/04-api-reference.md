# 04. API 参考

> **竞品调研 Agent**
> 版本：v5.1.0 · 日期：2026-08-02 · 分支：agent-v5

## 4.1 认证相关

### 注册

```
POST /api/auth/register
```

**请求体**：
```json
{
  "email": "user@example.com",
  "password": "Pass1234",
  "nickname": "张三"
}
```

**规则**：密码 ≥8 位且同时包含字母和数字；限流 3 次/秒。

**响应**：
```json
{
  "access_token": "...",
  "token_type": "bearer",
  "refresh_token": "...",
  "user": { "id": "...", "email": "...", "nickname": "...", "role": "user", "plan": "free", ... }
}
```

### 登录

```
POST /api/auth/login
```

**请求体**：`{ "email": "...", "password": "..." }`
**规则**：限流 5 次/秒。记录登录日志（IP + UA）。
**响应**：同注册，返回 TokenOut。

### 刷新 Token

```
POST /api/auth/refresh
```

**请求体**：`{ "refresh_token": "..." }`
**响应**：TokenOut（新的 access_token + refresh_token）

### 获取当前用户信息

```
GET /api/auth/me
Authorization: Bearer <access_token>
```

**响应**：UserOut

### 更新个人资料

```
PATCH /api/auth/profile
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "nickname": "新昵称",
  "avatar": "data:image/jpeg;base64,..."
}
```

**规则**：avatar 最大 200KB 文本。

### 修改密码

```
POST /api/auth/change-password
Authorization: Bearer <access_token>
```

**请求体**：`{ "old_password": "...", "new_password": "..." }`
**规则**：新密码需 ≥8 位且含字母和数字。修改后 `token_version` +1，旧 token 全部失效。

### 查看登录历史

```
GET /api/auth/logins
Authorization: Bearer <access_token>
```

**响应**：LoginLog[] — 按时间倒序。

### 退出所有设备

```
POST /api/auth/logout-all
Authorization: Bearer <access_token>
```

**规则**：`token_version` +1，所有旧 token 失效。返回新 token 对。

### 删除账号

```
DELETE /api/auth/account
Authorization: Bearer <access_token>
```

**请求体**：`{ "password": "..." }`
**规则**：管理员不可删除。级联删除：tasks → orders → login_logs → user。

### 忘记密码

```
POST /api/auth/forgot
```

**请求体**：`{ "email": "user@example.com" }`
**规则**：限流 2 次/秒。生成 6 位验证码（Fernet 加密存储，10 分钟过期）。邮件发送失败不阻断。

### 重置密码

```
POST /api/auth/reset
```

**请求体**：`{ "email": "...", "code": "123456", "new_password": "..." }`
**规则**：验证码解密校验 + 过期校验。成功后 `token_version` +1。

### 查看用量统计

```
GET /api/auth/usage
Authorization: Bearer <access_token>
```

**响应**：UsageOut — 包含近 N 个月用量、当前配额、成员用量明细。

### RBAC 权限查询

```
GET /api/me/permissions
Authorization: Bearer <access_token>
```

**响应**：`{ "permissions": ["*"] }` — admin 返回通配符 `*`。

---

## 4.2 调研任务

### 创建调研

```
POST /api/research
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "product_name": "ChatGPT",
  "competitors": "Claude,Gemini",
  "focus": "定价策略, 功能对比",
  "time_range": "year"
}
```

**规则**：配额检查（个人/企业套餐）。BackgroundTasks 异步触发 `run_research()`。
**响应**：TaskBrief（任务已创建，状态为 `pending`）

### 任务列表

```
GET /api/research
Authorization: Bearer <access_token>
```

**规则**：企业成员可见企业共享任务 + 自己的任务；个人用户仅可见自己的。
**响应**：TaskBrief[]

### 任务详情

```
GET /api/research/{task_id}
Authorization: Bearer <access_token>
```

**响应**：TaskDetail（含 report_markdown、steps、sources、report_data）

### 来源详情

```
GET /api/research/{task_id}/sources/{source_id}
Authorization: Bearer <access_token>
```

**响应**：SourceDetail（含 raw_content 原文 + access_status）

### 来源快照存档

```
GET /api/research/{task_id}/sources/{source_id}/archive
Authorization: Bearer <access_token>
```

**响应**：SourceArchiveOut（含 snapshot_html + snapshot_text + access_status）

### 删除任务

```
DELETE /api/research/{task_id}
Authorization: Bearer <access_token>
```

**规则**：级联删除（steps、sources、source_archives）。

### 报告问答

```
POST /api/research/{task_id}/ask
Authorization: Bearer <access_token>
```

**请求体**：`{ "question": "竞品A的核心优势是什么？" }`
**规则**：任务必须已完成。上下文 = 报告 Markdown (12K 字符) + 前 15 个来源摘要（各 600 字符）。不占额度。
**响应**：AskOut — `{ "answer": "..." }`

### 邮件发送报告

```
POST /api/research/{task_id}/email
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**字段**：`to` (逗号分隔，最多 10 个)、`subject`、`files`（可选附件，总大小 ≤20MB）
**规则**：任务必须已完成。逐封发送，每封最多 10 个收件人。
**响应**：EmailReportOut — `{ "status": "sent", "recipients": 3 }`

### SSE 实时进度

```
GET /api/research/{task_id}/events?token=<access_token>
```

**规则**：EventSource 无法带 Header，所以 token 通过查询参数传递。
**事件类型**：
- `step`：新增执行步骤 `{ "step": { "seq", "phase", "title", "detail" } }`
- `status`：状态变更 `{ "status": "planning" }`

**响应**：text/event-stream，轮询间隔 1 秒。状态进入 `completed`/`failed` 后断开。

---

## 4.3 竞品管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/competitors` | 列表（企业 + 系统模板） |
| POST | `/api/competitors` | 创建（需企业） |
| PATCH | `/api/competitors/{id}` | 更新（owner/admin；系统模板仅 admin） |
| DELETE | `/api/competitors/{id}` | 删除（owner/admin；系统模板仅 admin） |

### 竞品爬虫

> **v5.0.0 说明**：API 端点未变更，但爬虫内部行为已显著改善（语言感知 sitemap、consent overlay 移除、Chrome UA），multi-language 站点（如 /cn/）现在能正确爬取。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/crawl/{cid}/crawl` | 爬取竞品官网信息（结构化提取） |

---

## 4.4 定时追踪

### 创建追踪

```
POST /api/trackers
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "product_name": "ChatGPT",
  "competitors": "Claude,Gemini",
  "focus": "定价策略",
  "time_range": "month",
  "frequency": "weekly",
  "run_hour": 9,
  "push_email": true,
  "push_webhook": false,
  "webhook_type": "wecom",
  "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
}
```

**规则**：仅企业用户可用。校验 tracker 数量上限（按套餐）。
**响应**：TrackerOut

### 追踪列表

```
GET /api/trackers
Authorization: Bearer <access_token>
```

**响应**：TrackerOut[]（含 run_count、last_task_id、can_manage 等计算字段）

### 追踪详情

```
GET /api/trackers/{tracker_id}
Authorization: Bearer <access_token>
```

**响应**：TrackerOut

### 更新追踪

```
PATCH /api/trackers/{tracker_id}
Authorization: Bearer <access_token>
```

**请求体**：TrackerUpdateIn（所有字段可选）
**规则**：仅创建者或企业管理员可修改。

### 删除追踪

```
DELETE /api/trackers/{tracker_id}
Authorization: Bearer <access_token>
```

**规则**：级联删除关联的 ResearchTask。

### 手动触发

```
POST /api/trackers/{tracker_id}/run-now
Authorization: Bearer <access_token>
```

**规则**：配额检查 + 无正在运行的任务。创建 ResearchTask 并异步执行。
**响应**：TrackerRunOut

### 运行历史

```
GET /api/trackers/{tracker_id}/runs
Authorization: Bearer <access_token>
```

**响应**：TrackerRunOut[]（按时间倒序）

---

## 4.5 关系图谱

### 创建图谱

```
POST /api/graph
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "root_name": "华为",
  "industry": "通信",
  "time_range": "year"
}
```

**响应**：GraphProjectOut

### 图谱列表

```
GET /api/graph
Authorization: Bearer <access_token>
```

**规则**：企业成员可见企业图谱 + 自己的图谱。
**响应**：GraphProjectOut[]

### 图谱详情

```
GET /api/graph/{project_id}
Authorization: Bearer <access_token>
```

**响应**：GraphDetailOut（含 entities + relations + report_markdown）

### 重建图谱

```
POST /api/graph/{project_id}/refresh
Authorization: Bearer <access_token>
```

**规则**：校验非 building 状态 + 配额。删除所有实体/关系，重置为 pending。
**响应**：GraphProjectOut

### 删除图谱

```
DELETE /api/graph/{project_id}
Authorization: Bearer <access_token>
```

**响应**：204 No Content

---

## 4.6 竞品画像

### 模板 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/profiles/templates` | 列表（企业 + 系统模板） |
| POST | `/api/profiles/templates` | 创建 |
| PATCH | `/api/profiles/templates/{id}` | 更新（已冻结不可编辑） |
| POST | `/api/profiles/templates/{id}/freeze` | 冻结（admin only） |
| DELETE | `/api/profiles/templates/{id}` | 删除（已冻结不可删除） |

### 画像生成

```
POST /api/profiles/generate
Authorization: Bearer <access_token>
```

**请求体**：`{ "competitor_id": "...", "template_id": "..." }`
**规则**：template 必须已冻结。搜索已完成任务中提及该竞品的来源（最多 20 条，按置信度排序），调用 LLM 生成结构化数据。
**响应**：CompetitorProfileOut

### 画像列表

```
GET /api/profiles
Authorization: Bearer <access_token>
```

**响应**：CompetitorProfileOut[]

### 冻结画像

```
POST /api/profiles/{id}/freeze
Authorization: Bearer <access_token>
```

**规则**：admin only。不可逆。

### 横向对比

```
POST /api/profiles/compare
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "template_id": "...",
  "competitor_ids": ["id1", "id2", "id3"]
}
```

**规则**：至少 2 份冻结画像。取每个维度的第一个字段值做矩阵对比。
**响应**：ComparisonOut

---

## 4.7 企业组织

### 创建企业

```
POST /api/org
Authorization: Bearer <access_token>
```

**请求体**：`{ "name": "某某科技" }`
**规则**：用户不可已属于其他企业。创建后用户成为 owner。
**响应**：OrgOut

### 我的企业

```
GET /api/org/me
Authorization: Bearer <access_token>
```

**响应**：OrgMeOut — `{ "org": OrgOut | null, "org_role": "", "member_count": 0 }`

### 更新企业

```
PATCH /api/org
Authorization: Bearer <access_token>
```

**请求体**：`{ "name": "新名称" }`
**规则**：仅 owner/admin 可修改。

### 重置邀请码

```
POST /api/org/invite-code/reset
Authorization: Bearer <access_token>
```

**规则**：仅 owner/admin。生成新的 8 位邀请码。

### 加入企业

```
POST /api/org/join
Authorization: Bearer <access_token>
```

**请求体**：`{ "invite_code": "ABCD1234" }`
**规则**：用户不可已属于其他企业。

### 成员列表

```
GET /api/org/members
Authorization: Bearer <access_token>
```

**响应**：MemberOut[]（含 org_role、month_used、permissions）

### 更新成员

```
PATCH /api/org/members/{member_id}
Authorization: Bearer <access_token>
```

**请求体**：
```json
{
  "org_role": "admin",
  "org_monthly_limit": 10
}
```

**规则**：仅 owner/admin。不可修改 owner。

### 设置成员权限

```
POST /api/org/members/{member_id}/permissions
Authorization: Bearer <access_token>
```

**请求体**：`{ "permissions": ["source:register", "profile:generate"] }`
**规则**：仅 owner/admin。替换全部权限。

### 移除成员

```
DELETE /api/org/members/{member_id}
Authorization: Bearer <access_token>
```

**规则**：不可移除 owner 或自己。清除 org_id/org_role/org_monthly_limit。

### 退出企业

```
POST /api/org/leave
Authorization: Bearer <access_token>
```

**规则**：owner 仅在最后一个成员时可退出（解散企业）。

---

## 4.8 通知

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications` | 最近 50 条通知 |
| GET | `/api/notifications/unread-count` | 未读数量 |
| POST | `/api/notifications/read` | 标记已读（body: `{ "id": "" }`，空 = 全部） |

---

## 4.9 账单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/billing/plans` | 全部套餐列表 |
| POST | `/api/billing/upgrade` | 升级套餐（模拟支付） |
| GET | `/api/billing/orders` | 我的订单列表 |

**升级规则**：企业用户需 owner/admin 角色。同套餐续费自动延长期限。

---

## 4.10 管理后台

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 平台统计（用户/任务/收入） |
| GET | `/api/admin/users` | 用户列表（分页 + 搜索） |
| PATCH | `/api/admin/users/{id}` | 修改用户 plan/role |
| GET | `/api/admin/orgs` | 企业列表（分页 + 搜索） |
| PATCH | `/api/admin/orgs/{id}` | 修改企业 plan |
| GET | `/api/admin/audit-logs` | 审计日志（分页 + 过滤） |
| GET | `/api/admin/execution-snapshots` | 执行快照列表 |

**全部路由** 需要 `get_current_admin` 依赖。

---

## 4.11 AI 助手

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/assistant/sessions` | 我的会话列表 |
| PATCH | `/api/assistant/sessions/{id}` | 重命名会话 |
| DELETE | `/api/assistant/sessions/{id}` | 删除会话（级联消息） |
| GET | `/api/assistant/sessions/{id}/messages` | 会话消息（最近 100 条） |
| DELETE | `/api/assistant/sessions/{id}/messages` | 清空消息 |
| POST | `/api/assistant/ask` | 向助手提问 |

**提问流程**：
1. 用户提问 → 持久化用户消息
2. 检索可见已完成报告（最多选 3 篇，LLM 选择 + 关键词回退）
3. 构建上下文（每篇报告 8000 字符 + 变更摘要 2000 字符）
4. 取最近 6 条对话历史
5. LLM 多轮对话 → 持久化助手回复 + 引用链接

---

## 4.12 健康检查

```
GET /api/health
```

**响应**：`{ "status": "ok" }`
