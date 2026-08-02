# 竞品调研 Agent — 前端完整分析与改造方案

> 分析日期：2026-08-02 | 分支：agent-v5 | 核查方式：逐文件回查验证
> **版本**：v5.1 — 爬虫多语言站点修复

---

## 目录

1. [架构概览](#一架构概览)
2. [页面功能详析](#二页面功能详析)
3. [发现的问题](#三发现的问题)
4. [改造方案](#四改造方案)
5. [技术评审](#五技术评审)

---

## 一、架构概览

### 1.1 路由结构

```
/                          LandingPage（公开落地页）
/login                     LoginPage
/register                  RegisterPage
/forgot-password           ForgotPasswordPage

/app                       AppLayout（侧栏导航 + Outlet）
├── /                      DashboardPage（仪表盘）
├── /new                   NewResearchPage（新建调研）
├── /tasks                 TasksPage（调研记录列表）
├── /tasks/:id             TaskDetailPage（调研详情）
├── /trackers              TrackersPage（定时追踪列表）
├── /trackers/:id          TrackerDetailPage（追踪详情）
├── /competitors           CompetitorsPage（竞品管理）
├── /profiles/templates    ProfileTemplatesPage（画像模板）
├── /profiles              ProfilesPage（竞品画像列表+生成器）
├── /profiles/:id          ProfileDetailPage（画像详情）
├── /profiles/compare      ComparisonPage（横向对比）
├── /profiles/tasks        ProfileTasksPage（画像提取任务）
├── /graph                 GraphPage（关系图谱列表）
├── /graph/:id             GraphDetailPage（图谱详情）
├── /assistant             AssistantPage（AI 助手）
├── /pricing               PricingPage（套餐升级）
├── /account               AccountPage（个人中心，4 Tab）
├── /admin                 AdminPage（管理后台）
└── /admin/audit-logs      AuditLogsPage（审计日志）
```

### 1.2 侧栏导航（15 个入口）

| # | 入口 | 路由 | 页面类型 |
|---|------|------|---------|
| 1 | 仪表盘 | `/app` | 首页 |
| 2 | 新建调研 | `/app/new` | 表单页 |
| 3 | 调研记录 | `/app/tasks` | 列表页 |
| 4 | 定时追踪 | `/app/trackers` | 列表页 |
| 5 | 竞品管理 | `/app/competitors` | CRUD 管理页 |
| 6 | 画像模板 | `/app/profiles/templates` | CRUD 管理页 |
| 7 | 竞品画像 | `/app/profiles` | 生成器+列表 |
| 8 | 画像任务 | `/app/profiles/tasks` | 任务状态列表 |
| 9 | 横向对比 | `/app/profiles/compare` | 对比工具 |
| 10 | 关系图谱 | `/app/graph` | 列表页 |
| 11 | AI 助手 | `/app/assistant` | 对话页面 |
| 12 | 套餐升级 | `/app/pricing` | 定价页 |
| 13 | 个人中心 | `/app/account` | Tab 切换页 |
| 14 | 管理后台 | `/app/admin` | 后台管理（管理员可见） |
| 15 | 审计日志 | `/app/admin/audit-logs` | 审计日志（管理员可见） |

> 入口定义在 `AppLayout.tsx:27-41`（平铺数组），14/15 通过 `user?.role === 'admin'` 条件渲染。

### 1.3 技术栈

| 维度 | 现状 |
|------|------|
| 状态管理 | 无外部库。纯 React Context（仅 `AuthContext`）+ 页面内 `useState` |
| 数据获取 | 每个页面独立 `useEffect` → `fetch`。无缓存层 |
| 实时更新 | SSE（TaskDetailPage）+ `setInterval` 轮询（3-5 秒） |
| 路由 | React Router v6，嵌套路由 |
| UI | Tailwind CSS + Lucide 图标 + react-markdown + ReactFlow |
| 后端对齐 | 79/83 端点已接入；3 个未用 + 1 个前端死调用 |

### 1.4 后端对齐缺口

| 端点 | 位置 | 状态 |
|------|------|------|
| `GET /api/admin/audit-logs/stats` | `admin.py:227` | 已实现，前端未用 |
| `GET /api/admin/audit-logs/export` | `admin.py:275` | 已实现（CSV，10000 条上限），前端未用 |
| `GET /api/admin/execution-snapshots` | 无路由 | 前端 `client.ts:473` 有调用，后端无路由，DB 表已定义（`main.py:137`），半成品 |

### 1.5 现有组件清单（27 个）

`AssistantChat`、`AssistantWidget`、`AuthShell`、`BackToTop`、`ChartCard`、`ConfirmDialog`、`ErrorBoundary`、`NotificationBell`、`OrgPanel`、`PhaseStepper`、`PlanBadge`、`ProfileGenProgress`、`QuotaErrorBanner`、`ReadingProgress`、`ReportToc`、`ReportView`、`RunHistoryItem`、`ScoreBars`、`ScoreRadar`、`ScoreTrend`、`Skeleton`（未使用）、`SourceCard`、`SourceDrawer`、`StatusBadge`、`StepTimeline`、`SwotGrid`、`TierBadge`、`TrackerForm`

---

## 二、页面功能详析

### 2.1 DashboardPage（仪表盘）

**功能**：4 个统计卡片（套餐、额度、完成数、进行中）+ 最近 5 条任务列表。单次 API 调用（`getQuota` + `listResearch`），无轮询。

**评价**：功能完整但单薄。没有趋势图，没有快速操作区。

### 2.2 NewResearchPage（新建调研）

**功能**：产品名（必填）+ 竞品 + 重点 + 时效 → 创建 → 跳转详情页。额度检查、路由 `location.state` 秒传任务概要避免加载闪屏。

**评价**：完善。

### 2.3 TasksPage（调研记录）— 需要改进

**功能**：列表（3 秒轮询）+ 筛选（全部/我的/成员）+ 删除确认。

**缺失**：
- 无搜索框（按产品名称/竞品搜索）
- 无状态筛选（只看进行中/已完成/失败）
- 无分页（量大时撑爆页面）
- 无排序

**代码证据**：`Filter` 类型仅 `'all' | 'mine' | 'others'`（`TasksPage.tsx:13`）；`RUNNING` 集合定义了但仅用于轮询指示器，未用于筛选（`TasksPage.tsx:11`）。

### 2.4 TaskDetailPage（调研详情）

**功能**：最复杂的页面（875 行）。运行中展示 SSE 实时进度（PhaseStepper + StepTimeline + 计时器）；完成后 3 个 Tab：
- **调研报告**：封面头 + Markdown 渲染（引用角标）+ TOC + 追问（AI Q&A，不持久化）
- **数据洞察**：结论 + 雷达图 + 评分柱状图 + SWOT + 定位卡片 + 事件时间线
- **信息来源**：统计卡 + 可信度分布 + 新鲜度 + 层级/维度筛选 + 排序 + SourceCard 网格 + SourceDrawer

**附加**：导出（PDF/Word/MD/打印）、邮件发送、执行过程折叠展开。

**评价**：旗舰页面，功能完善。

### 2.5 TrackersPage + TrackerDetailPage（定时追踪）

**功能**：
- **列表**：卡片 + 启用/暂停 toggle + 立即运行 + 编辑 + 删除。「全部/我创建」筛选。5 秒轮询（仅运行中时）。无 org 用户看到空状态引导。
- **详情**：评分趋势图（≥2 期渲染）+ 运行历史时间线。每期有「查看完整报告 →」链接（`RunHistoryItem.tsx:46`，跳转 `/app/tasks/{run.id}`）。

**缺失**：
- 无按频率筛选（只看每日/每周/每月）
- 无搜索

### 2.6 CompetitorsPage（竞品管理）— 需要拆分

**功能**：卡片式 CRUD + 展开式爬取详情 + 批量画像生成。

**内部状态**：9 个 useState（items、templates、expandedCrawl、crawling、crawlTasks、crawlPages、pollTimers、genTasks、genPollTimers），537 行单体。

**爬取交互**：点击展开 → `getCrawlStatus` + `listCrawlPages` → 2 秒轮询 → 完成后自动收起刷新。

**画像生成**：Sparkles 按钮 → `generateProfileFromCrawl`（异步）→ 2 秒轮询 `getGenerateStatus` → 完成后刷新。

**缺失**：
- 无状态筛选（`STATUS_BADGE`/`STATUS_LABEL` 已定义但仅用于卡片徽章，`CompetitorsPage.tsx:10-20`）
- 无搜索
- 内联展开在竞品多时页面过长

### 2.7 ProfileTemplatesPage（画像模板）

**功能**：模板 CRUD + 冻结/解冻。JSON 文本域编辑维度。

**缺失**：可视化编辑器（非技术用户难以理解 JSON 结构）。

### 2.8 ProfilesPage（竞品画像）— 有 Bug

**功能**：顶部生成器 + 下方画像卡片列表。

**已确认 Bug**（`ProfilesPage.tsx:58-71`）：

```tsx
// handleGenerateFromCrawl — 实际调用的是同步接口
await generateProfileApi({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
```

后端两个端点的区别：

| 端点 | 返回值 | 行为 |
|------|--------|------|
| `POST /api/profiles/generate` | 201 + 完整画像 | 同步 `await generate_profile()` |
| `POST /api/profiles/generate-from-crawl` | 202 + `{task_id, status}` | 异步后台任务，需轮询 |

"基于爬取页面"按钮调的是同步接口，未利用爬取数据，也无进度跟踪。

**缺失**：画像卡片无摘要预览。

### 2.9 ProfileDetailPage（画像详情）

**功能**：维度数据展示 + 来源引用 + 冻结/重新生成/加入对比。

**评价**：完善。一次性加载全部 profiles + competitors + templates 后本地查找。

### 2.10 ComparisonPage（横向对比）

**功能**：选择模板 → 选 2+ 画像 → 对比矩阵表。

**缺失**：无可视化图表（`ScoreRadar`/`ScoreBars` 已存在但未复用）。无导出。

### 2.11 ProfileTasksPage（画像提取任务）

**功能**：3 秒轮询监控异步画像提取任务状态。已完成任务可点击跳转。

**缺失**：无「重新生成」「取消」按钮。

### 2.12 GraphPage + GraphDetailPage（关系图谱）

**功能**：列表 + ReactFlow 交互图谱 + 详情抽屉 + 分析报告抽屉 + 纳入追踪。

**评价**：非常完善。

### 2.13 AssistantPage（AI 助手）

**功能**：左侧会话列表 + 右侧对话面板。

**缺失**：移动端（`< md`）隐藏侧栏，无法新建/切换会话。

### 2.14 AccountPage（个人中心）

**功能**：4 个 Tab（概览/安全/企业/订单）。URL 参数 `?tab=` 驱动。

**评价**：功能完善。OrgPanel 嵌入企业 Tab，内容较重。

### 2.15 AdminPage（管理后台）

**功能**：5 统计卡片 + 用户管理表格（搜索/分页/改套餐/改角色）+ 企业管理表格（搜索/分页/改套餐）。

**Pagination 组件**：AdminPage 内定义了一套（第 13-39 行），用户表和企业表共用。`AuditLogsPage` 内有另一套独立实现（各约 26 行，代码几乎相同）。

**缺失**：无审计日志入口（侧栏有但 AdminPage 内无引导）。

### 2.16 AuditLogsPage（审计日志）

**功能**：筛选栏 + 分页表格（20 条/页）。

**未接入**：后端 `/audit-logs/stats` 和 `/audit-logs/export` 均未使用。

---

## 三、发现的问题

### P0 — Bug 与阻塞性问题

| # | 问题 | 位置 | 证据 |
|---|------|------|------|
| 1 | "基于爬取页面"按钮调错 API | `ProfilesPage.tsx:63` | 调用 `generateProfileApi`（同步 201）而非 `generateProfileFromCrawl`（异步 202） |
| 2 | TasksPage 无搜索、无状态筛选、无分页 | `TasksPage.tsx:13-45` | `Filter` 类型仅 3 个值，无 `TaskStatus` 筛选 |
| 3 | CompetitorsPage 无状态筛选、无搜索 | `CompetitorsPage.tsx:10-20` | `STATUS_BADGE` 仅用于卡片展示，无筛选逻辑 |

### P1 — 体验明显不足

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 4 | ComparisonPage 仅表格无可视化 | `ComparisonPage.tsx:126-153` | `ScoreRadar`/`ScoreBars` 组件已存在但未复用 |
| 5 | ProfilesPage 卡片无摘要预览 | `ProfilesPage.tsx:148-174` | 卡片只显示名称/模板/状态/时间 |
| 6 | ProfileTemplatesPage JSON 编辑门槛高 | `ProfileTemplatesPage.tsx:151` | 纯文本域编辑 JSON |
| 7 | AdminPage 无审计日志入口 | `AdminPage.tsx` | 全页无跳转链接 |

### P2 — 体验优化

| # | 问题 | 位置 |
|---|------|------|
| 8 | 侧栏 15 入口平铺无分组 | `AppLayout.tsx:27-41` |
| 9 | DashboardPage 无趋势图 | `DashboardPage.tsx` |
| 10 | ProfileTasksPage 无操作按钮 | `ProfileTasksPage.tsx` |
| 11 | AuditLogsPage 导出未接 | `AuditLogsPage.tsx` |
| 12 | Skeleton 组件定义了但未使用 | `components/Skeleton.tsx` |

### P3 — 架构层面

| # | 问题 | 说明 |
|---|------|------|
| 13 | 无缓存层 | 每次导航重新请求，3-5s 轮询频繁 |
| 14 | 移动端适配 | 侧栏固定 14rem，AI 助手移动端隐藏侧栏 |
| 15 | 静默失败 | 多处 `.catch(() => {})` |

### 未使用的代码

- `components/Skeleton.tsx` — `CardSkeleton`、`ListSkeleton` 定义了但无任何页面导入
- `hooks/useErrorHandler.ts` — hook 定义了但无任何页面或组件使用

---

## 四、改造方案

### 设计原则

1. **每次改动独立可回滚** — 不搞大爆炸重写
2. **优先复用已有组件** — `ScoreRadar`、`ScoreBars`、`Skeleton`、`ConfirmDialog`、`ChartCard` 都已写好
3. **先补缺口再重构结构** — 先修 bug、补功能，再拆组件、加缓存

---

## Phase 0：快速修复（~2 小时，6 项）

所有改动各自独立，可同时合入。

### 0.1 修复 ProfilesPage "基于爬取页面" Bug

**改**：`frontend/src/pages/app/ProfilesPage.tsx:58-71`

将 `handleGenerateFromCrawl` 从调用 `generateProfileApi`（同步 201）改为调用 `generateProfileFromCrawl`（异步 202），并加入轮询逻辑。模式和 `CompetitorsPage` 的 `handleQuickGenerate`（`CompetitorsPage.tsx:190-242`）完全一致，已有成熟代码可复用。

**关键改动**：
- 调用 `generateProfileFromCrawl` 获取 `task_id`
- 用 `setInterval` 每 2 秒轮询 `getGenerateStatus(taskId)`
- 完成后 `reload()` + 显示 notice
- 清理定时器

### 0.2 TasksPage 添加状态筛选

**改**：`frontend/src/pages/app/TasksPage.tsx`

在现有「全部/我的/成员」筛选按钮组下方，增加状态筛选 pill 行：

```
全部 | 进行中 | 已完成 | 失败
```

复用现有按钮组样式（`bg-gray-100 p-1` 容器 + `rounded-md px-4 py-1.5` 按钮）。新增 `StatusFilter` 类型和 `statusFilter` state，筛选逻辑：

```tsx
const statusFiltered = visible.filter(t => {
  if (statusFilter === 'running') return RUNNING.has(t.status)
  if (statusFilter === 'completed') return t.status === 'completed'
  if (statusFilter === 'failed') return t.status === 'failed'
  return true
})
```

### 0.3 CompetitorsPage 添加状态筛选 + 搜索框

**改**：`frontend/src/pages/app/CompetitorsPage.tsx`

- 标题行右侧增加搜索输入框（`placeholder="搜索竞品名称…"`），绑定 `search` state
- 卡片列表上方增加状态筛选 pill：`全部 | 启用中 | 已暂停 | 已归档`
- 筛选逻辑：`items.filter(c => statusFilter === 'all' || c.status === statusFilter).filter(c => matchSearch(c))`

### 0.4 侧栏导航分组

**改**：`frontend/src/layouts/AppLayout.tsx`

将 `NAV` 数组从平铺改为分组结构：

```tsx
const NAV_GROUPS = [
  { label: '调研', items: [
    { to: '/app', label: '仪表盘', icon: LayoutDashboard, end: true },
    { to: '/app/new', label: '新建调研', icon: Plus },
    { to: '/app/tasks', label: '调研记录', icon: FileText },
  ]},
  { label: '追踪', items: [
    { to: '/app/trackers', label: '定时追踪', icon: Clock },
    { to: '/app/competitors', label: '竞品管理', icon: Building2 },
  ]},
  { label: '画像', items: [
    { to: '/app/profiles/templates', label: '画像模板', icon: Layers, end: true },
    { to: '/app/profiles', label: '竞品画像', icon: Sparkles, end: true },
    { to: '/app/profiles/tasks', label: '画像任务', icon: ClipboardList },
    { to: '/app/profiles/compare', label: '横向对比', icon: GitCompare },
  ]},
  { label: '图谱', items: [
    { to: '/app/graph', label: '关系图谱', icon: Network },
  ]},
  { label: '助手', items: [
    { to: '/app/assistant', label: 'AI 助手', icon: Bot },
  ]},
  { label: '系统', items: [
    { to: '/app/pricing', label: '套餐升级', icon: Gem },
    { to: '/app/account', label: '个人中心', icon: User },
  ]},
]
```

渲染时每组先渲染 `<p className="px-3 text-xs text-slate-500 mt-4 mb-1 font-medium">{label}</p>`，然后 map items。管理员入口单独放在最底部。

### 0.5 AuditLogsPage 导出 CSV

**改**：`frontend/src/pages/app/AuditLogsPage.tsx` + `frontend/src/api/client.ts`

1. `client.ts` 新增 `exportAuditLogs` 函数 — 因为 CSV 返回的是 `text/csv` 而非 JSON，不能走通用 `request()`（它会 `resp.json()` 解析），需要单独处理：

```ts
export function exportAuditLogs(params: {
  action?: string; resource_type?: string; user_id?: string; start?: string; end?: string
}): Promise<Blob> {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v) })
  const token = tokenStore.get()
  return fetch(`/api/admin/audit-logs/export?${p}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => r.blob())
}
```

2. `AuditLogsPage` 筛选栏右侧添加「导出 CSV」按钮，点击后用 `URL.createObjectURL(blob)` + `<a download>` 触发下载。

### 0.6 Skeleton 组件投入使用

**改**：`TasksPage.tsx`、`CompetitorsPage.tsx`、`TrackersPage.tsx`、`ProfilesPage.tsx`、`AdminPage.tsx`、`AuditLogsPage.tsx`

将各页面 `加载中…` 文本替换为：
- 列表页 → `<ListSkeleton count={5} />`
- 卡片页 → 多列 `<CardSkeleton />`

`Skeleton.tsx` 中两个组件已定义好，直接导入。

---

## Phase 1：组件拆分（1.5 天）

### 1.1 抽离共享 Pagination 组件

**新建**：`frontend/src/components/Pagination.tsx`

取 AdminPage（第 13-39 行）和 AuditLogsPage 两套实现的并集，支持 `page`、`totalPages`、`total`、`onChange`，以及可选的 `pageSize` 显示。

**删除**：AdminPage 和 AuditLogsPage 内的两套 Pagination 副本。

### 1.2 拆分 CompetitorsPage 为三个组件

**新建**：
- `frontend/src/components/CompetitorCard.tsx` — 单张竞品卡片
- `frontend/src/components/CrawlPanel.tsx` — 爬取进度展开区

**修改**：`CompetitorsPage.tsx` 缩减为 ~100 行的容器，只保留列表状态管理和筛选逻辑。

**拆分边界**：
- `CompetitorCard` 接收 `competitor` 对象 + `onEdit/onDelete/onStartCrawl/onToggleCrawl/onQuickGenerate` 回调
- `CrawlPanel` 接收 `competitorId` + `crawlTask` + `pages` + `crawling` 状态，内部渲染爬取进度和页面列表

### 1.3 新建 CompetitorDetailPage

**新建**：
- `frontend/src/pages/app/CompetitorDetailPage.tsx`
- 路由 `/app/competitors/:id`

**页面内容**：
- 竞品基本信息（只读）
- 爬取状态 + 任务信息
- crawled 页面列表（类型标签 + 访问状态）
- 「重新爬取」按钮 + 「生成画像」按钮

**对 CompetitorsPage 的影响**：卡片上的内联展开区变为「查看详情 →」链接。

---

## Phase 2：功能增强（2.5 天）

### 2.1 ComparisonPage 增加可视化

**改**：`frontend/src/pages/app/ComparisonPage.tsx`

对比结果表格下方，将 matrix 数据转换为 `ReportData` 格式，复用 `ScoreRadar` 和 `ScoreBars`。

**数据转换逻辑**：
```tsx
const chartData: ReportData = {
  dimensions: result.dimensions,
  competitors: selectedIds.map(id => ({
    name: nameMap[id],
    scores: result.matrix.reduce((acc, row) => {
      acc[row.dimension] = parseFloat(row.values[id]) || 0
      return acc
    }, {} as Record<string, number>),
    positioning: '',
  })),
  swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
  verdict: '',
}
```

**注意**：`compareProfiles` 返回的 `matrix` 中 `values` 可能是文本（如 "8/10"），需做解析。

### 2.2 ProfilesPage 卡片增加摘要预览

**改**：`frontend/src/pages/app/ProfilesPage.tsx`

从 `profile.profile_data.dimensions` 中提取前 2-3 个维度的关键字段值，以 `key: value` 迷你格式显示在卡片上。需处理 `profile_data` 可能是字符串（需 `JSON.parse`）的情况（`ProfileDetailPage.tsx:88` 已有这种处理模式）。

### 2.3 ProfileTemplatesPage 简化版可视化编辑器

**改**：`frontend/src/pages/app/ProfileTemplatesPage.tsx`

在弹窗中 JSON 文本域下方，增加「添加维度」和「添加字段」按钮。用户通过表单输入后自动追加到 JSON 中。底层仍序列化为 JSON 存储。

**不做全功能可视化编辑器** — 保持 JSON 文本域作为高级模式，新增表单作为易用模式。

### 2.4 AdminPage 增加审计日志入口

**改**：`frontend/src/pages/app/AdminPage.tsx`

在统计卡片行增加审计概览卡片，调用 `GET /api/admin/audit-logs/stats` 显示：今日操作数、成功率、Top 模型成本。卡片点击跳转到 `/app/admin/audit-logs`。

同时在用户管理表格上方增加「查看审计日志 →」链接。

---

## Phase 3：架构升级（3-5 天）

### 3.1 轻量缓存层（不引入新依赖）

**改**：`frontend/src/api/client.ts`

在 `request()` 函数内为 GET 请求添加内存缓存：

```ts
const GET_CACHE = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 30_000 // 30 秒

// request() 中 GET 请求逻辑：
if (init.method === undefined || init.method === 'GET') {
  const cacheKey = url
  const cached = GET_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
}
// ... 正常 fetch ...
// 成功后：
if (init.method === undefined || init.method === 'GET') {
  GET_CACHE.set(url, { data: result, ts: Date.now() })
}
```

POST/PATCH/DELETE 请求后使相关路径缓存失效（简单方案：清空全部缓存）。

**效果**：切换页面返回时（如从 TaskDetail 返回 TasksPage），列表数据命中缓存，无需重新请求。

### 3.2 移动端适配

- 侧栏添加折叠按钮，移动端默认折叠
- AdminPage、AuditLogsPage 表格添加 `overflow-x-auto`
- AI 助手移动端增加会话切换下拉

### 3.3 错误处理统一化

- 将各处 `.catch(() => {})` 替换为至少 `console.error`
- 引入 `react-hot-toast` 统一 toast 提示

---

## 实施顺序

```
Phase 0（6 项，独立可并行）
├── 0.1 修复 ProfilesPage bug          (~2 min)
├── 0.2 TasksPage 状态筛选             (~5 min)
├── 0.3 CompetitorsPage 筛选+搜索      (~15 min)
├── 0.4 侧栏导航分组                   (~10 min)
├── 0.5 AuditLogsPage CSV 导出         (~20 min)
└── 0.6 Skeleton 投入使用              (~10 min)

Phase 1（组件拆分，~1.5 天）
├── 1.1 抽离 Pagination 组件
├── 1.2 拆分 CompetitorsPage
└── 1.3 新建 CompetitorDetailPage

Phase 2（功能增强，~2.5 天）
├── 2.1 ComparisonPage 可视化
├── 2.2 ProfilesPage 卡片摘要
├── 2.3 模板简化可视化编辑器
└── 2.4 AdminPage 审计入口

Phase 3（架构升级，~3-5 天）
├── 3.1 轻量缓存层
├── 3.2 移动端适配
└── 3.3 错误处理统一化
```

---

## 五、技术评审

### 评审方式

对方案中每个改动点，逐一从以下维度评估：

| 维度 | 评估内容 |
|------|---------|
| 可行性 | 改动是否与现有代码结构兼容？是否有隐藏依赖？ |
| 风险 | 是否会影响现有功能？回滚难度？ |
| 替代方案 | 是否有更简单的实现方式？ |
| 遗漏 | 方案是否覆盖了所有发现的问题？是否有新增风险？ |

### 逐项评审

#### Phase 0.1 — 修复 ProfilesPage Bug

**可行性**：高。`CompetitorsPage.tsx:190-242` 的 `handleQuickGenerate` 已经实现了完全相同的异步轮询模式（调用 `generateProfileFromCrawl` → 获取 `task_id` → `setInterval` 轮询 `getGenerateStatus` → 完成后 `reload`）。直接复制该模式到 `ProfilesPage`。

**风险**：低。改动仅涉及一个函数体，不影响其他逻辑。原同步调用删掉，替换为异步模式。

**替代方案**：无。只有修复这一条路。

**结论**：**通过**，直接实施。

---

#### Phase 0.2 — TasksPage 状态筛选

**可行性**：高。现有代码已有筛选按钮组模式（`TasksPage.tsx:89-103`），只需在下方复制该模式，添加 `statusFilter` state 和筛选逻辑。`RUNNING` 集合已定义（`TasksPage.tsx:11`）。

**风险**：极低。纯 UI 层过滤，不影响 API 和数据。

**遗漏注意**：方案未提及分页。状态筛选让列表更短，但搜索后如果结果仍多，仍会撑爆页面。建议 Phase 0 只做状态筛选，分页留到 Phase 1 或 Phase 3 一起做。

**结论**：**通过**。建议加一句："状态筛选后如列表仍长，后续 Phase 补充分页"。

---

#### Phase 0.3 — CompetitorsPage 状态筛选 + 搜索

**可行性**：高。搜索框和筛选按钮组是标准 UI 模式，代码中 TasksPage 和 TrackersPage 已有类似实现。`STATUS_BADGE`/`STATUS_LABEL` 已定义（`CompetitorsPage.tsx:10-20`），直接用。

**风险**：低。但注意 `items` 是 `listCompetitors()` 的全量返回，筛选和搜索都在前端做。如果竞品数量很大（>100），前端筛选仍有性能问题。目前应用场景是团队级使用，竞品数量通常 <50，前端筛选够用。

**遗漏注意**：搜索仅匹配 `name` 和 `alias`，未匹配 `keywords` 数组和 `tech_focus`。建议也匹配 `keywords.some(kw => kw.includes(query))`。

**结论**：**通过**，搜索范围建议扩大到 keywords 和 tech_focus。

---

#### Phase 0.4 — 侧栏导航分组

**可行性**：高。`NAV` 是硬编码数组（`AppLayout.tsx:27-41`），改为分组结构只需调整数据结构和渲染逻辑。

**风险**：极低。纯视觉改动，不影响路由和功能。

**遗漏注意**：管理员入口（管理后台、审计日志）在方案中说是"单独放在最底部"。具体实现时需要注意：当前代码中管理员入口是单独的条件渲染块（`AppLayout.tsx:86-112`），需要移到分组渲染之后。另外 `end` 属性（用于精确匹配路由高亮）在分组后仍然需要保留。

**结论**：**通过**。

---

#### Phase 0.5 — AuditLogsPage CSV 导出

**可行性**：需评估。后端 CSV 导出已完整实现（`admin.py:275-325`），返回 `Response(content=buf.getvalue(), media_type="text/csv; charset=utf-8")`。

**关键风险 — request() 函数兼容性**：通用 `request()` 函数（`client.ts:97-133`）会对所有非 204 响应调用 `resp.json()`（第 132 行）。CSV 返回 `text/csv`，`resp.json()` 会抛解析错误。所以**不能走通用 `request()`**，必须单独写 `fetch` + `blob` 处理。

方案中已识别到这一点，建议用独立的 `exportAuditLogs` 函数直接 `fetch` + `blob`。**这个判断是正确的**。

**风险**：低。独立的 fetch 调用，不走通用 request 函数，不会触发 401 refresh 流程。但如果 token 过期，fetch 会返回 401 但不会被自动处理。建议在 fetch 前检查 token 有效性，或者至少处理 401 响应（跳登录）。

**遗漏注意**：
- 导出按钮应仅在 `logs.length > 0` 时显示，或始终显示但空结果时导出空 CSV
- CSV 文件命名建议包含日期：`audit-logs-{YYYY-MM-DD}.csv`

**结论**：**有条件通过**。需确保 401 处理和文件命名。

---

#### Phase 0.6 — Skeleton 投入使用

**可行性**：高。`Skeleton.tsx` 中 `CardSkeleton` 和 `ListSkeleton` 已定义好，直接导入。

**风险**：极低。纯视觉替换。

**遗漏注意**：当前所有页面使用统一的 "加载中…" 文本，替换为 Skeleton 后需要逐个页面调整。有些页面（如 TaskDetailPage）加载逻辑更复杂（有 `notFound` 状态），不应简单替换。

**结论**：**通过**，建议列表页和卡片页优先替换，详情页暂不替换。

---

#### Phase 1.1 — 抽离 Pagination 组件

**可行性**：高。两套实现各约 26 行，逻辑几乎相同。AdminPage 的版本更完整（支持省略号），AuditLogsPage 的版本更简洁。合并取并集即可。

**风险**：低。AdminPage 的 Pagination 定义在组件内部（`AdminPage.tsx:13-39`），需要提到组件外部。AuditLogsPage 的 Pagination 定义在文件顶部（`AuditLogsPage.tsx:8-20`），也需要提到共享位置。

**遗漏注意**：AdminPage 的 Pagination 有 `total` 显示（"共 X 条"），AuditLogsPage 的没有。合并时应保留 `total` 显示。

**结论**：**通过**。

---

#### Phase 1.2 — 拆分 CompetitorsPage

**可行性**：中高。但有一个技术细节需要注意。

**关键风险 — 轮询定时器的清理**：当前 `CompetitorsPage` 中 `pollTimers` 和 `genPollTimers` 是 state 对象（`CompetitorsPage.tsx:86-89`），清理逻辑在 `useEffect` 中（`CompetitorsPage.tsx:109-115`）。拆分后：
- 如果 `CrawlPanel` 自己管理轮询，定时器需要在组件卸载时清理 — 但 `CrawlPanel` 是按竞品展开/收起的，不是一直挂载的
- 如果轮询仍由父组件管理，`CrawlPanel` 变成纯展示组件，拆分收益降低

**建议**：`CrawlPanel` 接收 `crawlTask`/`pages`/`crawling` 等 props，轮询逻辑保留在父组件。`CrawlPanel` 只负责渲染。这样拆分主要是代码组织优化，不是功能拆分。

**结论**：**有条件通过**。轮询逻辑保留在父组件，`CrawlPanel` 为展示组件。

---

#### Phase 1.3 — 新建 CompetitorDetailPage

**可行性**：高。标准详情页模式，已有 `TrackerDetailPage` 和 `ProfileDetailPage` 作为模板。

**风险**：低。新路由不影响现有页面。

**遗漏注意**：详情页的数据获取 — 需要调用 `getCrawlStatus` + `listCrawlPages`，这两个 API 在 `client.ts` 中已有（`client.ts` 中的 `getCrawlStatus` 和 `listCrawlPages`）。详情页还需要展示竞品基本信息，需要 `listCompetitors` 后本地查找，或者新增 `getCompetitor(id)` API。建议先用 `listCompetitors` 全量 + 本地查找，和 `ProfileDetailPage` 模式一致。

**结论**：**通过**。

---

#### Phase 2.1 — ComparisonPage 可视化

**可行性**：中。`ScoreRadar` 和 `ScoreBars` 接受 `ReportData` 类型，需要做数据转换。

**风险**：中。`compareProfiles` 返回的 `matrix` 中 `values` 字段类型不确定 — 可能是数字字符串（如 "8"），也可能是文本（如 "8/10"）。直接 `parseFloat` 可能在文本格式上失败。需要在数据转换时做容错处理。

**遗漏注意**：
- `ScoreRadar` 需要 `data.competitors` 有 `name` 和 `scores`，`ScoreBars` 需要 `data.dimensions` 和 `data.competitors`。转换后的 `chartData` 中 `swot` 和 `verdict` 为空对象/字符串，组件会优雅降级（`TaskDetailPage.tsx:585` 中 `reportData` 的判断逻辑保证了这一点）。
- 如果对比结果中没有数值型评分（全是文本描述），雷达图和柱状图无法渲染，需要做 fallback 显示。

**结论**：**有条件通过**。需在数据转换时做数值解析容错，并添加 fallback 提示。

---

#### Phase 2.2 — ProfilesPage 卡片摘要

**可行性**：中。需要从 `profile.profile_data` 中提取维度摘要。

**风险**：低。但 `profile_data` 的结构不固定 — 它取决于模板定义的维度。不同模板的 `dimensions` 结构可能完全不同。需要做通用解析：

```tsx
const data = typeof profile.profile_data === 'string' ? JSON.parse(profile.profile_data) : profile.profile_data
const dims = data?.dimensions || {}
// 取前 2-3 个维度的第一个字段值
```

**遗漏注意**：`profile_data` 中 `dimensions` 的值可能是对象（含 fields）或纯文本。需要做 `typeof` 判断。`ProfileDetailPage.tsx:99-114` 已有这种递归渲染逻辑，可以复用其解析方式。

**结论**：**通过**，复用 `ProfileDetailPage` 的解析逻辑。

---

#### Phase 2.3 — 模板简化可视化编辑器

**可行性**：中。在弹窗中增加表单操作。

**风险**：中低。需要处理 JSON 与表单状态的双向同步。用户通过表单添加维度后，需要更新 `dimsJson` state（文本域内容），反之 JSON 文本域修改后需要更新表单状态。

**简化方案风险**：如果用户同时使用表单和 JSON 文本域，可能出现状态不一致。建议方案：
- 表单操作更新 JSON 文本域
- JSON 文本域修改后重置表单状态（或标记为"手动编辑"）
- 保存时以 JSON 文本域内容为准

**结论**：**通过**，但状态同步需要仔细处理。建议先做"表单添加 → JSON 自动更新"的单向模式，JSON 文本域仍可手动编辑但会清除表单状态。

---

#### Phase 2.4 — AdminPage 审计入口

**可行性**：高。`GET /api/admin/audit-logs/stats` 已实现，返回 `AuditStatsOut`（`admin.py:227`，schema 在 `schemas/auth.py:202`）。但 `client.ts` 中**没有对应的 API 函数**，需要新增。

**需要新增**：`client.ts` 中 `export function adminAuditStats(): Promise<AuditStatsOut>` — 但 `AuditStatsOut` 类型在 `schemas/auth.py` 中定义，`types.ts` 中没有。需要先在 `types.ts` 中添加该类型。

**风险**：低。新增一个 API 函数和一个类型定义。

**遗漏注意**：审计统计中的 `top_models` 包含 `total_cost`（USD），在 AdminPage 中展示时需要标注货币单位。

**结论**：**通过**，需先在 `types.ts` 中补充 `AuditStatsOut` 类型。

---

#### Phase 3.1 — 轻量缓存层

**可行性**：中。方案建议在 `client.ts` 的 `request()` 函数内加内存缓存。

**关键风险 — request() 的 401 refresh 流程与缓存的交互**：

当前 `request()` 的流程是：
1. fetch 请求
2. 如果 401 → tryRefreshToken → retry
3. 如果 retry 成功 → 返回数据

如果 GET 请求命中缓存，直接返回缓存数据，不会经过 401 流程。这意味着：
- 缓存中的数据可能是过期 token 获取的 — 但 token 过期不影响已获取的数据内容
- 缓存命中时不会检查 token 是否仍然有效 — 对于公开数据（如自己的任务列表）没问题，但如果用户权限发生变化（如被移出企业），缓存数据会过时

**建议调整**：
- 缓存 key 加入用户标识：`const cacheKey = `${url}:${user_id}`` — 但 `request()` 函数没有 user_id 参数
- 简化处理：缓存仅在同一个页面生命周期内有效（即组件 mount → unmount），配合 30 秒 TTL 够用
- 更安全的做法：POST/PATCH/DELETE 后清空缓存（已在方案中提及）

**另一个风险 — request() 返回 `undefined` 的场景**：401 refresh 失败时返回 `undefined as T`（`client.ts:109`）。如果缓存了这个 `undefined`，后续请求会命中缓存并返回 `undefined`。需要确保只有成功响应才缓存。

**结论**：**有条件通过**。需修正缓存条件：仅缓存 `resp.ok === true` 的响应，跳过 401 重试路径。建议在 fetch 成功后才写入缓存。

---

#### Phase 3.2 — 移动端适配

**可行性**：高。标准响应式设计模式。

**风险**：低。

**遗漏注意**：侧栏折叠后，需要确保折叠按钮在所有页面可见，且折叠状态在页面切换时保持（或默认展开）。

**结论**：**通过**。

---

#### Phase 3.3 — 错误处理统一化

**可行性**：中。改动点多但每个改动简单。

**风险**：低。但需要注意：`.catch(() => {})` 在有些场景下是故意的（如轮询中的单次请求失败不应阻断流程）。需要区分"可忽略的静默失败"和"应该上报的错误"。

**建议分类**：
- 轮询中的单次请求失败 → 可静默（已有）
- 初始化加载失败 → 应上报
- 用户操作失败 → 应 toast 提示

**结论**：**通过**，需分类处理。

---

### 评审总结

| 改动 | 结论 | 需修正/补充 |
|------|------|------------|
| 0.1 修复 ProfilesPage Bug | 通过 | — |
| 0.2 TasksPage 状态筛选 | 通过 | 补充分页计划 |
| 0.3 CompetitorsPage 筛选+搜索 | 通过 | 搜索范围扩大到 keywords/tech_focus |
| 0.4 侧栏导航分组 | 通过 | 注意管理员入口的 `end` 属性 |
| 0.5 AuditLogsPage CSV 导出 | 有条件通过 | 401 处理 + 文件命名含日期 |
| 0.6 Skeleton 投入使用 | 通过 | 详情页暂不替换 |
| 1.1 抽离 Pagination | 通过 | 合并时保留 `total` 显示 |
| 1.2 拆分 CompetitorsPage | 有条件通过 | 轮询逻辑保留父组件 |
| 1.3 新建 CompetitorDetailPage | 通过 | 先用 listCompetitors + 本地查找 |
| 2.1 ComparisonPage 可视化 | 有条件通过 | 数值解析容错 + fallback |
| 2.2 ProfilesPage 卡片摘要 | 通过 | 复用 ProfileDetailPage 解析逻辑 |
| 2.3 模板简化编辑器 | 通过 | 先做单向（表单→JSON），处理状态同步 |
| 2.4 AdminPage 审计入口 | 通过 | 先在 types.ts 补充 AuditStatsOut |
| 3.1 轻量缓存层 | 有条件通过 | 仅缓存成功响应，跳过 401 路径 |
| 3.2 移动端适配 | 通过 | — |
| 3.3 错误处理统一化 | 通过 | 分类处理（轮询/初始化/用户操作） |

### 方案遗漏

评审过程中发现以下方案未覆盖但应纳入的内容：

1. **`client.ts` 中缺少 `adminAuditStats` 和 `exportAuditLogs` API 函数** — Phase 2.4 和 Phase 0.5 需要用到，需在 `client.ts` 中补充。且 `types.ts` 中缺少 `AuditStatsOut` 类型定义。

2. **ProfileTasksPage 在 Phase 2 中遗漏** — 原方案 P2-12 提到 ProfileTasksPage 缺少操作按钮，但 Phase 2 的 4 项中未包含。建议在 Phase 2 增加第 5 项：ProfileTasksPage 增加「重新生成」按钮。

3. **`compareProfiles` 返回类型为 `any`**（`client.ts:434`）— ComparisonPage 的可视化依赖 `result.matrix` 结构，但类型是 `any`，没有类型安全。建议在 `types.ts` 中定义 `ComparisonResult` 接口。

4. **Phase 0 的改动没有 git commit 策略建议** — 6 项改动建议分两个 commit：bug fix（0.1）单独一个，其余 5 项 UI 改进合并为一个。Phase 1-3 各自独立 commit。

---

## 实施建议

- Phase 0 的 6 项可以一次性开发、分两个 commit 合入（bug fix + UI 改进）
- Phase 1 的 3 项互相依赖（Pagination 抽离是基础，拆分 CompetitorsPage 依赖 Pagination），建议按顺序合入
- Phase 2 的 4 项（+1 项遗漏）互相独立，可并行开发
- Phase 3 的缓存层建议在 Phase 1 完成后就开始，因为拆分组件后缓存收益更明显
