# 竞品管理 / 画像生成页面 — 导航切换后状态丢失问题分析报告

> **版本**：v5.0.0 · 分析日期：2026-08-02
> **说明**：本文件为技术分析文档，基于 v5.0.0 代码审查更新（分析结论仍适用）。

## 1. 问题现象

用户在竞品管理、画像生成等页面发起任务（爬取、画像生成）后，切换到其他页面再切回来，页面恢复到初始空状态（loading → 空列表）。但隔一段时间后再看，数据会"自己出现"。

## 2. 根本原因

### 2.1 核心问题：组件卸载导致状态销毁

项目使用 **React Router DOM v6** 做路由。React Router v6 的路由匹配机制是：当 URL 离开某个 `<Route>` 匹配的路径时，对应的组件会**完全卸载（unmount）**，所有 `useState` 状态、`setInterval` 轮询定时器都被销毁。当用户再次导航回来时，组件**重新挂载（remount）**，所有状态回到初始值。

**证据**：

- `frontend/src/App.tsx:55` — `/app/competitors` → `CompetitorsPage`
- `frontend/src/layouts/AppLayout.tsx:145` — 侧边栏 `<NavLink>` 点击 → 路由切换 → `<Outlet />` 内容替换

这是 React Router v6 的默认行为，与 v5 不同（v5 使用 `<Switch>` + render 模式，切换路由时旧组件会保留在 DOM 中但隐藏）。v6 的 `<Routes>` + `<Outlet />` 模式会**完全销毁/重建**路由组件。

### 2.2 没有全局状态管理

项目中 **没有任何全局状态管理方案**（无 Redux / Zustand / Jotai / React Query / SWR 等）。

唯一全局状态是 `AuthContext`（用户登录信息），它管理的是 token 和 user 对象，**不涉及页面数据**。

每个页面自行用 `useState` + `useEffect` 管理数据，数据完全存在于组件内部：

| 页面 | 关键状态（切换后丢失） |
|------|----------------------|
| `CompetitorsPage` | `items`, `crawlTasks`, `crawlPages`, `genTasks`, `expandedCrawl`, `templates` |
| `ProfilesPage` | `templates`, `competitors`, `profiles`, `selectedTemplate`, `selectedCompetitor` |
| `TasksPage` | `tasks`, `filter` |
| `TrackersPage` | `trackers`, `hasOrg` |
| `GraphPage` | `projects` |
| `ComparisonPage` | `templates`, `profiles`, `competitors`, `selectedTemplate`, `selectedIds`, `result` |
| `ProfileTasksPage` | `tasks`, `competitors`, `templates` |

### 2.3 轮询定时器随之终止

很多页面使用 `setInterval` 做轮询：

- `TasksPage` — 每 3 秒轮询 `listResearch()` (line 35)
- `CompetitorsPage` — 每 2 秒轮询爬取状态和画像生成状态 (line 213, 275)
- `ProfileTasksPage` — 每 3 秒轮询 `listProfileExtractTasks()` (line 62)
- `TrackersPage` — 每 5 秒轮询 (line 93)
- `GraphPage` — 每 4 秒轮询 (line 57)

这些轮询的 `useEffect` cleanup 会在组件卸载时调用 `clearInterval()`，**正常地停止了轮询**。这是正确行为——但副作用是：当用户切走页面后，即使后端任务还在跑，前端也不再刷新状态。

### 2.4 数据"后来又出现了"的原因

当用户切回页面时，组件重新挂载 → `useEffect` 触发 → `reload()` 重新调用 API → 后端任务此时已经完成 → API 返回最新数据 → 页面显示结果。

所以用户看到的"过一会就有结果"实际上是：

```
用户切走         后端任务完成         用户切回
  │               │                  │
  │     ──────────│──────────────────│──→ reload() 拿到结果
  │               │                  │
  组件卸载        任务在后台完成      组件重新挂载 → 重新拉取
  轮询停止        数据已写入 DB       useEffect → fetch → 显示
```

## 3. 影响范围

这个问题影响 **所有受 `/app/*` 路由守卫的页面**，具体表现：

| 页面 | 用户感知 |
|------|---------|
| 竞品管理 | 爬取/画像任务进行中 → 切走 → 回来变成空列表，过一会再加载 |
| 竞品画像 | 选好的竞品/模板 → 切走 → 回来重置为默认 |
| 画像任务 | 轮询进度条 → 切走 → 回来从 0 开始 |
| 调研记录 | 筛选条件（我的/全部）→ 切走 → 回来重置 |
| 定时追踪 | 展开的追踪项详情 → 切走 → 回来折叠 |
| 关系图谱 | 构建中的项目状态 → 切走 → 回来丢失进度 |
| 横向对比 | 已选模板和竞品 → 切走 → 回来重置 |

## 4. 解决方案

### 方案 A：引入 Zustand 全局状态（推荐）

**优点**：
- 最小侵入性，每个页面只需几行改动
- 数据在页面切换间持久保留
- 可以与 `localStorage` 持久化配合
- 适合项目当前规模（约 15 个页面）

**实施方式**：

1. 安装 `zustand` + `zustand/middleware`（已有 `persist` middleware，可持久化到 localStorage）
2. 为各模块创建 store：

```ts
// frontend/src/stores/competitorStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { listCompetitors, listProfileTemplates } from '../api/client'
import type { Competitor, ProfileTemplate } from '../api/types'

interface CompetitorState {
  items: Competitor[]
  templates: ProfileTemplate[]
  loading: boolean
  reload: () => Promise<void>
}

export const useCompetitorStore = create<CompetitorState>()(
  persist(
    (set) => ({
      items: [],
      templates: [],
      loading: false,
      reload: async () => {
        set({ loading: true })
        try {
          const [cs, ts] = await Promise.all([
            listCompetitors(), listProfileTemplates()
          ])
          set({ items: cs, templates: ts.filter((t) => t.frozen_at) })
        } finally {
          set({ loading: false })
        }
      },
    }),
    { name: 'competitor-store', partialize: (s) => ({ items: s.items, templates: s.templates }) }
  )
)
```

3. 每个页面从 store 读取数据，`useEffect` 只在首次挂载时 `reload()`：

```tsx
// CompetitorsPage.tsx 修改前
const [items, setItems] = useState<Competitor[]>([])
const [templates, setTemplates] = useState<ProfileTemplate[]>([])

// 修改后
const { items, templates, loading, reload } = useCompetitorStore()
```

4. 页面级 UI 状态（弹窗开关、展开折叠、表单输入等）仍然保留在页面组件内，因为这些状态不需要在导航间保持。

**需要创建的 Store**：

| Store | 文件 | 数据 | 持久化 |
|-------|------|------|--------|
| `useTaskStore` | `stores/taskStore.ts` | 调研任务列表 + filter | 是 |
| `useCompetitorStore` | `stores/competitorStore.ts` | 竞品列表 + 模板 | 是 |
| `useProfileStore` | `stores/profileStore.ts` | 画像列表 + 模板 + 竞品 | 是 |
| `useTrackerStore` | `stores/trackerStore.ts` | 追踪项列表 + hasOrg | 否（有轮询） |
| `useGraphStore` | `stores/graphStore.ts` | 图谱项目列表 | 否（有轮询） |

**预估改动量**：约 7 个新文件（store + types），约 7 个页面修改。

### 方案 B：用 React Query (TanStack Query) 替换手写轮询

**优点**：
- 自带缓存、后台刷新、stale-while-revalidate
- 自动处理 loading/error/refetch 逻辑
- 更适合有大量异步数据流的场景

**缺点**：
- 需要重写所有页面的数据获取逻辑
- 改动量更大（约 10+ 页面 + API 层）
- 对于简单列表页面有些过度设计

### 方案 C：条件性 Reload（轻量修复，治标不治本）

在每个页面的 `useEffect` 中添加条件判断：如果已经有数据且不是 force reload，跳过重新加载。

```tsx
const reload = useCallback(async () => {
  if (items.length > 0 && !forceReload) return // 已有数据不重拉
  setLoading(true)
  // ... fetch
}, [items, forceReload])
```

**缺点**：
- 无法解决状态丢失的问题（表单输入、筛选、展开状态等仍然丢失）
- 只是减少网络请求，用户体验没有根本改善
- 容易产生 bug（数据过期时不会刷新）

## 5. 推荐实施计划

```
Phase 1: 引入 Zustand，改造数据列表页
  ├── 安装 zustand
  ├── 创建 stores（taskStore, competitorStore, profileStore, trackerStore, graphStore）
  ├── 改造 TasksPage、CompetitorsPage、ProfilesPage 使用 store
  └── 验证：竞品管理和画像页面切换不再丢失状态

Phase 2: 改造其余页面
  ├── TrackersPage、GraphPage、ComparisonPage、ProfileTasksPage
  └── 验证所有列表页切换正常

Phase 3: 增强体验（可选）
  ├── 给 store 添加 subscribe 机制，在后台静默刷新
  ├── 为长时间运行的任务添加全局通知（NotificationBell）
  └── 添加"刷新"按钮手动触发 reload
```

## 6. 后端相关说明

后端层面，画像生成的后台任务（`ExtractTask`）设计是正确的：

- `profile_extractor.py` 使用 `asyncio` 后台任务运行三阶段 LLM pipeline
- 任务状态持久化到 `ProfileExtractTask` 表
- 支持 `recover_stale_tasks()` 在重启后恢复任务

**后端不存在状态丢失问题**。问题纯粹是前端架构层面的：数据存在内存中但组件被 React Router 销毁了。

## 7. 总结

| 维度 | 说明 |
|------|------|
| **根因** | React Router v6 路由切换时完全卸载/重建组件，所有 `useState` 状态丢失 |
| **加重因素** | 无全局状态管理，数据完全在组件内部 |
| **副作用** | `setInterval` 轮询随之停止，用户看不到后台进度 |
| **假象** | 后端任务完成后数据"自动出现"——实际是重新挂载后重新拉取 |
| **修复方向** | 引入 Zustand 全局状态管理，关键数据持久化到 localStorage |
| **工作量** | 约 7 个新文件 + 7 个页面修改，中等规模 |
