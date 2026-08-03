# 06. 前端架构

> 版本：v5.5.0 · 分支：agent-v5
> 更新日期：2026-08-03

## 6.1 技术栈

| 库 | 用途 |
|----|------|
| React 18 | UI 框架 |
| TypeScript | 类型系统 |
| Vite 5 | 构建工具 |
| Tailwind CSS 4 | 样式框架 |
| react-router-dom v6 | 路由 |
| lucide-react | 图标库 |
| recharts | 图表（雷达图、评分条、趋势图） |
| ReactFlow | 图谱可视化画布 |
| react-markdown + remark-gfm | Markdown 渲染 |
| html2pdf.js | PDF 导出 |

## 6.2 路由结构

### 公开路由（无需认证）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | LandingPage | 公开首页（品牌介绍 + 功能 + 定价） |
| `/login` | LoginPage | 登录表单 |
| `/register` | RegisterPage | 注册表单 |
| `/forgot-password` | ForgotPasswordPage | 两步密码重置 |

### 认证路由（需 RequireAuth）

所有 `/app/*` 路由包裹在 `AppLayout` 布局中，包含固定侧边栏 + 全局通知铃铛 + AI 悬浮球。

| 路径 | 页面 | 侧边栏图标 | 说明 |
|------|------|-----------|------|
| `/app` | DashboardPage | LayoutDashboard | 仪表盘（默认首页） |
| `/app/new` | NewResearchPage | Plus | 新建调研 |
| `/app/tasks` | TasksPage | FileText | 调研记录列表 |
| `/app/tasks/:id` | TaskDetailPage | — | 调研详情 + 报告 + 洞察 + 来源 |
| `/app/trackers` | TrackersPage | Clock | 定时追踪列表 |
| `/app/trackers/:id` | TrackerDetailPage | — | 追踪详情 + 趋势 |
| `/app/competitors` | CompetitorsPage | Building2 | 竞品管理 |
| `/app/profiles/templates` | ProfileTemplatesPage | Layers | 画像模板 |
| `/app/profiles` | ProfilesPage | Sparkles | 竞品画像 |
| `/app/profiles/:id` | ProfileDetailPage | — | 画像详情 |
| `/app/profiles/compare` | ComparisonPage | GitCompare | 画像横向对比 |
| `/app/graph` | GraphPage | Network | 关系图谱列表 |
| `/app/graph/:id` | GraphDetailPage | — | 图谱详情 + 可视化画布 |
| `/app/assistant` | AssistantPage | Bot | AI 助手 |
| `/app/admin/audit-logs` | AuditLogsPage | FileText | 审计日志（独立页面） |
| `/app/pricing` | PricingPage | Gem | 套餐升级 |
| `/app/account` | AccountPage | User | 个人中心（含企业 Tab） |
| `/app/admin` | AdminPage | Shield | 管理后台（需 RequireAdmin） |

### 路由守卫

| 守卫 | 位置 | 逻辑 |
|------|------|------|
| `RequireAuth` | `App.tsx` | 未登录 → 跳转 `/login`；loading → 显示 spinner |
| `RequireAdmin` | `App.tsx` | 非 admin → 跳转 `/app`；额外调用 `/api/admin/stats` 验证 |

## 6.3 布局结构

### AppLayout（侧边栏 Shell）

```
┌──────────────────────────────────────────────────────┐
│  aside (固定, w-56, bg-slate-900)                    │
│  ├── Logo                                          │
│  ├── nav (可滚动)                                   │
│  │   ├── 仪表盘                                     │
│  │   ├── 新建调研                                   │
│  │   ├── 调研记录                                   │
│  │   ├── 定时追踪                                   │
│  │   ├── 竞品管理                                   │
│  │   ├── 画像模板                                   │
│  │   ├── 竞品画像                                   │
│  │   ├── 横向对比                                   │
│  │   ├── 关系图谱                                   │
│  │   ├── AI 助手                                    │
│  │   ├── ...                                        │
│  │   └── 管理后台 (admin only)                      │
│  └── User footer                                   │
│      ├── avatar / 昵称首字母                         │
│      ├── PlanBadge (有效套餐)                        │
│      ├── 管理员标签 (admin only)                     │
│      └── 退出按钮                                   │
├──────────────────────────────────────────────────────┤
│  main (ml-56, flex-1)                               │
│  ├── NotificationBell (全局)                         │
│  ├── Outlet (页面内容)                               │
│  └── AssistantWidget (AI 悬浮球, 除助手页面外)        │
└──────────────────────────────────────────────────────┘
```

## 6.4 状态管理

### AuthContext（全局认证状态）

| 状态 | 类型 | 说明 |
|------|------|------|
| `user` | `User \| null` | 当前登录用户 |
| `ready` | `boolean` | 会话恢复是否完成 |

| 方法 | 说明 |
|------|------|
| `login(email, password)` | 登录 |
| `register(email, password, nickname)` | 注册 |
| `logout()` | 登出（清除 token） |
| `refreshUser()` | 重新获取用户信息（升级套餐后） |
| `updateUser(user)` | 直接更新状态（编辑资料后） |

**会话恢复**：组件挂载时检查 localStorage 中的 token，若有则调用 `/api/auth/me` 恢复用户状态。

### 全局 Hooks

| Hook | 文件 | 用途 |
|------|------|------|
| `useErrorHandler` | `hooks/useErrorHandler.ts` | 统一错误处理 |
| `usePageTitle` | `hooks/usePageTitle.ts` | 页面标题管理 |

### 工具函数

| 工具 | 文件 | 用途 |
|------|------|------|
| `cn` | `utils/cn.ts` | 类名合并 + 输入框样式常量 |

### 组件级状态

无全局状态管理库（Redux/Zustand 等），各页面使用 `useState` + `useEffect` 管理本地状态。

## 6.5 API 客户端

### 核心基础设施

**文件**：`src/api/client.ts`（~600 行）

| 功能 | 实现 |
|------|------|
| Token 存储 | localStorage：`cr_token` (access), `cr_refresh` (refresh) |
| 请求封装 | `request<T>()` — 自动注入 Bearer token |
| 401 处理 | 自动 refresh → 重试原请求（Singleton 模式防并发） |
| 错误解析 | 提取 FastAPI `detail` 字段 |
| SSE 订阅 | `subscribeEvents(taskId, onStep, onStatus)` |

### API 函数清单

| 模块 | 函数数 | 端点数 |
|------|--------|--------|
| 认证 | 12 | register, login, me, profile, change-password, logins, logout-all, delete-account, forgot, reset, refresh, usage |
| 调研 | 8 | create, list, get, source detail, archive, delete, ask, email, events (SSE) |
| 追踪 | 7 | create, list, get, update, delete, run-now, runs |
| 图谱 | 5 | create, list, get, refresh, delete |
| 企业 | 9 | create, me, update, invite-code/reset, join, members, member update, member remove, leave, permissions |
| 竞品 | 5 | list, create, update, delete, crawl |
| 画像 | 11 | templates CRUD + freeze, generate, getGenerateStatus, list, freeze, compare, detail, full-report |
| 权限 | 2 | my permissions, set member permissions |
| 账单 | 3 | plans, upgrade, orders |
| 管理 | 6 | stats, users, user update, orgs, org update, audit-logs, execution-snapshots |
| 通知 | 3 | list, unread-count, mark read |
| 助手 | 6 | sessions list/rename/delete, messages list/clear, ask |

**总计**：约 60 个 API 函数。

## 6.6 前端页面详解

### DashboardPage（仪表盘）

- **数据源**：`getQuota()` + `listResearch()`
- **UI**：4 张统计卡（套餐/额度/完成数/进行中）+ 最近 5 条任务列表

### NewResearchPage（新建调研）

- **数据源**：`getQuota()`（检查配额）
- **表单**：调研对象（必填）、指定竞品、调研重点、信息时效
- **特殊**：提交后通过 `location.state` 传递 TaskBrief 给详情页，跳过加载闪烁

### TasksPage（调研记录）

- **数据源**：`listResearch()`，每 3 秒轮询
- **筛选**：全部 / 我创建的 / 成员创建的
- **操作**：删除（运行中隐藏）

### TaskDetailPage（调研详情）⭐ 最复杂的页面

**状态**：`task`、`steps`、`status`、`tab`、多个 filter 和 drawer

**运行态**：
- 暗色执行头 + 耗时计数器
- PhaseStepper（六阶段进度条：planning → searching → analyzing[洞察] → analyzing[时间线] → reporting → done）
- StepTimeline（自动滚动步骤日志）

**完成态**（三 Tab）：

| Tab | 内容 |
|-----|------|
| report | 变更摘要 banner + 报告封面 + ReportView（TOC + Markdown 渲染）+ Q&A |
| insights | 结论卡片 + ScoreRadar + ScoreBars + SwotGrid + 定位卡 + 时间线 |
| sources | 统计卡 + 可信度分布条 + 分级/维度筛选 + 三种排序 + SourceCard 双列 + 详情抽屉（含快照状态） |

**操作**：导出（PDF/Word/MD/打印）、邮件发送、来源详情抽屉、报告问答

### TrackersPage / TrackerDetailPage

- 轮询（5 秒）
- TrackerForm 组件（创建/编辑）
- ScoreTrend 趋势图
- 手动触发运行 → 跳转任务详情

### CompetitorsPage

- CRUD 弹窗表单
- 关键词逗号分隔输入
- 爬虫功能

### ProfilesPage / ProfileTemplatesPage / ProfileDetailPage / ComparisonPage

- 模板 CRUD（dimensions 以 JSON 文本编辑，冻结后不可编辑）
- 画像生成：选择竞品 + 模板 → 异步任务（`getGenerateStatus` 轮询） → 完成
- 画像生成支持两种来源：调研任务来源 / 爬虫页面来源（自动合并）
- 冻结锁定（不可逆）
- 横向对比矩阵（至少 2 份冻结画像）
- ProfileDetailPage 增加"信息来源"Tab：按 tier 筛选 + SourceCard + SourceDrawer

### GraphPage / GraphDetailPage

- GraphPage：创建弹窗 + 状态感知卡片 + 轮询（4 秒）
- GraphDetailPage：ReactFlow 画布 + 确定性布局 + 右侧详情抽屉 + 报告面板 + 实体转追踪

### AuditLogsPage（审计日志）

- 独立页面，完整筛选器（action/resource_type/user_id/时间范围）
- 分页表格（时间/用户/组织/操作类型/资源/状态/模型/token/错误）
- 加载状态和空状态提示

### AssistantPage

- 双栏布局：会话列表 + 聊天面板
- 新建会话（null sessionId）+ 重命名 + 删除
- AssistantChat 组件复用（悬浮球 + 独立页共享）

### AdminPage

- 5 列统计卡
- 用户管理表格（plan/role 下拉修改）
- 企业管理表格（plan 下拉修改）
- 审计日志子组件（内嵌，独立页面 AuditLogsPage 已拆分）
- 执行快照列表

### AccountPage

- URL 驱动 Tab：`?tab=overview` / `?tab=security` / `?tab=org` / `?tab=orders`
- OverviewTab：头像压缩上传 + 内联编辑昵称 + 用量柱状图
- SecurityTab：改密 + 登录历史 + 退出所有设备 + 注销账号
- OrgTab：OrgPanel 组件（创建/加入/成员管理/成员月额度/RBAC 权限/邀请码）
- OrdersTab：订单列表

## 6.7 可复用组件

| 组件 | 文件 | 用途 |
|------|------|------|
| PhaseStepper | `PhaseStepper.tsx` | 六阶段执行进度条 |
| StepTimeline | `StepTimeline.tsx` | 步骤时间线（自动滚动） |
| SourceCard | `SourceCard.tsx` | 来源卡片（分级/评分/新鲜度/摘要/置信度） |
| SourceDrawer | `SourceDrawer.tsx` | 来源详情滑出抽屉（含快照状态） |
| TrackerForm | `TrackerForm.tsx` | 追踪项创建/编辑表单 |
| ReportView | `ReportView.tsx` | 报告 Markdown 渲染 + TOC |
| ScoreRadar | `ScoreRadar.tsx` | 五维评分雷达图 |
| ScoreBars | `ScoreBars.tsx` | 评分条形对比 |
| SwotGrid | `SwotGrid.tsx` | SWOT 四象限 |
| ScoreTrend | `ScoreTrend.tsx` | 评分趋势折线图 |
| StatusBadge | `StatusBadge.tsx` | 状态徽章 |
| ConfirmDialog | `ConfirmDialog.tsx` | 确认弹窗 |
| QuotaErrorBanner | `QuotaErrorBanner.tsx` | 配额不足提示 |
| NotificationBell | `NotificationBell.tsx` | 通知铃铛（30 秒轮询） |
| AssistantWidget | `AssistantWidget.tsx` | AI 悬浮球 |
| AssistantChat | `AssistantChat.tsx` | AI 聊天面板 |
| OrgPanel | `OrgPanel.tsx` | 企业面板（创建/加入/成员管理） |
| AuthShell | `AuthShell.tsx` | 登录/注册页布局 |
| ErrorBoundary | `ErrorBoundary.tsx` | 错误边界 |
| PlanBadge | `PlanBadge.tsx` | 套餐徽章 |
| Skeleton | `Skeleton.tsx` | 骨架屏加载 |
| ProfileGenProgress | `ProfileGenProgress.tsx` | 画像生成进度 |
| ReportToc | `ReportToc.tsx` | 报告目录（scroll spy） |
| ReadingProgress | `ReadingProgress.tsx` | 阅读进度条 |
| BackToTop | `BackToTop.tsx` | 回到顶部 |
| ChartCard | `ChartCard.tsx` | 图表卡片容器 |
| TierBadge | `TierBadge.tsx` | 来源分级徽章 |
| RunHistoryItem | `RunHistoryItem.tsx` | 追踪期次历史项 |

## 6.8 前端特殊模式

### 轮询模式

| 页面 | 间隔 | 触发条件 |
|------|------|----------|
| TasksPage | 3s | 组件挂载时持续轮询 |
| TrackersPage | 5s | 有 tracker 处于 running |
| TrackerDetailPage | 5s | 有 run 处于 active |
| GraphPage / GraphDetailPage | 4s | 状态为 building/pending |
| NotificationBell | 30s | 组件挂载时持续轮询未读数 |

### SSE 模式

| 页面 | 用途 |
|------|------|
| TaskDetailPage | 调研任务实时进度（step + status 事件） |

### 导出模式

| 格式 | 实现 |
|------|------|
| PDF | html2pdf.js，A4 竖版，703px 宽度渲染 |
| Word | HTML MIME（MSO namespace + @page Section1） |
| Markdown | Blob 下载 |
| 打印 | window.print() + CSS print media query |
