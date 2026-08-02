# 竞品调研 Agent — 前端完整分析与改造方案

> 版本：v6.0.0 | 分析日期：2026-08-03 | 分支：agent-v6 | 核查方式：逐文件回查验证

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

### 1.3 当前技术栈

| 维度 | 现状 |
|------|------|
| 状态管理 | **Zustand**（5 个 store，带 `persist` 中间件持久化到 localStorage） |
| 数据获取 | 页面通过 Zustand store 读取数据，store 内调用 API |
| 实时更新 | SSE（TaskDetailPage）+ `setInterval` 轮询（3-5 秒），轮询调用 `store.reload()` |
| 路由 | React Router v6，嵌套路由 |
| UI | Tailwind CSS + Lucide 图标 + react-markdown + ReactFlow |
| 后端对齐 | 79/83 端点已接入；3 个未用 + 1 个前端死调用 |

### 1.4 Zustand Store 落地情况

已创建 5 个 store，6 个页面已接入：

| Store | 文件 | 持久化 key | 已接入页面 |
|-------|------|-----------|-----------|
| `useTaskStore` | `stores/taskStore.ts` | `task-store` | TasksPage |
| `useCompetitorStore` | `stores/competitorStore.ts` | `competitor-store` | CompetitorsPage |
| `useProfileStore` | `stores/profileStore.ts` | `profile-store` | ProfilesPage, ComparisonPage, ProfileTasksPage |
| `useGraphStore` | `stores/graphStore.ts` | `graph-store` | GraphPage |
| `useTrackerStore` | `stores/trackerStore.ts` | `tracker-store` | TrackersPage |

**未接入 store 的页面**：DashboardPage、NewResearchPage、TaskDetailPage、TrackerDetailPage、ProfileDetailPage、GraphDetailPage、AssistantPage、PricingPage、AccountPage、AdminPage、AuditLogsPage — 这些页面仍用页面内 `useState` + `useEffect` 直接调用 API。

### 1.5 后端对齐缺口

| 端点 | 位置 | 状态 |
|------|------|------|
| `GET /api/admin/audit-logs/stats` | `admin.py:227` | 已实现，前端未用 |
| `GET /api/admin/audit-logs/export` | `admin.py:275` | 已实现（CSV，10000 条上限），前端未用 |
| `GET /api/admin/execution-snapshots` | 无路由 | 前端 `client.ts:473` 有调用，后端无路由，DB 表已定义（`main.py:137`），半成品 |

### 1.6 现有组件清单（28 个）

`AssistantChat`、`AssistantWidget`、`AuthShell`、`BackToTop`、`ChartCard`、`ConfirmDialog`、`ErrorBoundary`、`NotificationBell`、`OrgPanel`、`PhaseStepper`、`PlanBadge`、`ProfileGenProgress`、`QuotaErrorBanner`、`ReadingProgress`、`ReportToc`、`ReportView`、`RunHistoryItem`、`ScoreBars`、`ScoreRadar`、`ScoreTrend`、`Skeleton`（未使用）、`SourceCard`、`SourceDrawer`、`StatusBadge`、`StepTimeline`、`SwotGrid`、`TierBadge`、`TrackerForm`

---

## 二、页面功能详析

### 2.1 DashboardPage（仪表盘）

**功能**：4 个统计卡片（套餐、额度、完成数、进行中）+ 最近 5 条调研列表。直接调用 `getQuota()` + `listResearch()`，未接入 store。
**评价**：功能完整但单薄。没有趋势图，没有快速操作区。

### 2.2 NewResearchPage（新建调研）

**功能**：填写产品名、竞品、重点、时效 → 创建任务 → 跳转详情页。额度检查、路由 `location.state` 秒传任务概要避免加载闪屏。
**评价**：完善。

### 2.3 TasksPage（调研记录）— 已接入 Store，仍缺筛选

**功能**：通过 `useTaskStore` 读取任务列表。列表（3 秒轮询，轮询调用 `store.reload()`）+ 筛选（全部/我的/成员）+ 删除确认。
**已改善**：数据通过 Zustand store 管理，切换页面返回时 store 数据仍在（persist 持久化），无需重新请求。
**仍缺失**：
- 无搜索框
- 无状态筛选（只看进行中/已完成/失败）
- 无分页

### 2.4 TaskDetailPage（调研详情）

**功能**：最复杂的页面（875 行）。运行中展示 SSE 实时进度；完成后 3 个 Tab（报告/洞察/来源）+ 导出 + 邮件发送 + 追问。
**评价**：旗舰页面，功能完善。未接入 store（详情页不需要）。

### 2.5 TrackersPage + TrackerDetailPage（定时追踪）

**功能**：
- **列表**：通过 `useTrackerStore` 读取。卡片 + 启用/暂停 toggle + 立即运行 + 编辑 + 删除。「全部/我创建」筛选。5 秒轮询（仅运行中时）。
- **详情**：评分趋势图（≥2 期渲染）+ 运行历史时间线。每期有「查看完整报告 →」链接（`RunHistoryItem.tsx:46`）。

**已改善**：已接入 `useTrackerStore`，数据持久化。

**仍缺失**：
- 无按频率筛选（只看每日/每周/每月）
- 无搜索

### 2.6 CompetitorsPage（竞品管理）— 已接入 Store，仍缺筛选

**功能**：通过 `useCompetitorStore` 读取竞品列表和模板。卡片式 CRUD + 展开式爬取详情 + 批量画像生成。
**内部状态**：7 个 useState（showForm、editing、submitting、name/alias/website/techFocus/keywords、confirmOpen/deleteId、expandedCrawl/crawling/crawlTasks/crawlPages/pollTimers、genTasks/genPollTimers）。
**已改善**：基础数据（items、templates）从 store 读取，不再自己管理。
**仍缺失**：
- 无状态筛选（`STATUS_BADGE`/`STATUS_LABEL` 已定义但仅用于卡片徽章）
- 无搜索
- 内联展开的爬取页面列表在竞品多时体验差

### 2.7 ProfileTemplatesPage（画像模板）

**功能**：模板 CRUD + 冻结/解冻。JSON 文本域编辑维度。
**评价**：基本完善。JSON 编辑器门槛高。

### 2.8 ProfilesPage（竞品画像）— 已接入 Store，仍有 Bug

**功能**：通过 `useProfileStore` 读取 templates/competitors/profiles。顶部生成器 + 下方画像卡片列表。
**已确认 Bug 仍然存在**（`ProfilesPage.tsx:47-60`）：

```tsx
const handleGenerateFromCrawl = async () => {
  await generateProfileApi({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
  // ↑ 调的是同步接口，不是异步的 generateProfileFromCrawl
}
```

后端两个端点的区别：

| 端点 | 返回值 | 行为 |
|------|--------|------|
| `POST /api/profiles/generate` | 201 + 完整画像 | 同步 `await generate_profile()` |
| `POST /api/profiles/generate-from-crawl` | 202 + `{task_id, status}` | 异步后台任务，需轮询 |

**仍缺失**：画像卡片无摘要预览。

### 2.9 ProfileDetailPage（画像详情）

**功能**：维度数据展示 + 来源引用 + 冻结/重新生成/加入对比。
**评价**：完善。

### 2.10 ComparisonPage（横向对比）— 已接入 Store

**功能**：通过 `useProfileStore` 读取 templates/profiles/competitors。选择模板 → 选 2+ 画像 → 对比矩阵表。
**已改善**：数据从 store 读取。
**仍缺失**：无可视化图表（`ScoreRadar`/`ScoreBars` 已存在但未复用）。无导出。

### 2.11 ProfileTasksPage（画像提取任务）

**功能**：3 秒轮询监控异步画像提取任务状态。通过 `useProfileStore` 读取 competitors/templates。
**评价**：功能单一但实用。缺少「重新生成」「取消」按钮。

### 2.12 GraphPage + GraphDetailPage（关系图谱）

**功能**：列表通过 `useGraphStore` 读取 + ReactFlow 交互图谱 + 详情抽屉 + 分析报告抽屉 + 纳入追踪。
**评价**：非常完善。

### 2.13 AssistantPage（AI 助手）

**功能**：左侧会话列表 + 右侧对话面板。
**缺失**：移动端隐藏侧栏，无法新建/切换会话。

### 2.14 AccountPage（个人中心）

**功能**：4 个 Tab（概览/安全/企业/订单）。未接入 store。
**评价**：功能完善。OrgPanel 嵌入企业 Tab，内容较重。

### 2.15 AdminPage（管理后台）

**功能**：5 统计卡片 + 用户管理表格（搜索/分页/改套餐/改角色）+ 企业管理表格（搜索/分页/改套餐）。Pagination 组件在 AdminPage 内定义一套，AuditLogsPage 内有另一套独立实现。
**缺失**：无审计日志入口。

### 2.16 AuditLogsPage（审计日志）

**功能**：筛选栏 + 分页表格（20 条/页）。
**未接入**：后端 `/audit-logs/stats` 和 `/audit-logs/export` 均未使用。

---

## 三、发现的问题

### P0 — Bug

| # | 问题 | 位置 | 证据 |
|---|------|------|------|
| 1 | "基于爬取页面"按钮调错 API | `ProfilesPage.tsx:52` | 调用 `generateProfileApi`（同步 201）而非 `generateProfileFromCrawl`（异步 202）。**Zustand 迁移时未修复此 bug** |

### P1 — 功能缺失

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 2 | TasksPage 无状态筛选 | `TasksPage.tsx` | 已有「全部/我的/成员」，缺「进行中/已完成/失败」 |
| 3 | CompetitorsPage 无状态筛选、无搜索 | `CompetitorsPage.tsx` | `STATUS_BADGE` 已定义但未用于筛选 |
| 4 | ComparisonPage 仅表格无可视化 | `ComparisonPage.tsx:127-155` | `ScoreRadar`/`ScoreBars` 已存在但未复用 |
| 5 | ProfilesPage 卡片无摘要预览 | `ProfilesPage.tsx` | 卡片只显示名称/模板/状态/时间 |
| 6 | AdminPage 无审计日志入口 | `AdminPage.tsx` | 全页无跳转链接 |

### P2 — 体验优化

| # | 问题 | 位置 |
|---|------|------|
| 7 | 侧栏 15 入口平铺无分组 | `AppLayout.tsx:27-41` |
| 8 | TrackersPage 无频率筛选 | `TrackersPage.tsx` |
| 9 | ProfileTasksPage 无操作按钮 | `ProfileTasksPage.tsx` |
| 10 | AuditLogsPage 导出未接 | `AuditLogsPage.tsx` |
| 11 | Skeleton 组件定义了但未使用 | `components/Skeleton.tsx` |

### P3 — 架构层面

| # | 问题 | 说明 |
|---|------|------|
| 12 | 未接入 store 的页面 | Dashboard、TaskDetail、Account、Admin、AuditLogs 等仍用 useState |
| 13 | Pagination 组件重复 | AdminPage 和 AuditLogsPage 各有一套独立实现（~26 行/处） |
| 14 | 移动端适配 | 侧栏固定 14rem，AI 助手移动端隐藏侧栏 |
| 15 | 静默失败 | 多处 `.catch(() => {})` |

### 未使用的代码

- `components/Skeleton.tsx` — `CardSkeleton`、`ListSkeleton` 定义了但无任何页面导入
- `hooks/useErrorHandler.ts` — hook 定义了但无任何页面或组件使用

---

## 四、改造方案

### 设计原则

1. **每次改动独立可回滚** — 不搞大爆炸重写
2. **在 Zustand 迁移基础上继续推进** — store 已建立，后续页面继续接入
3. **优先复用已有组件** — `ScoreRadar`、`ScoreBars`、`Skeleton`、`ConfirmDialog`、`ChartCard` 都已写好
4. **先补缺口再重构结构** — 先修 bug、补功能，再拆组件

---

## Phase 0：快速修复（~1.5 小时，5 项）

### 0.1 修复 ProfilesPage "基于爬取页面" Bug

**改**：`frontend/src/pages/app/ProfilesPage.tsx:47-60`

将 `handleGenerateFromCrawl` 从调用 `generateProfileApi`（同步 201）改为调用 `generateProfileFromCrawl`（异步 202），并加入轮询逻辑。模式和 `CompetitorsPage` 的 `handleQuickGenerate`（`CompetitorsPage.tsx:180-232`）完全一致。

**关键改动**：
- 调用 `generateProfileFromCrawl` 获取 `task_id`
- 用 `setInterval` 每 2 秒轮询 `getGenerateStatus(taskId)`
- 完成后 `reload()` + 显示 notice
- 清理定时器

### 0.2 TasksPage 添加状态筛选

**改**：`frontend/src/pages/app/TasksPage.tsx`

在现有「全部/我的/成员」筛选按钮组下方，增加状态筛选 pill 行：`全部 | 进行中 | 已完成 | 失败`。

复用现有按钮组样式。新增 `statusFilter` state（`'all' | 'running' | 'completed' | 'failed'`），筛选逻辑：

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
- 搜索匹配 `name`、`alias`、`keywords`（`keywords.some(kw => kw.includes(query))`）、`tech_focus`

### 0.4 侧栏导航分组

**改**：`frontend/src/layouts/AppLayout.tsx`

将 `NAV` 数组从平铺改为分组结构：

```tsx
const NAV_GROUPS = [
  { label: '调研', items: [仪表盘, 新建调研, 调研记录] },
  { label: '追踪', items: [定时追踪, 竞品管理] },
  { label: '画像', items: [画像模板, 竞品画像, 画像任务, 横向对比] },
  { label: '图谱', items: [关系图谱] },
  { label: '助手', items: [AI 助手] },
  { label: '系统', items: [套餐升级, 个人中心] },
]
```

渲染时每组先渲染分组标题，然后 map items。管理员入口单独放在最底部。

### 0.5 AuditLogsPage 导出 CSV

**改**：`frontend/src/pages/app/AuditLogsPage.tsx` + `frontend/src/api/client.ts`

1. `client.ts` 新增 `exportAuditLogs` 函数 — CSV 返回 `text/csv` 而非 JSON，不能走通用 `request()`（会调 `resp.json()` 抛错），需独立 `fetch` + `blob`：

```ts
export function exportAuditLogs(params: {
  action?: string; resource_type?: string; user_id?: string; start?: string; end?: string
}): Promise<Blob> {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v) })
  const token = tokenStore.get()
  return fetch(`/api/admin/audit-logs/export?${p}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => {
    if (!r.ok) throw new Error('导出失败')
    return r.blob()
  })
}
```

2. `AuditLogsPage` 筛选栏右侧添加「导出 CSV」按钮，点击后用 `URL.createObjectURL(blob)` + `<a download="audit-logs-{date}.csv">` 触发下载。

---

## Phase 1：组件拆分（1.5 天）

### 1.1 抽离共享 Pagination 组件

**新建**：`frontend/src/components/Pagination.tsx`

取 AdminPage（第 13-39 行）和 AuditLogsPage 两套实现的并集，支持 `page`、`totalPages`、`total`、`onChange`。

**删除**：AdminPage 和 AuditLogsPage 内的两套 Pagination 副本。

### 1.2 拆分 CompetitorsPage 为三个组件

**新建**：
- `frontend/src/components/CompetitorCard.tsx` — 单张竞品卡片
- `frontend/src/components/CrawlPanel.tsx` — 爬取进度展开区

**修改**：`CompetitorsPage.tsx` 缩减为 ~120 行的容器，只保留列表状态管理、筛选逻辑和表单弹窗。

**拆分边界**：
- `CompetitorCard` 接收 `competitor` 对象 + `onEdit/onDelete/onStartCrawl/onToggleCrawl/onQuickGenerate` 回调
- `CrawlPanel` 接收 `crawlTask`/`pages`/`crawling` 等 props，纯展示组件。轮询逻辑保留在父组件（避免展开/收起时定时器生命周期复杂化）

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

**注意**：`compareProfiles` 返回的 `matrix` 中 `values` 可能是文本，需做 `parseFloat` 容错。如果解析后全为 0，显示 fallback 提示。

### 2.2 ProfilesPage 卡片增加摘要预览

**改**：`frontend/src/pages/app/ProfilesPage.tsx`

从 `profile.profile_data.dimensions` 中提取前 2-3 个维度的关键字段值，以迷你格式显示在卡片上。复用 `ProfileDetailPage.tsx:86-117` 的解析逻辑（处理 `profile_data` 可能是字符串的情况）。

### 2.3 ProfileTemplatesPage 简化版可视化编辑器

**改**：`frontend/src/pages/app/ProfileTemplatesPage.tsx`

在弹窗中 JSON 文本域下方，增加「添加维度」和「添加字段」按钮。用户通过表单输入后自动追加到 JSON 中。底层仍序列化为 JSON 存储。

**状态同步策略**：表单操作更新 JSON 文本域；JSON 文本域修改后重置表单状态（标记为"手动编辑"模式）。保存时以 JSON 文本域内容为准。

### 2.4 AdminPage 增加审计日志入口

**改**：`frontend/src/pages/app/AdminPage.tsx` + `frontend/src/api/client.ts` + `frontend/src/api/types.ts`

1. `types.ts` 新增 `AuditStatsOut` 类型
2. `client.ts` 新增 `adminAuditStats()` 函数
3. AdminPage 在统计卡片行增加审计概览卡片（今日操作数、成功率、Top 模型成本），点击跳转到 `/app/admin/audit-logs`
4. 用户管理表格上方增加「查看审计日志 →」链接

### 2.5 ProfileTasksPage 增加操作按钮

**改**：`frontend/src/pages/app/ProfileTasksPage.tsx`

在任务卡片上增加「重新生成」按钮（调用 `generateProfileFromCrawl` + 跳转到任务列表）和「取消」按钮（如后端支持取消接口）。

---

## Phase 3：继续接入 Store + 架构升级（3-5 天）

### 3.1 剩余页面接入 Store

将 DashboardPage、NewResearchPage、AccountPage、AdminPage、AuditLogsPage 的数据层接入 Zustand。每个页面创建对应的 store（或合入已有 store）。

**建议**：
- DashboardPage → 新建 `useDashboardStore`（quota + tasks 摘要）
- AccountPage → 新建 `useAccountStore`（usage + orders + logins）
- AdminPage → 新建 `useAdminStore`（stats + users + orgs）
- AuditLogsPage → 合入 `useAdminStore` 或新建 `useAuditStore`

### 3.2 轻量缓存层验证

Zustand 的 `persist` 中间件已将数据持久化到 localStorage，切换页面时数据不丢失。这已经解决了"返回列表页时重新加载"的问题。

**剩余优化**：轮询间隔可配置（当前固定 3-5 秒），以及在页面不可见时暂停轮询（`document.hidden` API）。

### 3.3 移动端适配

- 侧栏添加折叠按钮，移动端默认折叠
- 表格添加 `overflow-x-auto`
- AI 助手移动端增加会话切换下拉

### 3.4 错误处理统一化

- 将各处 `.catch(() => {})` 分类处理
- 引入 `react-hot-toast` 统一 toast 提示

---

## 实施顺序

```
Phase 0（5 项，独立可并行，~1.5 小时）
├── 0.1 修复 ProfilesPage Bug          (~2 min)
├── 0.2 TasksPage 状态筛选             (~5 min)
├── 0.3 CompetitorsPage 筛选+搜索      (~15 min)
├── 0.4 侧栏导航分组                   (~10 min)
└── 0.5 AuditLogsPage CSV 导出         (~20 min)

Phase 1（组件拆分，~1.5 天）
├── 1.1 抽离 Pagination 组件
├── 1.2 拆分 CompetitorsPage
└── 1.3 新建 CompetitorDetailPage

Phase 2（功能增强，~2.5 天）
├── 2.1 ComparisonPage 可视化
├── 2.2 ProfilesPage 卡片摘要
├── 2.3 模板简化可视化编辑器
├── 2.4 AdminPage 审计入口
└── 2.5 ProfileTasksPage 操作按钮

Phase 3（Store 扩展 + 架构，~3-5 天）
├── 3.1 剩余页面接入 Store
├── 3.2 轮询优化（暂停/恢复）
├── 3.3 移动端适配
└── 3.4 错误处理统一化
```

---

## 五、技术评审

### 当前状态变化对原方案的影响

Zustand 的引入改变了方案的多项结论：

| 原方案结论 | 当前状态 | 影响 |
|-----------|---------|------|
| Phase 3.1 轻量缓存层 | **已通过 Zustand persist 实现** | 缓存层需求已满足，Phase 3.1 降级为轮询优化 |
| Phase 1.2 拆分 CompetitorsPage | 基础数据已从 store 读取 | 拆分收益降低（数据层已解耦），但仍需拆组件以改善可维护性 |
| 5 个 store 已创建，6 个页面已接入 | 事实 | Phase 3.1 的"引入状态管理"不再需要 |

### 逐项评审

#### Phase 0.1 — 修复 ProfilesPage Bug

**可行性**：高。`CompetitorsPage.tsx:180-232` 的 `handleQuickGenerate` 已经实现了完全相同的异步轮询模式。

**风险**：低。改动仅涉及一个函数体。

**结论**：**通过**。

---

#### Phase 0.2 — TasksPage 状态筛选

**可行性**：高。现有代码已有筛选按钮组模式，`RUNNING` 集合已定义。

**风险**：极低。纯 UI 层过滤。

**结论**：**通过**。

---

#### Phase 0.3 — CompetitorsPage 筛选 + 搜索

**可行性**：高。搜索框和筛选按钮组是标准 UI 模式。注意数据已从 `useCompetitorStore` 读取，`items` 是 store 中的全量数据。

**风险**：低。前端筛选。竞品数量通常 <50，够用。

**结论**：**通过**。

---

#### Phase 0.4 — 侧栏导航分组

**可行性**：高。`NAV` 是硬编码数组，改为分组结构只需调整数据结构和渲染逻辑。

**风险**：极低。纯视觉改动。

**结论**：**通过**。

---

#### Phase 0.5 — AuditLogsPage CSV 导出

**可行性**：需注意。CSV 返回 `text/csv`，通用 `request()` 会调 `resp.json()` 抛错，必须走独立 `fetch` + `blob`。

**风险**：低。独立 fetch 调用。但需处理 401（token 过期时 fetch 返回 401 不会被自动 refresh）。

**结论**：**有条件通过**。需处理 401 响应。

---

#### Phase 1.1 — 抽离 Pagination

**可行性**：高。两套实现各约 26 行，逻辑几乎相同。

**风险**：低。

**结论**：**通过**。

---

#### Phase 1.2 — 拆分 CompetitorsPage

**可行性**：中高。数据层已从 store 读取，拆分主要是代码组织。

**关键风险 — 轮询定时器**：当前 `pollTimers` 和 `genPollTimers` 是 state 对象（`CompetitorsPage.tsx:89-92`）。拆分后轮询逻辑保留在父组件，`CrawlPanel` 只做展示。这个判断正确。

**结论**：**有条件通过**。轮询逻辑保留父组件，`CrawlPanel` 为展示组件。

---

#### Phase 1.3 — 新建 CompetitorDetailPage

**可行性**：高。标准详情页模式。

**风险**：低。

**结论**：**通过**。

---

#### Phase 2.1 — ComparisonPage 可视化

**可行性**：中。`ScoreRadar` 和 `ScoreBars` 接受 `ReportData` 类型，需要数据转换。

**风险**：中。`compareProfiles` 返回的 `matrix` 中 `values` 可能是文本。需做 `parseFloat` 容错。

**结论**：**有条件通过**。数值解析容错 + fallback。

---

#### Phase 2.2 — ProfilesPage 卡片摘要

**可行性**：中。`profile_data` 结构不固定，需做通用解析。

**风险**：低。复用 `ProfileDetailPage` 的解析逻辑。

**结论**：**通过**。

---

#### Phase 2.3 — 模板可视化编辑器

**可行性**：中。JSON 与表单状态双向同步需仔细处理。

**结论**：**通过**，先做单向（表单→JSON）。

---

#### Phase 2.4 — AdminPage 审计入口

**可行性**：高。需先在 `types.ts` 补充 `AuditStatsOut`，`client.ts` 新增 `adminAuditStats()`。

**结论**：**通过**。

---

#### Phase 2.5 — ProfileTasksPage 操作按钮

**可行性**：高。标准按钮 + API 调用。

**结论**：**通过**。

---

#### Phase 3.1 — Store 扩展

**可行性**：高。Zustand 已引入，模式已建立（5 个 store 作为参考模板）。

**风险**：低。每个 store 独立，互不影响。

**结论**：**通过**。

---

#### Phase 3.2 — 轮询优化

**可行性**：高。`document.hidden` API 检测页面可见性。

**风险**：低。

**结论**：**通过**。

---

#### Phase 3.3 — 移动端适配

**可行性**：高。标准响应式设计。

**结论**：**通过**。

---

#### Phase 3.4 — 错误处理统一化

**可行性**：中。改动点多但每个简单。

**结论**：**通过**，分类处理。

---

### 方案遗漏补充

1. **`compareProfiles` 返回类型为 `any`**（`client.ts:434`）— 建议在 `types.ts` 中定义 `ComparisonResult` 接口。
2. **Zustand persist 的 localStorage 可能膨胀** — 5 个 store 都持久化，每次 API 调用后全量写入。建议 `partialize` 只持久化必要字段（当前已做），并设置合理的序列化配置。
3. **store 间数据冗余** — `useProfileStore` 同时持有 `profiles`、`templates`、`competitors`，而 `useCompetitorStore` 也持有 `items`（competitors）和 `templates`。同一份数据在两个 store 中各存一份，修改时需同步更新。建议：`useProfileStore` 只存 profiles，templates 和 competitors 从 `useCompetitorStore` 读取。

---

## 六、需要新建/拆分的子页面

| 现有页面 | 建议拆分出的子页面 | 理由 |
|---------|------------------|------|
| `CompetitorsPage` | `/app/competitors/:id` | 爬取详情（页面列表、任务状态）从卡片内联展开拆分 |
| `CompetitorsPage` | `/app/competitors/:id/crawl` | 爬取任务管理独立页面 |

---

## 七、改进优先级总览

```
Phase 0（P0 Bug + P1 功能，~1.5 小时）：
  0.1 修复 ProfilesPage handleGenerateFromCrawl bug
  0.2 TasksPage 添加状态筛选
  0.3 CompetitorsPage 添加状态筛选 + 搜索
  0.4 侧栏导航分组
  0.5 AuditLogsPage 导出 CSV

Phase 1（组件拆分，~1.5 天）：
  1.1 抽离 Pagination 组件
  1.2 拆分 CompetitorsPage 为 Card + CrawlPanel
  1.3 新建 CompetitorDetailPage

Phase 2（功能增强，~2.5 天）：
  2.1 ComparisonPage 可视化图表
  2.2 ProfilesPage 卡片摘要预览
  2.3 模板简化可视化编辑器
  2.4 AdminPage 审计日志入口
  2.5 ProfileTasksPage 操作按钮

Phase 3（Store 扩展 + 架构，~3-5 天）：
  3.1 Dashboard/Account/Admin/AuditLogs 接入 Store
  3.2 轮询优化（页面不可见时暂停）
  3.3 移动端适配
  3.4 错误处理统一化
```
