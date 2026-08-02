# FleetView 画像板块 — 改进策略、技术评审与实现计划

> 2026-08-02 ｜ 基于 agent-v5 分支完整代码审查

---

# 第一部分：改进策略

## 1.1 改进原则

所有改进遵循三个原则：

1. **不破坏现有功能** — 每个改动保持向后兼容，seed_data 和已有 API 行为不变
2. **最小必要改动** — 只改问题点，不重构未出问题的部分
3. **可逐条合并** — 每个改进是独立的 commit，可单独 review 和回滚

## 1.2 阻断项改进（必须修复）

### 改进 #1：画像生成端点加额度校验

**问题**：`POST /generate` 和 `POST /generate-from-crawl` 没有调用 `check_quota_or_403()`，消耗 LLM token 但不计入用户配额。

**方案**：
```
在 api/profiles.py 的 generate_profile_api 和 generate_from_crawl 中，
注入 get_db，调用 check_quota_or_403(db, user)。
```

**改动位置**：
- `backend/app/api/profiles.py:108` — `generate_profile_api` 函数签名加 `db: Session = Depends(get_db)`
- `backend/app/api/profiles.py:116` — `generate_from_crawl` 已有 `db`，直接加 `check_quota_or_403(db, user)`

**风险**：低。仅加一道校验，不影响成功路径。

---

### 改进 #2：内存缓存加锁

**问题**：`_extract_tasks` 是普通 dict，`get_extract_task` 和 `create_extract_task` 并发访问时存在竞态。

**方案**：
```
在 profile_extractor.py 中引入 asyncio.Lock，
所有 _extract_tasks 读写操作都通过 with _lock: 保护。
```

**改动位置**：
- `backend/app/services/profile_extractor.py` — 加 `_extract_lock = asyncio.Lock()`
- `get_extract_task` 中的 dict 读写加锁
- `create_extract_task` 中的 dict 写入加锁
- `_cleanup_extract_cache` 加锁
- `recover_stale_tasks` 中的 dict 写入加锁

**风险**：低。仅序列化内存操作，DB 写入逻辑不变。

---

### 改进 #3：同步生成加超时保护

**问题**：`POST /generate` 是同步 endpoint，LLM 调用可能阻塞 FastAPI worker 30-60 秒，期间其他请求无法响应。

**方案 A（推荐）**：将 `/generate` 改为异步任务模式，与 `/generate-from-crawl` 一致，返回 `{task_id}` 让前端轮询。

**方案 B（最小改动）**：在 endpoint 上加 `asyncio.wait_for(generate_profile(...), timeout=120)`，超时返回 504。

**推荐方案 A**，理由：与现有异步模式统一，用户体验更好（前端显示进度）。改动：
- `backend/app/api/profiles.py:107-110` — 改为创建 ExtractTask + 202 响应
- `backend/app/api/profiles.py:132` — 复用已有的 `GET /generate-from-crawl/{task_id}` 查询状态

**风险**：中。需要前端调整同步生成的调用方式，但从 `POST /generate` 改为 `POST /generate-from-crawl` + 轮询只改动两行前端代码。

---

### 改进 #4：外键约束 + 级联策略

**问题**：`competitor_profiles.competitor_id` 和 `template_id` 无外键约束。

**方案**：
```
在 models.py 的 CompetitorProfile 表中加 ForeignKey，
但 SQLite 的 ALTER TABLE 不支持 ADD CONSTRAINT，
需要通过 migrate_columns 或在 main.py 的 migrate 中处理。
```

由于 SQLite 限制，实际做法：
- 在 `migrate_columns` 中不做（SQLite 无法加 FK）
- 在应用层加保护：删除 Competitor 或 Template 前检查是否有关联的 Profile
- 未来迁移到 PostgreSQL 时在 migration 中加 FK

**短期方案（应用层保护）**：
- `backend/app/api/competitors.py` — 删除竞品前检查 `CompetitorProfile`
- `backend/app/api/profiles.py` — 删除模板前检查 `CompetitorProfile`

**风险**：低。纯校验逻辑，不影响正常流程。

---

## 1.3 非阻断项改进（建议修复）

### 改进 #5：持久化 `generation_source`

**问题**：`generation_source`（research/product_intel/crawl）仅在 API 响应的 dict 中返回，未写入 DB。

**方案**：在 `CompetitorProfile` 表加 `generation_source` 列。

**改动**：
- `backend/app/db/models.py` — 加 `generation_source: Mapped[str] = mapped_column(String(20), default="")`
- `backend/app/main.py` — `migrate_columns` 中加 `"generation_source": "VARCHAR(20) NOT NULL DEFAULT ''"`
- `backend/app/services/profiles.py` — 写入时赋值
- `backend/app/services/product_intel.py` — 写入时赋值
- `backend/app/services/profile_extractor.py` — 写入时赋值
- `backend/app/schemas/profiles.py` — `CompetitorProfileOut` 加字段
- `frontend/src/api/types.ts` — `CompetitorProfile` 接口加字段

**风险**：低。纯新增字段，默认值兼容。

---

### 改进 #6：系统级模板编辑权限收紧

**问题**：`org_id=""` 的系统级模板，任何用户都可修改。

**方案**：
```
在 update_template 中，如果 t.org_id == "" 且 user.role != "admin"，拒绝修改。
```

**改动位置**：
- `backend/app/api/profiles.py:64` — `update_template` 开头加 admin 检查

**风险**：低。仅收紧权限，不影响正常企业模板操作。

---

### 改进 #7：ProfileDetailPage 直接获取单条画像

**问题**：详情页调用 `listProfiles()` 获取全量列表后前端 `find()` 定位。

**方案**：
```
改为直接调用 GET /api/profiles/{id}。
```

**改动位置**：
- `frontend/src/pages/app/ProfileDetailPage.tsx:27-28` — 改为 `getProfile(id)`

**风险**：极低。减少数据传输，行为不变。

---

### 改进 #8：对比矩阵支持多字段

**问题**：每个维度只取 `fields[0]`，其余字段被忽略。

**方案**：
```
comparison.py 的 generate_comparison 中，
对每个维度展开所有字段，构建多行矩阵。
```

**改动位置**：
- `backend/app/services/comparison.py:33-45` — 遍历 fields 而非只取第一个
- `frontend/src/pages/app/ComparisonPage.tsx` — 表格行数增加，渲染不变

**风险**：低。数据量增加但前端 table 渲染天然支持多行。

---

# 第二部分：技术评审

## 2.1 架构评审

### 设计模式评估

| 模式 | 实现 | 评价 |
|------|------|------|
| 三级数据源回退 | research → product_intel → crawl | 优秀 — 最大化数据利用率 |
| 三阶段渐进 LLM | 摘要 → 维度提取 → 聚合 | 优秀 — 控制上下文长度 |
| 内存+DB 双写持久化 | _extract_tasks + ProfileExtractTask | 良好 — 进程重启可恢复 |
| asyncio.Semaphore 限流 | Stage 1: 5路, Stage 2: 3路 | 良好 — 避免 LLM 限流 |
| SQLite 锁重试 | product_intel 有，profile_extractor 无 | 不一致 — 需统一 |

### 数据流一致性

```
写入路径（正常）：
  API → Service → LLM → JSON parse → DB commit → 返回
                                     ↑
                              此处有 field_validator
                              做 JSON 字符串→对象解析
```

数据流一致，JSON 序列化/反序列化在两端都有兜底。

### 并发安全

| 组件 | 线程安全 | 说明 |
|------|:--------:|------|
| SessionLocal() | 通过 | 每次新建 session |
| _extract_tasks dict | **否** | 无锁保护（改进 #2） |
| _running set (scheduler) | **否** | 无锁保护（同 module-level dict） |
| LLMClient | 通过 | 每次新建实例 |

## 2.2 安全性评审

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 认证 | 通过 | 所有 endpoint 有 `get_current_user` |
| 授权（管理员操作） | 通过 | 冻结操作有 `_is_admin` |
| 数据隔离 | 通过 | `(org_id == user.org_id) \| (org_id == "")` |
| SQL 注入 | 通过 | SQLAlchemy ORM，无原始 SQL |
| LLM prompt 注入 | 有防护 | system prompt 有"不得编造"约束，但无严格的 prompt 隔离 |
| 额度控制 | **缺失** | 画像生成无配额校验（改进 #1） |

## 2.3 性能评审

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 分页 | 部分 | profiles 和 templates 有分页，但 ProfileDetailPage 加载全量 |
| 索引 | 基本 | 单列索引充足，缺少 `(org_id, created_at)` 复合索引 |
| N+1 查询 | 有 | `_with_extras_batch` 用 window function 解决了 tracker 的 N+1 |
| LLM 并发 | 良好 | Semaphore 控制并发度 |
| 缓存 | 基础 | _extract_tasks 内存缓存 + DB 持久化 |

## 2.4 测试覆盖评估

**画像板块当前无任何单元测试或集成测试。**

| 应覆盖的场景 | 优先级 |
|-------------|--------|
| 模板 CRUD + 冻结状态机 | 高 |
| 画像生成三级回退链 | 高 |
| 三阶段 LLM 提取（mock LLM） | 高 |
| 后台任务创建 + 状态轮询 + 恢复 | 高 |
| 横向对比矩阵构建 | 中 |
| 权限检查（admin-only 操作） | 中 |
| JSON 解析兜底（parse_json） | 低 |

---

# 第三部分：追踪板块 vs 画像板块 — 重叠与结合

## 3.1 两个模块的产出物对比

| 维度 | 追踪（Tracker + Research） | 画像（Profile） |
|------|---------------------------|-----------------|
| **触发方式** | 定时自动 / 手动 | 用户手动选择竞品+模板 |
| **输出格式** | Markdown 报告 + 结构化洞察 JSON | 模板驱动的结构化 JSON |
| **数据粒度** | 多竞品对比报告（宏观） | 单竞品结构化快照（微观） |
| **结构化维度** | 固定 5 维评分（功能/定价/口碑/声量/潜力）+ SWOT | 用户自定义维度+字段 |
| **来源机制** | Tavily 实时搜索 + 爬取 | ResearchTask 来源 / 爬取页面 |
| **时间维度** | 每期运行，可对比变化趋势 | 单次快照，可冻结锁定 |
| **自动化程度** | 全自动（调度器触发） | 半自动（用户选择参数） |
| **输出消费** | 阅读报告 + 查看评分图表 | 查看结构化字段 + 横向对比 |

## 3.2 功能重叠分析

### 不重叠的部分（各自独立价值）

| 功能 | 追踪独有 | 画像独有 |
|------|---------|---------|
| 定时自动运行 | 调度器驱动，按频率自动执行 | 无 |
| Markdown 报告 | 5 阶段 LLM 生成完整报告 | 无 |
| 评分可视化 | 5 维评分 + 趋势图 | 无 |
| SWOT 分析 | LLM 生成 SWOT | 无 |
| 变更摘要 | 与上期对比的 change_summary | 无 |
| 自定义模板 | 无 | 用户定义任意维度和字段 |
| 冻结锁定 | 无 | 冻结后不可修改，确保一致性 |
| 多模板管理 | 无 | 一套竞品可按不同模板生成多个画像 |

### 重叠的部分（需要去重或整合）

| 重叠点 | 追踪侧 | 画像侧 | 建议 |
|--------|--------|--------|------|
| 数据来源 | ResearchTask + Source | ResearchTask + Source（Level 1 回退） | **共用 Source 表，无需重复检索** |
| LLM 生成结构化数据 | `report_data`（5 维评分 JSON） | `profile_data`（自定义维度 JSON） | **画像可从 report_data 生成** |
| 竞品信息 | `competitors` 字段（名称列表） | `Competitor` 表（结构化竞品注册） | **Tracker 应关联 Competitor 表** |
| 横向对比 | 报告中的竞品对比表格 | 冻结画像的对比矩阵 | **各有用途，报告是叙述式，画像矩阵是结构化** |

## 3.3 合理结合点

### 结合点 A：追踪运行后自动生成画像

**场景**：Tracker 每期运行完成后，自动基于 report_data 生成该期竞品的画像。

**价值**：
- 用户定义一套画像模板（如"标准竞品画像"），追踪每次运行后自动填充
- 省去手动生成画像的步骤
- 画像随追踪自动更新，反映最新状态

**实现方式**：
```
Tracker 运行完成（agent.py 第 548 行之后的 digest 步骤之后）：
  for competitor in competitors:
      检查是否存在该竞品+模板的 CompetitorProfile
      如果不存在或上期已变化：
          从 report_data 中提取对应竞品的数据
          填充到模板定义的结构中
          创建/更新 CompetitorProfile
```

**注意**：report_data 的结构是固定的 5 维评分，与用户自定义模板的维度不一定对齐。需要做字段映射或 LLM 转换。

---

### 结合点 B：画像作为追踪的数据源

**场景**：追踪的调研可以使用已冻结的画像作为背景信息输入 LLM。

**价值**：
- 画像包含竞品的基础信息（产品概况、企业信息等）
- 追踪搜索时把这些信息作为 context，减少 LLM "信息不足"
- 特别是对于已有的竞品，无需每次重新搜索基础信息

**实现方式**：
```
run_research() 的 _plan 阶段之前：
  查询该产品相关的已冻结画像
  将画像摘要注入 planning prompt 作为背景
```

---

### 结合点 C：共用来源数据

**场景**：追踪产生的 Source 记录，画像提取直接复用。

**现状**：画像 Level 1 回退已经实现了这一点（查 ResearchTask → Source）。

**改进**：追踪产生的 `Source` 带有 `confidence`、`conflict_status` 等元数据，画像提取应利用这些已计算好的元数据，而非重新评估。

---

### 结合点 D：追踪变更摘要触发画像刷新

**场景**：当追踪检测到竞品有重大变化（`change_summary` 非空），自动提示用户更新画像。

**价值**：
- 画像通常是静态快照，但竞品信息会变
- 追踪是持续监测的，能发现变化
- 两者结合实现"变化感知"的画像管理

**实现方式**：
```
Tracker 完成运行后，检查 change_summary 是否包含"重大变更"标记
  如果包含：
      查找对应竞品的冻结画像
      创建"画像待更新"通知
      或在画像列表加"有更新"标记
```

---

## 3.4 不合并的理由

两个模块**不应合并为一个**，理由：

1. **触发模型不同**：追踪是时间驱动的自动执行，画像是人机交互的手动/半自动执行
2. **输出消费者不同**：追踪产出阅读型报告（给人看），画像产出结构化数据（给系统/对比用）
3. **生命周期不同**：追踪持续运行多期，画像是单次快照
4. **用户意图不同**：追踪关注"变化"，画像关注"当前状态"

**正确的关系是：追踪是画像的上游数据源之一，而非替代。**

---

# 第四部分：技术实现计划

## 4.1 总体时间线

```
Week 1: 阻断项修复（改进 #1-4）
Week 2: 非阻断项修复（改进 #5-8）+ 单元测试骨架
Week 3: 追踪-画像集成（结合点 A + C）
Week 4: 测试 + 文档 + 灰度验证
```

## 4.2 Sprint 1：阻断项修复（Week 1）

### Task 1.1：画像生成加额度校验

**文件**：`backend/app/api/profiles.py`
```
改动：
  1. generate_profile_api: 加 db 参数 + check_quota_or_403
  2. generate_from_crawl: 加 check_quota_or_403（已有 db）
```

**预估工作量**：30 分钟

---

### Task 1.2：内存缓存加锁

**文件**：`backend/app/services/profile_extractor.py`
```
改动：
  1. 加 _extract_lock = asyncio.Lock()
  2. get_extract_task 中 dict 读写加 with _extract_lock:
  3. create_extract_task 中 dict 写入加锁
  4. _cleanup_extract_cache 加锁
  5. recover_stale_tasks 中 dict 写入加锁
```

**预估工作量**：1 小时

---

### Task 1.3：同步生成改为异步任务模式

**文件**：
```
backend/app/api/profiles.py  — 改造 endpoint
backend/app/frontend/src/pages/app/ProfilesPage.tsx — 前端改为轮询
```

**改动**：
```
后端：
  - 移除 generate_profile_api（同步 endpoint）
  - generate_from_crawl 同时处理"已有爬取页面"和"无爬取页面"场景
  - 统一通过 task_id + 轮询获取结果

前端：
  - handleGenerate 改为调用 generateProfileFromCrawl
  - 复用现有的轮询逻辑（已有 genPollTimer）
```

**预估工作量**：2 小时

---

### Task 1.4：应用层保护（删除前检查）

**文件**：
```
backend/app/api/competitors.py — 删除竞品前检查关联画像
backend/app/api/profiles.py — 删除模板前检查关联画像
```

**改动**：
```python
# 删除竞品前
count = db.query(CompetitorProfile).filter(CompetitorProfile.competitor_id == competitor.id).count()
if count > 0:
    raise HTTPException(400, f"该竞品有 {count} 个关联画像，请先删除")

# 删除模板前
count = db.query(CompetitorProfile).filter(CompetitorProfile.template_id == template.id).count()
if count > 0:
    raise HTTPException(400, f"该模板有 {count} 个关联画像，请先删除")
```

**预估工作量**：1 小时

---

## 4.3 Sprint 2：非阻断项修复 + 测试（Week 2）

### Task 2.1：持久化 generation_source

**文件**：
```
backend/app/db/models.py           — 加列
backend/app/main.py                 — migrate_columns 加列
backend/app/services/profiles.py    — 写入时赋值
backend/app/services/product_intel.py — 写入时赋值
backend/app/services/profile_extractor.py — 写入时赋值
backend/app/schemas/profiles.py     — Schema 加字段
frontend/src/api/types.ts           — TypeScript 接口加字段
```

**预估工作量**：2 小时

---

### Task 2.2：收紧系统级模板编辑权限

**文件**：`backend/app/api/profiles.py`

**改动**：
```python
@router.patch("/templates/{tid}", ...)
def update_template(tid, payload, user, db):
    t = db.get(ProfileTemplate, tid)
    if not t: ...
    if t.org_id == "" and user.role != "admin":
        raise HTTPException(403, "系统级模板仅管理员可修改")
    if t.frozen_at is not None: ...
```

**预估工作量**：30 分钟

---

### Task 2.3：ProfileDetailPage 直接用 GET /{id}

**文件**：`frontend/src/pages/app/ProfileDetailPage.tsx`

**改动**：
```typescript
// 替换
const [allProfiles] = await listProfiles()
const p = allProfiles.find(x => x.id === id)

// 改为
const p = await getProfile(id)
```

**预估工作量**：20 分钟

---

### Task 2.4：对比矩阵支持多字段

**文件**：
```
backend/app/services/comparison.py  — 矩阵构建逻辑
backend/app/schemas/profiles.py     — ComparisonMatrixRow 可能需要调整
```

**改动**：
```python
# 当前：每个维度只取第一个字段
for dim in dimensions:
    field_key = fields[0]["key"]
    row = {"dimension": dim["label"], "values": {...}}

# 改为：每个字段一行
for dim in dimensions:
    for field in dim.get("fields", []):
        row = {"dimension": f"{dim['label']} · {field['label']}", "values": {...}}
```

**预估工作量**：1 小时

---

### Task 2.5：单元测试骨架

**文件**：新建 `backend/tests/`

**覆盖范围**：
```
tests/
  test_profiles_api.py        — 模板 CRUD、画像生成、冻结
  test_profile_extractor.py   — Stage 1/2/3 逻辑（mock LLM）
  test_comparison.py          — 对比矩阵构建
  test_llm.py                 — parse_json 容错
  test_scheduler.py           — next_run 计算
```

**预估工作量**：4 小时

---

## 4.4 Sprint 3：追踪-画像集成（Week 3）

### Task 3.1：追踪运行后自动生成画像（结合点 A）

**触发位置**：`backend/app/services/agent.py` 第 548 行（tracker_id 分支）

**逻辑**：
```python
if task.tracker_id:
    # 变更摘要（已有）
    await generate_change_summary(llm, task_id)
    
    # 新增：自动生成画像
    await auto_generate_profiles_from_tracker(task_id)
```

**auto_generate_profiles_from_tracker 的实现**：
```
1. 查询该 Tracker 关联的 ProfileTemplate（通过 Tracker 的 competitors 匹配）
   — 或：Tracker 配置中增加 template_ids 字段，明确指定用哪些模板生成画像
   
2. 对每个 (competitor, template) 组合：
   a. 从 report_data 中提取该竞品的数据
   b. 如果 report_data 结构与模板维度对齐 → 直接填充
   c. 如果不齐 → 调用 LLM 做字段映射转换
   d. 检查是否已存在画像 → 不存在则创建，存在则比较变化
   
3. 画像状态设为 draft（不自动冻结），用户审核后手动冻结
```

**新增 DB 字段**：
```python
# Tracker 表加字段
auto_profile_template_ids: Mapped[str] = mapped_column(Text, default="")
# JSON: ["template_id_1", "template_id_2"] — 留空表示不自动生成画像
```

**预估工作量**：6 小时

---

### Task 3.2：画像引用追踪来源（结合点 C 增强）

**场景**：画像详情页展示"该竞品最近的追踪动态"。

**实现**：
```python
# ProfileDetailPage 加载画像后，额外查询：
#   ResearchTask 中 product_name/competitors 匹配该竞品
#   且 status=completed 的最新 3 条任务
#   展示任务标题、时间、变更摘要
```

**文件**：
```
backend/app/api/profiles.py  — 加 /{pid}/related-tasks endpoint
frontend/src/pages/app/ProfileDetailPage.tsx — 展示相关追踪
```

**预估工作量**：3 小时

---

### Task 3.3：画像变更通知（结合点 D）

**场景**：追踪检测到竞品重大变化 → 通知用户更新画像。

**实现**：
```python
# agent.py 的 change_summary 生成后：
#   检查 change_summary 中是否有"重大变更"标记
#   如果有，查询该竞品的冻结画像
#   创建 Notification：「竞品 XXX 有重大变化，建议更新画像」
```

**预估工作量**：2 小时

---

## 4.5 Sprint 4：测试 + 文档 + 验证（Week 4）

### Task 4.1：端到端测试

- 启动服务 → seed_data → 登录 → 创建模板 → 生成画像 → 冻结 → 对比
- 异步路径：启动后台任务 → 轮询 → 完成 → 查看结果

### Task 4.2：文档更新

- `README.md` — 更新画像板块使用说明
- `docs/profile-technical-report.md` — 已有
- `docs/profile-delivery-assessment.md` — 已有
- 新增 API 文档（自动从 FastAPI /docs 生成）

### Task 4.3：灰度验证

- 内部使用 1 周，观察 LLM 调用成功率、任务恢复、并发场景

---

## 4.6 实施优先级矩阵

```
                    高影响
                      │
        改进 #5        │    改进 #1（额度）
  (持久化source)       │    改进 #3（异步化）
                      │
  ────────────────────┼──────────────────── 高优先级
                      │
    改进 #6（权限）    │    改进 #2（锁）
    改进 #7（详情页）  │    改进 #4（外键）
                      │
    改进 #8（对比矩阵）│    追踪-画像集成
                      │
                    低影响
```

**高优先级（必须做）**：#1 额度校验、#2 锁、#3 异步化
**中优先级（建议做）**：#4 外键保护、#5 持久化 source、追踪-画像集成
**低优先级（有空做）**：#6 权限收紧、#7 详情页优化、#8 对比矩阵扩展

---

## 4.7 文件变更总览

| 文件 | 改动类型 | 涉及改进 |
|------|----------|----------|
| `backend/app/api/profiles.py` | 修改 | #1 额度、#3 异步化、#4 删除保护 |
| `backend/app/services/profile_extractor.py` | 修改 | #2 锁 |
| `backend/app/services/profiles.py` | 修改 | #5 generation_source |
| `backend/app/services/product_intel.py` | 修改 | #5 generation_source |
| `backend/app/db/models.py` | 修改 | #5 加列 |
| `backend/app/main.py` | 修改 | #5 migrate |
| `backend/app/schemas/profiles.py` | 修改 | #5 Schema |
| `backend/app/api/competitors.py` | 修改 | #4 删除保护 |
| `backend/app/api/trackers.py` | 修改 | 集成：auto_profile_template_ids |
| `backend/app/services/agent.py` | 修改 | 集成：自动生成画像 |
| `backend/app/services/comparison.py` | 修改 | #8 多字段 |
| `frontend/src/pages/app/ProfilesPage.tsx` | 修改 | #3 异步化 |
| `frontend/src/pages/app/ProfileDetailPage.tsx` | 修改 | #5 显示 source、#7 优化 |
| `frontend/src/pages/app/ComparisonPage.tsx` | 修改 | #8 多字段 |
| `frontend/src/api/types.ts` | 修改 | #5 接口加字段 |
| `backend/tests/` | 新建 | 测试骨架 |
