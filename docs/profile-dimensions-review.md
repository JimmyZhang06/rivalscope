# 维度改造方案 — 技术评审报告

> **日期**：2026-08-03 | **评审范围**：`docs/profile-dimensions-redesign.md` 全部 4 个改动点
> **结论**：方案方向正确，有 3 个中高优先级问题必须在实施前修复

---

## 一、总体结论

方案在视觉升级和前端 label 映射上的设计是合理的。但**后端数据管道存在三套并行的维度格式**，方案只改了其中一套（crawl 路径），导致新画像和旧画像之间、不同生成路径之间产生格式分裂。这是评审中最大的风险。

---

## 二、发现的问题

### CRITICAL-1：三套生成路径的字段值格式不一致，方案只改了其中一套

| 生成路径 | 入口 | 字段值格式 | 方案是否覆盖 |
|---------|------|-----------|-------------|
| **research** | `profiles.py:63-64` | 纯文本字符串（LLM prompt 要求） | ❌ 未改动 |
| **crawl** | `profile_extractor.py:191-227` | `{value, confidence, source_url}` → Stage 3 丢弃为纯文本 | ⚠️ 方案改了 Stage 3 |
| **product_intel** | `product_intel.py:554-591` | 混合嵌套对象（`product_catalog` 含 `product_lines`/`latest_releases`，`pricing` 含 `price_list`） | ❌ 未改动 |

**证据**：

- `profiles.py:63` — research 路径的 LLM prompt 明确要求 `"field_key": "文本字符串"`
- `product_intel.py:389-394` — product_intel 的 LLM prompt 输出 `product_catalog`、`latest_releases` 等嵌套结构
- `product_intel.py:567-589` — `_merge_results` 将这些嵌套对象直接写入 `dimensions`，完全不经过 `{v, c, s}` 格式
- `product_intel.py:588-589` — 缺失维度写入 `{"_info": "信息不足"}`，与 crawl 路径的 `"信息不足"` 字符串也不一致

**后果**：
- 用户用 research 路径生成的画像：字段值仍是纯文本，前端新 UI 的置信度标记永远不会出现
- 用户用 product_intel 路径生成的画像：字段值是 `product_lines` 数组或 `price_list` 数组，前端 `renderFieldValue` 需要处理完全不同的结构
- 三种格式共存时，前端代码需要三套判断逻辑，复杂度反而增加

**建议修复**：
方案应增加一个**格式归一化层**，在所有路径写入 `profile_data` 之前统一格式。推荐在 `generate_profile`（`profiles.py`）返回前、`generate_profile_from_crawl_data`（`profile_extractor.py`）落库前、以及 `product_intel` 的 `_merge_results` 之后，各加一个 `_normalize_dimensions` 函数：

```python
def _normalize_dimensions(raw_dimensions: dict) -> dict:
    """将所有路径的维度数据归一化为 {field_key: {v, c, s}} 格式"""
    normalized = {}
    for dim_key, fields in raw_dimensions.items():
        if not isinstance(fields, dict):
            normalized[dim_key] = fields
            continue
        normalized[dim_key] = {}
        for fk, fv in fields.items():
            if isinstance(fv, str):
                normalized[dim_key][fk] = {"v": fv, "c": "medium", "s": ""}
            elif isinstance(fv, dict):
                if "v" in fv:
                    normalized[dim_key][fk] = fv  # 已是 {v, c, s}
                elif "_info" in fv:
                    normalized[dim_key][fk] = {"v": "信息不足", "c": "low", "s": ""}
                else:
                    # product_intel 的嵌套对象（product_catalog 等）保留原结构
                    # 这些是设计为结构化展示的维度，不归一化
                    normalized[dim_key][fk] = fv
    return normalized
```

---

### CRITICAL-2：`_stage3_aggregate` 的 summary 统计逻辑随格式变化而断裂

**当前代码**（`profile_extractor.py:219`）：

```python
filled = sum(1 for d in dimensions.values() for v in d.values() if v != "信息不足")
```

**改动后**，字段值从 `"信息不足"`（字符串）变为 `{"v": "信息不足", "c": "low", "s": ""}`（对象）。上述比较会永远为 `True`（对象 ≠ 字符串），导致 `filled` 总是等于 `total_fields`，summary 变成：

```
已完成 XXX 的画像提取，共 5/5 个字段有值，其中 0 个字段置信度较高。
```

即使实际上所有字段都是「信息不足」。

**同文件第 207 行也受影响**：

```python
val = fd.get("value", "信息不足")
# 改动后 fd 变成 {v, c, s}，fd.get("value") 返回 None
```

以及第 213 行：

```python
if val.startswith("存在差异"):  # 对象没有 .startswith 方法 → AttributeError
```

**建议修复**：Stage 3 聚合逻辑需要适配新格式：

```python
def _stage3_aggregate(dim_results, competitor_name):
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

    filled = sum(
        1 for d in dimensions.values()
        for v in d.values()
        if isinstance(v, dict) and v.get("v", "") not in ("", "信息不足")
    )
    # ... summary 不变
```

---

### HIGH-1：洞察评分 key 无法可靠匹配维度 label

**方案设计**：在 `insights` 对象中追加 `dimension_labels` 映射，前端用它做 `scores[dimLabel]` 查找。

**问题**：LLM 返回的 `scores` 的 key 是什么，取决于 prompt 中传给 LLM 的维度名。方案修改了 prompt（`profile_report.py:139-143`）用中文 label，但 LLM 是概率模型，不保证严格遵循：

| 情况 | LLM 返回的 scores key | 前端能否匹配 |
|------|---------------------|-------------|
| 理想 | `{"产品概况": 8, "市场定位": 6}` | ✅ 直接用 dimLabelMap |
| 实际常见 | `{"产品概况": 8, "market_position": 6}` | ⚠️ 部分匹配失败 |
| 极端 | `{"维度1": 8, "维度2": 6}` | ❌ 全部匹配失败 |

当前洞察 prompt（`profile_report.py:145-172`）中没有任何指令要求 LLM 严格使用 prompt 中给定的维度名作为 JSON key。LLM 倾向于使用输入数据中的 key（`dimensions.items()` 的原始 key，即英文 key）。

**建议修复**：
1. 在 LLM prompt 中明确指令：

```
评分 JSON 的 key 必须严格使用以下中文维度名：产品概况、企业信息、市场定位、技术分析、风险与机会
```

2. 前端做双向查找（方案草稿提到了 fallback，但实现不完整）：

```typescript
const getScore = (dimKey: string, dimLabel: string, scores: Record<string, number>) => {
  return scores[dimLabel] ?? scores[dimKey] ?? null
}
```

3. 持久化时记录映射关系（方案已包含，但位置不对）：

```python
insights["dimension_labels"] = dim_label_map  # 写入 insights_json
```

同时，`dim_label_map` 应该从 template 读取（方案做法正确），但需要处理 template 为 `None` 的情况（当前代码 `profile_report.py:124` 已有 `template = _load_template(...)` 可能返回 `None`）。

---

### HIGH-2：`template` 状态在详情页不可靠，前端 label 映射可能为空

**当前前端加载逻辑**（`ProfileDetailPage.tsx:136-145`）：

```typescript
const p = await getProfile(id)
setProfile(p)

let allCompetitors: Competitor[] = []
try { allCompetitors = await listCompetitors() } catch { /* 非致命 */ }
let allTemplates: ProfileTemplate[] = []
try { allTemplates = await listProfileTemplates() } catch { /* 非致命 */ }

const c = allCompetitors.find((x) => x.id === p.competitor_id)
if (c) setCompetitor(c)
const t = allTemplates.find((x) => x.id === p.template_id)
if (t) setTemplate(t)
```

`listProfileTemplates()` 是 `try/catch` 非致命的，如果该 API 失败，`template` 就是 `null`。方案中的 `dimLabelMap[dim.key] = dim.label` 依赖 `template` 状态。

**建议修复**：
- 在 `renderProfileData()` 中加 fallback：如果 `template` 不可用，直接从 `profile_data` 中已有的 label 映射读取（需要在后端生成画像时写入 `profile_data.dimension_labels`）
- 或者将 label 映射直接存在 profile 生成时的 `profile_data` 中（`profiles.py` / `profile_extractor.py` 写入时附上）

```python
# 后端写入 profile_data 时附带维度 label 映射
template = db.get(ProfileTemplate, template_id)
dim_label_map = {d["key"]: d["label"] for d in json.loads(template.dimensions)}
profile_data["dimension_labels"] = dim_label_map
```

这样前端无需依赖 `template` 状态即可完成中文渲染。

---

### MEDIUM-1：`product_intel` 路径不经过 `_stage3_aggregate`，新格式不会生效

`product_intel.py` 的 `_merge_results` 直接写入 `dimensions`，不经过 `_stage3_aggregate`。方案只改了 `_stage3_aggregate`，所以 product_intel 路径的字段值仍然是混合格式（嵌套对象或 `{"_info": "..."}`）。

**建议**：product_intel 路径在 `_merge_results` 后调用 `_normalize_dimensions`（见 CRITICAL-1 的建议）。

---

### MEDIUM-2：`_fallback_insights` 的 scores key 是 dim_key（英文），与主路径不一致

`profile_report.py:687-711` — `_fallback_insights` 函数用 `dimensions.items()` 的 key（即 `dim_key`，英文）作为 scores key：

```python
for dim_key, fields in dimensions.items():
    scores[dim_key] = ...  # 英文 key
```

而主路径的 LLM 生成（改动 2 之后）会用中文 label 作为 key。两条路径的 scores key 不一致会导致前端匹配失败。

**建议**：`_fallback_insights` 也需要接收 `dim_label_map` 参数：

```python
def _fallback_insights(dimensions, competitor_name, dim_label_map=None):
    scores = {}
    for dim_key, fields in dimensions.items():
        label = (dim_label_map or {}).get(dim_key, dim_key)
        # ... 计算 score
        scores[label] = score  # 用中文 label
```

---

### MEDIUM-3：方案未处理 `_fallback_report` 的引用编号清理

前端 `stripRefs` 函数（`ProfileDetailPage.tsx:330`）会去掉 `[n]` 引用编号。改造后字段值从纯文本改为 `{v, c, s}` 对象，`stripRefs` 只在 `renderFieldValue` 的字符串分支调用。但 `_fallback_report` 输出的报告文本中包含 `[n]` 编号，如果这些编号在维度卡片中显示，需要确保被清理。

当前代码中，维度卡片不展示 `report_markdown` 内容，所以这不直接影响维度 Tab。但如果在洞察或其他地方复用渲染逻辑，需要注意。

**建议**：无代码改动需要，记录为注意事项即可。

---

### LOW-1：洞察持久化到两处，`dimension_labels` 也应同步

当前洞察数据写入两处：
1. `profile_data.insights`（JSON 字段内）
2. `profile.insights_json`（独立列）

`_persist_insights`（`profile_report.py:604-614`）只写 `profile_data`，而 `_run_profile_generation_task`（`profile_extractor.py:539-553`）在任务完成后同步写两处。

方案在 `generate_profile_insights` 中追加 `dimension_labels`，但这个追加只存在于内存中的 `insights` 对象。持久化时：
- 走 `_persist_insights` → 只写 `profile_data` ✅
- 走 `_run_profile_generation_task` → 写 `insights_json`，但 `insights_json` 来自 `generate_profile_insights` 的返回值，包含 `dimension_labels` ✅

两处路径都正确，**但需确认**：`_run_profile_generation_task` 在 `profile_extractor.py:533` 调用 `generate_profile_insights` 时，该函数返回的 insights 已包含 `dimension_labels`（改动 2 实现后）。**这个依赖关系在方案中未显式说明。**

---

## 三、代码中已发现但方案未提及的相关问题

### R-1：product_intel 路径可能产生 `_info` 键的维度

`product_intel.py:588-589`：
```python
if key and key not in merged["dimensions"]:
    merged["dimensions"][key] = {"_info": "信息不足"}
```

这会创建 `{ "_info": "信息不足" }` 的维度值。前端的 `renderFieldValue` 当前处理逻辑中，对象会遍历 `Object.entries` 并过滤空值。`{ "_info": "信息不足" }` 会渲染为一个 `_info: 信息不足` 的字段——对用户无意义。

**建议**：在 `_merge_results` 或归一化层中将 `{"_info": "信息不足"}` 转为 `{"v": "信息不足", "c": "low", "s": ""}`。

### R-2：研究路径的 dimension key 可能是中文也可能是英文

`profiles.py:63` 的 prompt 只要求输出 JSON 格式，没有指定维度 key 应该用模板的 key 还是 label。LLM 可能输出 `{"产品概况": {...}}` 也可能输出 `{"product_overview": {...}}`。这会导致前端用 `dimLabelMap[dimKey]` 查找时，如果 dimKey 本身已经是中文 label，查找失败。

**建议**：研究路径也需要在写入 `profile_data` 时附上 `dimension_labels` 映射，前端用 `dimension_labels` 做 key 归一化。

---

## 四、评审总结

| 编号 | 级别 | 问题 | 必须修复？ |
|------|------|------|----------|
| CRITICAL-1 | 🔴 | 三套路径格式不一致，方案只改了一套 | **必须** |
| CRITICAL-2 | 🔴 | `_stage3_aggregate` summary 统计逻辑断裂 | **必须** |
| HIGH-1 | 🟠 | LLM scores key 不保证使用中文 label | **必须** |
| HIGH-2 | 🟠 | `template` 状态不可靠，label 映射可能为空 | **必须** |
| MEDIUM-1 | 🟡 | product_intel 不经过 Stage 3，新格式不生效 | 必须 |
| MEDIUM-2 | 🟡 | `_fallback_insights` scores key 用英文 | 必须 |
| MEDIUM-3 | 🟡 | 两处持久化路径的依赖关系未说明 | 建议 |
| LOW-1 | 🟢 | 需确认两处持久化都包含 `dimension_labels` | 建议 |
| R-1 | 🟡 | product_intel 的 `_info` 字段对用户无意义 | 建议 |
| R-2 | 🟡 | 研究路径的维度 key 可能已是中文 | 建议 |

**5 个必须修复**（2 Critical + 3 Medium + 2 High = 但 HIGH 全部必须）。在修复之前，方案不应实施。

**建议的修订顺序**：
1. 先添加 `_normalize_dimensions` 统一函数（解决 CRITICAL-1 + MEDIUM-1）
2. 修复 `_stage3_aggregate` 统计逻辑（解决 CRITICAL-2）
3. 在洞察 prompt 中加中文 label 指令（解决 HIGH-1 的部分）
4. 后端写入 `dimension_labels` 到 `profile_data`（解决 HIGH-2 + R-2）
5. 修复 `_fallback_insights` 用中文 key（解决 MEDIUM-2）
6. 再实施前端 UI 改造（原方案 Step 3）
