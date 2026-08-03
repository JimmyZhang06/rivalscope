# 画像详情页维度板块改造方案

> **日期**：2026-08-03 | **分支**：agent-v7
> **目标**：所有 key 改为中文标签 + 维度页面视觉升级为精美信息卡片

---

## 一、改造目标

### 改造前

```
┌─────────────────────────────────┐
│ product_overview                │  ← 英文 key 当标题
│   名称: 小米 SU7                 │
│   产品类别: 纯电动汽车            │
│   price_range: 21.59-29.99万    │  ← 字段也是英文 key
│   核心卖点: ...                  │
├─────────────────────────────────┤
│ market_position                 │
│   目标用户: ...                  │
│   advantages: ...               │  ← 漏翻
└─────────────────────────────────┘
```

### 改造后

```
┌─────────────────────────────────────────┐
│ 📦 产品概况                        8/10 │  ← 中文标签 + 洞察评分
│ ─────────────────────────────────────── │
│  产品名称    小米 SU7                    │
│  产品类别    纯电动汽车                   │
│  价格区间    21.59–29.99 万元            │
│  核心卖点    长续航、智能驾驶、...        │
│  ✓ 高可信度 · 来源: 官网/媒体            │
├─────────────────────────────────────────┤
│ 📍 市场定位                          6/10 │
│ ─────────────────────────────────────── │
│  目标用户    25-40 岁中产家庭            │
│  销售渠道    线上直销 + 线下体验店       │
│  竞争优势    性价比高、生态完整           │
│  ⚠ 中可信度 · 来源: 第三方报告          │
└─────────────────────────────────────────┘
```

---

## 二、改造清单（4 个修改点）

### 改动总览

| # | 模块 | 文件 | 改动类型 | 工作量 |
|---|------|------|---------|--------|
| 1 | 后端聚合 | `profile_extractor.py` | Stage 3 保留 confidence | 小 |
| 2 | 后端洞察 | `profile_report.py` | 评分 key 用中文 label | 小 |
| 3 | 前端渲染 | `ProfileDetailPage.tsx` | 重写维度卡片 UI | 中 |
| 4 | 前端类型 | `api/types.ts` | 补充维度相关类型 | 小 |

---

## 三、详细设计

### 改动 1：后端 Stage 3 保留字段置信度

**文件**：`backend/app/services/profile_extractor.py` — `_stage3_aggregate()`

**当前行为**（第 191-227 行）：

```python
def _stage3_aggregate(dim_results, competitor_name):
    dimensions = {}
    for dim_key, fields in dim_results.items():
        dim_data = {}
        for fk, fd in fields.items():
            val = fd.get("value", "信息不足")
            conf = fd.get("confidence", "low")
            dim_data[fk] = val          # ← 只保留 value，丢弃 confidence/source_url
        dimensions[dim_key] = dim_data
    return dimensions, summary
```

**修改后**：

```python
def _stage3_aggregate(dim_results, competitor_name):
    dimensions = {}
    for dim_key, fields in dim_results.items():
        dim_data = {}
        for fk, fd in fields.items():
            val = fd.get("value", "信息不足")
            conf = fd.get("confidence", "low")
            src = fd.get("source_url", "")
            dim_data[fk] = {"v": val, "c": conf, "s": src}  # ← 保留结构化对象
        dimensions[dim_key] = dim_data
    return dimensions, summary
```

**字段结构变化**：

| 版本 | 字段值类型 | 示例 |
|------|-----------|------|
| 改造前 | `string` | `"21.59-29.99万"` |
| 改造后 | `{v, c, s}` | `{v: "21.59-29.99万", c: "high", s: "https://..."}` |

**向下兼容**：前端渲染时检测类型，string 直接显示，object 则提取 `.v` 并展示 `.c`/`.s`。

---

### 改动 2：洞察评分 key 对齐中文 label

**文件**：`backend/app/services/profile_report.py` — `generate_profile_insights()`

**当前行为**（第 139-143 行）：

```python
dim_summary = "\n".join(
    f"【{dim_label}】\n{json.dumps(fields, ...)}"
    for dim_label, fields in dimensions.items()
    if isinstance(fields, dict)
)
# LLM 返回的 scores key 是 dim_label（可能是英文 key 或中文 label）
```

**问题**：LLM 用 `dimensions.items()` 的 key（可能是英文 `product_overview`）作为评分 key。

**修改后**：先用模板的 `label` 字段生成维度名，再用中文名传给 LLM：

```python
template = _load_template(profile.template_id, org_id)
template_dims = json.loads(template.dimensions) if template else []
dim_label_map = {d["key"]: d["label"] for d in template_dims}

dim_summary = "\n".join(
    f"【{dim_label_map.get(dim_key, dim_key)}】\n{json.dumps(fields, ...)}"
    for dim_key, fields in dimensions.items()
    if isinstance(fields, dict)
)
```

同时，洞察持久化时记录 label→key 的映射，方便前端将评分关联到维度卡片：

```python
# 在 insights 对象中追加维度映射
insights["dimension_labels"] = dim_label_map
```

---

### 改动 3：前端维度卡片全面重写

**文件**：`frontend/src/pages/app/ProfileDetailPage.tsx`

#### 3.1 用模板定义覆盖所有 key/label

当前代码直接用原始 key 做标题和字段名。改造后，通过 `template` 状态获取中文映射：

```typescript
// 在 renderProfileData() 顶部构建映射
const templateDimensions = template?.dimensions || []
const dimLabelMap: Record<string, string> = {}
const fieldLabelMap: Record<string, Record<string, string>> = {}

templateDimensions.forEach((dim) => {
  dimLabelMap[dim.key] = dim.label || dim.key
  fieldLabelMap[dim.key] = {}
  dim.fields.forEach((f) => {
    fieldLabelMap[dim.key][f.key] = f.label || f.key
  })
})
```

#### 3.2 重写维度卡片 UI

```tsx
const renderProfileData = () => {
  if (!profile) return null
  const data = typeof profile.profile_data === 'string'
    ? JSON.parse(profile.profile_data) : profile.profile_data
  const dims = data?.dimensions || {}
  if (!Object.keys(dims).length) return <p className="text-sm text-gray-400">暂无维度数据</p>

  // 洞察评分映射（dimension_labels 在改动 2 中持久化）
  const insightScores = data?.insights?.scores || {}
  const dimLabelMap = data?.insights?.dimension_labels || {}

  const dimColors = [
    { border: 'border-l-blue-500', bg: 'bg-blue-50/40', icon: '📦', tag: 'bg-blue-100 text-blue-700' },
    { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40', icon: '🏢', tag: 'bg-emerald-100 text-emerald-700' },
    { border: 'border-l-violet-500', bg: 'bg-violet-50/40', icon: '📍', tag: 'bg-violet-100 text-violet-700' },
    { border: 'border-l-amber-500', bg: 'bg-amber-50/40', icon: '⚙', tag: 'bg-amber-100 text-amber-700' },
    { border: 'border-l-rose-500', bg: 'bg-rose-50/40', icon: '⚡', tag: 'bg-rose-100 text-rose-700' },
    { border: 'border-l-teal-500', bg: 'bg-teal-50/40', icon: '🔗', tag: 'bg-teal-100 text-teal-700' },
    { border: 'border-l-indigo-500', bg: 'bg-indigo-50/40', icon: '📊', tag: 'bg-indigo-100 text-indigo-700' },
  ]

  const scoreColor = (score: number) => {
    if (score >= 7) return 'text-emerald-600 bg-emerald-50'
    if (score >= 4) return 'text-amber-600 bg-amber-50'
    return 'text-rose-600 bg-rose-50'
  }

  const confBadge = (conf: string) => {
    const map = {
      high:   { text: '高可信度', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
      medium: { text: '中可信度', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
      low:    { text: '低可信度', cls: 'bg-gray-50 text-gray-500 ring-gray-200' },
    }
    const info = map[conf] || map.low
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${info.cls}`}>{info.text}</span>
  }

  const renderFieldValue = (v: any): React.ReactNode => {
    // 改造后：支持 {v, c, s} 结构化对象
    let displayValue: any = v
    let confidence: string | undefined
    let sourceUrl: string | undefined

    if (v && typeof v === 'object' && !Array.isArray(v) && 'v' in v) {
      displayValue = v.v
      confidence = v.c
      sourceUrl = v.s
    }

    if (displayValue === null || displayValue === undefined) return <span className="text-gray-400">—</span>
    if (typeof displayValue === 'string') {
      const text = displayValue.replace(/\[\d+\]/g, '').trim()
      if (!text || text === '信息不足') return <span className="text-gray-400">—</span>
      return <span className="text-sm text-gray-800">{text}</span>
    }
    // ... 数组/对象的递归渲染保持不变，但递归时也提取 confidence
  }

  const entries = Object.entries(dims)
  return (
    <div className="space-y-4">
      {entries.map(([dimKey, fields], idx) => {
        const dimLabel = dimLabelMap[dimKey] || dimKey
        const style = dimColors[idx % dimColors.length]
        const fieldEntries = typeof fields === 'object' && !Array.isArray(fields)
          ? Object.entries(fields) : []
        const filledCount = fieldEntries.filter(([, v]) => {
          const val = v && typeof v === 'object' && 'v' in v ? v.v : v
          return val && val !== '信息不足' && val !== ''
        }).length
        const totalCount = fieldEntries.length
        const score = insightScores[dimLabel] || insightScores[dimKey]
        const scoreNum = typeof score === 'number' ? score : null

        return (
          <div key={dimKey}
            className={`rounded-xl border border-gray-100 ${style.bg} ${style.border} overflow-hidden`}>
            {/* 维度标题栏 */}
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="text-base">{style.icon}</span>
                <h3 className="text-sm font-semibold text-gray-800">{dimLabel}</h3>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${style.tag}`}>
                  {dimKey}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {scoreNum !== null && (
                  <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${scoreColor(scoreNum)}`}>
                    {scoreNum}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {filledCount}/{totalCount} 字段
                </span>
              </div>
            </div>

            {/* 字段列表 */}
            <div className="border-t border-gray-100/80 px-5 py-3">
              {fieldEntries.length === 0 ? (
                <p className="text-xs text-gray-400 italic">信息不足</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fieldEntries.map(([fieldKey, v]) => {
                    const fieldLabel = (fieldLabelMap[dimKey]?.[fieldKey]) || fieldKey
                    const val = v && typeof v === 'object' && 'v' in v ? v.v : v
                    const conf = v && typeof v === 'object' && 'c' in v ? v.c : undefined
                    const src = v && typeof v === 'object' && 's' in v ? v.s : undefined

                    if (!val || val === '信息不足' || val === '') return null

                    return (
                      <div key={fieldKey} className="rounded-lg bg-white/70 p-3 ring-1 ring-gray-100">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-400">{fieldLabel}</span>
                          {conf && confBadge(conf)}
                        </div>
                        <div className="mt-1.5">{renderFieldValue(v)}</div>
                        {src && (
                          <a href={src} target="_blank" rel="noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-500">
                            <ExternalLink className="h-2.5 w-2.5" /> 来源
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

#### 3.3 调整维度 Tab 的概要展示

**当前问题**：维度 Tab 内重复展示画像概要（蓝色卡片），与概览 Tab 的内容重复。

**修改**：维度 Tab 仅展示维度卡片，概要跳转到概览 Tab：

```tsx
{tab === 'dimensions' && (
  <div>
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-gray-900">维度详情</h2>
      {insights && insights.scores && (
        <span className="text-xs text-gray-400">
          基于 {Object.keys(insights.scores).length} 个维度的洞察分析
        </span>
      )}
    </div>
    <div className="mt-3">{renderProfileData()}</div>
    {/* 移除 renderSources()，来源已在 Tab 5 完整展示 */}
  </div>
)}
```

---

### 改动 4：类型定义补充

**文件**：`frontend/src/api/types.ts`

在 `CompetitorProfile` 附近补充维度相关类型：

```typescript
// 字段值（改造后：带置信度和来源的对象）
export interface DimensionFieldValue {
  v: string                    // 实际值
  c: 'high' | 'medium' | 'low' // 置信度
  s: string                    // 来源 URL
}

// 洞察数据中追加的维度标签映射
export interface InsightsData {
  scores: Record<string, number>
  dimension_labels?: Record<string, string>  // { "product_overview": "产品概况" }
  // ... 其余字段不变
}
```

---

## 四、视觉设计规范

### 4.1 颜色体系

| 维度序号 | 主色 | 背景 | 标签色 | 图标 |
|---------|------|------|-------|------|
| 1 | blue-500 | blue-50/40 | blue-100/blue-700 | 📦 |
| 2 | emerald-500 | emerald-50/40 | emerald-100/emerald-700 | 🏢 |
| 3 | violet-500 | violet-50/40 | violet-100/violet-700 | 📍 |
| 4 | amber-500 | amber-50/40 | amber-100/amber-700 | ⚙ |
| 5 | rose-500 | rose-50/40 | rose-100/rose-700 | ⚡ |
| 6+ | 循环使用前 5 色 | | | |

### 4.2 评分颜色

| 分数区间 | 颜色 | 含义 |
|---------|------|------|
| 7-10 | emerald | 强 |
| 4-6 | amber | 中 |
| 0-3 | rose | 弱 |
| 无数据 | gray | — |

### 4.3 置信度标记

| 级别 | 标签 | 颜色 |
|------|------|------|
| high | 高可信度 | emerald |
| medium | 中可信度 | amber |
| low | 低可信度 | gray |

---

## 五、迁移兼容策略

### 5.1 profile_data 向前兼容

改造后字段值从 `string` 变为 `{v, c, s}`，需要处理存量数据：

```typescript
// 前端兼容检测
const normalizeFieldValue = (v: any): { text: string; confidence?: string; source?: string } => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'v' in v) {
    return { text: v.v, confidence: v.c, source: v.s }
  }
  return { text: v ?? '' }  // 旧格式直接使用
}
```

存量画像的 `profile_data.dimensions` 中字段值仍是纯字符串，前端检测到非对象格式时走旧路径。

### 5.2 洞察评分 key 兼容

LLM 返回的 scores key 可能是旧格式（英文 key），加 fallback：

```typescript
const getScore = (dimKey: string, dimLabel: string, scores: Record<string, number>) => {
  return scores[dimLabel] ?? scores[dimKey] ?? null
}
```

---

## 六、实施步骤

```
Step 1: 修改 profile_extractor.py _stage3_aggregate()
         → 字段值改为 {v, c, s} 对象
         影响：所有新生成的画像

Step 2: 修改 profile_report.py generate_profile_insights()
         → LLM prompt 用中文 label 做维度名
         → insights 中追加 dimension_labels 映射
         影响：新生成的洞察

Step 3: 修改 ProfileDetailPage.tsx renderProfileData()
         → 用 template.dimensions 构建 label 映射
         → 替换维度卡片 UI
         → 移除维度 Tab 内的来源预览
         影响：前端展示

Step 4: 补充 types.ts 类型定义
         → DimensionFieldValue / dimension_labels
         影响：类型安全

Step 5: 验证
         → 生成新画像 → 维度 Tab 全中文 + 新 UI
         → 查看旧画像 → 旧数据兼容降级
         → 洞察评分正确关联维度
```

**预计工作量**：约 3-4 小时。

---

## 七、改造前后对比

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 维度标题 | `product_overview`（英文） | `产品概况`（中文 label） |
| 字段标签 | `name` / `price_range`（英文 key） | `产品名称` / `价格区间`（中文 label） |
| 字段值类型 | `string` | `{v, c, s}` 含置信度和来源 |
| 信息密度 | 纯文本列表 | 带图标、评分、进度、置信度标记的卡片 |
| 洞察关联 | 无关联 | 评分徽章直接显示在维度卡片头 |
| 来源溯源 | 无 | 字段级来源链接 |
| 视觉风格 | 灰色边框 + 白色背景 | 彩色图标 + 彩色左边框 + 浅色背景 + 圆角卡片 |
