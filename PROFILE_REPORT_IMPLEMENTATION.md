# 画像板块 — 优秀报告实施方案

> 版本：v5.1.0 | 日期：2026-08-02 | 分支：agent-v5
> **关联文档**：[PERFORMANCE_OPTIMIZATION_PLAN.md](PERFORMANCE_OPTIMIZATION_PLAN.md) — 性能优化方案
> **目标**：将画像板块从"结构化数据展示器"升级为"分析报告阅读器"，参考调研报告（TaskDetailPage）已达的表现层标准。

---

## 一、优秀画像报告标准

| 维度 | 标准 | 当前状态 |
|------|------|----------|
| 叙事性 | Markdown 报告 + 目录 + 引用标注 | 仅有结构化 JSON 字段平铺 |
| 可视化 | 雷达图、条形图、SWOT、时间线 | 仅色彩标签块，零图表 |
| 可信度 | 每条数据标注来源编号 + 可信度分级 | 仅有来源 URL 列表 |
| 洞察 | 定位判断、SWOT、发展潜力 | 无洞察层 |
| 可对比 | 矩阵表 + 差异高亮 + 可视化嵌入 | 纯表格 |
| 可导出 | PDF / Word / Markdown 导出 | 无导出 |
| 时效性 | 追踪历史变化趋势 | 无时序视图 |

---

## 二、整体改造架构

```
后端新增 2 个端点:
  POST /api/profiles/{id}/report    → 生成叙事性 Markdown 报告
  POST /api/profiles/{id}/insights  → 生成洞察数据（scores/SWOT/timeline）

前端改造 2 个页面:
  ProfileDetailPage.tsx    → Tab 化升级（报告 / 洞察 / 来源 / 维度）
  ComparisonPage.tsx       → 增强可视化

新增 1 个服务文件:
  backend/app/services/profile_report.py  → 报告/洞察生成逻辑
```

---

## 三、后端改造详情

### 3.1 新增 `backend/app/services/profile_report.py`

**职责**：基于竞品画像数据生成两类内容：
1. **报告（report）**：LLM 生成的叙事性 Markdown，包含公司概况、产品线、市场定位、技术栈等章节
2. **洞察（insights）**：结构化 JSON，包含 5 维度评分、SWOT、定位判断、关键事件时间线

**核心逻辑**：

```python
# 报告生成流程
async def generate_profile_report(profile_id: str, user_id: str) -> dict:
    """
    输入：profile_id
    输出：{
        "report_markdown": "...",      # Markdown 报告全文
        "insights": { ... }            # 结构化洞察数据
    }
    """
```

**数据获取优先级**（复用现有服务）：

```
1. 检查 profile_data 中是否已有 summary → 作为报告开篇
2. 查找关联的 research_tasks（通过 competitor_id 匹配 product_name/competitors）
   → 提取 report_data.scores / swot / timeline → 作为洞察数据源
   → 提取 report_markdown 中与该竞品相关的章节 → 作为报告素材
3. 查找 competitor_pages（已爬取的官网页面）
   → 提取 page_type=about/features/pricing/products 的页面文本
   → 作为报告的原始素材
4. 查找 sources（关联 research_task 的搜索来源）
   → 提取 snippet 和 raw_content → 作为报告引用素材
5. 查找 graph_entities/graph_relations（产业链关系）
   → 提取上下游/竞对关系 → 作为市场定位的补充素材
```

**LLM Prompt 设计**：

报告生成使用单次 LLM 调用（chat 方法，非 chat_json），输出 Markdown 格式。

洞察生成使用 LLM 调用 + chat_json，输出结构化 JSON。

**审计日志**：复用 `_log_llm_audit` 记录 LLM 调用。

**文件位置**：`backend/app/services/profile_report.py`

---

### 3.2 修改 `backend/app/api/profiles.py` — 新增端点

在现有路由末尾追加：

```python
@router.get("/{pid}/report", response_model=dict)
def get_profile_report(pid: str, user: User = Depends(get_current_user)):
    """生成画像叙事性报告（Markdown）"""
    from app.services.profile_report import generate_profile_report
    return generate_profile_report(pid, user.id)


@router.get("/{pid}/insights", response_model=dict)
def get_profile_insights(pid: str, user: User = Depends(get_current_user)):
    """生成画像洞察数据（scores/SWOT/timeline）"""
    from app.services.profile_report import generate_profile_insights
    return generate_profile_insights(pid, user.id)
```

> **设计理由**：使用 GET 而非 POST，因为报告生成是幂等操作（相同输入相同输出），且客户端需要缓存。

---

### 3.3 修改 `backend/app/schemas/profiles.py` — 新增 schema

```python
class ProfileInsightsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verdict: str = ""                          # 总体结论
    scores: dict[str, float] = Field(default_factory=dict)  # 维度评分 {dim_label: 1-10}
    swot: dict[str, list[str]] = Field(default_factory=dict) # {strengths, weaknesses, opportunities, threats}
    positioning: str = ""                      # 市场定位判断
    timeline: list[dict] = Field(default_factory=list)       # 关键事件时间线
```

---

### 3.4 修改 `backend/app/api/profiles.py` — 更新 import

在文件顶部新增 import：

```python
from app.schemas.profiles import (
    # ... 现有 imports ...
    ProfileInsightsOut,
)
```

---

## 四、前端改造详情

### 4.1 修改 `frontend/src/api/client.ts` — 新增 API 函数

在"画像"区块末尾追加：

```typescript
// ---------- 画像报告与洞察 ----------

export function getProfileReport(id: string): Promise<{ report_markdown: string; insights: any }> {
  return request(`/api/profiles/${id}/report`)
}

export function getProfileInsights(id: string): Promise<any> {
  return request(`/api/profiles/${id}/insights`)
}
```

---

### 4.2 修改 `frontend/src/pages/app/ProfileDetailPage.tsx` — Tab 化升级

**改造方案**：将当前的单栏布局升级为 Tab 结构，参考 `TaskDetailPage` 的 Tab 模式。

```
Tab 结构：
├── 概览 (overview)     ← 保留现有维度展示，增加来源可信度概览
├── 报告 (report)      ← 新增：Markdown 渲染 + 目录 + 引用标注 + 导出
├── 洞察 (insights)    ← 新增：评分 + SWOT + 时间线 + 定位
└── 维度 (dimensions)  ← 保留现有结构化数据展示
```

**具体改动**：

#### 4.2.1 新增 import

```typescript
import {
  ArrowLeft, Lock, RefreshCw, ExternalLink, GitCompare,
  FileText, BarChart3, CalendarDays, Lightbulb, Target,  // 新增
  FileDown,  // 新增
} from 'lucide-react'
import ReportView from '../../components/ReportView'
import ReportToc from '../../components/ReportToc'
import ScoreRadar from '../../components/ScoreRadar'
import ScoreBars from '../../components/ScoreBars'
import SwotGrid from '../../components/SwotGrid'
import StepTimeline from '../../components/StepTimeline'
import { buildReportPdfBlob, exportMarkdown, exportPdf, exportWord } from '../../utils/exportReport'
```

#### 4.2.2 新增状态

```typescript
const [tab, setTab] = useState<'overview' | 'report' | 'insights' | 'dimensions'>('overview')
const [reportMarkdown, setReportMarkdown] = useState('')
const [insights, setInsights] = useState<any>(null)
const [reportLoading, setReportLoading] = useState(false)
const [insightsLoading, setInsightsLoading] = useState(false)
const [exportOpen, setExportOpen] = useState(false)
const [exporting, setExporting] = useState(false)
const exportRef = useRef<HTMLDivElement>(null)
```

#### 4.2.3 新增数据加载逻辑

在 `reload` 成功后，根据当前 tab 懒加载报告和洞察：

```typescript
useEffect(() => {
  if (!id || !profile || tab === 'overview' || tab === 'dimensions') return
  if (tab === 'report' && !reportMarkdown) {
    setReportLoading(true)
    getProfileReport(id)
      .then(data => setReportMarkdown(data.report_markdown))
      .catch(() => setNotice('报告加载失败'))
      .finally(() => setReportLoading(false))
  }
  if (tab === 'insights' && !insights) {
    setInsightsLoading(true)
    getProfileInsights(id)
      .then(data => setInsights(data))
      .catch(() => setNotice('洞察加载失败'))
      .finally(() => setInsightsLoading(false))
  }
}, [id, profile, tab, reportMarkdown, insights])
```

#### 4.2.4 Tab 导航按钮

在页面头部下方添加 Tab 栏：

```typescript
const tabs: { key: typeof tab; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: '概览', icon: BarChart3 },
  { key: 'report', label: '报告', icon: FileText },
  { key: 'insights', label: '洞察', icon: Lightbulb },
  { key: 'dimensions', label: '维度', icon: Target },
]

// 渲染：
<div className="no-print mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1">
  {tabs.map((t) => (
    <button key={t.key} onClick={() => setTab(t.key)} className={...}>
      <t.icon className="h-3.5 w-3.5" />{t.label}
    </button>
  ))}
</div>
```

#### 4.2.5 各 Tab 内容渲染

**Tab "overview"（概览）**：
- 当前 `renderProfileData()` 中的 summary 部分独立为一张"画像概要"卡
- 增加来源可信度统计（来源数量、可信度分级占比）
- 增加生成信息（generation_source、创建时间、爬取状态）

**Tab "report"（报告）**：
- 使用 `ReportView` 渲染 `reportMarkdown`
- 使用 `ReportToc` 渲染目录
- 增加导出下拉（PDF / Word / Markdown）— 复用 `exportReport.tsx`
- 注意：`exportReport.tsx` 的 `buildPdfWorker` 需要适配非 TaskDetail 的数据结构，需抽象化

**Tab "insights"（洞察）**：
- 如果有 `insights.verdict` → 总体结论卡（深色背景，参考 TaskDetailPage 第 588 行）
- 如果有 `insights.scores` → `ScoreRadar` + `ScoreBars`
- 如果有 `insights.swot` → `SwotGrid`
- 如果有 `insights.positioning` → 定位描述卡（参考 TaskDetailPage 第 599 行）
- 如果有 `insights.timeline` → `StepTimeline`

**Tab "dimensions"（维度）**：
- 保留现有的 `renderProfileData()` 完整内容

#### 4.2.6 导出功能适配

`exportReport.tsx` 当前依赖 `TaskDetail` 类型。需要修改使其能接受通用报告数据：

**修改方案**：创建 `exportProfileReport.tsx`（独立文件），适配画像数据结构：

```typescript
// 输入：{ report_markdown: string, sources: Array<{url, title, snippet}> }
// 输出：PDF / Word / Markdown 下载
```

复用 `EXPORT_CSS` 和 `buildExportHtml` 的核心逻辑，但：
- 封面标题改为 `{竞品名} 竞品画像报告`
- 移除调研特有的元信息（focus、competitors 对比列表）
- 来源附录使用 `profile.source_refs` 而非 `task.sources`

---

### 4.3 修改 `frontend/src/pages/app/ComparisonPage.tsx` — 可视化增强

**改造方案**：

#### 4.3.1 在对比结果中增加"可视化"标签页

当前对比结果仅展示表格。增加两种可视化：

**a) 差异高亮表格**：
- 同一维度下，所有竞品值相同 → 绿色标记
- 有差异 → 橙色标记，hover 显示具体差异
- 实现方式：在 `td` 上添加条件 className

```typescript
// 检测同一行是否所有值相同
const allSame = row.values && Object.values(row.values).every(v => v === Object.values(row.values)[0])
const hasDiff = !allSame

// 渲染：
<td className={`px-4 py-3 text-xs ${allSame ? 'text-emerald-700 bg-emerald-50/50' : 'text-gray-700'}`}>
  {row.values[id]}
</td>
```

**b) 嵌入雷达图对比**（当有评分数据时）：
- 如果 profile_data 中包含评分维度（或从 insights 端点获取），嵌入 `ScoreRadar`
- 实现方式：在对比结果区域上方添加一个可选的雷达图

**实现代码位置**：`ComparisonPage.tsx` 结果渲染区域

---

## 五、文件改动清单

### 5.1 后端（3 文件）

| 操作 | 文件路径 | 改动说明 |
|------|----------|----------|
| **新建** | `backend/app/services/profile_report.py` | 报告生成 + 洞察分析服务（~200 行） |
| **修改** | `backend/app/api/profiles.py` | 新增 2 个端点 (`/{pid}/report`, `/{pid}/insights`) |
| **修改** | `backend/app/schemas/profiles.py` | 新增 `ProfileInsightsOut` schema |

### 5.2 前端（3 文件）

| 操作 | 文件路径 | 改动说明 |
|------|----------|----------|
| **修改** | `frontend/src/api/client.ts` | 新增 `getProfileReport()` + `getProfileInsights()` |
| **修改** | `frontend/src/pages/app/ProfileDetailPage.tsx` | Tab 化升级 + 报告/洞察渲染 + 导出 |
| **修改** | `frontend/src/utils/exportReport.tsx` | 抽象化以支持非 TaskDetail 数据，或新建 `exportProfileReport.tsx` |
| **修改** | `frontend/src/pages/app/ComparisonPage.tsx` | 差异高亮 + 雷达图嵌入 |

### 5.3 可选的组件复用（0 新建文件）

以下现有组件直接复用，无需修改：

| 组件 | 用途 |
|------|------|
| `components/ReportView.tsx` | 渲染 Markdown 报告 + 引用标注 |
| `components/ReportToc.tsx` | 目录提取 |
| `components/ScoreRadar.tsx` | 多维度雷达图 |
| `components/ScoreBars.tsx` | 维度评分条形图 |
| `components/SwotGrid.tsx` | SWOT 分析网格 |
| `components/StepTimeline.tsx` | 事件时间线 |
| `components/ChartCard.tsx` | 统一图表容器 |
| `components/SourceCard.tsx` | 来源卡片 |
| `components/SourceDrawer.tsx` | 来源详情抽屉 |

---

## 六、实施优先级与工作量

| 阶段 | 内容 | 后端文件 | 前端文件 | 预估行数 |
|------|------|----------|----------|----------|
| **P0** | 后端报告/洞察端点 + Schema | 新建 1 + 修改 2 | — | ~250 行 |
| **P1** | 前端 ProfileDetailPage Tab 升级 | — | 修改 1 + 新建 1 (export) | ~300 行 |
| **P2** | 对比页可视化增强 | — | 修改 1 | ~80 行 |

**P0 可独立交付**：后端端点上线后，前端即使不改版也能通过直接调用 API 获取报告数据。

---

## 七、关键设计决策

### 7.1 为什么用 GET 而非 POST 生成报告？

报告生成是幂等操作（相同输入相同输出），GET 语义正确，且支持浏览器缓存和中间件缓存。如果生成时间较长（>5s），可以在中间层加缓存。

### 7.2 为什么优先利用 research_tasks 而不是重新跑 LLM？

- **成本**：research_tasks 已经投入了 LLM 分析（_analyze + _insights），直接提取 scores/SWOT/timeline 零额外 LLM 成本
- **一致性**：研究报告中已分析好的结论，画像报告引用同一来源，保持数据一致性
- **兜底**：当没有关联 research_task 时，才对 profile_data.dimensions 跑一次 LLM 生成洞察

### 7.3 报告数据存在哪里？

两种方案，推荐方案 A：

**方案 A（推荐）**：不持久化，每次请求实时生成
- 优点：报告始终与最新数据同步
- 缺点：首次加载较慢（~2-5s）
- 缓解：前端懒加载 + loading 状态

**方案 B**：持久化到 `CompetitorProfile.profile_data` 中新增 `report_markdown` 字段
- 优点：加载快
- 缺点：数据过期时需要手动刷新，增加复杂度

### 7.4 导出功能如何适配画像？

调研报告的 `exportReport.tsx` 依赖 `TaskDetail` 类型。两种适配方式：

1. **新建 `exportProfileReport.tsx`**：复制核心逻辑，修改封面标题和输入类型
2. **抽象化 `exportReport.tsx`**：将 `buildExportHtml` 和 `buildPdfWorker` 提取为接受通用参数

推荐方案 1，因为两者的数据结构和元信息差异较大，强行抽象反而增加复杂度。

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 生成报告质量不稳定 | 报告可读性差 | Prompt 工程 + 提供"重新生成"按钮 |
| 无关联 research_task 时数据不足 | 洞察为空 | 兜底：对 profile_data.dimensions 做 LLM 分析 |
| 导出功能适配复杂度高 | 延期 | 优先实现 PDF 导出，Word/Markdown 后续 |
| 前端 Tab 切换导致代码膨胀 | 维护困难 | 将每个 Tab 内容拆分为独立子组件 |

---

## 九、后续扩展方向

1. **追问功能**：参考 TaskDetailPage 的"针对报告追问"，在画像报告 Tab 中加入 AI 问答
2. **时序追踪**：如果竞品有多个时期的画像，展示维度值变化趋势图
3. **图谱嵌入**：在报告中嵌入该竞品的产业链关系图
4. **AI 助理联动**：在 AssistantWidget 中支持"基于画像提问"
