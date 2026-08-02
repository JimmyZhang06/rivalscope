# 竞品产品情报系统 — 架构评审与技术方案

> **版本**：v5.0.0 · 分析日期：2026-08-02
> **说明**：v5.0.0 爬虫 bug 已修复，以下方案中的 Bug fix 3 和 Bug fix 4 标记为已完成。

---

## 一、评审结论先行

**现有系统的核心问题不是某个函数的 bug，而是画像模块和研究模块采用了完全不同的信息获取范式，导致画像模块在工程上不可持续。**

研究模块（`agent.py`）通过搜索引擎获取信息 → 可靠、可交付、可验证。画像模块（`profile_extractor.py`）通过直接爬虫获取信息 → 实测 0% 可用。

**产品情报的需求（产品目录、参数、定价）恰好介于两者之间：目录和动态适合搜索，参数和定价需要官网验证。** 所以正确的架构是「搜索为主、定向抓取为辅」的双层结构。

---

## 二、现有模块能力盘点

| 模块 | 文件 | 能力 | 状态 | 可复用于产品情报 |
|------|------|------|------|-----------------|
| 研究管线 | `services/agent.py` | 搜索规划 → Tavily 检索 → 去重分级 → LLM 分析 → Markdown 报告 | 成熟可用 | **核心基础** |
| 搜索客户端 | `services/search.py` | Tavily API 封装（`AsyncTavilyClient`，`search()` 返回 `[{title, url, content, score, raw_content, published_date}]`） | 成熟可用 | 直接用 |
| 去重/分级/置信度 | `services/dedup.py` | `dedup_by_content()`（URL + 标题相似度去重）、`classify_source()`（official/media/community/other 四级分级）、`estimate_confidence()`（tier_weight × freshness） | 成熟可用 | 直接用 |
| 时间工具 | `core/timeutil.py` | `baseline_now()`（支持 `research_now_override` 演示回测）、`recency_weight()`（180 天半衰期指数衰减）、`age_days_of()` | 成熟可用 | 直接用 |
| 图谱管线 | `services/graph_agent.py` | 搜索规划 → 检索 → LLM 实体/关系抽取 → 去重落库 | 成熟可用 | 模式可复用 |
| 快照服务 | `services/snapshot.py` | `capture_snapshot()` + `save_archive()`：httpx 获取 HTML + BeautifulSoup 提取文本 | 可用 | 定向抓取可复用 |
| 全站爬虫 | `services/crawler.py` | Sitemap → BFS → 并发抓取 → readability 提取 | **v5.0.0 已修复**（语言感知 sitemap、consent overlay 剥离、命名空间匹配、Chrome UA） | 定向抓取模式可用 |
| 画像提取 | `services/profile_extractor.py` | 3 阶段 LLM 提取（Stage1 每页 1 次 + Stage2 每维度 1 次 = 55+ 次调用） | 实测不可用 | 不直接复用 |
| 画像服务 | `services/profiles.py` | `generate_profile()`：优先 ResearchTask 来源（15 条 Source 做单次 LLM 提取），fallback 到爬虫 | 依赖上游数据 | 需要改造 |
| 横向对比 | `services/comparison.py` | `generate_comparison()`：基于已冻结画像的横向对比矩阵 | 成熟可用 | 直接用 |
| LLM 客户端 | `services/llm.py` | `LLMClient`：OpenAI 兼容接口，`chat()` / `chat_messages()` / `chat_json()`，3 次重试 + 审计日志 + 成本计算 | 成熟可用 | 直接用 |
| 调度器 | `services/scheduler.py` | 每 60s 扫描到期 Tracker → 创建 ResearchTask → 触发 `run_research` | 成熟可用 | 无需改动 |

**关键发现：** 研究模块和图谱模块已经验证了「搜索优先」的范式是可靠的。画像模块需要对齐这个范式。

---

## 三、产品情报的信息分层

产品情报不是均匀的——不同信息类型的获取成本差异极大：

| 信息类型 | 示例 | 最优来源 | 获取方式 | 成本 |
|---------|------|---------|---------|------|
| **产品目录** | DJI 有哪些产品线 | 搜索引擎（第三方整理） | Tavily 搜索 | 低 |
| **最新动态** | 今年发布了什么新品 | 搜索引擎（新闻/发布会） | Tavily 搜索 | 低 |
| **产品分类** | 消费级 vs 专业级 vs 企业级 | 搜索引擎 | Tavily 搜索 | 低 |
| **产品参数** | Mavic 4 传感器型号、重量 | **官网产品页** | 定向抓取 | 中 |
| **定价信息** | 各产品售价 | **官网定价页** | 定向抓取 | 中 |
| **官方声明** | 功能描述、技术规格 | **官网产品页** | 定向抓取 | 中 |
| **用户评价** | 实际使用体验 | 搜索引擎（社区/评测） | Tavily 搜索 | 低 |
| **市场定位** | 竞品之间的差异化 | 搜索引擎（评测/对比） | Tavily 搜索 | 低 |

**分层结论：**
- 搜索引擎覆盖 70% 的信息需求（目录、动态、分类、评价、定位）
- 定向抓取覆盖 20% 的信息需求（精确参数、定价、官方声明）
- 剩下的 10% 是两家都没覆盖的（如内部产量数据），标注为「信息不足」

---

## 四、架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    产品情报系统 — 搜索优先 + 定向抓取补充                   │
│                                                                         │
│  输入：竞品名称（Competitor.name）+ 产品情报模板（ProfileTemplate）       │
│                                                                         │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   第一层         │     │   第二层         │     │   第三层         │   │
│  │   搜索发现       │────▶│   定向采集       │────▶│   LLM 综合       │   │
│  │                 │     │                 │     │                 │   │
│  │ "知道有什么"    │     │ "取精确数据"    │     │ "组织成交付物"   │   │
│  │                 │     │                 │     │                 │   │
│  │ 调用方式：       │     │ 调用方式：       │     │ 调用方式：       │   │
│  │ SearchClient     │     │ httpx.AsyncClient│     │ LLMClient        │   │
│  │ .search()        │     │ 定向 GET 请求    │     │ .chat_json()     │   │
│  │ (Tavily API)     │     │ (复用 crawler.py │     │ (两次调用)       │   │
│  │                 │     │  的 fetch 逻辑)  │     │                 │   │
│  │ 并发：3-5 个     │     │ 串行/限 2 并发   │     │ 串行，顺序执行   │   │
│  │ 搜索查询         │     │ 最多 5 个 URL    │     │                 │   │
│  │                 │     │                 │     │                 │   │
│  │ 产出：           │     │ 产出：           │     │ 产出：           │   │
│  │ • 产品名称列表   │     │ • 精确参数       │     │ • 产品目录       │   │
│  │ • 产品分类       │     │ • 定价数据       │     │ • 产品参数表     │   │
│  │ • 最新动态       │     │ • 官方功能描述   │     │ • 定价信息       │   │
│  │ • 关键 URL 列表  │     │ • 页面分类标记   │     │ • 来源引用       │   │
│  │ • 搜索结果集     │     │ • CompetitorPage │     │ • 置信度标注     │   │
│  │   （存入 Source）│     │   记录           │     │ • Competitor    │   │
│  │                 │     │                 │     │   Profile        │   │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘   │
│                                                                         │
│  数据流：                                                                │
│  第一层搜索结果 ──→ 第三层（LLM 做广度综合：产品目录、分类、动态）          │
│  第一层搜索结果 ──→ 提取关键 URL ──→ 第二层定向抓取                       │
│  第二层爬取结果 ──→ 第三层（LLM 做深度提取：参数、定价）                  │
│  第三层合并两层信息 → 写入 CompetitorProfile                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 三层职责

**第一层：搜索发现**

职责是回答「这个竞品有什么产品」。不需要爬虫，纯搜索。

执行方式：
- 复用 `agent.py` 的 `_plan()` 模式，生成 3-5 个搜索查询
- 查询设计：
  - `"{竞品名} 产品目录 产品线 2024 2025"` — 发现产品目录
  - `"{竞品名} 最新发布 新品 发布会"` — 发现最新动态
  - `"site:{官网域名} products"` — 发现官网产品页 URL
  - `"{竞品名} 产品型号 规格参数 价格"` — 补充参数信息
- Tavily 并行检索（复用 `SearchClient.search()`，`max_results=5`）
- 复用 `dedup_by_content()` + `classify_source()` + `estimate_confidence()` 做去重、分级、评分
- 结果存入 `Source` 表（和研究模块一致）
- 产出：
  - 产品名称列表、产品分类、最新动态
  - 「关键 URL 列表」：从搜索结果中筛选 `tier=official` 且路径匹配高价值模式的 URL（`/pricing`、`/products/`、`/about`、`/support`），最多 5 个 → 这是给第二层的输入

**第二层：定向采集**

职责是回答「产品的精确参数和定价是多少」。只抓第一层发现的高价值 URL，不做全站爬取。

执行方式：
- 输入：第一层产出的关键 URL 列表（最多 5 个）
- 对每个 URL 做轻量抓取，复用 `crawler.py` 中的 httpx 请求 + readability/BS4 提取逻辑，但：
  - 不做 sitemap 发现（不需要）
  - 不做 BFS（不需要）
  - 不做并发批量（最多 5 个 URL，串行或 2 并发即可）
  - content_text 截断到 5000 chars（画像提取足够用）
  - 轻量过滤：content_text < 200 chars 的标记为 skipped
- 产出：`CompetitorPage` 记录（`page_type` 标记为 pricing/products/about/help 等）
- **这一层不需要自己的 LLM 调用。** 纯规则筛选 + 轻量抓取 + 存储。LLM 工作在第三层。

**第三层：LLM 综合**

职责是把两层的信息综合成结构化的产品情报。

执行方式——两次 LLM 调用：

```
调用 1：广度综合
  系统 prompt：基于搜索结果提取产品目录、产品线、分类、最新动态
  输入：第一层的 Source 材料（按维度分组）
  输出：JSON 包含 product_catalog + latest_updates

调用 2：深度提取
  系统 prompt：基于搜索结果 + 定向抓取页面，提取每个产品的精确参数和定价
  输入：第一层的 Source 材料 + 第二层的 CompetitorPage 内容
  输出：JSON 包含 product_specs + pricing + 每个字段的 value/confidence/source_urls
```

两次调用的输出合并为同一份 JSON，每个字段标注来源类型（搜索 / 官网抓取）和置信度。

最终写入 `CompetitorProfile.profile_data`（JSON 字符串），来源引用写入 `CompetitorProfile.source_refs`。

### 4.3 与现有系统的复用关系

```
现有模块              文件路径                  产品情报如何使用
─────────────────    ───────────────────────    ──────────────────────────────────
SearchClient         services/search.py        直接用（Tavily 搜索）
LLMClient            services/llm.py           直接用（chat / chat_json）
dedup.py             services/dedup.py         直接用（dedup_by_content / classify_source / estimate_confidence）
timeutil.py          core/timeutil.py          直接用（baseline_now / recency_weight）
snapshot.py          services/snapshot.py       复用 capture_snapshot() 做定向抓取
crawler.py           services/crawler.py        修复两个 bug 后，定向抓取复用 httpx + readability 逻辑
Competitor           db/models.py:54-73        输入：竞品 name / alias / website / tech_focus / keywords
CompetitorPage       db/models.py:76-98        存储定向抓取结果（page_type / content_text）
CompetitorProfile    db/models.py:284-304       存储最终画像（profile_data + source_refs）
ProfileTemplate      db/models.py:266-282       产品情报模板（dimensions JSON）
Source               db/models.py              搜索记录存入（和研究模块一致）
```

**不新建数据库表。不新建 API 路由。复用现有基础设施。**

---

## 五、数据流详细设计

### 5.1 完整数据流

```
用户操作：POST /api/profiles/generate
  │
  ▼
profiles.py :: generate_profile(competitor_id, template_id)
  │
  ├─ 读取 Competitor（name, alias, website, tech_focus, keywords）
  ├─ 读取 ProfileTemplate（dimensions JSON）
  │
  ▼
product_intel.py :: generate_product_intel()
  │
  ├─ 第一层：_layer1_discover()
  │   │
  │   ├─ _build_search_queries(competitor, template)
  │   │   生成 3-5 个 Tavily 查询（基于竞品名称 + 模板维度）
  │   │   查询示例：
  │   │     q1 = f"{name} 产品目录 产品线 最新"
  │   │     q2 = f"{name} 最新发布 新品 2024 2025"
  │   │     q3 = f"site:{website} products"
  │   │     q4 = f"{name} 产品型号 规格参数 价格"
  │   │
  │   ├─ asyncio.gather(*(searcher.search(q) for q in queries))
  │   │   每个查询 max_results=5, time_range="year"
  │   │
  │   ├─ dedup_by_content(results)          ← 复用 dedup.py
  │   ├─ classify_source(url, [name], name) ← 复用 agent.py:51-72
  │   ├─ estimate_confidence(r)             ← 复用 dedup.py:15-39
  │   │
  │   ├─ 筛选关键 URL（给第二层用）：
  │   │   official URLs with /pricing|/products|/about|/support|/prices
  │   │   最多 5 个，按 confidence 排序
  │   │
  │   ├─ Source 记录写入数据库
  │   │
  │   └─ 返回：search_results + key_urls
  │
  ├─ 第二层：_layer2_fetch(key_urls)
  │   │
  │   ├─ 对每个 URL 做定向抓取（最多 5 个，2 并发）
  │   │   ├─ httpx.AsyncClient(timeout=15).get(url)
  │   │   ├─ Document(html) 提取正文（readability）
  │   │   │   失败时降级到 BeautifulSoup.get_text()
  │   │   ├─ content_text 截断到 5000 chars
  │   │   ├─ 轻量过滤：len(text) < 200 → skipped
  │   │   └─ 存入 CompetitorPage（competitor_id / url / page_type / title / content_text）
  │   │
  │   └─ 返回：crawled_pages
  │
  ├─ 第三层：_layer3_synthesize()
  │   │
  │   ├─ LLM 调用 1：广度综合（search-only）
  │   │   system = _build_broad_prompt(template_dimensions, competitor)
  │   │   user = _format_search_results(search_results)
  │   │   → llm.chat_json(system, user)
  │   │   → 提取 product_catalog（产品线列表、分类、最新发布）
  │   │
  │   ├─ LLM 调用 2：深度提取（search + crawl）
  │   │   system = _build_deep_prompt(template_dimensions, competitor)
  │   │   user = _format_search_results(search_results) + _format_crawled_pages(crawled_pages)
  │   │   → llm.chat_json(system, user)
  │   │   → 提取 product_specs（参数表、核心参数）+ pricing（价格区间、定价模式）
  │   │
  │   └─ 合并两层 JSON，生成 source_refs
  │
  ├─ 写入 CompetitorProfile
  │   profile_data = {"dimensions": {...merged dimensions...}, "summary": "..."}
  │   source_refs = [{"url", "title", "snippet", "source_type": "search"/"crawl", "confidence"}]
  │   status = "draft"
  │
  └─ 返回：profile_id + profile_data + source_refs
```

### 5.2 各层输入输出契约

```
_layer1_discover(competitor, template_dimensions)
  ├── 输入：Competitor(name, alias, website, tech_focus, keywords) + dimensions
  ├── 调用：SearchClient.search() × 3-5（并行）
  ├── 处理：dedup + classify + confidence
  ├── 输出：
  │   {
  │     "search_results": [...],        // 去重分级后的搜索记录
  │     "sources": [...],               // 已写入 Source 表的记录
  │     "key_urls": [...],              // 给第二层的高价值 URL（≤5个）
  │     "product_catalog_draft": {...}  // LLM 预综合的产品目录草稿
  │   }
  └── 出错处理：搜索全部失败 → 直接跳过第二层，第三层用空数据集继续

_layer2_fetch(key_urls, competitor_id)
  ├── 输入：key_urls（最多 5 个 URL）+ competitor_id
  ├── 调用：httpx.AsyncClient.get() × ≤5（2 并发）
  ├── 处理：readability/BS4 提取 → 截断 5000 chars → 过滤 < 200 chars
  ├── 存储：CompetitorPage（每条 URL 一条记录）
  ├── 输出：
  │   {
  │     "pages": [...],                // 成功抓取的页面
  │     "skipped": [...],              // 被过滤的页面
  │     "failed": [...]                // 抓取失败的 URL
  │   }
  └── 出错处理：单个 URL 失败不影响其他 URL；全部失败 → 返回空 pages，第三层继续

_layer3_synthesize(search_results, crawled_pages, template_dimensions, competitor)
  ├── 输入：第一层结果 + 第二层结果 + 模板维度 + 竞品信息
  ├── 调用：LLMClient.chat_json() × 2（串行）
  │   调用 1：广度综合（search-only）
  │   调用 2：深度提取（search + crawl）
  ├── 输出：
  │   {
  │     "dimensions": {
  │       "product_catalog": {
  │         "product_lines": [{"name": "Mavic", "category": "航拍无人机", ...}],
  │         "total_products": "12款",
  │         "categories": ["消费级", "专业级", "企业级"],
  │         "latest_releases": [{"name": "Mavic 4 Pro", "date": "2025-03", ...}]
  │       },
  │       "product_specs": {
  │         "specs_table": {...},
  │         "key_specs": {"传感器": "4/3 CMOS", "重量": "966g", ...}
  │       },
  │       "pricing": {
  │         "price_range": "¥3,688 ~ ¥12,888",
  │         "pricing_model": "一次性购买"
  │       },
  │       ...
  │     },
  │     "summary": "DJI 目前拥有 X 条产品线...",
  │     "overall_confidence": "high|medium|low"
  │   }
  │   source_refs: [{"url", "title", "snippet", "source_type": "search|crawl", "confidence"}]
  └── 出错处理：调用 1 失败 → 整体失败；调用 2 失败 → 只保留调用 1 的广度结果，参数/定价标注"信息不足"
```

---

## 六、具体改动清单

### 改动 1：新建 `backend/app/services/product_intel.py`（核心，~300 行）

包含以下函数：

```
generate_product_intel(competitor_id, template_id, user_id="")
  └── 主入口，协调三层执行，写入 CompetitorProfile

_layer1_discover(competitor, template_dimensions, user_id, org_id)
  └── 搜索发现层
      ├── _build_search_queries(competitor, dimensions) → list[dict]
      ├── _execute_searches(queries) → list[dict]（并行 Tavily）
      ├── _process_results(results, competitor_name) → 去重/分级/评分
      └── _extract_key_urls(results) → list[str]（筛选官方高价值 URL）

_layer2_fetch(key_urls, competitor_id)
  └── 定向采集层
      ├── _fetch_single_url(url) → dict（httpx + readability + 截断）
      └── _store_pages(pages, competitor_id) → 写入 CompetitorPage

_layer3_synthesize(search_results, crawled_pages, template_dimensions, competitor)
  └── LLM 综合层
      ├── _build_broad_prompt(dimensions, competitor) → str（调用 1 的 system prompt）
      ├── _build_deep_prompt(dimensions, competitor) → str（调用 2 的 system prompt）
      ├── _call_llm_broad() → dict（广度综合）
      ├── _call_llm_deep() → dict（深度提取）
      └── _merge_results(broad, deep) → dict（合并输出）
```

### 改动 2：修改 `backend/app/services/profiles.py`

在 `generate_profile()` 函数中（当前逻辑在第 14-105 行），调整路径优先级：

```
当前逻辑（第 48-100 行）：
  if sources (来自已有 ResearchTask):
      → 单次 LLM 提取（现有逻辑，保留）
  else:
      → fallback 到 extract_profile_from_pages()（爬虫路径）

修改后：
  if sources (来自已有 ResearchTask):
      → 单次 LLM 提取（保留，作为快捷方式）
  else:
      → 调用 product_intel.generate_product_intel()（新增，搜索优先路径）
      → 如果 product_intel 也失败，再 fallback 到 extract_profile_from_pages()（兜底）
```

具体改动：在第 103 行的 `from app.services.profile_extractor import extract_profile_from_pages` 之前，插入 `product_intel` 路径。

### 改动 3：修复 `backend/app/services/crawler.py`（v5.0.0 已完成）

**Bug fix 1：`_fetch_sitemap_urls()`（第 91-142 行）**

已修复：使用 `{*}loc` 通配符命名空间匹配替代 `loc.tag.lower() == "loc"`。

```python
# 修复后（已在 v5.0.0 代码中）：
for loc in root.findall(".//{*}loc"):
    if loc.text:
        urls.append(loc.text.strip())
```

`sitemapindex` 分支同样使用 `{*}loc`。

**Bug fix 2：`_classify_page_type()`（第 449-479 行）**

已修复：分类前用 regex 去掉语言前缀。

```python
# 修复后（已在 v5.0.0 代码中）：
path = re.sub(r"^/(cn|en|de|fr|ja|ko|es|pt|it|ru|zh)/", "/", parsed.path).lower().rstrip("/")
```

`_TYPE_MAP` 中已补充遗漏的类型映射：`"newsroom": "news"`、`"press": "press"`、`"contact": "contact"`、`"faq": "faq"`、`"repair": "help"`、`"prices": "pricing"`。

### 改动 4：`backend/app/services/crawler.py` 的定向抓取辅助函数

在全站爬虫函数之外，新增一个轻量的定向抓取函数，供第二层调用：

```python
async def fetch_single_page(url: str) -> dict[str, Any]:
    """
    定向抓取单个页面（不经过 discover/fetch_pages 流程）。
    返回 {url, title, content_text, content_html, page_type, access_status, access_error}
    
    与 _fetch_single() 的区别：
    - 不需要 semaphore 和 domain delay（少量 URL 不需要）
    - content_text 截断到 5000 chars（画像提取足够）
    - 不依赖 _MAX_PAGES 等全站爬取参数
    """
```

### 不改动的文件

| 文件 | 原因 |
|------|------|
| `profile_extractor.py` | 保留作为兜底路径，不删除 |
| `api/profiles.py` | API 路径不变，返回格式兼容 `CompetitorProfileOut` |
| `api/crawl.py` | 手动触发全站爬取的入口保留 |
| 前端任何文件 | 用户操作流程不变，前端无需感知后端架构变化 |
| 数据库 schema | 不新建表，复用 `CompetitorPage` + `CompetitorProfile` + `Source` |

---

## 七、产品情报模板

产品情报需要比当前默认模板更细的维度。模板存在 `ProfileTemplate.dimensions` 中（JSON 格式，用户可通过前端编辑）。

系统内置一个「产品情报」默认模板：

```json
[
  {
    "key": "product_catalog",
    "label": "产品目录",
    "fields": [
      {"key": "product_lines", "label": "产品线列表", "type": "text"},
      {"key": "total_products", "label": "产品总数", "type": "text"},
      {"key": "categories", "label": "产品分类", "type": "text"},
      {"key": "latest_releases", "label": "最新发布", "type": "text"}
    ]
  },
  {
    "key": "product_specs",
    "label": "产品参数",
    "fields": [
      {"key": "specs_by_product", "label": "各产品参数", "type": "text"},
      {"key": "key_specs", "label": "核心参数对比", "type": "text"}
    ]
  },
  {
    "key": "pricing",
    "label": "定价信息",
    "fields": [
      {"key": "price_list", "label": "产品价格表", "type": "text"},
      {"key": "price_range", "label": "价格区间", "type": "text"},
      {"key": "pricing_model", "label": "定价模式", "type": "text"}
    ]
  },
  {
    "key": "technology",
    "label": "技术方向",
    "fields": [
      {"key": "core_tech", "label": "核心技术", "type": "text"},
      {"key": "tech_advantages", "label": "技术优势", "type": "text"}
    ]
  },
  {
    "key": "market_position",
    "label": "市场定位",
    "fields": [
      {"key": "target_segments", "label": "目标客户群", "type": "text"},
      {"key": "competitive_position", "label": "竞争定位", "type": "text"}
    ]
  }
]
```

这个模板是可配置的——用户可以通过前端编辑 JSON 来调整维度和字段。系统内置模板在 `main.py` 的 `seed_admin()` 或新的 `seed_default_templates()` 中初始化。

---

## 八、搜索查询生成逻辑

第一层的搜索查询不是硬编码的，而是根据竞品信息和模板维度动态生成。

### 8.1 基础查询（必选）

```
q_base = f"{competitor_name} 产品目录 产品线"
```

### 8.2 动态查询（基于模板维度）

遍历 `ProfileTemplate.dimensions`，为每个维度生成一个搜索查询：

```
for dim in dimensions:
    field_labels = "、".join(f["label"] for f in dim.get("fields", []))
    queries.append({
        "dimension": dim["key"],
        "query": f"{competitor_name} {dim['label']} {field_labels}",
        "focus": dim["label"]
    })
```

例如，模板有 `product_specs` 维度，字段为 `specs_table` 和 `key_specs`，则生成：
```
q = "DJI 产品参数 参数表、核心参数"
```

### 8.3 补充查询（固定）

```
q_website = f"site:{competitor.website} products pricing"  # 发现官网页面
q_news = f"{competitor_name} 最新发布 新品 2024 2025"       # 最新动态
```

### 8.4 去重

基础查询 + 动态查询 + 补充查询可能有重复，用 `dict` 去重（按 `query` 字段）。

最终控制在 3-5 个查询（参考 `agent.py` 的 `MAX_QUERIES=8` 和 `graph_agent.py` 的 `MAX_QUERIES=6`，画像场景不需要那么多）。

---

## 九、LLM Prompt 设计

### 9.1 调用 1：广度综合（search-only）

```
system_prompt = f"""\
{_date_header()}你是一名竞争情报分析师。基于给出的网络检索材料，\
为竞品提取产品目录、产品线分类和最新动态。

竞品：{competitor_name}
别名：{competitor.alias}
官网：{competitor.website}
技术领域：{competitor.tech_focus}

需要提取的维度：
{dimensions_desc}

检索材料（共 {n} 条，已按维度分组，含来源可信度）：
{materials_formatted}

输出 JSON：
{{
  "product_catalog": {{
    "product_lines": [
      {{"name": "产品线名称", "category": "分类", "description": "一句话描述", "confidence": "high|medium|low"}}
    ],
    "total_products": "约 X 款",
    "categories": ["消费级", "专业级", ...],
    "latest_releases": [
      {{"name": "产品名", "date": "发布时间", "description": "更新内容", "confidence": "high|medium|low"}}
    ]
  }},
  "summary": "产品目录整体概况（100 字以内）",
  "info_gaps": ["信息不足的方面"]
}}

要求：
1. 仅依据材料中的信息，材料未覆盖的内容要明确标注「信息不足」；
2. 每个条目标注来源编号 [n]；
3. 最新动态只包含有明确时间依据的事件。
"""

user_prompt = f"竞品：{competitor_name}\n\n检索材料：\n{materials_formatted}"
```

### 9.2 调用 2：深度提取（search + crawl）

```
system_prompt = f"""\
{_date_header()}你是一名竞争情报分析师。基于给出的网络检索材料\
（含搜索引擎结果和官网定向抓取内容），\
为竞品提取精确的产品参数和定价信息。

竞品：{competitor_name}
别名：{competitor.alias}
官网：{competitor.website}

需要提取的维度：
{dimensions_desc}

检索材料：
{materials_formatted}

官网页面内容（已定向抓取）：
{crawled_pages_formatted}

输出 JSON：
{{
  "dimensions": {{
    "product_specs": {{
      "specs_by_product": [
        {{
          "name": "产品名",
          "specs": {{
            "传感器": {{"value": "...", "confidence": "high|medium|low", "source_urls": ["..."]}},
            "重量": {{"value": "...", "confidence": "high|medium|low", "source_urls": ["..."]}},
            ...
          }}
        }}
      ],
      "key_specs": {{...}}
    }},
    "pricing": {{
      "price_list": [
        {{"product": "产品名", "price": "¥X,XXX", "confidence": "high|medium|low", "source_urls": ["..."]}}
      ],
      "price_range": "¥X,XXX ~ ¥XX,XXX",
      "pricing_model": "一次性购买/订阅制/免费+增值"
    }}
  }},
  "summary": "参数和定价概况",
  "overall_confidence": "high|medium|low",
  "info_gaps": ["信息不足的方面"]
}}

要求：
1. 精确参数（如传感器型号、重量克数）以官网抓取内容为准，搜索结果为辅；
2. 定价信息以官网定价页为准；
3. 多来源冲突时标注「存在差异：A来源说X，B来源说Y」；
4. 不能编造信息，不确定的内容明确标注。
"""

user_prompt = f"竞品：{competitor_name}\n\n检索材料：\n{materials_formatted}\n\n官网页面内容：\n{crawled_pages_formatted}"
```

---

## 十、执行顺序

| 步骤 | 内容 | 改动文件 | 产出 | 时间 |
|------|------|---------|------|------|
| 1 | 新建 `product_intel.py`：三层核心逻辑（~300 行） | `services/product_intel.py`（新建） | 可运行的搜索优先画像生成 | 半天 |
| 2 | 修改 `profiles.py`：默认走搜索优先路径 | `services/profiles.py`（修改 ~10 行） | 用户端直接受益 | 2 小时 |
| 3 | 修复 `crawler.py` 两个 bug | `services/crawler.py`（v5.0.0 已完成） | 定向采集层可用 | — |
| 4 | 新增 `fetch_single_page()` 辅助函数 | `services/crawler.py`（新增 ~30 行） | 第二层定向抓取可用 | 1 小时 |
| 5 | DJI 实测验收 | 测试脚本 | 验证产品目录 + 参数 + 定价 | 1 小时 |
| 6 | 可选：细化产品情报模板 | `main.py` seed 逻辑 | 内置模板 | 可选 |

**总投入：1-2 天。**

---

## 十一、验收标准

完成后对 DJI 测试，交付物必须包含：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 产品目录 | 能列出 DJI 当前主要产品线（Mavic、Mini、Air、Ronin 等） | 检查 product_catalog.product_lines |
| 产品参数 | 核心参数（传感器、重量、续航）和官网一致 | 抽样对比官网产品页 |
| 定价信息 | 价格和官网定价页一致 | 抽样对比官网定价页 |
| 来源可追溯 | 每条信息带 URL 和来源类型（搜索/官网） | 检查 source_refs |
| 生成成功率 | 100%，不依赖竞品是否做过调研 | 对 5 个竞品批量测试 |
| 生成耗时 | <= 60 秒 | 计时 |
| LLM 调用 | <= 4 次（搜索规划 1 + 广度综合 1 + 深度提取 1 + 可选洞察 1） | 审计日志 |
| 成本 | <= ¥0.1/次 | 审计日志 token 消耗 |
| 字段覆盖率 | >= 60% 的维度字段能填上值 | 统计填充率 |

---

## 十二、风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 搜索引擎遗漏某些产品 | 目录不完整 | 定向抓取补充，两层互补 |
| 官网参数页 404/SPA | 参数获取失败 | 标注「信息不足」，不影响其他字段 |
| LLM 提取参数有误 | 数据不准确 | 每个字段带来源 URL，用户可验证 |
| Tavily API 故障 | 搜索失败 | 保留爬虫路径作为兜底（`profile_extractor.py` 不删除） |
| 竞品名称歧义 | 搜索结果不准确 | 模板中允许用户指定 `competitor.alias` 和 `keywords`，搜索时用于消歧 |

---

## 十三、总结

> **当前画像管线的根本问题是：试图从每个竞品不同的官网中「硬提取」结构化信息。这在工程上不可持续——每个网站的 HTML 结构、反爬策略、URL 路由都不同，而 LLM 需要的是「经过整理的、有上下文的信息」，不是「一堆杂乱的 HTML」。**

> **研究模块已经验证了正确的范式：用搜索引擎获取多来源、经过初步整理的信息，让 LLM 做综合分析。产品情报系统应该对齐这个范式，而不是继续在爬虫上投入。**

> **最终交付物应该是：一张可验证的、有来源引用的、包含精确参数和定价的竞品产品情报。而不是一串从官网硬抠出来的 JSON 字段。**
