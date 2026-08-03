# 横向对比功能修复计划

> 基于代码审查与线上数据验证，共发现 4 个问题（1 个 Critical、2 个 Medium、1 个 Low）。

---

## 根因

`generate_comparison()` 接收的 ID 列表实际是**画像 ID**（profile ID），但内部用 `CompetitorProfile.competitor_id.in_()` 查询——字段含义完全不同，查询永远返回空集，触发 `ValueError("至少需要 2 份已冻结的画像")`，导致对比功能完全无法启动。

---

## 变更总览

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | `backend/app/services/comparison.py` | Bug Fix | 查询字段改为 `id.in_()` + 竞品去重 |
| 2 | `backend/app/schemas/profiles.py` | Bug Fix | Schema 字段名 `competitor_ids` → `profile_ids` |
| 3 | `backend/app/api/profiles.py` | Bug Fix | 路由引用同步改为 `payload.profile_ids` |
| 4 | `frontend/src/pages/app/ComparisonPage.tsx` | Bug Fix + 增强 | 填充洞察数据 + URL 参数处理 |

---

## Fix 1 — `backend/app/services/comparison.py`（核心修复）

### 变更原因

第 22 行用 `competitor_id.in_(competitor_ids)` 查询，但传入的是 profile ID，永远匹配不到。

### 具体修改

**第 12 行** — 参数名改为 `profile_ids`：

```python
# 改前
def generate_comparison(template_id: str, competitor_ids: list[str]) -> dict:

# 改后
def generate_comparison(template_id: str, profile_ids: list[str]) -> dict:
```

**第 19-26 行** — 查询改为按 profile ID 查询，移除 `status` 过滤（移至后续去重逻辑）：

```python
# 改前
profiles = (
    db.query(CompetitorProfile)
    .filter(
        CompetitorProfile.competitor_id.in_(competitor_ids),
        CompetitorProfile.status == "frozen",
    )
    .all()
)

# 改后
profiles = db.query(CompetitorProfile).filter(
    CompetitorProfile.id.in_(profile_ids)
).all()
```

**第 28-37 行** — 在版本一致性校验之前插入竞品去重逻辑（同一竞品保留最新冻结画像）：

```python
if len(profiles) < 2:
    raise ValueError("至少需要 2 份已冻结的画像")

# 按竞品去重：同一竞品保留最新冻结的画像
latest_by_competitor: dict[str, CompetitorProfile] = {}
for p in profiles:
    if p.status != "frozen":
        continue
    if p.competitor_id not in latest_by_competitor or \
       (p.frozen_at and p.frozen_at > latest_by_competitor[p.competitor_id].frozen_at):
        latest_by_competitor[p.competitor_id] = p
profiles = list(latest_by_competitor.values())

if len(profiles) < 2:
    raise ValueError("至少需要 2 个不同竞品的已冻结画像")
```

第 32-37 行的版本一致性校验（`versions = {p.template_version ...}`）保持不动。

---

## Fix 2 — `backend/app/schemas/profiles.py`（Schema 字段对齐）

### 变更原因

前端发送的 ID 实际是 profile ID，字段名 `competitor_ids` 语义错误。

### 具体修改

**第 134-136 行**：

```python
# 改前
class ComparisonIn(BaseModel):
    template_id: str
    competitor_ids: list[str] = Field(..., min_length=2, max_length=10)

# 改后
class ComparisonIn(BaseModel):
    template_id: str
    profile_ids: list[str] = Field(..., min_length=2, max_length=10)
```

`ComparisonMatrixRow` 和 `ComparisonOut` 无需修改。

---

## Fix 3 — `backend/app/api/profiles.py`（路由引用同步）

### 变更原因

Schema 字段改名后，路由函数中的引用需同步。

### 具体修改

**第 334 行**（一处引用）：

```python
# 改前
for pid in payload.competitor_ids:

# 改后
for pid in payload.profile_ids:
```

其他代码（模板/画像权限校验、`valid_ids` 收集）保持不变。

---

## Fix 4 — `frontend/src/pages/app/ComparisonPage.tsx`（前端修复 + 增强）

### 变更原因

- `insightsMap` 状态从未被填充，雷达图永远不显示
- 从画像详情页跳转时 `?profile=` 参数被忽略

### 具体修改

**需要新增的 import**（第 2 行添加 `useRef`）：

```tsx
import { useEffect, useMemo, useState, useRef } from 'react'
```

**4a. `handleCompare` 函数（第 42-55 行）— 对比成功后加载洞察数据：**

```tsx
const handleCompare = async () => {
    if (selectedIds.length < 2) return
    setComparing(true)
    setError('')
    try {
      const res = await compareProfiles({ template_id: selectedTemplate, competitor_ids: selectedIds })
      setResult(res)

      // 新增：加载各画像的洞察数据，供雷达图使用
      setInsightsLoading(true)
      const pairs = await Promise.all(
        selectedIds.map(async (pid) => {
          try {
            const ins = await getProfileInsights(pid)
            return { pid, insights: ins }
          } catch {
            return { pid, insights: null }
          }
        })
      )
      const next: Record<string, any> = {}
      pairs.forEach(({ pid, insights }) => { if (insights) next[pid] = insights })
      setInsightsMap(next)

      setNotice('对比完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : '对比失败')
    } finally {
      setComparing(false)
      setInsightsLoading(false)
    }
}
```

**4b. URL 参数处理（在现有 `useEffect` 之后新增一个 effect）— 从画像详情页跳转时预选：**

```tsx
// 新增：处理 ?profile= 参数（从画像详情页"加入对比"跳转过来时预选）
const urlProfileRef = useRef<string | null>(null)
urlProfileRef.current = new URLSearchParams(window.location.search).get('profile')

useEffect(() => {
    if (storeLoading || allProfiles.length === 0) return
    const pre = urlProfileRef.current
    if (pre && selectedIds.length === 0) {
      const p = allProfiles.find((x: any) => x.id === pre)
      if (p && p.status === 'frozen') {
        setSelectedIds([p.id])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [storeLoading, allProfiles])
```

> 用 `useRef` 读取 URL 参数（稳定引用，不触发 effect 重跑），以 `storeLoading` 和 `allProfiles` 为依赖，确保 store 加载完毕后才检查。`selectedIds.length === 0` 避免覆盖用户手动选择。`eslint-disable` 注释防止 exhaustive-deps 警告。

---

## 完整调用链（修复后）

```
前端 ComparisonPage
  │  用户选择冻结画像（profile IDs）
  │
  ▼
POST /api/profiles/compare
  body: { template_id, profile_ids: [profile_id, ...] }
  │
  ▼
profiles.py: compare_profiles()
  │  ├─ 模板权限校验
  │  ├─ 每个 profile ID 做画像权限校验 → valid_ids
  │  └─ generate_comparison(template_id, valid_ids)
  │
  ▼
comparison.py: generate_comparison()
  │  ├─ id.in_(profile_ids) 查询 ← 【核心修复】
  │  ├─ 按竞品去重，保留最新冻结画像
  │  ├─ 版本一致性校验
  │  └─ 返回 matrix + dimensions + source_refs
  │
  ▼
前端收到对比矩阵
  │  ├─ 渲染对比表格
  │  └─ 并行调用 getProfileInsights(profile_id) ← 【新增】
  │
  ▼
雷达图渲染（ScoreRadar 接收 insights scores）
```

---

## 回滚策略

修改仅涉及 4 个文件，均为独立变更，可按文件逐项回滚：
- Fix 2/3 可一起回滚（Schema + 路由）
- Fix 1 可单独回滚（会恢复原来的 bug 行为，即对比不可用）
- Fix 4a/4b 可单独回滚（仅影响雷达图和 URL 预选，表格对比仍可用）

---

## 数据现状（验证用）

| 数据项 | 值 |
|--------|-----|
| 冻结模板 | `电气安全监测企业画像`（ID: `b827edce70af...`） |
| 冻结画像 | 2 份（同属 admin，同模板，同竞品 `51e819e...`） |
| 可冻结草稿 | 2 份（`4f2b125e...`、`fc6254d9...`，需先冻结才能对比） |
| 可用竞品 | 明圣电气×2、大疆×1 |

> 注意：当前 2 份冻结画像属于同一竞品，对比结果在业务意义上有限。建议测试时先冻结第 3 份草稿画像（对应大疆），再对比 3 个竞品。
