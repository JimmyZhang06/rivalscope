# 竞品调研 & 图谱报告详情页内容增强 — 技术执行方案

> 基于 `agent-v5` 分支实际代码编写。所有行号、组件名、API 路径均与当前代码一一对应。
> 本方案已通过技术评审，修正了导出封面模板、状态守卫、回调传递、下拉状态管理等 6 项问题。

---

## 评审修正项汇总

| # | 问题 | 修正措施 | 涉及 Phase |
|---|---|---|---|
| 1 | 导出封面模板硬编码调研格式 | `ReportExportInput` 扩展为联合类型，`renderCoverHtml` 根据类型渲染不同封面 | Phase 1 |
| 2 | Drawer 缺少 completed 守卫 | 渲染条件增加 `detail.status === 'completed'` | Phase 1 |
| 3 | 图谱报告无 `[n]` 引用标注 | Phase 4 后端 prompt 增强时一并解决 | Phase 4 |
| 4 | `EntitySummaryCards` 无法访问 `flowApiRef` | 回调由父组件处理，仅传递 `entityId` | Phase 1 |
| 5 | 导出下拉缺少状态管理 | 复用 TaskDetailPage 已有的 `exportOpen` + 点击外部关闭模式 | Phase 1 |
| 6 | 暗色背景上统计卡文字可读性 | 使用 `text-slate-300` 而非 `text-slate-400` | Phase 1 |

---

## 总原则

| 原则 | 说明 |
|---|---|
| **不改动核心流程** | `agent.py` 的 5 阶段流水线（plan→search→analyze→insights→report）不动 |
| **不改动数据库** | 不在 `models.py` 中新增表 |
| **增量组件为主** | 新建 3 个组件，修改 6 个文件 |
| **复用优先** | `ReportToc`、`SourceDrawer`、`ReportView`、`ReactMarkdown`、导出模板全部复用 |

---

## Phase 1：图谱报告 Drawer 全面升级（核心）

### 目标

将 `GraphDetailPage.tsx` 第 489-516 行的单薄 Drawer 从"纯 Markdown 直出"升级为与 `TaskDetailPage` 同等级的报告阅读体验。

### 改动文件清单

```
frontend/src/components/GraphReportHeader.tsx   — 新建
frontend/src/components/EntitySummaryCards.tsx  — 新建
frontend/src/pages/app/GraphDetailPage.tsx       — 修改（Drawer 布局重写）
frontend/src/utils/exportReport.tsx              — 扩展（图谱报告导出封面）
frontend/src/api/types.ts                        — 扩展（GraphDetail 接口）
```

---

### 1.1 `GraphReportHeader` 组件

**文件**：`frontend/src/components/GraphReportHeader.tsx`（新建，~120 行）

**Props**：

```tsx
interface GraphReportHeaderProps {
  rootName: string
  industry: string
  timeRange: string
  createdAt: string
  entities: GraphEntity[]       // 来自 GraphDetail.entities
  relations: GraphRelation[]    // 来自 GraphDetail.relations
}
```

**渲染结构**：

```
┌─ 暗色封面卡 ─────────────────────────────────────────────┐
│  {root_name} 关系网络分析报告                              │
│  生成于 {created_at} · 检索时效 {timeRange}                │
│                                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐   │
│  │ 24     │ │ 37     │ │ 7      │ │ 72%              │   │
│  │ 实体   │ │ 关系   │ │ 关系类型│ │ 平均置信度       │   │
│  └────────┘ └────────┘ └────────┘ └──────────────────┘   │
│                                                           │
│  关系类型分布：                                            │
│  ● 上游供应商 4  ● 下游客户 5  ● 竞争 3                   │
│  ● 合作伙伴 2   ● 投资方 1   ● 母公司 1                   │
│  ● 子公司 1                                               │
│                                                           │
│  实体类型分布：                                            │
│  企业 18 · 产品 4 · 机构 2                                │
└───────────────────────────────────────────────────────────┘
```

**核心计算**（全部从前端数据计算，无新 API）：

```tsx
// 关系类型中文映射（与 backend/app/services/graph_agent.py:32-40 的 RELATION_LABELS 一致）
const RELATION_LABELS: Record<string, string> = {
  upstream_supplier: '上游供应商',
  downstream_customer: '下游客户',
  competitor: '竞争对手',
  partner: '合作伙伴',
  investor: '投资方',
  parent: '母公司',
  subsidiary: '子公司',
}

// 平均置信度
const avgConfidence = relations.length
  ? `${(relations.reduce((s, r) => s + r.confidence, 0) / relations.length * 100).toFixed(0)}%`
  : '—'

// 实体类型分布
const entityTypeCount = entities.reduce<Record<string, number>>((m, e) => {
  m[e.type] = (m[e.type] || 0) + 1; return m
}, {})
```

**样式**：沿用 `TaskDetailPage.tsx:470` 的封面卡样式 `bg-slate-900 text-white`。

---

### 1.2 `EntitySummaryCards` 组件

**文件**：`frontend/src/components/EntitySummaryCards.tsx`（新建，~100 行）

**Props**：

```tsx
interface EntitySummaryCardsProps {
  rootEntity: GraphEntity | undefined
  entities: GraphEntity[]
  relations: GraphRelation[]
  entityById: Record<string, GraphEntity>
  onEntityClick: (entityId: string) => void   // 回调，父组件处理画布交互
}
```

**渲染结构**：

```tsx
// 1. 核心对象卡（is_root === true）
<div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
  <span className="text-xs font-semibold text-blue-700">★ 核心对象</span>
  <h3 className="mt-1 text-base font-bold text-gray-900">{rootEntity.name}</h3>
  <p className="text-xs text-gray-500">{rootEntity.industry}</p>
  <p className="mt-2 text-sm text-gray-600">{rootEntity.description}</p>
</div>

// 2. 按 relation_type 分组的实体卡
// 遍历 relations，按类型分组，通过 source_id === rootId 判断方向
// 每组渲染一张卡片，内含实体名称按钮列表
<div className="rounded-lg border border-gray-200 bg-white p-3">
  <div className="flex items-center justify-between">
    <span className="text-xs font-semibold" style={{ color: RELATION_META[t].color }}>
      {RELATION_META[t].label}
    </span>
    <span className="text-xs text-gray-400">{count} 条关系</span>
  </div>
  <div className="mt-2 flex flex-wrap gap-1.5">
    {relatedEntities.map(e => (
      <button key={e.id} onClick={() => onEntityClick(e.id)}
        className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700
                   transition hover:bg-blue-50 hover:text-blue-700">
        {e.name}
      </button>
    ))}
  </div>
</div>
```

**分组逻辑**：遍历 `relations`，按 `relation_type` 分组；对每条关系，若 `source_id === rootId` 则该关系的 `target_id` 对应实体为"出方向"，反之则为"入方向"。两组实体合并展示（不区分方向，只展示该类型涉及的所有实体）。

---

### 1.3 `GraphDetailPage.tsx` Drawer 布局重写

**修改位置**：第 488-516 行。

**当前代码**：

```tsx
{showReport && (
  <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setShowReport(false)}>
    <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
         onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-900">关系网络分析报告</h2>
        <button onClick={() => setShowReport(false)}><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.report_markdown}</ReactMarkdown>
      </div>
    </div>
  </div>
)}
```

**替换为**（修正项 #2：增加 `detail.status === 'completed'` 守卫）：

```tsx
{showReport && detail.status === 'completed' && detail.report_markdown && (
  <div className="fixed inset-0 z-50 flex justify-end bg-black/40"
       onClick={() => setShowReport(false)}>
    <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl"
         onClick={(e) => e.stopPropagation()}>

      {/* Header：标题 + 导出下拉 + 关闭 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">关系网络分析报告</h2>
            <p className="text-xs text-gray-400">基于 {detail.root_name} 的产业链关系自动生成</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 导出下拉（修正项 #5：状态管理） */}
          <GraphExportButton detail={detail} />
          <button onClick={() => setShowReport(false)}
                  className="text-gray-400 transition hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 可滚动内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-5">

          {/* 1. 封面头 */}
          <GraphReportHeader
            rootName={detail.root_name}
            industry={detail.industry}
            timeRange={detail.time_range}
            createdAt={detail.created_at}
            entities={detail.entities}
            relations={detail.relations}
          />

          {/* 2. 实体关系摘要卡 */}
          <div className="mt-6">
            <EntitySummaryCards
              rootEntity={detail.entities.find(e => e.is_root)}
              entities={detail.entities}
              relations={detail.relations}
              entityById={entityById}
              onEntityClick={(entityId) => {
                // 修正项 #4：回调由父组件处理画布交互
                const pos = computeLayout(detail)
                flowApiRef.current?.setCenter(
                  pos[entityId]?.x ?? 0,
                  pos[entityId]?.y ?? 0,
                  { zoom: 1.5, duration: 300 }
                )
                setShowReport(false)
              }}
            />
          </div>

          {/* 3. 报告正文 + 侧边 TOC */}
          <div className="mt-8 flex gap-8">
            <div className="min-w-0 flex-1">
              {/* 修正项 #3：图谱报告目前无 [n] 引用标注，
                  ReportView 的 injectCitations 不产生副作用，
                  使用 ReportView 渲染是安全的 */}
              <ReportView markdown={detail.report_markdown} showSources={false} />
            </div>
            <div className="no-print hidden w-52 shrink-0 lg:block">
              <ReportToc markdown={detail.report_markdown} />
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
)}
```

**新增 import**（在 `GraphDetailPage.tsx` 顶部）：

```tsx
import ReportView from '../../components/ReportView'
import ReportToc from '../../components/ReportToc'
import GraphReportHeader from '../../components/GraphReportHeader'
import EntitySummaryCards from '../../components/EntitySummaryCards'
```

**关键改动点**：

| 改动 | 位置 | 说明 |
|---|---|---|
| 渲染条件增加 `detail.status === 'completed' && detail.report_markdown` | 第 489 行 | 修正项 #2 |
| `max-w-2xl` → `max-w-3xl` | 第 492 行 | 更宽的阅读宽度 |
| Header 新增导出下拉 | 新增 | 修正项 #5 |
| Body 内新增 `GraphReportHeader` | 插入 | 封面统计卡 |
| Body 内新增 `EntitySummaryCards` | 插入 | 实体关系分组摘要 |
| 报告正文改用 `ReportView` + 侧边 `ReportToc` | 原 ReactMarkdown 位置 | 复用 TaskDetailPage 布局 |
| 点击实体回调由父组件处理 | `onEntityClick` | 修正项 #4 |

---

### 1.4 `GraphExportButton` 内联实现

**方案**：在 `GraphDetailPage.tsx` 中新增一个内联状态和函数，不新建独立组件（改动最小）。

**新增 state**：

```tsx
const [graphExportOpen, setGraphExportOpen] = useState(false)
const graphExportRef = useRef<HTMLDivElement>(null)
```

**新增导出处理函数**：

```tsx
const handleGraphExport = async (kind: 'md' | 'pdf' | 'word') => {
  if (!detail?.report_markdown) return
  setGraphExportOpen(false)
  const input: ReportExportInput = {
    report_markdown: detail.report_markdown,
    product_name: detail.root_name,
    created_at: detail.created_at,
    industry: detail.industry,
    time_range: detail.time_range,
    type: 'graph',                              // 修正项 #1：标记为图谱报告
  }
  if (kind === 'md') {
    exportMarkdown(input)
  } else if (kind === 'word') {
    exportWord(input, [])
  } else {
    await exportPdf(input, [])
  }
}
```

**点击外部关闭**：

```tsx
useEffect(() => {
  if (!graphExportOpen) return
  const onDown = (e: MouseEvent) => {
    if (graphExportRef.current && !graphExportRef.current.contains(e.target as Node))
      setGraphExportOpen(false)
  }
  document.addEventListener('mousedown', onDown)
  return () => document.removeEventListener('mousedown', onDown)
}, [graphExportOpen])
```

**Drawer header 中的按钮**（修正项 #5）：

```tsx
<div className="relative" ref={graphExportRef}>
  <button
    onClick={() => setGraphExportOpen(v => !v)}
    className="flex items-center gap-1.5 rounded-md border border-gray-200
               px-3 py-1.5 text-xs font-medium text-gray-600
               transition hover:border-blue-300 hover:text-blue-700"
  >
    <FileDown className="h-3.5 w-3.5" /> 导出 ▾
  </button>
  {graphExportOpen && (
    <div className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden
                    rounded-md border border-gray-200 bg-white py-1 shadow-lg">
      {([{ k: 'pdf', l: 'PDF 文档 (.pdf)' },
          { k: 'word', l: 'Word 文档 (.doc)' },
          { k: 'md', l: 'Markdown (.md)' }] as const).map(item => (
        <button key={item.k} onClick={() => handleGraphExport(item.k)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left
                     text-xs text-gray-700 transition hover:bg-blue-50 hover:text-blue-700">
          <FileDown className="h-3.5 w-3.5 text-gray-400" />
          {item.l}
        </button>
      ))}
    </div>
  )}
</div>
```

---

### 1.5 `exportReport.tsx` 扩展（修正项 #1）

**文件**：`frontend/src/utils/exportReport.tsx`

**修改 `ReportExportInput` 接口**（第 14-20 行）：

```tsx
// 修改前
export interface ReportExportInput {
  report_markdown: string
  product_name: string
  created_at?: string
  competitors?: string
  focus?: string
}

// 修改后
export type ReportType = 'research' | 'graph'

export interface ReportExportInput {
  report_markdown: string
  product_name: string
  created_at?: string
  competitors?: string
  focus?: string
  type: ReportType            // 新增：区分报告类型
  industry?: string           // 图谱报告用
  time_range?: string         // 图谱报告用
}
```

**修改 `renderCoverHtml`**（第 78-89 行）：

```tsx
function renderCoverHtml(input: ReportExportInput, sources: Source[]) {
  const competitors = input.competitors
    ? input.competitors.split(/[,，、]/).map(c => c.trim()).filter(Boolean).join('、')
    : ''

  if (input.type === 'graph') {
    // 图谱报告封面
    return `
      <div class="exp-cover">
        <p class="exp-kicker">Industry Relationship Analysis</p>
        <h1>${escapeHtml(input.product_name)} 关系网络分析报告</h1>
        ${input.industry ? `<p class="exp-meta">行业：${escapeHtml(input.industry)}</p>` : ''}
        <p class="exp-meta">生成时间：${fmtDateTime(input.created_at || '')} · 检索时效：${input.time_range || '—'}</p>
        <p class="exp-meta">信息来源 ${sources.length} 条</p>
      </div>`
  }

  // 调研报告封面（原有逻辑不变）
  return `
    <div class="exp-cover">
      <p class="exp-kicker">Competitive Intelligence Profile Report</p>
      <h1>${escapeHtml(input.product_name)} 竞品调研报告</h1>
      ${competitors ? `<p class="exp-meta">对比竞品：${escapeHtml(competitors)}</p>` : ''}
      ${input.focus ? `<p class="exp-meta">调研重点：${escapeHtml(input.focus)}</p>` : ''}
      <p class="exp-meta">生成时间：${fmtDateTime(input.created_at || '')} · 信息来源 ${sources.length} 条</p>
    </div>`
}
```

**向下兼容**：已有的 `exportMarkdownTask`、`exportWordTask`、`exportPdfTask` 三个函数保持不变，继续使用 `type: 'research'` 的默认行为。

---

### 1.6 `api/types.ts` 扩展

**文件**：`frontend/src/api/types.ts`

**修改位置**：`GraphDetail` 接口（第 433-437 行）：

```tsx
// 修改前
export interface GraphDetail extends GraphProject {
  report_markdown: string
  entities: GraphEntity[]
  relations: GraphRelation[]
}

// 修改后
export interface GraphDetail extends GraphProject {
  report_markdown: string
  entities: GraphEntity[]
  relations: GraphRelation[]
  sources?: Array<{ title: string; url: string; domain: string }>  // Phase 3 启用
}
```

---

## Phase 2：调研报告封面头增强

### 目标

在 `TaskDetailPage.tsx` 现有封面头基础上新增一行执行效率指标。

### 改动文件

```
frontend/src/pages/app/TaskDetailPage.tsx  — 修改
```

### 具体修改

**位置**：第 496-515 行的封面统计卡区域。

**当前代码**（4 个卡，1 行 4 列）：

```tsx
<div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 sm:grid-cols-4">
  <div><p className="text-lg font-bold">{sources.length}</p><p className="text-[11px] text-slate-400">信息来源</p></div>
  <div>...</div>
  <div>...</div>
  <div>...</div>
</div>
```

**替换为**（6 个卡，2 行）：

```tsx
{/* 第一行：基本信息（保持不变） */}
<div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 sm:grid-cols-4">
  <StatCard value={sources.length} label="信息来源" />
  <StatCard value={(stats.tierCount.get('official') ?? 0) + (stats.tierCount.get('media') ?? 0)} label="官方与媒体来源" />
  <StatCard value={stats.dimensions.length || '—'} label="检索维度" />
  <StatCard value={reportData ? reportData.competitors.length : '—'} label="对比产品数" />
</div>
{/* 第二行：执行效率（新增） */}
<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
  <StatCard value={elapsedTime} label="总耗时" />
  <StatCard value={searchRounds} label="搜索轮次" />
  <StatCard value={dedupRate} label="去重后来源" />
  <StatCard value={conflictCount} label="冲突检出" />
</div>
```

**辅助计算**（在组件函数体内新增，靠近其他 `useMemo` 之后）：

```tsx
// 总耗时
const elapsedTime = useMemo(() => {
  if (!task.updated_at || !task.created_at) return '—'
  const ms = new Date(task.updated_at).getTime() - new Date(task.created_at).getTime()
  return formatElapsed(ms)
}, [task.created_at, task.updated_at])

// 搜索轮次
const searchRounds = useMemo(
  () => steps.filter(s => s.phase === 'searching').length,
  [steps]
)

// 去重后来源
const dedupRate = useMemo(() => {
  if (!sources.length) return '—'
  const dupCount = sources.filter(s => s.is_duplicate).length
  return `${sources.length} / ${sources.length + dupCount}`
}, [sources])

// 冲突检出
const conflictCount = useMemo(
  () => sources.filter(s => s.conflict_status === 'pending').length,
  [sources]
)
```

**`StatCard` 子组件**（在 `TaskDetailPage` 函数内部或外部定义）：

```tsx
function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {/* 使用 text-slate-300 而非 text-slate-400，确保暗色背景可读性 */}
      <p className="text-[11px] text-slate-300">{label}</p>
    </div>
  )
}
```

---

## Phase 3：洞察 Tab 维度覆盖矩阵

### 目标

在 `TaskDetailPage` 的洞察 Tab 中新增一个维度 × 产品评分矩阵。

### 改动文件

```
frontend/src/components/DimensionMatrix.tsx  — 新建
frontend/src/pages/app/TaskDetailPage.tsx    — 修改（挂载新组件）
```

### 3.1 `DimensionMatrix` 组件

**文件**：`frontend/src/components/DimensionMatrix.tsx`（新建，~80 行）

**Props**：

```tsx
interface DimensionMatrixProps {
  dimensions: string[]
  competitors: { name: string; scores: Record<string, number> }[]
}
```

**渲染结构**：

```
┌─ 维度 × 产品 评分矩阵 ──────────────────────────────────┐
│                                                          │
│  维度 \ 产品    │  产品A    │  产品B    │  产品C         │
│  ─────────────────────────────────────────────────────   │
│  功能完备性     │ 8 ★★★★  │ 6 ★★★   │ 9 ★★★★★       │
│  定价竞争力     │ 7 ★★★   │ 5 ★★    │ 8 ★★★★        │
│  用户口碑       │ 8 ★★★★  │ 7 ★★★   │ 6 ★★★         │
│  市场声量       │ 9 ★★★★★ │ 6 ★★★   │ 7 ★★★         │
│  发展潜力       │ 8 ★★★★  │ 8 ★★★★  │ 7 ★★★         │
└──────────────────────────────────────────────────────────┘
```

**核心实现**：

```tsx
function StarRating({ score }: { score: number }) {
  const full = Math.floor(score / 2)    // 10分制 → 5星
  const half = score % 2 >= 1 ? 1 : 0
  const empty = 5 - full - half
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-amber-400">{'★'.repeat(full)}</span>
      {half && <span className="text-amber-400">★</span>}
      <span className="text-gray-300">{'☆'.repeat(empty)}</span>
      <span className="ml-1.5 text-xs text-gray-500 tabular-nums">{score}</span>
    </span>
  )
}
```

**表格渲染**：

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b border-gray-200">
      <th className="pb-2 text-left text-xs font-semibold text-gray-500">维度 \ 产品</th>
      {competitors.map(c => (
        <th key={c.name} className="pb-2 text-left text-xs font-semibold text-gray-900">
          {c.name}
        </th>
      ))}
    </tr>
  </thead>
  <tbody>
    {dimensions.map(dim => (
      <tr key={dim} className="border-b border-gray-50">
        <td className="py-2.5 text-sm text-gray-700">{dim}</td>
        {competitors.map(c => (
          <td key={c.name} className="py-2.5">
            <StarRating score={c.scores[dim] ?? 0} />
          </td>
        ))}
      </tr>
    ))}
  </tbody>
</table>
```

### 3.2 在 `TaskDetailPage` 中挂载

**位置**：第 615 行后（洞察 Tab 的最后一个组件之后）。

```tsx
{reportData && reportData.dimensions?.length > 0 && reportData.competitors?.length > 0 && (
  <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-700">
        <BarChart3 className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">维度评分矩阵</h3>
        <p className="text-xs text-gray-400">各产品在各维度的量化评分对比</p>
      </div>
    </div>
    <div className="mt-4">
      <DimensionMatrix
        dimensions={reportData.dimensions}
        competitors={reportData.competitors}
      />
    </div>
  </div>
)}
```

---

## Phase 4：后端报告生成增强

### 4.1 图谱报告 prompt 增强

**文件**：`backend/app/services/graph_agent.py`

**修改位置**：`_report` 函数，第 268-326 行。

**修改 `system` prompt**（第 304-315 行），章节从 8 节扩展为 11 节：

```python
date_hint = f"当前日期 {baseline_now():%Y-%m-%d}。"
system = (
    date_hint
    + "你是一名资深的产业链与竞争情报分析师。请基于给出的关系网络（实体清单与关系清单）"
    "和检索材料，撰写一份结构化的中文 Markdown 分析报告，包含以下章节：\n"
    "1. 执行摘要（3-5句话概括关系网络，bullet points 列出核心发现）\n"
    "2. 网络结构概览（实体类型分布统计、关系密度分析）\n"
    "3. 核心对象定位（所属行业、在产业链中的位置）\n"
    "4. 上游供应链\n5. 下游客户与应用市场\n6. 竞争格局\n"
    "7. 合作、投资与股权关系\n"
    "8. 关键路径与枢纽识别（高关系度枢纽节点、最长关系链、低置信度关系警示）\n"
    "9. 关键洞察与风险提示（供应链集中度风险、竞品重叠度分析）\n"
    "10. 可信度说明（关系置信度分布、来源可信度统计、信息缺口）\n"
    "11. 信息来源（沿用给出的编号与链接）\n"
    "硬性要求：\n"
    "- 仅依据给出的实体、关系与检索材料撰写，不得编造；某维度缺乏材料时如实说明；\n"
    "- 正文论断处保留 [n] 引用标注，直接写 [n] 纯文本，不要写成 Markdown 链接；\n"
    "- 使用中文，直接输出 Markdown 正文，不要用代码块包裹。"
)
```

**在 `user` prompt 中追加预处理统计数据**（第 317-325 行后）：

```python
# 实体统计
entity_type_dist: dict[str, int] = {}
for e in entities:
    t = e.get("type", "company") if isinstance(e, dict) else "company"
    entity_type_dist[t] = entity_type_dist.get(t, 0) + 1
entity_stats = (
    f"实体统计：共 {len(entities)} 个实体，"
    + "、".join(f"{k} {v} 个" for k, v in entity_type_dist.items())
)

# 关系统计
rel_type_dist: dict[str, int] = {}
confidences: list[float] = []
for r in relations:
    if not isinstance(r, dict):
        continue
    t = r.get("relation_type", "partner")
    rel_type_dist[t] = rel_type_dist.get(t, 0) + 1
    try:
        confidences.append(float(r.get("confidence", 0.6)))
    except (TypeError, ValueError):
        pass
rel_stats = (
    f"关系统计：共 {len(relations)} 条关系，"
    + "、".join(f"{k} {v} 条" for k, v in rel_type_dist.items())
)
avg_conf = sum(confidences) / len(confidences) if confidences else 0
conf_stats = (
    f"关系置信度：平均 {avg_conf:.0%}"
    + (f"，范围 {min(confidences):.0%} ~ {max(confidences):.0%}" if confidences else "")
)

# 追加到 user prompt
user += f"\n\n{entity_stats}\n{rel_stats}\n{conf_stats}"
```

**修正项 #3 说明**：新增的 prompt 指令要求 LLM 在报告中生成 `[n]` 引用标注，这样 Phase 1 中 `ReportView` 的引用角标系统就能正常工作了。

---

### 4.2 调研报告 prompt 微调

**文件**：`backend/app/services/agent.py`

**修改位置**：`_report` 函数，第 334-358 行。

**修改 `system` prompt**，在第 1 节前新增第 0 节：

```python
system = (
    _date_header()
    + "你是一名资深的市场竞品分析师。请把分析内容整理成一份结构化的 Markdown 竞品调研报告，包含：\n"
    "0. 关键动态速览（3-5条近期关键事件，基于下方时间线数据，每条标注时间与来源编号）\n"
    "1. 执行摘要\n2. 调研对象与竞品概况\n3. 核心功能对比（用 Markdown 表格）\n"
    "4. 定价策略对比\n5. 目标市场与用户群\n6. SWOT 分析\n"
    "7. 结论与建议\n8. 可信度说明\n9. 信息来源（沿用给出的编号与链接）\n"
    "硬性要求：\n"
    "- 保留分析内容中的 [n] 引用标注，正文论断处直接写 [n] 纯文本，不要写成 Markdown 链接；\n"
    "- 「可信度说明」章节：先原样呈现给出的来源统计数据，再补充 2-4 条本次调研的信息缺口与局限性；\n"
    "- 报告使用中文，直接输出 Markdown 正文，不要用代码块包裹。"
)
```

**在 `user` prompt 中追加 timeline**（在 `source_list` 之前）：

```python
# 读取 timeline（从 task.report_data）
timeline_data = None
if task.report_data:
    try:
        rd = json.loads(task.report_data) if isinstance(task.report_data, str) else task.report_data
        timeline_data = rd.get("timeline", [])
    except (ValueError, TypeError):
        pass

if timeline_data:
    timeline_text = "\n".join(
        f"- {t.get('date', '')} {t.get('title', '')}（来源 [{t.get('ref', '?')}]）"
        for t in timeline_data[:5]
    )
    user += f"\n\n关键事件时间线：\n{timeline_text}\n"

user += f"\n\n来源统计数据（用于可信度说明章节）：\n{credibility}\n\n信息来源列表：\n{source_list}"
```

---

## 完整文件改动清单

### 新建文件（3 个）

| 文件 | 大小 | 内容 |
|---|---|---|
| `frontend/src/components/GraphReportHeader.tsx` | ~120 行 | 图谱报告封面统计卡：4 个数字卡 + 关系类型分布 + 实体类型分布 |
| `frontend/src/components/EntitySummaryCards.tsx` | ~100 行 | 核心对象卡 + 按关系类型分组的实体名称按钮列表 |
| `frontend/src/components/DimensionMatrix.tsx` | ~80 行 | 维度 × 产品评分矩阵表格，含星星可视化 |

### 修改文件（6 个）

| 文件 | 修改位置 | 改动内容 |
|---|---|---|
| `frontend/src/pages/app/GraphDetailPage.tsx` | 第 117-125 行（新增 state） | 新增 `graphExportOpen` / `graphExportRef` state |
| | 新增函数 | `handleGraphExport` + 点击外部关闭 effect |
| | 第 489-516 行（Drawer 重写） | 布局升级：Header 增加导出按钮 + Body 内嵌封面头/实体卡/TOC |
| | 顶部 imports | 新增 `ReportView`、`ReportToc`、`GraphReportHeader`、`EntitySummaryCards` |
| | 第 124 行附近 | 新增 `FileDown` icon import |
| `frontend/src/utils/exportReport.tsx` | 第 14-20 行 | `ReportExportInput` 扩展 `type`/`industry`/`time_range` |
| | 第 78-89 行 | `renderCoverHtml` 增加 `type === 'graph'` 分支 |
| `frontend/src/api/types.ts` | 第 433-437 行 | `GraphDetail` 接口新增 `sources?` 字段 |
| `backend/app/services/graph_agent.py` | 第 304-315 行 | `system` prompt 章节扩展至 11 节 |
| | 第 317-325 行后 | `user` prompt 追加实体/关系/置信度统计数据 |
| `backend/app/services/agent.py` | 第 339-349 行 | `system` prompt 新增第 0 节"关键动态速览" |
| | 第 351-357 行 | `user` prompt 追加 timeline 数据 |
| `frontend/src/pages/app/TaskDetailPage.tsx` | 第 496-515 行 | 封面头新增第 2 行统计卡（4 个） |
| | 第 615 行后 | 洞察 Tab 挂载 `DimensionMatrix` |

### 可选修改（Phase 3，暂不实施）

| 文件 | 改动 | 说明 |
|---|---|---|
| `backend/app/api/graph.py` | 新增 `GET /{graph_id}/sources` | 返回图谱检索来源列表 |
| `frontend/src/api/client.ts` | 新增 `getGraphSources(id)` | 前端调用 |
| `frontend/src/components/SourceTrustPanel.tsx` | 新建 | 来源信任链路面板 |

---

## 实施顺序与验证

```
Phase 1 ──────────────────────────────────────────────
  ├─ 1.1 GraphReportHeader 新建    →  GraphDetailPage 引入 → 验证封面统计卡渲染
  ├─ 1.2 EntitySummaryCards 新建   →  GraphDetailPage 引入 → 验证实体分组卡渲染
  ├─ 1.3 Drawer 布局重写           →  集成 TOC + ReportView → 验证完整报告阅读
  ├─ 1.4 导出按钮                  →  测试 PDF/Word/MD 导出 → 验证封面类型正确
  └─ 1.5 exportReport.tsx 扩展     →  验证图谱报告封面不同于调研报告

Phase 2 ──────────────────────────────────────────────
  ├─ 2.1 封面头第 2 行统计卡       →  验证数据正确（耗时/轮次/去重率/冲突）

Phase 3 ──────────────────────────────────────────────
  ├─ 3.1 DimensionMatrix 新建      →  洞察 Tab 挂载 → 验证矩阵渲染与星星

Phase 4 ──────────────────────────────────────────────
  ├─ 4.1 graph_agent.py prompt    →  新建图谱任务 → 验证报告含 11 节 + [n] 引用
  └─ 4.2 agent.py prompt          →  新建调研任务 → 验证"关键动态速览"节
```

每个 Phase 独立可交付，建议逐 Phase 提交 git commit。Phase 1 完成后，图谱报告详情页的阅读体验应与调研报告详情页持平。
