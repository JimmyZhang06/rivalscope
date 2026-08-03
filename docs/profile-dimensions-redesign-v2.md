# 画像详情页维度板块改造方案 v2

> **日期**：2026-08-03 | **分支**：agent-v7 | **前版**：v1（已技术评审，发现 5 个必须修复项）
> **v2 变更**：新增格式归一化层、修复三路径一致性、修复统计逻辑断裂、后端持久化 label 映射

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
└─────────────────────────────────┘
```

### 改造后

```
┌─────────────────────────────────────────┐
│ 📦 产品概况                        8/10 │  ← 中文 label + 洞察评分
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
│  竞争优势    性价比高、生态完整           │
│  ⚠ 中可信度 · 来源: 第三方报告          │
└─────────────────────────────────────────┘
```

---

## 二、核心架构设计

### 2.1 三路径归一化策略

后端有三个画像生成入口，产出不同格式的维度数据。改造的关键是**在写入 `profile_data` 之前统一格式**，而不是在各路径末端零散修改。

```
                    ┌──────────────┐
                    │  research    │  纯文本字段值
                    │  profiles.py │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │              │
   ┌──────────────►│ _normalize_  │◄──────────────┐
   │               │  dimensions  │               │
   │               │              │               │
┌──┴───────┐  ┌────┴─────┐  ┌────┴─────┐  ┌──────┴───────┐
│  crawl   │  │product_  │  │research  │  │  _fallback_  │
│extractor │  │ intel    │  │ fallback │  │  _insights   │
│  .py     │  │  .py     │  │  .py     │  │  .py         │
└──────────┘  └──────────┘  └──────────┘  └──────────────┘
                           │
                    ┌──────▼───────┐
                    │ profile_data │  {"dimensions": {dim_key: {field_key: {v,c,s}}},
                    │   (统一格式)  │   "summary": "...", "dimension_labels": {...}}
                    └──────────────┘
                           │
                    ┌──────▼───────┐
                    │  前端渲染    │  所有 key/label 来自模板定义或
                    │ProfileDetail │  profile_data.dimension_labels
                    └──────────────┘
```

### 2.2 统一字段值格式

所有路径写入 `profile_data.dimensions` 时，字段值统一为对象格式：

```json
{
  "dimensions": {
    "product_overview": {
      "name":          { "v": "小米 SU7",           "c": "high",   "s": "https://..." },
      "category":      { "v": "纯电动汽车",           "c": "high",   "s": "" },
      "price_range":   { "v": "21.59-29.99万",       "c": "medium", "s": "https://..." },
      "main_features": { "v": "长续航、智能驾驶",     "c": "low",    "s": "" }
    }
  },
  "summary": { "key_points": [...], "data_quality": "medium" },
  "dimension_labels": {
    "product_overview": "产品概况",
    "company_info":     "企业信息",
    "market_position":  "市场定位",
    "tech_analysis":    "技术分析",
    "risk_opportunity": "风险与机会"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `v` | `string` | 实际字段值 |
| `c` | `"high" \| "medium" \| "low"` | 置信度 |
| `s` | `string` | 来源 URL（空串表示无特定来源） |

---

## 三、改动清单

| # | 模块 | 文件 | 改动 | 工作量 |
|---|------|------|------|--------|
| 1 | 后端工具 | `profile_extractor.py` | 新增 `_normalize_dimensions()` 统一函数 | 小 |
| 2 | 后端 crawl | `profile_extractor.py` | `_stage3_aggregate()` 改格式 + 修统计逻辑 | 小 |
| 3 | 后端 research | `profiles.py` | 生成后归一化 + 写入 `dimension_labels` | 小 |
| 4 | 后端 product_intel | `product_intel.py` | `_merge_results` 后归一化 + 写入 `dimension_labels` | 小 |
| 5 | 后端洞察 | `profile_report.py` | prompt 用中文 label + 持久化 `dimension_labels` + 修 fallback | 中 |
| 6 | 前端渲染 | `ProfileDetailPage.tsx` | 全面重写维度卡片 UI | 中 |
| 7 | 前端类型 | `api/types.ts` | 补充维度相关类型定义 | 小 |

---

## 四、后端改动详细设计

### 改动 1：新增 `_normalize_dimensions` 统一函数

**文件**：`backend/app/services/profile_extractor.py`

在 `_stage3_aggregate` 之前新增：

```python
def _normalize_dimensions(raw_dimensions: dict, dim_label_map: dict[str, str] | None = None) -> dict:
    """将所有路径的维度数据归一化为 {field_key: {v, c, s}} 格式。

    处理三种输入：
      1. 纯文本字符串（research 路径）→ 包装为 {v, c: "medium", s: ""}
      2. {value, confidence, source_url} 对象（crawl Stage 2 输出）→ 改为 {v, c, s}
      3. 嵌套结构对象（product_intel 路径的 product_catalog 等）→ 保留原样，不归一化
      4. {"_info": "信息不足"}（product_intel 缺失维度）→ 转为 {v: "信息不足", c: "low", s: ""}
    """
    normalized = {}
    for dim_key, fields in raw_dimensions.items():
        if not isinstance(fields, dict):
            # 非 dict 值（如数组、字符串）保留原样
            normalized[dim_key] = fields
            continue
        normalized[dim_key] = {}
        for fk, fv in fields.items():
            if isinstance(fv, str):
                # 情况 1：纯文本 → 包装为对象
                normalized[dim_key][fk] = {
                    "v": fv if fv else "信息不足",
                    "c": "medium",
                    "s": "",
                }
            elif isinstance(fv, dict):
                if "v" in fv:
                    # 情况 2：已是 {v, c, s} 格式（crawl Stage 2 输出）
                    normalized[dim_key][fk] = {
                        "v": fv.get("v", "信息不足"),
                        "c": fv.get("c", fv.get("confidence", "medium")),
                        "s": fv.get("s", fv.get("source_url", "")),
                    }
                elif "_info" in fv:
                    # 情况 4：product_intel 的缺失标记
                    normalized[dim_key][fk] = {"v": "信息不足", "c": "low", "s": ""}
                else:
                    # 情况 3：嵌套结构对象（product_catalog、price_list 等）
                    # 这些是设计为结构化展示的维度，保留原始结构
                    normalized[dim_key][fk] = fv
            else:
                # 其他类型（数字、布尔值等）包装为对象
                normalized[dim_key][fk] = {"v": str(fv), "c": "medium", "s": ""}
    return normalized
```

**被归一化的数据流**：

| 路径 | 归一化前 | 归一化后 |
|------|---------|---------|
| research | `{"name": "小米 SU7"}` | `{"name": {v: "小米 SU7", c: "medium", s: ""}}` |
| crawl | `{"name": {value, confidence, source_url}}` | `{"name": {v, c, s}}`（键名重映射） |
| product_intel 普通字段 | `{"price_range": "21.59-29.99万"}` | `{"price_range": {v, c: "medium", s: ""}}` |
| product_intel 嵌套维度 | `{"product_catalog": {product_lines: [...]}}` | 保留不变 |
| product_intel 缺失 | `{"_info": "信息不足"}` | `{"_info": {v: "信息不足", c: "low", s: ""}}` |

---

### 改动 2：修复 `_stage3_aggregate`

**文件**：`backend/app/services/profile_extractor.py`

```python
def _stage3_aggregate(
    dim_results: dict[str, dict[str, Any]],
    competitor_name: str,
) -> tuple[dict[str, Any], str]:
    """聚合各维度提取结果，检测冲突，生成 summary。

    返回的字段值为 {v, c, s} 对象格式。
    """
    dimensions = {}
    conflict_count = 0
    high_count = 0
    total_fields = 0

    for dim_key, fields in dim_results.items():
        dim_data = {}
        for fk, fd in fields.items():
            val = fd.get("value", "信息不足")
            conf = fd.get("confidence", "low")
            src = fd.get("source_url", "")
            dim_data[fk] = {"v": val, "c": conf, "s": src}
            total_fields += 1
            if conf == "high":
                high_count += 1
            if isinstance(val, str) and val.startswith("存在差异"):
                conflict_count += 1

        dimensions[dim_key] = dim_data

    # 统计已填充字段数（v 不为空且不是"信息不足"）
    filled = sum(
        1 for d in dimensions.values()
        for v in d.values()
        if isinstance(v, dict) and v.get("v", "") not in ("", "信息不足")
    )
    if total_fields == 0:
        summary = f"未能从官网提取到 {competitor_name} 的结构化信息，建议补充调研来源。"
    elif conflict_count > 0:
        summary = (f"已完成 {competitor_name} 的画像提取，"
                   f"共 {filled}/{total_fields} 个字段有值，"
                   f"{conflict_count} 个字段存在多来源差异，建议人工复核。")
    else:
        summary = (f"已完成 {competitor_name} 的画像提取，"
                   f"共 {filled}/{total_fields} 个字段有值，"
                   f"其中 {high_count} 个字段置信度较高。")

    return dimensions, summary
```

**关键修复**：
- 第 6 行：字段值从 `dim_data[fk] = val` 改为 `dim_data[fk] = {"v": val, "c": conf, "s": src}`
- 第 14 行：`.startswith("存在差异")` 前加 `isinstance(val, str)` 保护
- 第 18-21 行：`filled` 统计适配对象格式（`v.get("v", "")`）

---

### 改动 3：research 路径归一化 + 写入 label 映射

**文件**：`backend/app/services/profiles.py`

在 `generate_profile` 函数中，LLM 返回 `data` 后、写入数据库前，添加归一化和 label 映射：

```python
# ... 第 73 行 data = await llm.chat_json(system, user) 之后

# 确保 summary 是结构化对象（现有逻辑不变）
raw_summary = data.get("summary", "")
if isinstance(raw_summary, str):
    ...

# 新增：归一化维度字段值格式
dimensions = data.get("dimensions", {})
normalized_dimensions = _normalize_dimensions(dimensions)
data["dimensions"] = normalized_dimensions

# 新增：写入维度 label 映射（前端无需依赖 template 状态）
template = db.get(ProfileTemplate, template_id)
if template:
    template_dims = json.loads(template.dimensions)
    data["dimension_labels"] = {d["key"]: d["label"] for d in template_dims}

# 记录关联 task/source IDs（现有逻辑不变）
data["related_task_ids"] = [t.id for t in tasks]
data["related_source_ids"] = [s.id for s in sources[:10]]

final_data_str = json.dumps(data, ensure_ascii=False)
```

同时，`_stage3_aggregate` 的重命名版本（或同文件内的辅助函数）需要处理 research 路径的输出。由于 research 路径的 `data.dimensions` 在写入数据库前已经被 `_normalize_dimensions` 处理，不需要额外修改。

---

### 改动 4：product_intel 路径归一化 + 写入 label 映射

**文件**：`backend/app/services/product_intel.py`

在 `_merge_results` 调用之后、写入数据库之前：

```python
# 第 449 行 merged = _merge_results(broad_data, deep_data, dimensions) 之后

# 新增：归一化维度字段值格式
merged["dimensions"] = _normalize_dimensions(
    merged.get("dimensions", {}),
    {d["key"]: d["label"] for d in dimensions}
)
merged["dimension_labels"] = {d["key"]: d["label"] for d in dimensions}
```

`_normalize_dimensions` 函数从 `profile_extractor.py` 导入：

```python
from app.services.profile_extractor import _normalize_dimensions
```

注意：product_intel 路径中 `_merge_results` 产生的 `product_catalog`、`pricing` 等嵌套对象维度会被 `_normalize_dimensions` 识别为"嵌套结构对象"并保留原样，不会破坏其结构。

---

### 改动 5：洞察评分用中文 label + 持久化映射 + 修复 fallback

**文件**：`backend/app/services/profile_report.py`

#### 5a. 用中文 label 传给 LLM

```python
# 第 139-143 行，修改 dim_summary 构建逻辑

# 先加载模板获取 label 映射
template = _load_template(profile.template_id, org_id)
template_dims = json.loads(template.dimensions) if template else []
dim_label_map = {d["key"]: d["label"] for d in template_dims}

dim_summary = "\n".join(
    f"【{dim_label_map.get(dim_key, dim_key)}】\n{json.dumps(fields, ensure_ascii=False, indent=2)}"
    for dim_key, fields in dimensions.items()
    if isinstance(fields, dict)
)
```

同时修改 LLM prompt，明确要求使用中文维度名：

```python
system_prompt = (
    "你是一名资深的竞争情报分析师。基于给出的竞品画像维度数据，"
    "生成结构化的分析洞察。\n\n"
    "维度名称为中文，评分 JSON 的 key 必须严格使用以下中文维度名，"
    "不得使用英文或其他变体：\n"
    f"{', '.join(dim_label_map.values())}\n\n"
    "评分规则（严格按证据数量定级）：\n"
    "- 强（8-10分）：3条以上明确正面证据，无负面证据\n"
    "- 中（5-7分）：有正面证据但有限，或存在争议\n"
    "- 弱（1-4分）：负面证据多，或信息严重不足\n"
    "- 信息完全缺失的维度给 0 分并标注「无数据」\n\n"
    # ... 其余不变
)
```

#### 5b. 持久化时包含 `dimension_labels`

```python
# 第 189-197 行，确保所有字段存在后

insights.setdefault("scores", {})
insights.setdefault("verdict", "")
insights.setdefault("positioning", "")
insights.setdefault("swot", {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []})
insights.setdefault("timeline", [])

# 新增：追加维度 label 映射
insights["dimension_labels"] = dim_label_map

_persist_insights(profile, insights)
return insights
```

#### 5c. 修复 `_fallback_insights`

```python
def _fallback_insights(dimensions: dict, competitor_name: str, dim_label_map: dict[str, str] | None = None) -> dict:
    """LLM 失败时的兜底洞察：基于维度数据生成最简评分"""
    scores = {}
    for dim_key, fields in dimensions.items():
        if not isinstance(fields, dict):
            label = (dim_label_map or {}).get(dim_key, dim_key)
            scores[label] = 0
            continue
        filled = sum(1 for v in fields.values() if v and v != "信息不足")
        total = len(fields)
        if total == 0:
            score = 0
        elif filled == 0:
            score = 1
        elif filled / total >= 0.7:
            score = 7
        else:
            score = 4

        label = (dim_label_map or {}).get(dim_key, dim_key)
        scores[label] = score

    return {
        "scores": scores,
        "verdict": f"基于 {len(dimensions)} 个维度的有限数据生成，建议补充调研材料以获得更准确的洞察。",
        "positioning": "数据有限，暂无法判断",
        "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        "timeline": [],
        "dimension_labels": dim_label_map or {},
    }
```

修改调用处（第 187 行）：

```python
insights = _fallback_insights(dimensions, competitor.name, dim_label_map)
```

---

## 五、前端改动详细设计

### 改动 6：维度卡片全面重写

**文件**：`frontend/src/pages/app/ProfileDetailPage.tsx`

#### 6a. 类型定义

在文件顶部 imports 后添加类型：

```typescript
type FieldValue = { v: string; c: 'high' | 'medium' | 'low'; s: string }
type StructuredValue = Record<string, any>  // 嵌套结构（product_catalog 等）

type DimFieldEntry = { label: string; value: any; confidence?: string; sourceUrl?: string }
```

#### 6b. 构建 label 映射（从 profile_data 读取，不依赖 template 状态）

```typescript
const renderProfileData = () => {
    if (!profile) return null
    const data = typeof profile.profile_data === 'string'
        ? JSON.parse(profile.profile_data) : profile.profile_data
    const dims = data?.dimensions || {}
    if (!Object.keys(dims).length) return <p className="text-sm text-gray-400">暂无维度数据</span>

    // label 映射：优先从 insights.dimension_labels 读取（后端已写入 profile_data）
    // fallback 到 template 状态
    const dimLabelMap: Record<string, string> =
        data?.insights?.dimension_labels
        || template?.dimensions?.reduce((acc, d) => { acc[d.key] = d.label; return acc }, {} as Record<string, string>)
        || {}

    const fieldLabelMap: Record<string, Record<string, string>> =
        template?.dimensions?.reduce((acc, dim) => {
            acc[dim.key] = dim.fields.reduce((fAcc, f) => { fAcc[f.key] = f.label; return fAcc }, {} as Record<string, string>)
            return acc
        }, {} as Record<string, Record<string, string>>)
        || {}
```

#### 6c. 从字段值中提取显示值

```typescript
    const extractFieldValue = (v: any): DimFieldEntry => {
        if (v && typeof v === 'object' && !Array.isArray(v) && 'v' in v) {
            // 新格式 {v, c, s}
            return {
                label: '',
                value: v.v,
                confidence: v.c,
                sourceUrl: v.s,
            }
        }
        // 旧格式：纯文本或其他
        return { label: '', value: v }
    }
```

#### 6d. 洞察评分获取（双向查找）

```typescript
    const insightScores = data?.insights?.scores || {}
    const getScore = (dimKey: string, dimLabel: string): number | null => {
        const s = insightScores[dimLabel] ?? insightScores[dimKey] ?? null
        return typeof s === 'number' ? s : null
    }
```

#### 6e. 置信度徽章

```typescript
    const confBadge = (conf: string) => {
        const map: Record<string, { text: string; cls: string }> = {
            high:   { text: '高可信度', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
            medium: { text: '中可信度', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
            low:    { text: '低可信度', cls: 'bg-gray-50 text-gray-500 ring-gray-200' },
        }
        const info = map[conf] || map.low
        return (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${info.cls}`}>
                {info.text}
            </span>
        )
    }

    const scoreColor = (score: number) => {
        if (score >= 7) return 'text-emerald-600 bg-emerald-50'
        if (score >= 4) return 'text-amber-600 bg-amber-50'
        return 'text-rose-600 bg-rose-50'
    }
```

#### 6f. 重写维度卡片渲染

```tsx
    const dimColors = [
        { border: 'border-l-blue-500',   bg: 'bg-blue-50/40',   icon: '📦', tag: 'bg-blue-100 text-blue-700' },
        { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40', icon: '🏢', tag: 'bg-emerald-100 text-emerald-700' },
        { border: 'border-l-violet-500',  bg: 'bg-violet-50/40',  icon: '📍', tag: 'bg-violet-100 text-violet-700' },
        { border: 'border-l-amber-500',   bg: 'bg-amber-50/40',   icon: '⚙',  tag: 'bg-amber-100 text-amber-700' },
        { border: 'border-l-rose-500',    bg: 'bg-rose-50/40',    icon: '⚡', tag: 'bg-rose-100 text-rose-700' },
        { border: 'border-l-teal-500',    bg: 'bg-teal-50/40',    icon: '🔗', tag: 'bg-teal-100 text-teal-700' },
        { border: 'border-l-indigo-500',  bg: 'bg-indigo-50/40',  icon: '📊', tag: 'bg-indigo-100 text-indigo-700' },
    ]

    const renderFieldValue = (v: any): React.ReactNode => {
        const entry = extractFieldValue(v)
        const display = entry.value

        if (display === null || display === undefined)
            return <span className="text-gray-400">—</span>

        if (typeof display === 'string') {
            const text = display.replace(/\[\d+\]/g, '').trim()
            if (!text || text === '信息不足')
                return <span className="text-gray-400">—</span>
            return <span className="text-sm text-gray-800">{text}</span>
        }

        if (typeof display === 'number' || typeof display === 'boolean')
            return <span className="text-sm text-gray-800">{String(display)}</span>

        if (Array.isArray(display)) {
            if (display.length === 0) return <span className="text-gray-400">—</span>
            if (typeof display[0] === 'string') {
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {display.map((item, i) => (
                            <span key={i} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                {String(item).replace(/\[\d+\]/g, '').trim()}
                            </span>
                        ))}
                    </div>
                )
            }
            // 对象数组（嵌套结构）
            return (
                <div className="mt-2 space-y-2">
                    {display.map((item: any, i: number) => {
                        const keys = Object.keys(item).filter(k => item[k] !== null && item[k] !== false && item[k] !== '' && item[k] !== '信息不足')
                        const titleKey = keys.find(k => ['name', 'title', 'product', '类别'].includes(k)) || keys[0]
                        const title = String(item[titleKey] || '').replace(/\[\d+\]/g, '').trim()
                        return (
                            <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
                                {title && <p className="text-sm font-medium text-gray-800">{title}</p>}
                                <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                    {keys.filter(k => k !== titleKey).map(k => {
                                        const val = item[k]
                                        if (val === null || val === undefined || val === '') return null
                                        const label = fieldLabelMap[dimKey]?.[k]
                                            || { name: '名称', category: '类别', description: '描述', price: '价格',
                                                confidence: '置信度', specs: '规格', features: '功能',
                                                date: '日期', type: '类型' }[k] || k
                                        return (
                                            <div key={k} className="text-xs">
                                                <span className="text-gray-400">{label}</span>
                                                <p className="mt-0.5 text-gray-700">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )
        }

        if (typeof display === 'object' && display !== null) {
            const entries = Object.entries(display).filter(([, val]) => val !== null && val !== false && val !== '' && val !== '信息不足')
            if (entries.length === 0) return <span className="text-gray-400">信息不足</span>
            return (
                <div className="mt-1 space-y-1">
                    {entries.map(([k, val]) => (
                        <div key={k} className="text-xs">
                            <span className="text-gray-400">{k}：</span>
                            <span className="text-gray-700">{renderFieldValue(val)}</span>
                        </div>
                    ))}
                </div>
            )
        }

        return <span className="text-sm text-gray-800">{String(display)}</span>
    }

    return (
        <div className="space-y-4">
            {Object.entries(dims).map(([dimKey, fields], idx) => {
                const dimLabel = dimLabelMap[dimKey] || dimKey
                const style = dimColors[idx % dimColors.length]
                const fieldEntries = typeof fields === 'object' && !Array.isafe(fields)
                    ? Object.entries(fields) : []
                const filledCount = fieldEntries.filter(([, v]) => {
                    const entry = extractFieldValue(v)
                    return entry.value && entry.value !== '信息不足' && entry.value !== ''
                }).length
                const score = getScore(dimKey, dimLabel)

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
                            <div className="flex items-center gap-2.5">
                                {score !== null && (
                                    <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${scoreColor(score)}`}>
                                        {score}
                                    </span>
                                )}
                                <span className="text-xs text-gray-400">
                                    {filledCount}/{fieldEntries.length} 字段
                                </span>
                            </div>
                        </div>

                        {/* 字段列表 */}
                        <div className="border-t border-gray-100/80 px-5 py-3.5">
                            {fieldEntries.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">信息不足</p>
                            ) : (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {fieldEntries.map(([fieldKey, v]) => {
                                        const entry = extractFieldValue(v)
                                        if (!entry.value || entry.value === '信息不足' || entry.value === '')
                                            return null
                                        const fieldLabel = fieldLabelMap[dimKey]?.[fieldKey] || fieldKey

                                        return (
                                            <div key={fieldKey} className="rounded-lg bg-white/70 p-3 ring-1 ring-gray-100">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-medium text-gray-400">{fieldLabel}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        {entry.confidence && confBadge(entry.confidence)}
                                                    </div>
                                                </div>
                                                <div className="mt-1.5">{renderFieldValue(v)}</div>
                                                {entry.sourceUrl && (
                                                    <a href={entry.sourceUrl} target="_blank" rel="noreferrer"
                                                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-500">
                                                        <ExternalLink className="h-2.5 w-2.5" /> 来源
                                                    </a>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
```

#### 6g. 调整维度 Tab 布局

```tsx
{tab === 'dimensions' && (
    <div>
        <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">维度详情</h2>
            {insights?.scores && (
                <span className="text-xs text-gray-400">
                    基于 {Object.keys(insights.scores).length} 个维度的洞察分析
                </span>
            )}
        </div>
        <div className="mt-3">{renderProfileData()}</div>
    </div>
)}
```

**变更点**：移除维度 Tab 内的 `{renderSources()}` 调用（来源信息已在 Tab 5「信息来源」完整展示，避免重复）。

---

### 改动 7：补充类型定义

**文件**：`frontend/src/api/types.ts`

在 `CompetitorProfile` 接口后补充：

```typescript
// 洞察数据（补充 dimension_labels）
export interface InsightsData {
    scores: Record<string, number>
    dimension_labels?: Record<string, string>  // { "product_overview": "产品概况" }
    verdict: string
    positioning: string
    swot: {
        strengths: string[]
        weaknesses: string[]
        opportunities: string[]
        threats: string[]
    }
    timeline: Array<{ date: string; title: string; summary: string }>
}

// ProfileTemplate.dimensions 已有类型（第 165 行），无需修改
```

---

## 六、向后兼容策略

### 6.1 旧画像数据兼容

存量画像的 `profile_data.dimensions` 中字段值可能是纯文本字符串。前端 `extractFieldValue` 已处理两种格式：

```typescript
const extractFieldValue = (v: any): DimFieldEntry => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'v' in v) {
        // 新格式 {v, c, s}
        return { label: '', value: v.v, confidence: v.c, sourceUrl: v.s }
    }
    // 旧格式：纯文本
    return { label: '', value: v }
}
```

旧画像的 `dimension_labels` 字段可能不存在，前端通过 `template` 状态 fallback：

```typescript
const dimLabelMap = data?.insights?.dimension_labels
    || template?.dimensions?.reduce(...)
    || {}
```

如果 template 也加载失败，fallback 到原始 key（英文），保证页面不崩溃。

### 6.2 旧洞察数据兼容

存量 `insights_json` 中可能没有 `dimension_labels` 字段。前端 `getScore` 函数已做双向查找：

```typescript
const getScore = (dimKey: string, dimLabel: string): number | null => {
    return insightScores[dimLabel] ?? insightScores[dimKey] ?? null
}
```

如果两个 key 都找不到，返回 `null`，评分徽章不渲染。

---

## 七、实施步骤

```
Step 1: 后端 — 新增 _normalize_dimensions 函数
        文件: profile_extractor.py
        内容: 改动 1
        验证: import 不报错

Step 2: 后端 — 修复 _stage3_aggregate
        文件: profile_extractor.py
        内容: 改动 2
        验证: 生成测试画像，检查 summary 统计正确

Step 3: 后端 — product_intel 归一化
        文件: product_intel.py
        内容: 改动 4
        验证: 生成 product_intel 画像，检查维度字段格式

Step 4: 后端 — research 路径归一化 + label 映射
        文件: profiles.py
        内容: 改动 3
        验证: 生成 research 画像，检查 dimension_labels 写入

Step 5: 后端 — 洞察评分中文化 + fallback 修复
        文件: profile_report.py
        内容: 改动 5
        验证: 生成洞察，检查 scores key 是中文 label

Step 6: 前端 — 维度卡片重写
        文件: ProfileDetailPage.tsx
        内容: 改动 6
        验证: 新/旧画像都能正常渲染，label 全中文

Step 7: 前端 — 类型补充
        文件: api/types.ts
        内容: 改动 7
        验证: TypeScript 编译无错误

Step 8: 端到端验证
        1. 用三套模板各生成 1 个画像
        2. 检查维度 Tab：全中文、有评分、有置信度标记
        3. 检查旧画像：正常降级渲染
        4. 检查洞察 Tab：评分与维度卡片正确关联
```

**预计总工作量**：约 4-5 小时。

---

## 八、改造前后对比

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 维度标题 | `product_overview`（英文 key） | `产品概况`（中文 label） |
| 字段标签 | `name` / `price_range`（英文 key） | `产品名称` / `价格区间`（中文 label） |
| 字段值类型 | `string`（纯文本） | `{v, c, s}`（值 + 置信度 + 来源） |
| 三路径一致性 | research=字符串 / crawl=字符串 / product_intel=混合 | 统一为 `{v, c, s}`（嵌套结构保留） |
| 后端持久化 | 无 label 映射 | `profile_data.dimension_labels` 持久化 |
| 洞察评分 key | 英文 key（不稳定） | 中文 label + prompt 强制指令 |
| 信息密度 | 纯文本列表 | 图标 + 评分徽章 + 置信度标记 + 字段卡片 |
| 洞察关联 | 无 | 评分直接显示在维度卡片头部 |
| 来源溯源 | 无 | 字段级来源链接 |
| 视觉风格 | 灰色边框 + 白色背景 | 彩色图标 + 彩色左边框 + 浅色背景 + 圆角卡片 |
| 数据冗余 | 概要卡片在概览 Tab 和维度 Tab 各出现一次 | 维度 Tab 移除重复的概要卡片 |

---

## 九、风险与回滚

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| LLM 返回的 scores key 仍用英文 | 中 | 部分评分不显示 | prompt 强制指令 + 前端双向查找 |
| 旧画像数据字段值为字符串，前端误判 | 低 | 影响旧画像展示 | `extractFieldValue` 兼容两种格式 |
| `_normalize_dimensions` 误判嵌套结构 | 低 | 破坏 product_intel 结构化展示 | 检测 `"v" in fv` 而非 `isinstance(fv, dict)` |
| template 加载失败 | 低 | label 映射为空 | 后端已写入 `dimension_labels`，前端不依赖 template |
| LLM 对 `{v, c, s}` 格式输出不合规 | 中（仅 research 路径） | 研究路径字段值被包装为默认值 | research 路径的 LLM prompt 不改（仍输出纯文本），归一化层负责转换 |

**回滚策略**：每个 Step 独立提交，前端 Step 6 回滚只需恢复 `renderProfileData` 旧代码，后端数据格式变更通过 `extractFieldValue` 兼容检测自动降级。
