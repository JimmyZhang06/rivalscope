# 05. 后端服务层

> **竞品调研 Agent**
> 版本：v7.0.0 · 日期：2026-08-03 · 分支：agent-v7

## 5.1 Service 层职责总览

| 模块 | 文件 | 职责 |
|------|------|------|
| 调研编排 | `agent.py` | ★ 核心管线：规划 → 检索 → 去重/置信度/冲突 → 快照 → 分析 → 洞察 → 时间线 → 报告 |
| 图谱构建 | `graph_agent.py` | 关系图谱管线：规划 → 检索 → 实体/关系抽取 → 报告 |
| LLM 封装 | `llm.py` | OpenAI 兼容客户端 + 审计日志 |
| 搜索 | `search.py` | Tavily API 封装 |
| 去重/置信度 | `dedup.py` | URL 去重、标题相似度去重、置信度估算、冲突检测 |
| 快照存档 | `snapshot.py` | 网页 HTML/纯文本抓取与存档 |
| 变更摘要 | `digest.py` | 期次报告对比 + LLM 生成变更摘要 |
| 通知 | `notify.py` | 站内通知 + SMTP 邮件 + Webhook 推送 |
| 调度器 | `scheduler.py` | 60 秒扫描到期追踪项 + 触发执行 + 执行快照；启动时恢复未完成画像任务 |
| 竞品画像 | `profiles.py` | 基于来源生成画像 + 冻结 + 访问校验（`check_access`） |
| 画像提取 | `profile_extractor.py` | 竞品官网信息结构化提取（异步任务 + DB 持久化 + SQLite 锁重试 + 维度级错误隔离） |

### 画像提取流程（`profile_extractor.py`）

```
Stage 1: 数据加载
  │  Competitor + CompetitorPage（已爬取的页面） + ProfileTemplate
  ▼
Stage 2: 页面摘要
  │  每页截取前 3000 字符 + 保留完整内容（Stage 3 用）
  ▼
Stage 3: 维度提取（并行）
  │  asyncio.gather + return_exceptions=True
  │  单个维度失败 → 标记为空，不中断整个流程（v5.5.0 新增容错）
  ▼
Stage 4: 聚合
  │  LLM 汇总各维度提取结果为 summary
  │  生成 source_refs（URL + 置信度）
  ▼
Stage 5: 持久化
  │  写入 CompetitorProfile（status=draft）
  │  写入 ProfileGenerationTask（DB + 内存双写，SQLite 锁重试）
  │  模板版本号记录（template_version）
```

### 关键特性

- **DB 写入重试**：`_db_write_retry()` — SQLite "database is locked" 时自动重试 5 次（每次间隔 3s）
- **进程重启恢复**：`get_profile_generation_task()` 优先内存缓存，回退数据库查询
- **维度级错误隔离**：Stage 2 中单个维度 LLM 失败不影响其他维度
- **模板版本追踪**：记录生成时的模板版本号（`template_version`），支持后续版本对比
| 画像报告 | `profile_report.py` | 画像报告/洞察预生成（独立列存储 + 兜底洞察 + 置信度兼容） |

### 画像报告生成（`profile_report.py`）

#### 报告预生成

- 画像创建/更新后异步调用 `generate_profile_report()`
- 报告内容存储到 `competitor_profiles.report_markdown` 独立列（不再仅存在 `profile_data` JSON 中）
- 来源索引存储到 `source_index_json` 独立列
- 洞察 JSON 存储到 `insights_json` 独立列

#### 洞察生成

- 调用 LLM 生成结构化洞察（评分/SWOT/定位/结论）
- **兜底机制**（v5.5.0）：LLM 失败时，基于已有维度数据自动生成最简洞察
  - 填充率 ≥70% → 评分 7
  - 填充率 >0% → 评分 4
  - 无数据 → 评分 1

#### 置信度兼容

- 来源置信度可能为字符串（"high"/"medium"/"low"）或浮点数
- 自动映射：high=0.9, medium=0.6, low=0.3
| 对比 | `comparison.py` | 多份冻结画像横向对比矩阵 |
| 审计 | `audit.py` | 审计日志写入（fire-and-forget） |
| 用户限流 | `rate_limit_user.py` | 用户级令牌桶限流（补充 IP 级限流） |
| 画像报告 | `profile_report.py` | 画像报告/洞察预生成（存入 profile_data 缓存） |
| 爬虫 | `crawler.py` | 竞品官网信息爬取核心逻辑 |

## 5.2 agent.py — 调研 Agent 编排核心

### 常量

| 常量 | 值 | 含义 |
|------|----|------|
| `MAX_QUERIES` | 8 | 每次调研最大检索关键词组数 |
| `MAX_RESULTS_PER_QUERY` | 5 | 每组最多返回条数 |
| `SNIPPET_LIMIT` | 1000 | 每个来源摘要发给 LLM 的字符上限 |
| `RAW_CONTENT_LIMIT` | 8000 | 存储到 DB 的原文上限 |
| `RECENCY_HALF_LIFE_DAYS` | 180 | 时间衰减半衰期（天） |

### 来源分级规则

| 分级 | 判定 |
|------|------|
| **official** | 域名主体归一化后与竞品/产品名匹配 |
| **media** | 命中 `MEDIA_DOMAINS` 清单（36kr/techcrunch/ifanr/sspai/theverge 等 28 个） |
| **community** | 命中 `COMMUNITY_DOMAINS` 清单（zhihu/reddit/github/v2ex/producthunt/g2 等 20 个） |
| **other** | 其余 |

分级算法：去除 `www.` 后比对产品/竞品名称 → official；否则匹配 MEDIA_DOMAINS/COMMUNITY_DOMAINS。

### 八阶段管线

```
Stage 1: Planning (_plan)
  │  LLM 产出竞品清单 + 检索关键词（每组带维度标签）
  │  关键词数量 ≤ plan.max_queries (4/8/12)
  ▼
Stage 2: Searching (_search_all)
  │  asyncio.gather 并发调用各组查询
  │  URL 去重（跨查询组）
  │  classify_source() → tier 分类
  │  复合评分 = 0.6 * Tavily_score + 0.4 * recency_weight(180天半衰期)
  ▼
Stage 3: Dedup/Confidence/Conflict (dedup.py)
  │  dedup_by_content() → URL + 标题相似度去重（阈值 0.85）
  │  estimate_confidence() → 置信度（层级权重 × 新鲜度衰减）
  │  detect_conflicts() → 冲突检测
  ▼
Stage 4: Snapshot Archive (snapshot.py)
  │  异步抓取页面存档（HTML + 纯文本 + 采集元数据）
  ▼
Stage 5: Save Sources (_save_sources)
  │  全字段入库（raw_content 截断 8000 字符，published_date 解析为 YYYY-MM-DD）
  │  **入库顺序 = 材料编号 = 前端引用角标编号**
  ▼
Stage 6: Analysis (_analyze)
  │  材料按维度分组 + 元数据注入（tier/日期/距今天数/置信度）
  │  LLM 产出维度分析（带 [n] 引用标记）
  ▼
Stage 7: Insights + Timeline (_insights / _timeline) ── 非阻塞
  │  LLM 产出结构化 JSON：5 维评分 + SWOT + 定位 + 结论
  │  LLM 提取关键事件时间线（最多 12 条）
  │  → report_data (JSON)
  ▼
Stage 8: Report (_report)
  │  LLM 生成 Markdown 报告（9 章节结构）
  │  → report_markdown
  ▼
Post-processing
  ├─ tracker 任务：generate_change_summary() → 与上一期对比
  └─ 一次性任务：send_email() → 邮件发送报告
```

### 关键算法

**复合评分**：
```python
combined_score = 0.6 * tavily_score + 0.4 * recency_weight(published_at, now, 180_days)
```

**置信度估算**（`dedup.py:estimate_confidence`）：
```
confidence = tier_weight * freshness_factor
```

| tier_weight | official=0.9, media=0.7, community=0.4, other=0.2 |
| freshness_factor | ≤30天=1.0, ≤180天=0.85, ≤365天=0.6, >365天=0.3, 无日期=0.25 |

**标题相似度去重**：
```python
SequenceMatcher(None, title_a, title_b).ratio() > 0.85 → 去重
```

**冲突检测策略**：保守策略 — 同一维度来源来自多个不同 URL → 全部标记为 `pending` 待复核。

## 5.3 graph_agent.py — 关系图谱构建

### 管线

```
Stage 1: Planning (_plan_queries)
  │  LLM 生成维度搜索查询
  │  LLM 失败 → 回退 5 个硬编码查询
  ▼
Stage 2: Collecting (_collect)
  │  并发搜索 + URL 去重
  ▼
Stage 3: Extraction (_extract)
  │  LLM 抽取 entities + relations JSON
  │  约束：≤40 entities, ≤60 relations
  │  失败条件：≤1 entity 且 0 relation → ValueError
  ▼
Stage 4: Save (_save)
  │  实体去重（normalized name）
  │  关系去重（(source_id, target_id, relation_type) 元组）
  │  置信度截断到 [0.0, 1.0]
  ▼
Stage 5: Report (_report) ── 非阻塞
     LLM 生成 Markdown 分析报告
```

### 实体/关系类型

| 实体类型 | 可选值 |
|----------|--------|
| EntityType | `company`, `product`, `org`, `person` |

| 关系类型 | 可选值 |
|----------|--------|
| RelationType | `upstream_supplier`, `downstream_customer`, `competitor`, `partner`, `investor`, `parent`, `subsidiary` |

## 5.4 llm.py — LLM 客户端

### LLMClient 类

| 方法 | 用途 |
|------|------|
| `chat(system, user, temperature)` | 单轮对话，返回纯文本 |
| `chat_messages(messages, temperature)` | 多轮对话（接受完整 messages 数组） |
| `chat_json(system, user)` | 调用 `chat()` 后自动解析 JSON（`parse_json()`） |

### JSON 解析容错

1. 去除首尾空白
2. 去除 ```json ... ``` 代码块标记
3. 提取第一个 `{` 到最后一个 `}` 之间的内容
4. `json.loads()` 解析

### 审计日志

每次 LLM 调用后异步写入 AuditLog，记录：model_name、tokens_prompt、tokens_completion、cost、IP、UA。

## 5.5 notify.py — 通知分发

### 通知渠道

| 渠道 | 实现 | 触发条件 |
|------|------|----------|
| 站内通知 | 写入 `notifications` 表 | 所有追踪完成、额度预警、配额跳过 |
| 邮件 | SMTP_SSL (port 465) 或 SMTP+STARTTLS | 追踪完成 + push_email 开启；报告邮件 |
| Webhook | httpx POST JSON | 追踪完成 + push_webhook 开启 |

### Webhook 格式

| 类型 | 平台 | 格式 |
|------|------|------|
| `wecom` | 企业微信 | `{"msgtype":"text","text":{"content":"..."}}` |
| `dingtalk` | 钉钉 | `{"msgtype":"text","text":{"content":"..."}}` |
| `feishu` | 飞书 | `{"msg_type":"text","content":{"text":"..."}}` |
| `generic` | 通用 | `{"title":"...","text":"...","link":"..."}` |

### 邮件格式

- 纯文本 fallback + HTML（Markdown 渲染后带样式）
- 附件支持（RFC 2231 编码中文文件名）
- SMTP 未配置 → demo 模式（写入 email_logs，status=demo）

## 5.6 scheduler.py

- git hash 启动时一次性缓存到 `_GIT_HASH`（`_load_git_hash()`），不每次调用 subprocess
- `initial_next_run()` 使用 UTC 基准时间
- `recover_stale_tasks()` 在启动时恢复未完成的画像提取任务

## 5.6 scheduler.py — 定时追踪调度器

### 调度逻辑

```
scheduler_loop() [每 60 秒]
  │
  ▼
_scan_once()
  │  SELECT trackers WHERE enabled=true AND next_run_at <= now
  │  FOR EACH tracker:
  │    ├─ 配额检查 → 不足：推进 next_run + 通知跳过
  │    ├─ 创建 ResearchTask
  │    ├─ 创建 ExecutionSnapshot
  │    ├─ _running.add(tracker_id)
  │    └─ asyncio.create_task(run_research(task_id))
  ▼
  （任务完成后 _running.discard(tracker_id)）
```

### 调度周期

| frequency | 间隔天数 |
|-----------|----------|
| daily | 1 |
| weekly | 7 |
| monthly | 30 |

### next_run_at 计算

- 首次：当前/下个周期的 `run_hour:00`（本地时区）
- 后续：每次运行后推进 period 天，直到 > now

## 5.7 profiles.py — 竞品画像生成

### 访问校验（v5.5.0）

- 所有画像访问通过 `check_access()` 统一校验（`system_access="admin_only"`）
- 企业隔离 + 个人资源隔离

### 生成流程

1. 加载 Competitor + ProfileTemplate（必须已冻结）
2. 搜索已完成任务中包含该竞品名称的来源（LIKE 匹配 product_name/competitors 字段）
3. 取前 20 条 Source，按 confidence DESC 排序
4. 调用 `create_profile_generation_task()` 创建异步任务（v5.5.0 重命名）
5. 后台执行 `generate_profile_from_crawl_data()`（v5.5.0 重命名）
6. 创建 CompetitorProfile（status=draft，记录 template_version）
7. 异步预生成报告 + 洞察（`generate_profile_report()` / `generate_profile_insights()`）

### 冻结流程

1. 设置 status=frozen
2. 记录 frozen_at 时间戳
3. 不可逆

## 5.8 dedup.py — 去重/置信度/冲突

### estimate_confidence

```
confidence = tier_weight × freshness_factor
```

| tier | weight | freshness ≤30d | ≤180d | ≤365d | >365d | no date |
|------|--------|---------------|-------|-------|-------|---------|
| official | 0.9 | 0.90 | 0.77 | 0.54 | 0.27 | 0.23 |
| media | 0.7 | 0.70 | 0.60 | 0.42 | 0.21 | 0.18 |
| community | 0.4 | 0.40 | 0.34 | 0.24 | 0.12 | 0.10 |
| other | 0.2 | 0.20 | 0.17 | 0.12 | 0.06 | 0.05 |

### dedup_by_content

1. **URL 精确匹配**：strip/rstrip `/` 后比较，相同 → 去重
2. **标题相似度**：同域名下，`SequenceMatcher.ratio() > 0.85` → 去重

### detect_conflicts

同一维度有来源来自多个不同 URL → 标记 `conflict_status="pending"`。

## 5.9 snapshot.py — 快照存档

### capture_snapshot(url, raw_content)

1. 若有 raw_content → 直接包装为 HTML
2. 否则 HTTP GET 目标 URL（Mozilla UA，15s 超时，跟随重定向）
3. 提取 HTML（上限 500KB）+ BeautifulSoup 纯文本
4. 读取 `last-modified` / `date` Header 作为 published_at
5. 返回快照数据字典

### save_archive(task_id, source_id, url, raw_content)

调用 `capture_snapshot()` 后创建 `SourceArchive` 记录。异常吞掉（仅日志）。

## 5.10 crawler.py — 竞品官网爬虫

### 爬取流程

1. HTTP GET 目标 URL（Chrome UA，15s 超时，跟随重定向）
2. **语言前缀检测**：从 base URL 提取语言路径（如 /cn/, /en/, /ja/），用于过滤 sitemap URL 和启发式路径
3. **多路径 sitemap 发现**：优先尝试 `/{lang}/sitemap.xml`，回退 `/sitemap.xml`
4. **命名空间容错**：使用 `{*}loc` 通配符匹配 sitemap XML 命名空间
5. **Consent overlay 移除**：regex 剥离常见 cookie/consent/GDPR/OneTrust banner 的 HTML
6. **内容提取回退链**（v5.5.0 新增）：
   - readability → 正文提取
   - 若 consent overlay → 回退完整 body 文本
   - 若 < 500 chars → 尝试 meta 标签提取
   - 若仍不足 → 尝试 jina.ai 摘要 API
7. BeautifulSoup 解析 HTML，提取结构化信息
8. 返回结构化 JSON，存储到 `crawl_tasks` 表

### v5.0.0 改进要点 (2026-08-03)

| 改进 | 原因 | 效果 |
|------|------|------|
| 语言感知 sitemap 过滤 | 多语言站点的 sitemap 包含所有语言版本 | Insta360 /cn/ 等站点正确获取对应语言页面 |
| 多路径 sitemap 发现 | 某些站点仅部署了 `/{lang}/sitemap.xml` | 覆盖更多站点 |
| XML 命名空间通配匹配 | `ET.iter()` 对带命名空间的 XML 标签名包含 URI | sitemap URL 提取不再返回空列表 |
| Consent overlay regex 剥离 | OneTrust/CCPA/GDPR banner 干扰 readability | 正文提取内容从 consent 文本切换到实际页面内容 |
| Readability 降级检测 | 某些页面 readability 只提取到 consent 层 | 内容长度和质量显著提升 |
| Chrome User-Agent | `CompAgent-Crawler/1.0` 被部分站点拦截 | 减少 bot 检测，提高成功率 |
| meta 标签回退 | readability 对 JS 渲染站点提取不足 | 补充 OpenGraph/Twitter 元数据 |
| jina.ai 回退 | 静态页面 + meta 仍不足时 | 通过 jina.ai 提取完整页面文本 |
| 内部页排除 | /h-cookie / h-login 等功能页被 sitemap 收录 | 正则过滤排除 |

## 5.12 deps.py — 统一权限与访问控制

### 新增工具函数（v5.5.0）

| 函数/类 | 用途 |
|---------|------|
| `is_admin(user)` | 统一管理员判断（纯函数，任何上下文可用） |
| `check_access(org_id, user_id, user, ...)` | 统一资源访问校验，支持三种模式：`admin_only` / `owner_or_admin` / `any_authenticated` |
| `AccessDenied` | 403 异常基类 |
| `ResourceNotFound` | 403 伪装 404（安全最佳实践） |

### 访问校验逻辑

```
check_access(resource_org_id, resource_user_id, user):
  if resource_org_id == "":
    ├─ admin_only  →  仅 admin 可访问
    ├─ owner_or_admin → 企业用户需 admin，个人用户需 resource_user_id == user.id
    └─ any_authenticated → 所有登录用户可访问
  else:
    ├─ resource_org_id != user.org_id → 拒绝（跨企业）
    └─ 无企业用户 → 需 resource_user_id == user.id（个人资源隔离）
```

### 各模块迁移状态

- `profiles.py`：已迁移到 `check_access()`
- 其他模块逐步迁移中

## 5.13 llm.py — LLM 客户端

### 超时与重试（v5.5.0 新增）

- LLM 调用加入 `asyncio.wait_for(timeout=settings.llm_timeout_seconds)`
- 超时后指数退避重试（2s → 4s → 失败）
- 最多 3 次尝试

### log_audit()

同步写入审计日志，在独立的 `SessionLocal()` 中执行，不阻塞调用方的 db session。

记录内容：user_id / org_id / action / resource_type / resource_id / input / result / status / error / model_name / tokens_prompt / tokens_completion / cost / ip / user_agent / created_at
