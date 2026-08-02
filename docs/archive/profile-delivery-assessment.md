# 画像板块 — 交付能力评估

> 基于完整代码追踪，逐路径验证实际可运行性
> 2026-08-02

---

## 评估方法

对每个功能点，追踪从**前端 UI → API endpoint → Service 逻辑 → DB 写入**的完整调用链，
验证是否存在阻断性 bug、静默数据丢失、或依赖缺失导致功能不可用。

---

## 一、功能清单与逐项判定

### 1. 模板创建

| 子项 | 判定 | 说明 |
|------|------|------|
| 前端表单提交 | 通过 | `ProfileTemplatesPage.tsx` → `createProfileTemplate()` → `POST /api/profiles/templates` |
| API 接收校验 | 通过 | `ProfileTemplateIn` schema 校验 name/dimensions |
| DB 写入 | 通过 | `ProfileTemplate` ORM，JSON 序列化 dimensions |
| 返回前端 | 通过 | `ProfileTemplateOut`，dimensions 自动解析为 list |

**可正常交付。** 唯一小问题：创建时 `version` 默认 1，首次创建没问题；更新时 `version += 1`，但如果快速连续更新两次，无乐观锁保护，version 可能不一致（低风险）。

---

### 2. 模板冻结

| 子项 | 判定 | 说明 |
|------|------|------|
| 仅管理员可冻结 | 通过 | `_is_admin(user)` 检查 |
| 不可重复冻结 | 通过 | `if t.frozen_at is not None: 400` |
| 冻结后不可修改 | 通过 | `update_template` 检查 `frozen_at` |
| 前端下拉框过滤 | 通过 | `templates.filter(t => t.frozen_at)` |

**可正常交付。**

---

### 3. 模板编辑（含版本控制）

| 子项 | 判定 | 说明 |
|------|------|------|
| 更新维度/名称 | 通过 | `PATCH /templates/{tid}` |
| version 自增 | 通过 | `t.version += 1` |
| 系统级模板任何用户可编辑 | 问题 | `org_id==""` 的模板，`(t.org_id != user.org_id and t.org_id != "")` 为 false，任何用户都可修改 |

**功能正常，但存在安全缺陷（见第四节问题 #5）。**

---

### 4. 同步画像生成（ResearchTask 来源优先）

追踪完整调用链：

```
Frontend: handleGenerate()
  → POST /api/profiles/generate
    → generate_profile(competitor_id, template_id, user_id)
```

**内部流程：**

| 步骤 | 判定 | 说明 |
|------|------|------|
| 查询竞品和模板 | 通过 | `db.get(Competitor)` + `db.get(ProfileTemplate)` |
| 模板冻结校验 | 通过 | `if template.frozen_at is None: raise ValueError` |
| 查询 ResearchTask | 通过 | LIKE 匹配 name/competitors，只取 status=completed |
| 查询 Source | 通过 | `Source.task_id.in_(task_ids)`，按 confidence 降序，取 20 条 |
| LLM 构造 Prompt | 通过 | 包含维度定义和来源材料 |
| LLM 调用 | 通过 | `LLMClient.chat_json()`，3 次重试 |
| JSON 解析 | 通过 | `parse_json()` 容错代码块包裹 |
| DB 落库 | 通过 | `CompetitorProfile(status="draft")` |
| source_refs 保存 | 通过 | 前 10 条来源的 url/title/snippet 快照 |

**判定：可正常交付。** 前提条件：竞品必须有匹配的 completed ResearchTask + Source。如果没有来源，自动回退到 Level 2。

---

### 5. 回退链：product_intel（Level 2）

```
if not sources:
    from app.services.product_intel import generate_product_intel
    return await generate_product_intel(...)
```

| 子项 | 判定 | 说明 |
|------|------|------|
| 动态导入 | 通过 | `product_intel.py` 文件存在，路径正确 |
| Layer 1 搜索 | 通过 | `SearchClient` → Tavily，3-5 个查询 |
| Layer 2 定向采集 | 通过 | httpx + readability，存入 CompetitorPage |
| SQLite 锁重试 | 通过 | `_db_write_retry` 5 次 × 3s |
| Layer 3 LLM 双次调用 | 通过 | broad（广度）+ deep（深度） |
| 结果合并 | 通过 | `_merge_results()` 合并两层输出 |
| DB 落库 | 通过 | `CompetitorProfile(status="draft")` |

**判定：可正常交付。** 前提条件：需要配置 `TAVILY_API_KEY`。未配置时 `SearchClient` 初始化不报错，但首次 `search()` 调用会抛 Tavily 认证错误，被 `return_exceptions=True` 捕获后 `all_results` 为空，后续流程继续到 Layer 3 但 material 为空，LLM 输出将全为"信息不足"。**无 TAVILY 时功能严重降级但不会崩溃。**

---

### 6. 回退链：crawl 页面提取（Level 3）

```
if product_intel also fails:
    from app.services.profile_extractor import extract_profile_from_pages
    return await extract_profile_from_pages(...)
```

| 子项 | 判定 | 说明 |
|------|------|------|
| 查询 CompetitorPage | 通过 | 只取 `access_status="success"` 的页面 |
| 无爬取页面时错误 | 通过 | `raise ValueError("该竞品暂无爬取页面")` |
| Stage 1 页面摘要化 | 通过 | asyncio.Semaphore(5) 并发 |
| Stage 2 维度提取 | 通过 | asyncio.Semaphore(3) 并发，取最相关 3 页 |
| Stage 3 聚合 | 通过 | 冲突检测 + 置信度统计 |
| 进度回调 | 通过 | `on_progress` 参数透传到前端 |
| DB 落库 | 通过 | `CompetitorProfile(status="draft")` |

**判定：可正常交付。** 前提条件：竞品必须先执行爬取（crawl），有 `access_status=success` 的页面。

---

### 7. 异步画像生成（后台任务模式）

| 子项 | 判定 | 说明 |
|------|------|------|
| 创建任务 | 通过 | `create_extract_task()` 生成 UUID，写入内存 + DB |
| 异步启动 | 通过 | `asyncio.create_task(_run_extract_task)` |
| 202 响应 | 通过 | 立即返回 `{task_id, status: "running"}` |
| 前端轮询 | 通过 | `setInterval` 每 2s 调用 `GET /generate-from-crawl/{task_id}` |
| 状态查询（内存优先） | 通过 | `get_extract_task()` 先查 `_extract_tasks` dict |
| 状态查询（DB 回退） | 通过 | 内存未命中则从 DB 恢复（支持进程重启） |
| 启动时恢复 | 通过 | `main.py:58` 调用 `recover_stale_tasks()` |
| 进度持久化 | 通过 | `_persist_task()` 每次 on_progress 都写 DB |

**判定：可正常交付，但有并发安全缺陷（见第四节问题 #6）。**

---

### 8. 冻结画像

| 子项 | 判定 | 说明 |
|------|------|------|
| 仅管理员可冻结 | 通过 | `_is_admin(user)` |
| 不可重复冻结 | 通过 | `if profile.status == "frozen": raise ValueError` |
| 状态变为 frozen | 通过 | `profile.status = "frozen"` |

**判定：可正常交付。**

---

### 9. 横向对比

| 子项 | 判定 | 说明 |
|------|------|------|
| 模板已冻结校验 | 通过 | `template.frozen_at is None: raise` |
| 至少 2 份冻结画像 | 通过 | `if len(profiles) < 2: raise` |
| 矩阵构建 | 通过 | 逐维度取 `fields[0]` 构建 |
| 前端表格渲染 | 通过 | 标准 HTML table |

**判定：功能可用，但对比粒度粗（每个维度只取第一个字段）。** 对于多字段模板（如"产品概况"下有名称/类别/价格/核心卖点 4 个字段），对比矩阵只显示"名称"这一个字段。

---

### 10. 前端页面与路由

| 页面 | 路由 | 判定 |
|------|------|------|
| 画像列表 + 生成面板 | `/app/profiles` | 通过 |
| 画像详情 | `/app/profiles/:id` | 通过 |
| 画像模板管理 | `/app/profiles/templates` | 通过 |
| 横向对比 | `/app/profiles/compare` | 通过 |
| 后台任务监控 | `/app/profiles/tasks` | 通过 |
| 侧边栏导航 | AppLayout | 通过 |

**判定：全部路由已注册，前端页面完整。**

---

### 11. 种子数据

| 数据 | 判定 |
|------|------|
| 3 套系统级模板 | 通过 — "标准竞品画像"、"深度技术画像"、"简洁画像" |
| 5 个已完成 ResearchTask | 通过 — 小米/大疆/影石/华为/OPPO |
| 含来源数据 | 通过 |

**判定：首次启动后无需手动创建模板即可体验完整流程。**

---

## 二、全链路可用性总结

### 最简可用路径（用户零配置即可体验）

```
1. 启动 → seed_data 自动创建 3 套模板 + 5 个调研任务
2. 用户登录 → 进入「竞品画像」→ 选择「标准竞品画像」模板
3. 选择竞品（如小米）→ 点击「生成画像」
4. 后端路径：ResearchTask 有 completed 任务 → 查到 Source → LLM 生成 → 落库
5. 用户看到画像卡片 → 点击查看详情 → 管理员冻结 → 进入对比
```

**这条路径完全畅通，零阻断。**

### 需要额外配置的路径

| 路径 | 需要配置 | 不配置的后果 |
|------|----------|-------------|
| Level 1 (ResearchTask) | 无需额外配置 | 已有种子数据 |
| Level 2 (product_intel) | `TAVILY_API_KEY` | 搜索降级，材料为空，画像全为"信息不足" |
| Level 3 (crawl) | 先执行爬取 | 无爬取页面时直接报错 |
| 所有 LLM 调用 | `LLM_API_KEY` + `LLM_BASE_URL` | 所有画像生成失败（启动时有 warning） |

---

## 三、交付判定

### 核心功能（可交付）

| 功能 | 判定 | 说明 |
|------|:----:|------|
| 模板 CRUD + 冻结 + 版本 | **交付** | 完整，数据流畅通 |
| 同步画像生成（ResearchTask 来源） | **交付** | 种子数据保证可用 |
| 异步画像生成（爬取页面） | **交付** | 后台任务 + 状态持久化完整 |
| 画像查看 + 冻结 | **交付** | 详情页功能完整 |
| 横向对比 | **交付** | 矩阵可用，粒度较粗 |
| 后台任务监控 | **交付** | 3s 轮询，状态实时 |

### 非阻断性问题（可交付，建议后续修复）

| 问题 | 影响 | 优先级 |
|------|------|--------|
| `generation_source` 未持久化，刷新后丢失 | 前端无法显示"基于调研/基于爬取"标签 | 低 |
| 系统级模板任何用户可编辑 | 非预期行为，但种子数据仅管理员可见 | 低 |
| 对比矩阵每个维度只取第一个字段 | 多字段模板对比粒度不足 | 中 |
| `ProfileDetailPage` 加载全量列表后前端查找 | 性能问题，数据量小时无感 | 低 |
| `reviewed` 状态无 UI 入口 | 状态流转不完整 | 低 |
| `ProfileExtractTask` 无复合索引 | 大量任务时查询慢 | 低 |

### 阻断性问题（交付前必须修复）

| 问题 | 影响 | 优先级 |
|------|------|--------|
| **#1** 画像生成端点无额度校验 | 不受配额限制，可无限消耗 LLM | **高** |
| **#2** `_extract_tasks` 内存缓存无锁保护 | 高并发下竞态条件，任务状态可能错乱 | **高** |
| **#3** `competitor_profiles` 无外键约束 | 删除竞品/模板后孤儿画像 | **中** |
| **#4** 同步生成 `/generate` 无超时保护 | 大模型调用可能阻塞 FastAPI worker 数十秒 | **中** |

---

## 四、结论

### 是否达到交付标准？

**达到，但有 4 个条件：**

1. **必须修复 #1（额度校验）** — 这是生产环境的基本要求，否则无法控制成本
2. **必须修复 #2（内存缓存锁）** — 并发场景下数据一致性风险
3. **建议修复 #4（同步超时）** — 用户体验问题，`/generate` 阻塞期间 server 不响应其他请求
4. **建议修复 #3（外键约束）** — 数据完整性，但短期内可通过应用层校验规避

### 非阻断问题的处理策略

| 问题 | 建议处理 |
|------|----------|
| `generation_source` 未持久化 | 在 `CompetitorProfile` 表加列，或在 API 返回时从 `source_refs` 推断 |
| 系统级模板编辑权限 | 更新 endpoint 增加 admin 检查 |
| 对比矩阵粒度 | 下个迭代扩展，不影响当前交付 |
| `reviewed` 状态 | 下个迭代补充状态流转 UI |

---

## 五、依赖就绪度

| 依赖 | 配置要求 | 影响 |
|------|----------|------|
| LLM（DeepSeek/OpenAI 兼容） | `LLM_API_KEY` + `LLM_BASE_URL` | **必需** — 所有画像生成依赖 LLM |
| Tavily 搜索 | `TAVILY_API_KEY` | Level 2 必需，Level 1 不需要 |
| SMTP | `SMTP_HOST` 等 | 画像板块不涉及邮件 |
| SQLite | 默认 `research.db` | 无需额外配置 |

**画像板块的最小运行依赖只有 LLM，且 Level 1（ResearchTask 来源）路径在种子数据存在时不需要任何外部 API。**
