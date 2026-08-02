# 竞品画像系统 — 架构评审与解决方案

> **版本**：v5.0.0 · 分析日期：2026-08-02
> **说明**：本文件为架构评审建议文档，基于 v5.0.0 代码审查更新（无 Schema 变更）。

> **核心结论**（v5.0.0 更新）：画像管线的范式问题仍建议重构为「搜索优先、爬虫补充」，但爬虫模块的致命 bug 已在 v5.0.0 中修复（语言感知 sitemap、consent overlay 剥离、XML 命名空间匹配、Chrome UA）。

---

## 一、现状评审：为什么当前方案不可行

### 1.1 研究模块 vs 画像模块 — 根本差异

| 维度 | 研究模块（agent.py） | 画像模块（profile_extractor.py） |
|------|---------------------|--------------------------------|
| **数据来源** | Tavily 搜索引擎（标准化 API） | 直接爬取竞品官网（每个网站都不一样） |
| **反爬对抗** | 无（Tavily 处理） | 每个网站 Cloudflare/SPA/反爬策略各异 |
| **内容格式** | 统一：title + snippet + raw_content | 异构：每个网站 HTML 结构完全不同 |
| **LLM 调用次数** | 5 次（plan → analyze → insights → report → timeline） | 55+ 次（每页摘要 + 每维度提取） |
| **信息可信度** | 多来源交叉验证 + 来源分级 + 引用编号 [n] | 单来源（仅官网），无交叉验证 |
| **交付物** | Markdown 报告 + 结构化洞察 + 来源列表 | JSON 字段填充，用户难以验证 |
| **失败处理** | 单条搜索失败不影响整体 | 任一页面 LLM 调用失败影响该维度 |

**研究模块之所以可交付、可信，核心原因是：它依赖搜索引擎获取多来源信息，LLM 做的是「综合分析」，而非「从单一源头硬提取」。**

### 1.2 当前画像管线的致命问题

```
┌─────────────────────────────────────────────────────────────────┐
│  当前架构：爬虫 → Stage1(N次LLM) → Stage2(M次LLM) → Stage3     │
│                                                                 │
│  问题 1：爬虫不可靠                                             │
│    - 每个竞品官网结构不同（SPA/静态/混合）                        │
│    - 反爬措施各异（Cloudflare/验证码/IP封禁）                    │
│    - URL 结构各异（/cn/ 前缀、/products/xxx 路由等）             │
│    - DJI 实测：0% 可用（sitemap 命名空间 bug + 404 + SPA）       │
│                                                                 │
│  问题 2：LLM 调用量爆炸                                         │
│    - 50 页 × 1 (Stage1) + 8 维度 × 1 (Stage2) = 58 次          │
│    - 每次调用都是「盲搜」——不知道页面里有没有想要的信息            │
│    - 成本高、耗时久、容易超时                                    │
│                                                                 │
│  问题 3：单来源无交叉验证                                       │
│    - 只爬官网 → 只有一方说法 → 无法判断可信度                     │
│    - 用户无法验证画像结论的来源                                  │
│    - 与「调研」模块的交付标准不一致                               │
│                                                                 │
│  问题 4：竞品间不可比                                           │
│    - 竞品 A 的官网写了产品信息                                  │
│    - 竞品 B 的官网没写（或写了不同的结构）                        │
│    - 提取出来的字段无法横向对比                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 成本分析

| 方案 | LLM 调用 | 单次成本（DeepSeek） | 单次耗时 | 成功率 |
|------|---------|---------------------|---------|--------|
| 当前画像（爬虫+3阶段） | 55-60 次 | ¥0.3-0.5 | 2-3 分钟 | <20%（实测） |
| 研究模块（搜索+5阶段） | 5 次 | ¥0.05-0.08 | 30-60 秒 | >95% |
| **搜索优先画像（推荐）** | **4 次** | **¥0.04-0.06** | **20-40 秒** | **>90%** |

---

## 二、解决方案：搜索优先的画像生成架构

### 2.1 核心理念

> **画像 ≠ 爬虫提取。画像 = 搜索收集 + LLM 综合分析 + 结构化输出 + 来源可追溯。**

对齐研究模块的成功范式，将画像生成从「被动爬取」改为「主动搜索」：

```
┌──────────────────────────────────────────────────────────────────┐
│                    新架构：搜索优先画像管线                         │
│                                                                  │
│  输入：竞品名称 + 冻结模板（维度定义）                              │
│                                                                  │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐  │
│  │ 步骤 1  │───▶│  步骤 2  │───▶│  步骤 3  │───▶│   步骤 4   │  │
│  │ 搜索规划 │    │ 联网检索  │    │ 画像提取  │    │ 结果校验   │  │
│  │ (1次LLM)│    │ (Tavily) │    │ (1次LLM) │    │ (本地规则) │  │
│  └─────────┘    └──────────┘    └──────────┘    └───────────┘  │
│       │               │               │               │          │
│       ▼               ▼               ▼               ▼          │
│  生成 5-8 条搜索    获取 30-40 条    按模板维度提取      字段级     │
│  关键词（覆盖产品、   搜索结果（多来源   结构化数据（JSON）  置信度评估、│
│  功能、定价、市场等）  交叉验证）        + 来源引用 [n]    冲突检测   │
│                                                                  │
│  总计：2 次 LLM 调用 +  Tavily 搜索                               │
│  成本：~¥0.04-0.06    耗时：20-40 秒    成功率：>90%              │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 四步流程详解

#### 步骤 1：搜索规划（1 次 LLM 调用，temperature=0.3）

**输入：** 竞品名称、别名、官网、技术领域 + 模板维度定义

**LLM Prompt：**
```
你是一名竞争情报分析师。请为以下竞品规划搜索策略。

竞品：{competitor_name}
别名：{alias}
官网：{website}
技术领域：{tech_focus}

需要提取的维度：
{dimensions_template}

请生成 6-10 条搜索查询，每条包含：
- dimension：对应的维度 key
- query：具体搜索关键词（中英文均可，要适合搜索引擎）
- focus：搜索重点（optional）

要求：
1. 覆盖产品名称/型号、功能特性、定价信息、目标市场、用户评价、最新动态
2. 包含官网域名 + 产品型号的组合搜索
3. 包含评测/对比类搜索
4. 时效性内容要带上年份或"最新"

输出 JSON：
{"queries": [{"dimension": "dim_key", "query": "搜索词", "focus": "重点"}]}
```

**输出：** 5-10 条维度化的搜索查询

#### 步骤 2：联网检索（Tavily API，并行执行）

```python
results = await asyncio.gather(*[
    searcher.search(q["query"], max_results=5, time_range="year")
    for q in queries
])

# 去重、分级、评分（复用研究模块的完整逻辑）
results = dedup_by_content(results)
for r in results:
    r["domain"], r["tier"] = classify_source(r["url"], [competitor_name], competitor_name)
    r["confidence"] = estimate_confidence(r)
```

**输出：** 20-40 条去重后的搜索结果，含来源分级和置信度

#### 步骤 3：画像提取（1 次 LLM 调用，temperature=0.3）

**输入：** 搜索结果（按维度分组，含来源类型、置信度）+ 模板维度定义

**LLM Prompt：**
```
你是一名竞争情报分析师。请基于以下网络检索材料，为竞品生成结构化画像。

【竞品】{competitor_name}
【别名】{alias}
【官网】{website}

【画像模板维度】
{formatted_dimensions}

【检索材料】（共 {n} 条，已按维度分组，含来源可信度）
{dimension_grouped_materials}

【输出要求】
1. 每个维度只输出模板中定义的字段
2. 信息来源不足的字段填 "信息不足"
3. 每个字段标注：
   - value：提取的值
   - confidence：high/medium/low（基于来源质量和一致性）
   - source_urls：[具体来源 URL]
4. 多来源冲突时标注 "存在差异：A来源说X，B来源说Y"
5. 不能编造信息，不确定的内容明确标注
6. 生成一段 100 字以内的画像摘要

输出 JSON：
{
  "dimensions": {
    "dim_key": {
      "field_key": {"value": "...", "confidence": "high", "source_urls": ["..."]}
    }
  },
  "summary": "...",
  "overall_confidence": "high|medium|low",
  "info_gaps": ["哪些重要信息缺失"]
}
```

**输出：** 结构化画像 JSON + 来源引用 + 信息缺口说明

#### 步骤 4：结果校验（本地规则，无 LLM 调用）

```python
def validate_profile(profile_data, search_results):
    """字段级校验"""
    checks = []
    
    # 1. 关键字段不能全为"信息不足"
    critical_fields = ["产品名称", "核心功能", "定位"]
    for field in critical_fields:
        filled = count_filled_fields(profile_data, field)
        checks.append({
            "field": field,
            "filled": filled > 0,
            "confidence": get_avg_confidence(profile_data, field),
        })
    
    # 2. 来源多样性检查
    unique_domains = len(set(r["domain"] for r in search_results))
    checks.append({
        "check": "source_diversity",
        "passed": unique_domains >= 3,
        "value": f"{unique_domains} 个独立来源",
    })
    
    # 3. 信息密度检查
    total_fields = count_total_fields(profile_data)
    filled_fields = count_filled_fields(profile_data)
    fill_rate = filled_fields / total_fields
    checks.append({
        "check": "fill_rate",
        "passed": fill_rate >= 0.5,
        "value": f"{fill_rate:.0%}",
    })
    
    return {
        "passed": all(c.get("passed", True) for c in checks),
        "checks": checks,
        "warnings": [c for c in checks if not c.get("passed", True)],
    }
```

### 2.3 可选增强：爬虫作为补充源

搜索方案已经能覆盖 90% 场景。对于需要「官网精确信息」的情况（如定价页的具体价格），可以：

1. **目标化抓取**：不是全站爬取，而是根据搜索结果中发现的 URL，定向抓取 3-5 个高价值页面
2. **作为 LLM 的额外上下文**：将定向抓取的内容合并到步骤 3 的 prompt 中
3. **标注来源类型**：在画像中区分「搜索来源」和「官网来源」

```python
# 定向抓取（非全站）
target_urls = [
    r["url"] for r in search_results
    if "official" in r["tier"] and is_high_value_page(r["url"])
][:5]

crawled_pages = await fetch_pages(target_urls)
# 合并到 LLM 输入
```

---

## 三、实施计划

### Phase 1：核心重构（1-2 天）

**文件：`backend/app/services/profile_extractor.py`**

1. 新增 `generate_profile_from_search()` — 搜索优先的主流程
2. 保留 `extract_profile_from_pages()` — 作为 fallback（已存在的爬虫路径）
3. 修改 `profiles.py::generate_profile()` — 默认走搜索路径

```
generate_profile()
  ├── 优先：generate_profile_from_search()  ← 新增，2次LLM
  │     ├── _plan_search()          1次 LLM
  │     ├── Tavily 搜索（并行）
  │     ├── 去重 + 分级 + 评分（复用 dedup.py）
  │     ├── _extract_from_search()  1次 LLM
  │     └── _validate_profile()     本地规则
  │
  └── 回退：extract_profile_from_pages()  ← 保留，55+次LLM
```

### Phase 2：前端适配（半天）

**文件：** `frontend/src/pages/app/ProfilesPage.tsx`、`ProfileDetailPage.tsx`

1. 在画像详情页显示来源列表（来源类型 + 置信度 + URL）
2. 显示信息缺口警告（"以下字段信息不足：..."）
3. 显示画像置信度评分

### Phase 3：模板维度增强（1 天）

**文件：** `backend/app/db/models.py`、`backend/app/schemas/profiles.py`

1. 在 `ProfileTemplate` 中增加 `search_priority` 字段（标记哪些维度优先搜索）
2. 增加 `source_min_count` 字段（每个维度最少需要多少个独立来源）
3. 增加 `confidence_threshold` 字段（字段置信度低于此值时标记为"存疑"）

### Phase 4：画像质量看板（1 天）

新增功能：画像质量评分

```python
def profile_quality_score(profile: CompetitorProfile) -> dict:
    """画像质量评分（0-100）"""
    data = json.loads(profile.profile_data)
    source_refs = json.loads(profile.source_refs)
    
    # 1. 字段覆盖率 (30分)
    total_fields = count_all_fields(data["dimensions"])
    filled_fields = count_filled_fields(data["dimensions"])
    coverage_score = min(30, (filled_fields / total_fields) * 30)
    
    # 2. 来源多样性 (25分)
    unique_domains = len(set(r["url"].split("/")[2] for r in source_refs))
    diversity_score = min(25, unique_domains * 5)
    
    # 3. 平均置信度 (25分)
    confidences = [f["confidence"] for dim in data["dimensions"].values() for f in dim.values()]
    avg_conf = sum(confidences) / len(confidences) if confidences else 0
    conf_score = avg_conf * 25
    
    # 4. 信息缺口 (20分)
    gaps = len(data.get("info_gaps", []))
    gap_score = max(0, 20 - gaps * 5)
    
    return {
        "total": round(coverage_score + diversity_score + conf_score + gap_score),
        "breakdown": {
            "coverage": round(coverage_score),
            "diversity": round(diversity_score),
            "confidence": round(conf_score),
            "completeness": round(gap_score),
        },
    }
```

---

## 四、与传统爬虫方案的对比

| 维度 | 传统爬虫方案（修复版） | 搜索优先方案（推荐） |
|------|---------------------|-------------------|
| **成功率** | 30-50%（取决于网站反爬） | >90%（Tavily 统一处理） |
| **LLM 成本** | ¥0.3-0.5（55次调用） | ¥0.04-0.06（2次调用） |
| **耗时** | 2-3 分钟 | 20-40 秒 |
| **信息可信度** | 单来源（官网），不可验证 | 多来源交叉，可追溯 |
| **竞品可比性** | 差（各官网信息结构不同） | 好（统一搜索维度） |
| **跨站点一致性** | 差 | 好 |
| **可交付性** | 低（用户无法验证来源） | 高（类似研究模块报告） |
| **官网精确信息** | 好（直接抓取） | 中（依赖搜索引擎收录） |
| **维护成本** | 高（每个网站适配） | 低（通用搜索引擎接口） |
| **信息时效性** | 取决于上次爬取 | 搜索自动获取最新信息 |

### 决策建议

```
                    官网信息精确度需求高？
                         │
                ┌────────┴────────┐
              是 │                 │ 否
          ┌────┴────┐         ┌───┴───┐
          │ 定向抓取 │         │ 纯搜索 │
          │ 3-5个URL │         │ 方案   │
          └────┬────┘         └───┬───┘
               │                 │
               └────────┬────────┘
                        ▼
                搜索优先 + 定向抓取补充
                （2次LLM + 可选抓取）
```

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Tavily 搜索结果质量差 | 画像信息不准确 | 增加搜索查询数量（10-15条），多维度覆盖 |
| Tavily API 限额/故障 | 画像生成失败 | 保留爬虫路径作为 fallback |
| 某些竞品信息极少（新公司） | 字段大量"信息不足" | 在画像中明确标注信息缺口，用户可手动补充 |
| 价格等动态信息时效性 | 信息过时 | 搜索时指定 time_range="month"，并在画像中标注信息时间 |
| 竞品官网信息与第三方不一致 | 冲突处理 | 保留多来源，在字段中标注"存在差异" |

---

## 六、验收标准

### 功能验收

| 验收项 | 标准 | 验证方式 |
|--------|------|----------|
| 画像生成成功率 | >= 90% | 对 20 个知名竞品（DJI/大疆、大疆、华为、小米等）批量测试 |
| 字段覆盖率 | >= 60%（每张画像） | 统计各维度字段填充率 |
| 来源多样性 | 每画像 >= 3 个独立域名 | 统计 source_refs 中不同域名数 |
| LLM 调用次数 | <= 4 次 | 审计日志 |
| 生成耗时 | <= 60 秒 | 计时 |
| 成本 | <= ¥0.1/次 | 审计日志中的 token 消耗 |

### 质量验收

| 验收项 | 标准 | 验证方式 |
|--------|------|----------|
| 关键字段置信度 | >= medium | 产品名称、核心功能、定位不出现"信息不足" |
| 来源可追溯 | 每个字段有 source_url | 检查 JSON 输出 |
| 信息缺口透明 | 标注缺失信息 | 检查 info_gaps 字段 |
| 与调研模块一致 | 使用相同的来源分级 + 引用格式 | 对齐 agent.py 的输出格式 |

---

## 七、与现有模块的关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        系统架构总览                                │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌───────────────────┐    │
│  │ 研究模块     │    │ 画像模块     │    │ 图谱模块           │    │
│  │ (agent.py)  │    │ (NEW)       │    │ (graph_agent.py)  │    │
│  │             │    │             │    │                   │    │
│  │ 搜索 → 分析  │    │ 搜索 → 提取  │    │ 搜索 → 实体提取    │    │
│  │ → 报告      │    │ → 结构化画像 │    │ → 关系图谱         │    │
│  │             │    │             │    │                   │    │
│  │ 5次LLM      │    │ 2次LLM      │    │ 3次LLM            │    │
│  │ 完整报告     │    │ 结构化数据   │    │ 可视化图谱         │    │
│  └──────┬──────┘    └──────┬──────┘    └────────┬──────────┘    │
│         │                  │                     │               │
│         │  共享使用 Source   │                     │               │
│         │  （去重/分级/评分）│                     │               │
│         ▼                  ▼                     ▼               │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              共享基础层                                    │     │
│  │  LLMClient / SearchClient / dedup.py / timeutil.py       │     │
│  │  Source / SourceArchive（统一来源存储）                    │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  关键改进：画像模块不再独立运行爬虫，而是共享研究模块的             │
│  SearchClient + dedup + classify_source 基础设施                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、实施优先级

| 优先级 | 任务 | 投入 | 收益 |
|--------|------|------|------|
| **P0** | 新建 `generate_profile_from_search()` | 1 天 | 画像从 0% 可用 → 90% 可用 |
| **P0** | 修改 `generate_profile()` 默认走搜索路径 | 2 小时 | 用户端直接受益 |
| **P1** | 结果校验 + 质量评分 | 1 天 | 画像可交付、可验证 |
| **P1** | 前端适配（来源展示、质量评分） | 半天 | 用户体验提升 |
| **P2** | 定向抓取补充（可选） | 1 天 | 官网精确信息补充 |
| **P2** | 模板维度增强（search_priority 等） | 1 天 | 更灵活的搜索策略 |
| **P3** | 爬虫路径 fallback 保留 | 0 天（已存在） | 极端情况兜底 |

---

## 九、总结

> **当前画像管线的根本问题是：试图从每个竞品不同的官网中「硬提取」结构化信息。这在工程上不可持续——每个网站的 HTML 结构、反爬策略、URL 路由都不同，而 LLM 需要的是「经过整理的、有上下文的信息」，不是「一堆杂乱的 HTML」。**

> **研究模块已经验证了正确的范式：用搜索引擎获取多来源、经过初步整理的信息，让 LLM 做综合分析。画像模块应该对齐这个范式，而不是继续在爬虫上投入。**

> **最终交付物应该是：一张可验证的、有来源引用的、与调研报告同等级别的竞品画像。而不是一串从官网硬抠出来的 JSON 字段。**
