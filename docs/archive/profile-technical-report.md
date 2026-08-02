# 竞品画像板块 — 技术分析报告

> 生成日期：2026-08-02 ｜ 基于 `agent-v5` 分支代码

---

## 一、整体架构概览

画像板块（Profiles）是 FleetView 系统中的一个**竞品结构化画像生成与管理**模块。其核心目标是：用户定义"画像模板"（包含维度和字段），系统基于已有数据源（调研结果 / 爬取页面）通过 LLM 自动生成竞品的结构化画像，并支持冻结锁定和横向对比。

```
┌─────────────────────────────────────────────────────────────┐
│                   画像板块架构总览                             │
├──────────────┬──────────────┬───────────────────────────────┤
│  画像模板     │  画像生成     │  横向对比                       │
│  (Template)   │  (Profile)    │  (Comparison)                   │
├──────────────┼──────────────┼───────────────────────────────┤
│ CRUD + 冻结   │ 三阶段 LLM    │ 冻结画像矩阵对比                  │
│ 版本控制      │ 提取 pipeline  │ 表格展示                        │
└──────────────┴──────────────┴───────────────────────────────┘
         │               │                    │
         ▼               ▼                    ▼
   ProfileTemplate   CompetitorProfile    API: POST /compare
   (DB Table)        (DB Table)           service: comparison.py
```

---

## 二、数据模型层（Database Layer）

### 2.1 核心表结构

| 表名 | 文件位置 | 作用 |
|------|----------|------|
| `profile_templates` | `backend/app/db/models.py:276-292` | 画像模板定义 |
| `competitor_profiles` | `backend/app/db/models.py:294-315` | 竞品画像数据 |
| `profile_extract_tasks` | `backend/app/db/models.py:317-343` | 后台提取任务（持久化） |

### 2.2 ProfileTemplate（画像模板）

```python
class ProfileTemplate(Base):
    __tablename__ = "profile_templates"
    id: str                    # UUID
    org_id: str                # 企业隔离，空串=系统级
    name: str                  # 模板名称，如 "SaaS 竞品画像"
    dimensions: str            # JSON: [{"key": "...", "label": "...", "fields": [...]}]
    version: int = 1           # 每次修改自动递增
    frozen_at: datetime | None # 冻结时间，None=可编辑，非空=只读
    created_by: str            # 创建者 user.id
    created_at: datetime
```

**设计要点：**
- `dimensions` 字段存储为 JSON 字符串，在 Python 层用 `json.loads` / `json.dumps` 序列化
- 模板一旦被冻结（`frozen_at != None`），禁止修改和删除，只能创建新版本
- `org_id` 为空串表示系统级模板（仅管理员可用），非空为企业私有模板

### 2.3 CompetitorProfile（竞品画像）

```python
class CompetitorProfile(Base):
    __tablename__ = "competitor_profiles"
    id: str
    org_id: str
    competitor_id: str          # 关联 Competitor 表
    template_id: str            # 关联 ProfileTemplate 表
    profile_data: str           # JSON: {"dimensions": {...}, "summary": "..."}
    source_refs: str            # JSON: [{"url": ..., "title": ..., "snippet": ...}]
    status: str = "draft"       # draft / reviewed / frozen
    frozen_at: datetime | None
    created_at: datetime
    updated_at: datetime        # 自动更新（onupdate）
```

**设计要点：**
- `profile_data` 结构为 `{"dimensions": {"dim_key": {"field_key": "value"}}, "summary": "..."}`
- `source_refs` 存储来源快照副本，避免悬空引用（来源表删除后画像仍可追溯）
- `status` 三态：draft（草稿）→ reviewed（已审核，代码中未使用此状态）→ frozen（已冻结）
- 冻结后的画像不可修改，参与横向对比

### 2.4 ProfileExtractTask（后台提取任务）

```python
class ProfileExtractTask(Base):
    __tablename__ = "profile_extract_tasks"
    id: str                      # UUID
    competitor_id: str
    template_id: str
    user_id: str
    org_id: str
    status: str                  # pending / running / done / error
    current_step: str            # 进度描述（如"正在分析页面..."）
    result: str                  # JSON：完成后存储结果
    error: str
    created_at: datetime
    updated_at: datetime
```

**设计要点：**
- 任务状态持久化到数据库，支持进程重启后恢复（`recover_stale_tasks`）
- 内存中也有缓存（`_extract_tasks` dict），加速运行中的任务访问
- 完成后从内存移除，仅保留 DB 记录

---

## 三、Schema 层（API 数据校验）

文件：`backend/app/schemas/profiles.py`

### 3.1 请求 Schema

| Schema | 用途 | 关键字段 |
|--------|------|----------|
| `ProfileTemplateIn` | 创建/更新模板 | `name`, `dimensions[]`, `org_id` |
| `ProfileGenerateIn` | 触发画像生成 | `competitor_id`, `template_id` |
| `ComparisonIn` | 触发横向对比 | `template_id`, `competitor_ids[]` |

### 3.2 响应 Schema

| Schema | 用途 | 关键字段 |
|--------|------|----------|
| `ProfileTemplateOut` | 模板详情 | `id`, `name`, `dimensions`, `version`, `frozen_at` |
| `CompetitorProfileOut` | 画像详情 | `id`, `profile_data`, `source_refs`, `status` |
| `GenerateFromCrawlOut` | 启动后台任务 | `task_id`, `status` |
| `GenerateStatusOut` | 任务状态查询 | `task_id`, `status`, `current_step`, `error`, `result` |
| `ComparisonOut` | 对比结果 | `template_name`, `dimensions[]`, `matrix[]` |

### 3.3 JSON 解析兜底

`ProfileTemplateOut`、`CompetitorProfileOut` 中的 `dimensions`、`profile_data`、`source_refs` 字段都定义了 `field_validator`，当数据库返回的是 JSON 字符串时自动解析为对象/数组，确保前后端传输的一致性。

---

## 四、API 路由层

文件：`backend/app/api/profiles.py`

### 4.1 模板管理 API

| 方法 | 路径 | 功能 | 权限 |
|------|------|------|------|
| GET | `/api/profiles/templates` | 列出模板（分页，支持系统级+企业级） | 登录 |
| POST | `/api/profiles/templates` | 创建模板 | 登录 |
| PATCH | `/api/profiles/templates/{tid}` | 更新模板（version+1，不可改冻结模板） | 登录+owner |
| POST | `/api/profiles/templates/{tid}/freeze` | 冻结模板 | 仅管理员 |
| DELETE | `/api/profiles/templates/{tid}` | 删除模板（不可删冻结模板） | 登录+owner |

**数据隔离逻辑：**
```python
(ProfileTemplate.org_id == user.org_id) | (ProfileTemplate.org_id == "")
```
即用户可见：自己企业的模板 + 系统级空 org_id 模板。

### 4.2 画像生成 API

| 方法 | 路径 | 功能 | 说明 |
|------|------|------|------|
| POST | `/api/profiles/generate` | 同步生成画像 | 阻塞式，直接返回结果 |
| POST | `/api/profiles/generate-from-crawl` | 后台生成（异步） | 202 Accepted，返回 task_id |
| GET | `/api/profiles/generate-from-crawl/{task_id}` | 查询任务状态 | 轮询用 |
| GET | `/api/profiles` | 列出所有画像 | 分页 |
| GET | `/api/profiles/{pid}` | 获取单条画像 | — |
| POST | `/api/profiles/{pid}/freeze` | 冻结画像 | 仅管理员 |
| GET | `/api/profiles/tasks` | 列出当前用户的提取任务 | 50 条限制 |

### 4.3 横向对比 API

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/profiles/compare` | 基于冻结画像生成对比矩阵 |

---

## 五、业务逻辑层（Service Layer）

画像板块的业务逻辑分布在三个服务文件中：

### 5.1 `profiles.py` — 核心画像生成

**核心函数 `generate_profile(competitor_id, template_id, user_id)`** 采用**三级数据源回退策略**：

```
Level 1: ResearchTask + Source（调研来源优先）
  → LLM 基于来源材料生成维度填充
  → 失败 → Level 2

Level 2: product_intel（产品情报路径）
  → 动态导入，失败静默回退
  → 失败 → Level 3

Level 3: crawl（爬取页面路径）
  → extract_profile_from_pages()
  → 三阶段 LLM 提取
```

**Level 1 详细流程（调研来源路径）：**
1. 查询 `ResearchTask` 中已完成且名称/竞品匹配的任务
2. 关联查询 `Source` 表获取来源材料（按 confidence 降序，取前 20 条）
3. 构造 LLM Prompt：包含维度定义、来源材料
4. LLM 返回结构化 JSON → 落库 `CompetitorProfile`（status=draft）
5. 保存来源引用快照到 `source_refs`

**Level 3 详细流程（爬取页面路径）——见 5.2**

### 5.2 `profile_extractor.py` — 三阶段 LLM 提取（核心算法）

这是画像板块最复杂的部分，采用**三阶段渐进式 LLM 提取**：

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Stage 1 │────▶│ Stage 2 │────▶│ Stage 3 │
│ 页面摘要  │     │ 维度提取  │     │ 聚合校验  │
└─────────┘     └─────────┘     └─────────┘
  并发(5路)        并发(3路)         单线程
```

#### Stage 1：页面摘要化 + 维度相关性标注

- **输入**：所有爬取成功的 `CompetitorPage`（含 content_text）
- **并发控制**：`asyncio.Semaphore(5)`，每批 5 页
- **LLM 任务**：为每页生成 100-200 字摘要，标注与该模板哪些维度相关，评估可信度（high/medium/low）
- **输出**：`[{url, title, page_type, summary, relevant_dims, confidence}, ...]`

#### Stage 2：按维度提取结构化数据

- **输入**：Stage 1 的摘要结果 + 原始页面全文
- **并发控制**：`asyncio.Semaphore(3)`，每维度一次 LLM 调用
- **策略**：对每个维度，取最相关的 3 页（按 confidence 排序），摘要 + 全文截断拼接作为上下文
- **LLM 任务**：提取该维度下每个字段的具体值、可信度、来源 URL
- **输出**：`{dim_key: {field_key: {value, confidence, source_url}}}`

**截断策略：**
- 每页摘要上限：`_MAX_SUMMARY_CHARS = 300`
- Stage 2 单页全文上限：`_MAX_PAGE_TEXT_STAGE2 = 4000`
- 单维度总输入上限：`_MAX_DIMENSION_TEXT = 12000`

#### Stage 3：聚合 + 冲突检测 + 置信度评分

- 遍历所有维度的提取结果
- 统计：总字段数、有值字段数、high 置信度字段数、"存在差异"字段数
- 生成 summary：
  - 无数据 → "未能从官网提取到...建议补充调研来源"
  - 有冲突 → "共 X/Y 个字段有值，Z 个字段存在多来源差异"
  - 无冲突 → "共 X/Y 个字段有值，其中 Z 个字段置信度较高"

### 5.3 `profile_extractor.py` — 后台任务系统

**内存 + 数据库双写持久化：**

```
创建任务
  ├── 生成 UUID task_id
  ├── 写入内存缓存 _extract_tasks[task_id]
  ├── 立即持久化到 DB（_persist_task）
  └── asyncio.create_task(_run_extract_task)  # 异步启动

运行中
  ├── 每次进度更新同时写内存 + DB
  └── on_progress 回调触发 _persist_task

完成/失败
  ├── 最终状态写入 DB
  └── 从内存缓存移除（_extract_tasks.pop）

进程重启恢复
  └── recover_stale_tasks() 扫描 DB 中 pending/running 的任务
       ├── 有结果 → 标记为 done
       ├── 已在内存 → 跳过
       └── 无结果 → 重新启动后台任务
```

### 5.4 `comparison.py` — 横向对比

```python
def generate_comparison(template_id: str, competitor_ids: list[str]) -> dict:
    1. 验证模板存在且已冻结
    2. 查询所有指定竞品的已冻结画像
    3. 至少需要 2 份冻结画像
    4. 对每个维度，取第一个字段的值构建矩阵
    5. 返回: {template_name, dimensions[], matrix[], source_refs[]}
```

**注意**：每个维度只取 `fields[0]`（第一个字段）做对比，其余字段暂未在矩阵中展示。

---

## 六、前端层

### 6.1 页面清单

| 页面 | 文件 | 功能 |
|------|------|------|
| 画像列表 | `frontend/src/pages/app/ProfilesPage.tsx` | 展示所有画像卡片 + 生成面板 |
| 画像详情 | `frontend/src/pages/app/ProfileDetailPage.tsx` | 查看/冻结/重新生成/加入对比 |
| 画像提取任务 | `frontend/src/pages/app/ProfileTasksPage.tsx` | 后台任务状态轮询（3s） |
| 横向对比 | `frontend/src/pages/app/ComparisonPage.tsx` | 选择冻结画像 → 生成对比矩阵 |

### 6.2 状态管理

使用 Zustand + persist 中间件持久化到 localStorage：

```typescript
interface ProfileState {
  profiles: CompetitorProfile[]
  templates: ProfileTemplate[]
  competitors: Competitor[]
  loading: boolean
  reload: () => Promise<void>
}
```

**reload 并发加载**模板、竞品、画像三个列表，然后前端根据 `generation_source` 字段区分"基于调研来源"和"基于爬取页面"两种生成方式。

### 6.3 画像详情页的字段渲染

`ProfileDetailPage.tsx` 中的 `renderFieldValue` 函数支持多种数据类型的渲染：

| 数据类型 | 渲染方式 |
|----------|----------|
| string | 纯文本（去除引用标记 `[n]`） |
| number/boolean | 文本化 |
| string[] | 标签 chips |
| structured object[] | 卡片列表（识别 name/title/category 等 key 作为标题） |
| 嵌套 object | 键值对递归渲染 |
| "信息不足" | 隐藏该字段 |

---

## 七、关键流程全景

### 7.1 完整画像生成流程

```
用户操作                          后端处理
──────────                       ──────────
选择竞品 + 模板                     ① 验证竞品/模板存在
点击"生成画像"                     ② 验证模板已冻结
 │                               ③ 查询 ResearchTask + Source
 │                               ④ 无来源 → 回退 product_intel → 回退 crawl
 │                               ⑤ 构造 LLM Prompt
 │ POST /generate  ────────────▶  ⑥ LLM chat_json（结构化输出）
 │                               ⑦ 解析返回的 JSON
 │ ◀─────────── 201 + 结果        ⑧ 落库 CompetitorProfile（draft）
 │                               ⑨ 保存 source_refs 快照
 │ 页面刷新                        ⑩ 前端 reload 展示
```

### 7.2 后台提取任务流程

```
用户点击"基于爬取页面"
 │
 POST /generate-from-crawl
 │
 ├── 验证竞品、模板、冻结状态
 ├── create_extract_task()
 │    ├── 生成 UUID
 │    ├── 写入内存 + 立即持久化 DB
 │    └── asyncio.create_task(_run_extract_task)
 │
 ◀── 202 Accepted + {task_id}
 │
 ├── 前端每 2s 轮询 GET /generate-from-crawl/{task_id}
 │    └── 查询状态（内存优先 → DB 回退）
 │
 └── 后台任务执行三阶段 LLM 提取
      ├── Stage 1: 并发摘要化（5路）
      ├── Stage 2: 并发维度提取（3路）
      ├── Stage 3: 聚合
      └── 落库 → 状态变为 done
```

---

## 八、多租户与权限设计

### 8.1 数据隔离

- **模板**：`(org_id == user.org_id) | (org_id == "")` — 可见企业模板 + 系统模板
- **画像**：`(org_id == user.org_id) | (org_id == "")` — 同模板
- **竞品**：同上，企业竞品 + 系统竞品

### 8.2 权限控制

| 操作 | 要求 |
|------|------|
| 创建模板 | 登录用户 |
| 更新/删除模板 | 登录 + 模板属于该用户企业 |
| 冻结模板 | 仅管理员（`user.role == "admin"`） |
| 冻结画像 | 仅管理员 |
| 查看任务状态 | 任务创建者或管理员 |
| 生成画像 | 登录用户（模板必须已冻结） |

---

## 九、当前实现的问题与改进建议

### 9.1 已知问题

| # | 问题 | 位置 | 严重度 |
|---|------|------|--------|
| 1 | `product_intel` 动态导入路径可能不存在 | `profiles.py:106` | 中 |
| 2 | `recover_stale_tasks` 已在 `main.py:58` 启动时调用，但幂等性检查依赖于任务已有 result 字段，若进程在 `_persist_task` 之前崩溃可能重复执行 | `profile_extractor.py:510`, `main.py:58` | 中 |
| 3 | `asyncio.get_running_loop()` 在非 async 上下文中会崩溃 | `profile_extractor.py:506` | 高 |
| 4 | 对比矩阵每个维度只取第一个字段 | `comparison.py:42` | 中 |
| 5 | 画像状态 `reviewed` 在代码中未被实际使用 | `models.py:310`, `types.ts:179` | 低 |
| 6 | `freeze_profile` 函数中 `CompetitorProfile` 的 `status` 设为 `"frozen"` 但 Schema 定义中 status 类型为 `'draft' \| 'reviewed' \| 'frozen'` — 前后一致但 reviewed 状态无 UI 入口 | 多处 | 低 |
| 7 | `_extract_tasks` 内存缓存是无锁的字典，高并发下 `get_extract_task` 和 `create_extract_task` 存在竞态 | `profile_extractor.py:360` | 中 |
| 8 | `generation_source` 未持久化到 DB — 仅作为 API 响应的内联字段返回，页面刷新后丢失 | `profiles.py:100,107` | 中 |
| 9 | 画像生成端点未执行额度校验（`check_quota_or_403`），消耗 LLM token 但不计入用户配额 | `api/profiles.py:108,116` | 中 |
| 10 | SQLite 并发下 profile_extractor 的 DB 写入无重试机制（product_intel 有 `_db_write_retry`，但 profile_extractor 没有） | `profile_extractor.py:331-342` | 中 |
| 11 | 多 worker 部署时 `_extract_tasks` 内存缓存不共享，worker A 创建的任务对 worker B 不可见 | `profile_extractor.py:360` | 高 |
| 12 | `ProfileExtractTask` 缺少 `(user_id, status)` 复合索引，列表查询效率低 | `models.py:317-343` | 低 |
| 13 | `competitor_profiles` 缺少 `(org_id, created_at)` 复合索引，分页查询效率低 | `models.py:294-315` | 低 |
| 14 | `CompetitorProfile` 的 `competitor_id` 和 `template_id` 无外键约束，删除竞品/模板会留下孤儿画像 | `models.py:294-315` | 中 |
| 15 | 系统级模板（`org_id=""`）的更新未做 org 检查，任何用户都可修改 | `api/profiles.py:64-76` | 中 |
| 16 | `ProfileDetailPage` 加载全部画像列表后前端 `find()` 定位单条，应直接调用 `GET /api/profiles/{id}` | `ProfileDetailPage.tsx:27-28` | 低 |
| 17 | `profileStore.ts` 持久化到 localStorage，多标签页不同企业上下文时会产生脏数据 | `profileStore.ts:37-43` | 中 |

### 9.2 改进建议

1. **启动时自动恢复任务**：在 `main.py` 启动时调用 `recover_stale_tasks()`，确保进程重启后后台任务不丢失（注：`main.py:57` 已有调用，需验证是否实际生效）
2. **增加 reviewed 状态流转**：在画像详情页增加"审核通过"按钮，将 draft → reviewed → frozen
3. **对比矩阵支持多字段**：当前只取每个维度的第一个字段，可扩展为每个维度展开所有字段
4. **内存缓存加锁**：`_extract_tasks` 字典操作应加 `asyncio.Lock` 保护；多 worker 场景应考虑 Redis 共享缓存
5. **画像生成加额度校验**：调用 `check_quota_or_403()` 消耗用户月度配额
6. **SQLite 并发写入加重试**：profile_extractor 的 DB 写入也应使用 `_db_write_retry` 模式
7. **添加画像版本历史**：当前 template 有 version 但 profile 本身无版本，可考虑 profile 重新生成时保留历史快照
8. **批量生成支持**：当前只能单条生成，可支持选择多个竞品批量生成画像
9. **持久化 `generation_source`**：在 `CompetitorProfile` 表中增加 `generation_source` 列，避免页面刷新后丢失
10. **ProfileDetailPage 直接用 `GET /{pid}`**：避免加载全量列表后前端查找
11. **系统级模板编辑加 org 检查**：`org_id==""` 的模板修改应限制为管理员
12. **添加外键约束**：`competitor_profiles.competitor_id` 和 `template_id` 应加 `ForeignKey` + `ON DELETE SET NULL` 或级联策略
13. **添加复合索引**：`(org_id, created_at)` on `profile_templates` 和 `competitor_profiles`；`(user_id, status)` on `profile_extract_tasks`
14. **localStorage 多标签页同步**：profileStore 的 persist 应考虑使用 `storage` 事件监听，或在切换组织时清除缓存

---

## 十、文件清单

| 文件路径 | 职责 |
|----------|------|
| `backend/app/db/models.py` | 5 个核心表定义（Template, Profile, ExtractTask 等） |
| `backend/app/schemas/profiles.py` | Pydantic Schema（入参/出参校验） |
| `backend/app/api/profiles.py` | REST API 路由（16 个 endpoint） |
| `backend/app/services/profiles.py` | 核心生成逻辑（三级回退策略） |
| `backend/app/services/profile_extractor.py` | 三阶段 LLM 提取 + 后台任务系统 |
| `backend/app/services/comparison.py` | 横向对比矩阵生成 |
| `backend/app/db/database.py` | 数据库引擎配置 |
| `frontend/src/pages/app/ProfilesPage.tsx` | 画像列表 + 生成面板 |
| `frontend/src/pages/app/ProfileDetailPage.tsx` | 画像详情 + 冻结 + 重新生成 |
| `frontend/src/pages/app/ProfileTasksPage.tsx` | 后台任务状态监控 |
| `frontend/src/pages/app/ComparisonPage.tsx` | 横向对比矩阵 |
| `frontend/src/stores/profileStore.ts` | Zustand 状态管理（持久化到 localStorage） |
| `frontend/src/api/types.ts` | TypeScript 类型定义 |

---

## 十一、总结

画像板块是一个设计完善的**AI 驱动的竞品结构化情报系统**，核心特点：

1. **模板驱动**：通过冻结模板约束 LLM 输出格式，确保画像结构一致性
2. **三级数据源回退**：调研来源 → 产品情报 → 爬取页面，最大化利用已有数据
3. **三阶段渐进 LLM**：摘要 → 维度提取 → 聚合，控制上下文长度和 token 消耗
4. **异步任务持久化**：内存+DB 双写，支持进程重启恢复
5. **横向对比**：基于冻结画像生成竞品矩阵，辅助决策
6. **多租户隔离**：企业级数据隔离 + 系统级共享模板

主要技术债务集中在后台任务的进程恢复机制未自动触发、内存缓存无锁保护、以及对比矩阵功能较简单三个方面。
