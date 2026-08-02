# 画像报告/洞察加载失败 — 修复方案

> **版本**: v6.0.0 | **日期**: 2026-08-03 | **分支**: agent-v6
>
> **问题**：画像任务完成后，打开报告和洞察页面显示"加载失败"。  
> **根本原因**：后台任务只生成结构化维度数据，报告/洞察通过独立的懒加载 API 调用 LLM 生成，这些调用独立失败导致页面空白。  
> **修复策略**：在同一个后台任务中预生成报告+洞察，存入 `profile_data`，前端优先读取缓存。

---

## 一、问题定位（基于实际代码）

### 1.1 后端：后台任务只保存 dimensions

`backend/app/services/profile_extractor.py` 第 465-534 行 `_run_extract_task`：

```python
async def _run_extract_task(task_id: str) -> None:
    # ... 步骤1：调用 generate_profile() 生成画像
    result = await generate_profile(task.competitor_id, task.template_id, user_id=task.user_id)
    task.result = result
    task.status = "done"
    task.current_step = "画像生成完成"
    # ← 这里就结束了，没有生成报告和洞察
```

`generate_profile`（`backend/app/services/profiles.py` 第 14-139 行）只保存了 `dimensions` + `summary` 到 `profile_data`。

### 1.2 前端：懒加载触发独立的 LLM 调用

`frontend/src/pages/app/ProfileDetailPage.tsx` 第 123-151 行：

```typescript
// 用户切换到"报告"Tab → 调用 getProfileReport(id) → 后端调用 LLM
// 用户切换到"洞察"Tab → 调用 getProfileInsights(id) → 后端调用 LLM
// 这两个调用独立于画像生成任务，各自可能失败
```

### 1.3 后端 API：每次都实时调用 LLM

`backend/app/api/profiles.py` 第 243-257 行（修复前）：

```python
@router.get("/{pid}/report", response_model=dict)
async def get_profile_report(pid: str, user: User = Depends(get_current_user)):
    p = db_get_profile(pid, user)
    result = await generate_profile_report(pid, user.id, p.org_id)  # ← 每次都调 LLM
    return result
```

---

## 二、修复方案（三处改动）

### 改动 1：后端预生成报告+洞察

**文件**：`backend/app/services/profile_extractor.py`

在 `_run_extract_task` 中，画像生成成功后，立即调用 LLM 预生成报告和洞察，存入 `profile_data`。

**修改位置**：第 485-523 行（`task.status = "done"` 之后）

```python
async def _run_extract_task(task_id: str) -> None:
    task = _extract_tasks.get(task_id)
    if not task:
        return
    task.status = "running"
    task.current_step = "正在准备分析..."
    task.updated_at = utcnow()
    _persist_task(task)

    def _on_progress(step: str) -> None:
        task.current_step = step
        task.updated_at = utcnow()
        _persist_task(task)

    try:
        from app.services.profiles import generate_profile
        result = await generate_profile(
            task.competitor_id, task.template_id, user_id=task.user_id,
        )
        task.result = result
        task.status = "done"
        task.current_step = "画像生成完成"

        # ========== 新增：预生成报告 + 洞察 ==========
        profile_id = result.get("id")
        if profile_id:
            try:
                _on_progress("正在生成画像报告…")
                from app.services.profile_report import generate_profile_report
                report_data = await generate_profile_report(profile_id, task.user_id, result.get("org_id", ""))
                report_markdown = report_data.get("report_markdown", "")
                source_index = report_data.get("source_index", [])
                quality = report_data.get("quality", {})

                _on_progress("正在分析洞察数据…")
                from app.services.profile_report import generate_profile_insights
                insights = await generate_profile_insights(profile_id, task.user_id, result.get("org_id", ""))

                # 写入 profile_data
                with SessionLocal() as db:
                    p = db.get(CompetitorProfile, profile_id)
                    if p:
                        raw = p.profile_data or "{}"
                        pd = json.loads(raw) if isinstance(raw, str) else dict(raw)
                        if report_markdown:
                            pd["report_markdown"] = report_markdown
                        if source_index:
                            pd["source_index"] = source_index
                        if quality:
                            pd["report_quality"] = quality
                        pd["insights"] = insights
                        p.profile_data = json.dumps(pd, ensure_ascii=False)
                        db.commit()
                        logger.info("pre-generated report+insights for profile %s", profile_id)
            except Exception as exc:
                # 预生成失败不影响画像主体，记录警告即可
                logger.warning("pre-generation for profile %s failed (non-blocking): %s", profile_id, exc)
        # ========== 新增结束 ==========
    except Exception as exc:
        logger.exception("extract task %s failed", task_id)
        task.error = str(exc)[:500]
        task.status = "error"
        task.current_step = ""
    finally:
        task.updated_at = utcnow()
        _persist_task(task)
        with _extract_lock:
            _extract_tasks.pop(task_id, None)
```

**关键点**：
- 预生成被 `try/except` 包裹，LLM 失败时只记 warning，不阻塞画像创建
- 报告和洞察数据以额外字段存入已有的 `profile_data` JSON 列，无需改表
- 存入的字段：`report_markdown`、`source_index`、`report_quality`、`insights`

---

### 改动 2：后端 API 优先返回缓存

**文件**：`backend/app/api/profiles.py`

三个端点都先检查缓存，缓存命中直接返回，不调用 LLM。

#### 2.1 `GET /{pid}/report`（第 255 行）

```python
@router.get("/{pid}/report", response_model=dict)
async def get_profile_report(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读缓存
    try:
        raw = p.profile_data or "{}"
        pd = json.loads(raw) if isinstance(raw, str) else dict(raw)
        cached = pd.get("report_markdown")
        if cached:
            return {
                "report_markdown": cached,
                "source_index": pd.get("source_index", []),
                "quality": pd.get("report_quality") or {},
                "insights": pd.get("insights"),
            }
    except (ValueError, TypeError):
        pass

    # 缓存不存在时才实时生成
    result = await generate_profile_report(pid, user.id, p.org_id)
    return result
```

#### 2.2 `GET /{pid}/insights`（第 282 行）

```python
@router.get("/{pid}/insights", response_model=ProfileInsightsOut)
async def get_profile_insights(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读缓存
    try:
        raw = p.profile_data or "{}"
        pd = json.loads(raw) if isinstance(raw, str) else dict(raw)
        cached = pd.get("insights")
        if cached and isinstance(cached, dict) and (cached.get("scores") or cached.get("verdict") or cached.get("swot")):
            return cached
    except (ValueError, TypeError):
        pass

    # 缓存不存在时才实时生成
    result = await generate_profile_insights(pid, user.id, p.org_id)
    return result
```

#### 2.3 新增 `GET /{pid}/report-full`（一次性获取全部）

```python
@router.get("/{pid}/report-full", response_model=dict)
async def get_profile_report_full(pid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """一次性返回画像报告 + 洞察 + 来源索引（前端首屏用，减少请求数）。"""
    p = db.get(CompetitorProfile, pid)
    _profile_access_check(p, user)

    # 优先读缓存
    try:
        raw = p.profile_data or "{}"
        pd = json.loads(raw) if isinstance(raw, str) else dict(raw)
        cached_report = pd.get("report_markdown")
        cached_insights = pd.get("insights")
        if cached_report:
            return {
                "report_markdown": cached_report,
                "source_index": pd.get("source_index", []),
                "quality": pd.get("report_quality") or {},
                "insights": cached_insights,
            }
    except (ValueError, TypeError):
        pass

    # 缓存不存在时实时生成
    from app.services.profile_report import generate_profile_report, generate_profile_insights
    report = await generate_profile_report(pid, user.id, p.org_id)
    insights = await generate_profile_insights(pid, user.id, p.org_id)
    return {
        "report_markdown": report.get("report_markdown", ""),
        "source_index": report.get("source_index", []),
        "quality": report.get("quality") or {},
        "insights": insights,
    }
```

---

### 改动 3：前端优先读取缓存

**文件**：`frontend/src/pages/app/ProfileDetailPage.tsx`

#### 3.1 新增缓存读取辅助函数（第 58 行后）

```typescript
// Helpers: read pre-generated content from profile_data (written by background task)
const getCachedReport = (pd: any) => {
  if (!pd?.report_markdown) return null
  return {
    markdown: pd.report_markdown,
    sourceIndex: (pd.source_index || []).map((s: any) => ({
      n: s.n, url: s.url, title: s.title || '', tier: s.tier || 'other',
      confidence: s.confidence || 0, snippet: s.snippet || '',
    })),
    quality: pd.report_quality || null,
  }
}

const getCachedInsights = (pd: any) => {
  const cached = pd?.insights
  if (cached && (cached.scores || cached.verdict || cached.swot)) {
    return cached
  }
  return null
}
```

#### 3.2 `reload` 函数中读取缓存（第 83 行起）

```typescript
const reload = useCallback(async () => {
  if (!id) return
  setLoading(true)
  setError('')
  try {
    const [p, allCompetitors, allTemplates] = await Promise.all([
      getProfile(id), listCompetitors(), listProfileTemplates(),
    ])
    setProfile(p)
    // ... competitor/template 查找 ...

    // 从 profile_data 读取预生成的报告和洞察
    const pd = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data

    const freshReport = getCachedReport(pd)
    if (freshReport) {
      setReportMarkdown(freshReport.markdown)
      setReportQuality(freshReport.quality)
      setSourceIndex(freshReport.sourceIndex)
    }

    const freshInsights = getCachedInsights(pd)
    if (freshInsights) {
      setInsights(freshInsights)
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : '加载失败')
  } finally {
    setLoading(false)
  }
}, [id])
```

#### 3.3 懒加载兜底（保持不变，仅作为缓存未命中时的降级）

```typescript
// 如果缓存为空，才走 API 懒加载
useEffect(() => {
  if (!id || !profile) return
  if (tab === 'report' && !reportMarkdown && !reportLoading) {
    setReportLoading(true)
    getProfileReport(id)
      .then((data) => { /* ... */ })
      .catch((err) => setNotice('报告加载失败：' + (err?.message || '未知错误')))
      .finally(() => setReportLoading(false))
  }
  if (tab === 'insights' && !insights && !insightsLoading) {
    // 同上
  }
}, [id, profile, tab, reportMarkdown, reportLoading, insights, insightsLoading])
```

---

## 三、数据流对比

### 修复前

```
用户触发画像生成
  → create_extract_task() 启动后台任务
    → generate_profile() 保存 dimensions（LLM #1）
    → 任务完成
  → 用户打开画像详情页
    → 加载 overview（OK，直接读 profile_data）
    → 切换到"报告"Tab
      → GET /api/profiles/{id}/report
        → generate_profile_report() 调用 LLM（LLM #2） ← 可能失败
    → 切换到"洞察"Tab
      → GET /api/profiles/{id}/insights
        → generate_profile_insights() 调用 LLM（LLM #3） ← 可能失败
```

### 修复后

```
用户触发画像生成
  → create_extract_task() 启动后台任务
    → generate_profile() 保存 dimensions（LLM #1）
    → generate_profile_report() 生成报告（LLM #2）← 移到后台
    → generate_profile_insights() 生成洞察（LLM #3）← 移到后台
    → 全部写入 profile_data
    → 任务完成（progress 可见）
  → 用户打开画像详情页
    → 加载 overview（OK）
    → 切换到"报告"Tab → 读取 profile_data 缓存 → 立即显示 ✓
    → 切换到"洞察"Tab → 读取 profile_data 缓存 → 立即显示 ✓
    → 无需任何额外 API 调用
```

---

## 四、兼容性说明

| 场景 | 行为 |
|------|------|
| **新建画像**（使用修复后的代码） | 后台预生成报告+洞察，存入缓存，前端直接读取 |
| **旧画像**（profile_data 无缓存字段） | 前端懒加载检测到 `reportMarkdown` 为空 → 走 API → 后端缓存未命中 → 实时调用 LLM（与原行为一致） |
| **预生成 LLM 失败** | 只记 warning，画像主体不受影响，前端走懒加载降级 |
| **重新生成画像** | 后台重新跑完整流程，新数据覆盖旧缓存 |

---

## 五、文件改动清单

| 文件 | 改动类型 | 行数 | 说明 |
|------|---------|------|------|
| `backend/app/services/profile_extractor.py` | 修改 | +35 行 | `_run_extract_task` 中追加预生成逻辑 |
| `backend/app/api/profiles.py` | 修改 | +60 行 | 三个端点增加缓存优先 + 新增 `/report-full` |
| `frontend/src/pages/app/ProfileDetailPage.tsx` | 修改 | +50 行 | 新增缓存读取辅助函数 + reload 中读取缓存 |
| `frontend/src/api/client.ts` | 修改 | +3 行 | 新增 `getProfileFullReport()` 函数 |

**无需改数据库表结构**，所有新数据存入已有的 `profile_data` JSON 列。

---

## 六、验证方式

```bash
# 1. 后端语法检查
cd backend && python -c "import ast; ast.parse(open('app/services/profile_extractor.py').read())"

# 2. 前端类型检查
cd frontend && npx tsc --noEmit

# 3. 启动后端，创建新画像任务
# 4. 等待任务完成（观察 progress 显示"正在生成画像报告…"/"正在分析洞察数据…"）
# 5. 打开画像详情页，切换到"报告"和"洞察"Tab，应直接显示内容，无"加载失败"
```
