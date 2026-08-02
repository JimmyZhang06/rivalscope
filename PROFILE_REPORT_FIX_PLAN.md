# 画像报告/洞察功能修复方案

> **版本**: v6.0.0 | **日期**: 2026-08-03 | **分支**: agent-v6
> 基于对完整数据流（DB → 素材收集 → LLM → 前端渲染）的分析，制定画像报告质量提升方案。部分修复已实施（素材关联匹配、画像任务启动恢复、DB 级审计保护）。

---

## 一、问题诊断总览

| 层级 | 核心问题 | 影响 |
|------|---------|------|
| 素材收集 | research_task 关联匹配错误 | 报告素材来自多竞品对比文本，非单一竞品画像 |
| 素材收集 | 画像概要仅 1 句话，来源碎片化 | 素材量不足以支撑 7 章节报告 |
| LLM 生成 | 报告 Prompt 要求超出素材覆盖范围 | 70% 内容为 LLM 通用知识填充 |
| LLM 生成 | 洞察评分无客观标准 | 同一画像多次生成得到不同分数 |
| 前端渲染 | 来源编号 [n] 无法追溯 | 引用标注形同虚设 |
| 数据流 | 画像生成时未记录关联 task | 报告生成时只能模糊搜索 |

---

## 二、修复原则

1. **素材驱动，不编造**：报告规模由素材丰富度决定，素材不足时降级为简报
2. **可追溯**：每条论断必须能追溯到具体来源 URL
3. **可复现**：相同输入必须产生相同输出（洞察评分需要确定性规则）
4. **分层降级**：素材 → 报告规模 → 洞察深度，逐级匹配

---

## 三、分阶段修复计划

### P0：修复数据正确性（阻断性问题）

#### 3.1 修复 research_task 关联匹配

**问题**：当前用 `ilike` 匹配竞品名，`product_name` 是用户自己的产品名，`competitors` 是逗号分隔列表，匹配结果不可靠。

**修复方案**：
- 画像生成时（`generate_profile`），将使用的 `task_id` 列表记录到 `CompetitorProfile.profile_data` 中
- 报告生成时，直接从 `profile_data.related_task_ids` 读取，不再模糊搜索

**改动文件**：`backend/app/services/profiles.py`、`backend/app/services/profile_report.py`

```python
# profiles.py — generate_profile 成功后追加
profile_data = json.loads(data_str)
profile_data["related_task_ids"] = [t.id for t in tasks]  # 记录关联 task
profile_data["related_source_ids"] = [s.id for s in sources]
```

```python
# profile_report.py — _load_research_report_data 改为直接读取
def _load_research_report_data(profile, org_id):
    profile_data = _parse_profile(profile)
    task_ids = profile_data.get("related_task_ids", [])
    if not task_ids:
        return None
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_ids[0])
        if task and task.report_data:
            return json.loads(task.report_data) if isinstance(task.report_data, str) else task.report_data
    return None
```

#### 3.2 画像概要提升信息量

**问题**：当前 summary 是"一句话总结"，信息量极低。

**修复方案**：
- 画像生成时，将 `summary` 从一句话扩展为结构化概要（3-5 条要点）
- 格式：`{"key_points": ["要点1", "要点2", ...], "data_quality": "high|medium|low"}`

**改动文件**：`backend/app/services/profiles.py`

```python
# 修改 LLM prompt 中的 summary 要求
'4. 输出 JSON：{"dimensions": {...}, "summary": {"key_points": ["要点1", ...], "data_quality": "high|medium|low"}}\n'
```

**对应修改**：`profile_report.py` 中 `_format_competitor_info` 和 `_format_materials` 适配新格式。

---

### P1：报告生成质量提升（核心功能）

#### 3.3 素材质量评估 + 动态报告规模

**问题**：无论素材多少，都生成 7 章节报告，导致大部分内容为 LLM 填充。

**修复方案**：
- 素材收集完成后，先评估素材质量（来源数、文本量、可信度分布）
- 根据质量分决定报告规模：

| 素材质量 | 来源数量 | 报告规模 |
|---------|---------|---------|
| 高 | ≥5 有效来源，文本 > 5000 字 | 完整 7 章节 |
| 中 | 2-4 有效来源，文本 1000-5000 字 | 4 章节（概况/产品/市场/来源） |
| 低 | <2 有效来源或文本 < 1000 字 | 简报模式：素材摘要 + 来源列表 |

**改动文件**：`backend/app/services/profile_report.py`

```python
def _assess_quality(materials: dict) -> dict:
    """评估素材质量，返回 {level, source_count, text_length}"""
    total_sources = sum(len(v) for v in materials.values())
    total_text = sum(
        len(item.get("text", "") or item.get("snippet", "") or "")
        for category in materials.values()
        for item in category
    )
    if total_sources >= 5 and total_text >= 5000:
        return {"level": "high", "source_count": total_sources, "text_length": total_text}
    elif total_sources >= 2 and total_text >= 1000:
        return {"level": "medium", "source_count": total_sources, "text_length": total_text}
    else:
        return {"level": "low", "source_count": total_sources, "text_length": total_text}
```

**动态 Prompt 生成**：

```python
def _build_report_prompt(quality: dict, materials_text: str) -> tuple[str, str]:
    if quality["level"] == "high":
        chapters = "## 一、公司概况\n## 二、产品线概览\n## 三、市场定位\n## 四、技术栈与架构\n## 五、竞争分析\n## 六、发展趋势\n## 七、信息来源"
    elif quality["level"] == "medium":
        chapters = "## 一、公司概况\n## 二、产品与核心功能\n## 三、市场定位\n## 四、信息来源"
    else:
        chapters = "## 素材摘要\n## 信息来源"

    system = f"...\n报告章节结构：\n{chapters}\n..."

    # 低质量时追加约束
    if quality["level"] == "low":
        system += "\n\n【重要】素材严重不足，仅能生成简报。每个章节必须严格基于素材，素材未覆盖的内容不得推断。"
```

#### 3.4 素材编号系统 + 来源可追溯

**问题**：Prompt 要求 LLM 标注 `[n]`，但编号按收集顺序排列，无法追溯。

**修复方案**：
- 素材收集时分配稳定编号，记录 `{n, url, title, tier, confidence}`
- LLM 输出后做后处理验证：提取所有 `[n]`，检查是否在编号范围内
- 前端渲染时，点击 `[n]` 展开来源详情（已由 `ReportView` 的 `CiteSup` 实现，但需要正确的 sources 数据）

**改动文件**：`backend/app/services/profile_report.py`、`frontend/src/pages/app/ProfileDetailPage.tsx`

```python
def _format_materials(materials: dict) -> tuple[str, list[dict]]:
    """返回 (素材文本, 来源索引列表)"""
    parts = []
    source_index = []  # [{n, url, title, tier, confidence}]
    counter = 0

    def _numbered(items, label):
        nonlocal counter
        if not items:
            return
        parts.append(f"--- {label} ---")
        for item in items:
            counter += 1
            text = item.get("text") or item.get("snippet") or item.get("raw_content", "")
            if not text:
                continue
            source = item.get("source", item.get("url", ""))
            parts.append(f"[{counter}] {source}")
            parts.append(text[:800])
            parts.append("")
            # 记录来源索引
            if item.get("url"):
                source_index.append({
                    "n": counter,
                    "url": item["url"],
                    "title": item.get("title", ""),
                    "tier": item.get("tier", "other"),
                    "confidence": item.get("confidence", 0.0),
                })

    ...
    return "\n".join(parts), source_index
```

**API 响应中包含来源索引**：

```python
# profiles.py — 端点返回
return {
    "report_markdown": report_markdown,
    "source_index": source_index,  # 新增
}
```

**前端将 `source_index` 传给 `ReportView`**：

```typescript
// ProfileDetailPage.tsx
<ReportView
  markdown={reportMarkdown}
  sources={sourceIndex.map(s => ({...s, id: s.n, snippet: ''}))}
  onCite={(n) => { /* 展开来源详情 */ }}
/>
```

---

### P2：洞察数据质量提升

#### 3.5 洞察评分改为相对对比 + 确定性规则

**问题**：绝对评分（1-10）无客观标准，重复调用结果不一致。

**修复方案**：
- 评分改为**相对等级**（强/中/弱），而非绝对分数
- 等级基于**素材中的明确证据数量**：
  - 强（score=8-10）：3+ 条明确正面证据，无负面证据
  - 中（score=5-7）：有正面证据但有限，或有争议
  - 弱（score=1-4）：负面证据多，或信息严重不足

```python
INSIGHTS_SYSTEM = (
    _date_header()
    + "你是一名竞争情报分析师。基于给出的画像维度数据，生成结构化分析洞察。\n\n"
    "评分规则（严格按证据数量定级）：\n"
    "- 强（8-10分）：3条以上明确正面证据，无负面证据\n"
    "- 中（5-7分）：有正面证据但有限，或存在争议\n"
    "- 弱（1-4分）：负面证据多，或信息严重不足\n"
    "- 信息完全缺失的维度给 0 分并标注「无数据」\n\n"
    "输出 JSON：\n"
    '{"scores": {"维度名": 1-10评分, ...},\n'
    ' "verdict": "总体结论",\n'
    ' "positioning": "市场定位",\n'
    ' "swot": {...},\n'
    ' "timeline": [...]}'
)
```

#### 3.6 洞察数据持久化

**问题**：洞察数据每次请求实时生成，消耗 LLM 成本且结果不稳定。

**修复方案**：
- 洞察生成后，存储到 `CompetitorProfile.profile_data.insights`
- 前端首次加载后缓存到 localStorage（已有 useProfileStore 的 persist）
- 画像重新生成时清除缓存

```python
# profile_report.py — generate_profile_insights 成功后
profile_data = _parse_profile(profile)
profile_data["insights"] = insights
profile_data["insights_generated_at"] = utcnow().isoformat()

with SessionLocal() as db:
    p = db.get(CompetitorProfile, profile_id)
    p.profile_data = json.dumps(profile_data, ensure_ascii=False)
    db.commit()
```

---

### P3：前端体验优化

#### 3.7 报告 Tab 增加素材质量提示

**问题**：用户不知道报告的可信度。

**修复方案**：
- 报告顶部显示素材质量徽章（高/中/低）
- 低质量时显示提示："素材不足，建议先完善调研或爬取官网页面"

```typescript
// ProfileDetailPage.tsx — renderReportTab
{reportQuality && (
  <div className="mb-4 flex items-center gap-2">
    <span className={`rounded-full px-2 py-0.5 text-xs ${
      reportQuality.level === 'high' ? 'bg-green-100 text-green-700' :
      reportQuality.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
      'bg-red-100 text-red-700'
    }`}>
      素材质量：{reportQuality.level === 'high' ? '充足' : reportQuality.level === 'medium' ? '一般' : '不足'}
    </span>
    <span className="text-xs text-gray-400">{reportQuality.source_count} 个来源 · {reportQuality.text_length} 字</span>
  </div>
)}
```

#### 3.8 洞察 Tab 增加评分置信度

**问题**：用户不知道评分是否可靠。

**修复方案**：
- 每个维度评分旁显示置信度标记
- 低置信度分数灰显或标注"参考"

```typescript
// ScoreBars.tsx — 每个分数条增加置信度标记
const confidence = insights.confidence_scores?.[dim] || 'medium'
const opacity = confidence === 'low' ? 'opacity-50' : ''
```

---

## 四、实施优先级与工作量

| 阶段 | 内容 | 文件 | 预估行数 | 优先级 |
|------|------|------|---------|--------|
| P0.1 | 修复 task 关联匹配 | profile_report.py, profiles.py | ~50 | 必须 |
| P0.2 | 画像概要扩展为要点格式 | profiles.py, profile_report.py | ~30 | 必须 |
| P1.1 | 素材质量评估 + 动态报告规模 | profile_report.py | ~120 | 高 |
| P1.2 | 素材编号系统 + 来源可追溯 | profile_report.py, ProfileDetailPage.tsx | ~80 | 高 |
| P2.1 | 洞察评分改为确定性规则 | profile_report.py | ~40 | 中 |
| P2.2 | 洞察数据持久化 | profile_report.py | ~30 | 中 |
| P3.1 | 素材质量提示 UI | ProfileDetailPage.tsx | ~30 | 低 |
| P3.2 | 评分置信度 UI | ScoreBars.tsx, ProfileDetailPage.tsx | ~20 | 低 |

**P0 预计 2 天，P1 预计 3 天，P2/P3 预计 2 天**。建议先交付 P0，验证数据正确性后再迭代 P1-P3。

---

## 五、后端改动详细设计

### 5.1 `backend/app/services/profiles.py`

**位置**：`generate_profile` 函数，写入 `CompetitorProfile` 之前

**改动**：在 `profile_data` 中追加 `related_task_ids` 和 `related_source_ids`

```python
profile_data = json.loads(data, ensure_ascii=False)
profile_data["related_task_ids"] = [t.id for t in tasks]  # 新增
profile_data["related_source_ids"] = [s.id for s in sources[:10]]  # 新增
# 同时修改 summary 格式
if "summary" in profile_data and isinstance(profile_data["summary"], str):
    profile_data["summary"] = {
        "key_points": [profile_data["summary"]],
        "data_quality": "medium",
    }
```

### 5.2 `backend/app/services/profile_report.py`

**改动概览**：

| 函数 | 改动 |
|------|------|
| `generate_profile_report` | 调用 `_assess_quality` → 动态 Prompt → 返回 `source_index` |
| `generate_profile_insights` | 确定性评分规则 + 持久化到 profile_data |
| `_load_research_report_data` | 从 `profile_data.related_task_ids` 读取，不再模糊搜索 |
| `_collect_materials` | 返回 `(materials, source_index)` 元组 |
| `_format_materials` | 返回 `(text, source_index)` 元组，编号系统 |
| `_assess_quality` | 新增：素材质量评估 |
| `_build_report_prompt` | 新增：根据质量动态生成 Prompt |

### 5.3 `backend/app/api/profiles.py`

**改动**：
- `GET /{pid}/report` 返回 `{report_markdown, source_index, quality}`
- `GET /{pid}/insights` 返回 `ProfileInsightsOut` + 持久化

---

## 六、前端改动详细设计

### 6.1 `ProfileDetailPage.tsx`

| 改动点 | 内容 |
|--------|------|
| 状态 | 新增 `sourceIndex`, `reportQuality` |
| 懒加载 | 同时获取 `source_index` 和 `quality` |
| Report Tab | 传入 `sourceIndex` 给 `ReportView`，显示质量徽章 |
| Insights Tab | 评分旁显示置信度 |

### 6.2 `ScoreBars.tsx`

| 改动点 | 内容 |
|--------|------|
| Props | 新增 `confidenceScores?: Record<string, string>` |
| 渲染 | 低置信度分数添加 `opacity-50` 和虚线边框 |

---

## 七、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 修改 summary 格式导致现有画像解析失败 | 旧画像显示异常 | `_parse_profile` 兼容旧格式（字符串 → 自动包装为 key_points） |
| 素材质量评估误判 | 报告规模不匹配 | 保守策略：不确定时降级不升级 |
| LLM 不遵守确定性评分规则 | 评分仍不一致 | Prompt 中增加硬约束 + 后处理 clamp 到规则定义的区间 |
| 洞察持久化增加写入频率 | DB 压力 | 仅在首次生成时写入，后续读取缓存 |

---

## 八、验收标准

### P0 验收

- [ ] 画像报告生成的素材来源正确（来自关联 research_task 或 competitor_pages，而非模糊搜索）
- [ ] 画像概要显示为要点列表而非单句话
- [ ] 无 `AttributeError` 等运行时错误

### P1 验收

- [ ] 素材不足时报告自动降级为简报（不超过 3 章节）
- [ ] 报告中 `[n]` 标注可点击并显示对应来源 URL
- [ ] 来源编号范围与 `source_index` 一致

### P2 验收

- [ ] 同一画像连续生成 3 次洞察，评分结果一致（±0 浮动）
- [ ] 洞察数据在画像重新生成前保持一致

### P3 验收

- [ ] 素材质量徽章正确反映实际素材数量
- [ ] 低置信度评分在 UI 中有明确标识

---

## 九、不在此次修复范围

1. **时序追踪**：需要多期画像数据，当前单期画像不支持
2. **追问功能**：参考 TaskDetailPage 的 AI 问答，属于独立功能
3. **图谱嵌入**：需要前端图谱组件配合，属于可视化增强
4. **素材持久化**：需要新增 DB 字段，属于中期架构改进
