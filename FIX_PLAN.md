# 竞品调研 Agent — 代码问题修复方案

**基于**: 代码评审报告 (`CODE_REVIEW_2026-08-02.md`)  
**日期**: 2026-08-02  
**分支**: `agent-v5`

---

## 一、修复总览

| 优先级 | 问题数 | 涉及模块 | 预估工作量 |
|--------|--------|----------|-----------|
| P0 — 紧急 | 4 | 前端认证 + 后端 token | 2-3 小时 |
| P1 — 高 | 3 | CORS + 调度器 + 登出清理 | 1-2 小时 |
| P2 — 中 | 5 | 数据模型 + 爬虫 + 缓存 + 审计 | 2-3 小时 |
| P3 — 低 | 3 | 并发 + 限流 + 细节优化 | 1 小时 |

---

## 二、P0 修复：认证稳定性（核心问题 — 频繁退出登录）

### P0-1：增加 Access Token 主动刷新机制

**问题**: Access Token 8 小时过期，用户在使用过程中被静默踢出。  
**方案**: 在 token 剩余 1 小时时主动静默刷新，而不是等 401 才被动处理。

**修改文件**: `frontend/src/api/client.ts`

```typescript
// 在文件顶部添加常量
const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000   // 8 小时
const REFRESH_THRESHOLD_MS = 1 * 60 * 60 * 1000  // 提前 1 小时刷新

// 新增：记录 token 签发时间（存在 sessionStorage，跨 tab 不共享）
function getTokenIssuedAt(): number {
  const v = sessionStorage.getItem('cr_token_iat')
  return v ? Number(v) : 0
}
function setTokenIssuedAt(ts: number) {
  sessionStorage.setItem('cr_token_iat', String(ts))
}

// 修改 saveTokens：记录签发时间
export async function saveTokens(data: TokenResponse) {
  tokenStore.set(data.access_token)
  if (data.refresh_token) setRefreshToken(data.refresh_token)
  // 记录当前时间作为 token 签发时间
  setTokenIssuedAt(Date.now())
}

// 新增：判断是否需要主动刷新
function shouldProactiveRefresh(): boolean {
  const issued = getTokenIssuedAt()
  if (!issued) return false
  const age = Date.now() - issued
  return age > (ACCESS_TOKEN_TTL_MS - REFRESH_THRESHOLD_MS)
}

// 修改 tryRefreshToken：支持主动刷新模式（不依赖 401 触发）
export async function tryProactiveRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  const refresh = getRefreshToken()
  if (!refresh) return false

  refreshPromise = (async () => {
    try {
      const resp = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!resp.ok) { tokenStore.clear(); return false }
      const data = await resp.json() as TokenResponse
      if (data.access_token) {
        saveTokens(data)  // 会更新签发时间
        return true
      }
      return false
    } catch { return false } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

// 新增：全局主动刷新检查（在 request 中每次调用时执行）
function maybeProactiveRefresh(): void {
  if (shouldProactiveRefresh()) {
    tryProactiveRefresh().catch(() => {})
  }
}
```

**修改 `request` 函数** — 在发起请求前检查是否需要主动刷新：

```typescript
export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  // ★ 新增：主动刷新检查
  maybeProactiveRefresh()

  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = tokenStore.get()
  if (token) headers['Authorization'] = `Bearer ${token}`
  // ... 其余逻辑不变
```

**修改 `login` / `register`** — 在保存 token 时记录签发时间（上面已包含在 `saveTokens` 中）。

---

### P0-2：修复 AuthContext 启动恢复逻辑

**问题**: 启动时 access token 过期直接清空，不尝试 refresh。  
**文件**: `frontend/src/auth/AuthContext.tsx:27-36`

```tsx
// 修改前
useEffect(() => {
    if (!tokenStore.get()) {
      setReady(true)
      return
    }
    fetchMe()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true))
}, [])

// 修改后
useEffect(() => {
    const token = tokenStore.get()
    if (!token) {
      setReady(true)
      return
    }

    // 尝试恢复会话：access token 有效则直接登录，过期则尝试 refresh
    fetchMe()
      .then(setUser)
      .catch(async () => {
        // access token 失效，尝试 refresh
        const refreshed = await tryProactiveRefresh().catch(() => false)
        if (!refreshed) {
          tokenStore.clear()
          return
        }
        // refresh 成功，用新 token 重试
        try {
          setUser(await fetchMe())
        } catch {
          tokenStore.clear()
        }
      })
      .finally(() => setReady(true))
}, [])
```

**需要导入 `tryProactiveRefresh`**：

```tsx
import { ApiError, fetchMe, login as apiLogin, register as apiRegister, request, saveTokens, tokenStore, tryProactiveRefresh } from '../api/client'
```

---

### P0-3：SSE 断开后自动重连（使用新 token）

**问题**: EventSource 断开后无法恢复，用户需手动刷新页面。  
**文件**: `frontend/src/api/client.ts:253-272`

```typescript
export function subscribeEvents(
  id: string,
  onStep: (step: Step) => void,
  onStatus: (status: TaskStatus) => void,
): () => void {
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  const MAX_RECONNECT = 5

  function connect(token: string) {
    es = new EventSource(`/api/research/${id}/events?token=${encodeURIComponent(token)}`)

    es.addEventListener('step', (e) => {
      onStep(JSON.parse((e as MessageEvent).data))
      reconnectAttempts = 0  // 收到数据说明连接正常
    })

    es.addEventListener('status', (e) => {
      const { status } = JSON.parse((e as MessageEvent).data)
      onStatus(status)
      if (status === 'completed' || status === 'failed') {
        es?.close()
      }
    })

    es.onerror = () => {
      if (es?.readyState === EventSource.CLOSED) {
        es.close()
        // ★ 自动重连逻辑
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++
          const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)  // 指数退避
          reconnectTimer = setTimeout(() => {
            // 尝试主动刷新 token 后重连
            tryProactiveRefresh().then(() => {
              const newToken = tokenStore.get() ?? ''
              connect(newToken)
            }).catch(() => {
              // refresh 也失败，用当前 token 再试一次
              connect(tokenStore.get() ?? token)
            })
          }, delay)
        }
      }
    }
  }

  // 启动连接
  const token = tokenStore.get() ?? ''
  connect(token)

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    es?.close()
  }
}
```

---

### P0-4：401 处理优化 — 区分场景 + 增加重试

**问题**: 任何 401 都清空 token，临时网络波动导致误登出。  
**文件**: `frontend/src/api/client.ts:104-124`

```typescript
// 修改 401 处理逻辑
const isAuthEndpoint = url.startsWith('/api/auth/')

if (resp.status === 401) {
    // 区分场景：
    // 1. 主动刷新触发的 refresh 端点 401 → token 彻底失效，清空
    // 2. 数据端点 401 → 尝试 refresh，失败再清空
    // 3. SSE / auth 端点 401 → 不自动跳转，由调用方处理

    const refreshed = await tryRefreshToken()

    if (!refreshed) {
      tokenStore.clear()
      // ★ 仅对非认证端点做跳转（避免刷新端点本身 401 时循环）
      if (!isAuthEndpoint && !url.includes('/api/auth/refresh')) {
        window.location.href = '/login'
      }
      return undefined as T
    }

    // refresh 成功，用新 token 重试
    const newToken = tokenStore.get()
    if (newToken) headers['Authorization'] = `Bearer ${newToken}`
    const retry = await fetch(url, { ...init, headers })

    if (retry.status === 204) return undefined as T
    if (!retry.ok) {
      const body = await retry.json().catch(() => null)
      let detail = body?.detail
      if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
      throw new ApiError(retry.status, detail ?? `请求失败 (${retry.status})`)
    }
    if (retry.status === 204) return undefined as T
    return retry.json()
  }
```

**额外修改** — `logoutAll` 和 `changePassword` 返回后需要同步更新 localStorage 中的 token：

```typescript
// AccountPage.tsx — SecurityTab 中的提交处理已正确处理（已设置 tokenStore.set）
// 确认 AccountPage.tsx 中 changePassword 和 logoutAll 的处理是正确的
// （已审查：lines 485-506 正确设置了 tokenStore.set(resp.access_token)）
```

---

### P0-5：后端 — 考虑缩短 access token TTL（可选）

**文件**: `backend/app/core/security.py:33`

```
当前: "exp": now + timedelta(hours=8),  # 8 小时
建议: "exp": now + timedelta(minutes=30),  # 30 分钟（配合前端主动刷新）
```

**如果不改后端**，前端主动刷新机制足以解决问题。如果后端配合缩短 TTL，安全性更高（token 泄露窗口更短）。

---

## 三、P1 修复：高优先级

### P1-1：CORS 配置改为环境变量驱动

**文件**: `backend/app/core/config.py`

```python
# 新增配置项
frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
```

**文件**: `backend/app/main.py:309-315`

```python
# 修改前
allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],

# 修改后
settings = get_settings()
allow_origins = [o.strip() for o in settings.frontend_origins.split(",") if o.strip()],
```

**.env 配置示例**:

```env
FRONTEND_ORIGINS=http://localhost:5173,https://comp-agent.example.com,https://app.example.com
```

---

### P1-2：调度器时区修正

**文件**: `backend/app/services/scheduler.py:75-81`

```python
def initial_next_run(frequency: str, run_hour: int) -> datetime:
    """新建/修改追踪项时计算首次运行时间：下一个 run_hour 整点（UTC 基准）

    注意：run_hour 以 UTC 为基准。如需本地时间，前端应将本地时区的小时
    转换为 UTC 小时传入，或后端存储用户时区偏移后在此转换。
    """
    utc_now = datetime.now(timezone.utc)
    # 将 run_hour 视为 UTC 小时
    candidate = utc_now.replace(hour=run_hour, minute=0, second=0, microsecond=0)
    if candidate <= utc_now:
        candidate += timedelta(days=1)
    return candidate
```

**前端适配** (`frontend/src/components/TrackerForm.tsx` 或相关表单)：

```typescript
// 用户选择 run_hour 时，将其视为本地时间
// 提交时转换为 UTC 小时
const localHour = parseInt(selectedHour)  // 用户选择的 0-23
const utcOffset = new Date().getTimezoneOffset()  // 分钟，东八区为 -480
const utcHour = (localHour - utcOffset / 60 + 24) % 24
payload.run_hour = Math.round(utcHour)
```

**长期方案**: 在 `User` 或 `Tracker` 模型中增加 `timezone_offset` 字段（分钟），调度器据此转换。

---

### P1-3：登出时清除所有 Zustand stores

**文件**: `frontend/src/auth/AuthContext.tsx`

```tsx
import { useTaskStore } from '../stores/taskStore'
import { useCompetitorStore } from '../stores/competitorStore'
import { useProfileStore } from '../stores/profileStore'
import { useGraphStore } from '../stores/graphStore'
import { useTrackerStore } from '../stores/trackerStore'

const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    // ★ 清除所有持久化 stores 的缓存数据
    useTaskStore.persist.clearStorage()
    useCompetitorStore.persist.clearStorage()
    useProfileStore.persist.clearStorage()
    useGraphStore.persist.clearStorage()
    useTrackerStore.persist.clearStorage()
}, [])
```

**如果 `persist.clearStorage()` 不可用**（zustand 版本差异），降级方案：

```tsx
// 直接清除 localStorage 中的对应 key
const STORE_KEYS = ['task-store', 'competitor-store', 'profile-store', 'graph-store', 'tracker-store']
const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    STORE_KEYS.forEach(key => localStorage.removeItem(key))
}, [])
```

---

## 四、P2 修复：中等优先级

### P2-1：修复 reset_code 列长度不匹配

**文件**: `backend/app/db/models.py:40`

```python
# 修改前
reset_code: Mapped[str] = mapped_column(String(10), default="")

# 修改后
reset_code: Mapped[str] = mapped_column(String(44), default="")
```

**数据库迁移**（已有数据库需要执行）：

```sql
-- 由于 SQLite 不支持直接修改列类型，需要重建表
-- 但 _fix_column_order_if_needed 会在下次启动时重建表，
-- 只要 models.py 中的列定义顺序与迁移脚本一致即可自动修复
```

**注意**: 如果已有数据库且 `reset_code` 列是 `VARCHAR(10)`，需要在启动日志中检查是否有列顺序重建日志。如果未重建，手动执行：

```sql
-- 备份数据后重建 users 表
CREATE TABLE users_new (...);  -- 使用 models.py 中的完整列定义
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

---

### P2-2：个人用户允许创建竞品

**文件**: `backend/app/api/competitors.py:38-41`

```python
# 修改前
@router.post("", response_model=CompetitorOut, status_code=201)
def create_competitor(payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_org(user)  # ★ 这行阻止了个人用户创建
    c = Competitor(org_id=user.org_id or "", ...)

# 修改后
@router.post("", response_model=CompetitorOut, status_code=201)
def create_competitor(payload: CompetitorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 允许个人用户创建竞品（org_id 为空表示个人竞品）
    # 企业用户的竞品属于企业维度
    org_id = user.org_id or ""
    c = Competitor(
        org_id=org_id,
        name=payload.name.strip(),
        ...
    )
```

**对应修改列表接口**（`list_competitors`）— 已支持显示个人竞品（`org_id == ""` 或匹配用户 org_id），无需修改。

**注意**: 系统级竞品（`org_id=""` 且 admin 创建）和个人竞品（`org_id=""` 且非 admin 创建）目前共享 `org_id=""`。建议增加 `created_by` 字段区分，或让个人竞品使用用户 ID 作为 `org_id` 的一部分。当前设计允许个人创建 `org_id=""` 的竞品，但会被其他用户看到。**短期修复**: 在列表查询中增加 `user_id` 过滤个人竞品。

```python
# 修改 list_competitors
q = db.query(Competitor).filter(
    (Competitor.org_id == user.org_id)   # 企业竞品
    | (Competitor.org_id == "")          # 系统级竞品（admin）
    # 个人竞品仅自己可见（如果 org_id=="" 且不是系统级的）
)
# 更精确的做法：
# 系统级竞品由 admin 创建，个人竞品由用户自己创建
# 在 Competitor 模型中增加 created_by 字段
```

---

### P2-3：画像提取任务启动恢复 ✅

**文件**: `backend/app/services/profile_extractor.py` + `main.py:57-63`

`recover_stale_tasks()` 在启动时自动恢复未完成的画像提取任务，避免进程重启丢失进度。在 `main.py` lifespan 中调用。

def get_extract_task(task_id: str) -> ExtractTask | None:
    """获取任务状态：优先内存，回退到数据库"""
    if task_id in _extract_tasks:
        return _extract_tasks[task_id]

    # 内存缓存过多时清理已完成的旧任务
    if len(_extract_tasks) > _EXTRACT_TASKS_MAX:
        _cleanup_extract_cache()

    # ... 其余逻辑不变

def _cleanup_extract_cache() -> None:
    """清理内存中已完成/失败的任务缓存"""
    to_remove = [
        tid for tid, task in _extract_tasks.items()
        if task.status in ("done", "error")
    ]
    for tid in to_remove:
        _extract_tasks.pop(tid, None)
    if to_remove:
        logger.info("cleaned %d extract tasks from memory cache", len(to_remove))
```

---

### P2-4：审计日志增加数据库触发器保护

**文件**: 新增 `backend/app/db/audit_triggers.py`

```python
"""审计日志数据库级保护：创建触发器防止 UPDATE/DELETE"""
from sqlalchemy import text
from app.db.database import engine

def create_audit_triggers():
    with engine.connect() as conn:
        # SQLite 触发器：防止 UPDATE 和 DELETE
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_update
            BEFORE UPDATE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可修改');
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
            BEFORE DELETE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, '审计日志不可删除');
            END
        """))
        conn.commit()
```

**在 `main.py` 的 `lifespan` 中调用**：

```python
@asynccontextmanager
async def lifespan(_app: FastAPI):
    migrate_columns()
    seed_admin()
    # ★ 审计日志触发器
    from app.db.audit_triggers import create_audit_triggers
    create_audit_triggers()
    # ... 其余不变
```

---

### P2-5：竞品爬虫发现阶段去重修复

**文件**: `backend/app/services/crawler.py:146-165`

```python
async def _discover_from_homepage(base: str, max_depth: int = 2) -> list[str]:
    """从首页开始 BFS 发现内部链接"""
    discovered: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(base, 0)])
    parsed_base = urlparse(base)

    while queue and len(discovered) < 100:
        url, depth = queue.popleft()
        # ★ 修复：在 popleft 后立即检查去重（而非在后续处理中）
        if url in discovered or depth > max_depth:
            continue
        discovered.add(url)  # ★ 移动到此处

        if depth >= max_depth:
            continue

        links = await _extract_links(url, parsed_base)
        for link in links:
            # ★ 添加去重检查后再加入队列
            if link not in discovered:
                queue.append((link, depth + 1))

    return list(discovered)
```

**另外，增加 sitemap_index.xml 支持**：

```python
async def _fetch_sitemap_urls(base: str, lang_prefix: str = "") -> list[str]:
    """尝试从多个路径获取 sitemap 并解析所有 <loc> URL"""
    urls: list[str] = []
    # ★ 增加 sitemap_index.xml 候选路径
    candidates = ["/sitemap.xml", "/sitemap_index.xml"]
    if lang_prefix:
        candidates = [f"/{lang_prefix}/sitemap.xml", f"/{lang_prefix}/sitemap_index.xml", "/sitemap.xml", "/sitemap_index.xml"]
    # ... 其余逻辑不变
```

---

## 五、P3 修复：低优先级优化

### P3-1：并发 refresh 竞态防御

**文件**: `frontend/src/api/client.ts`

```typescript
export async function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  const refresh = getRefreshToken()
  if (!refresh) return false

  refreshPromise = (async () => {
    try {
      const resp = await fetch('/api/auth/refresh', { ... })
      if (!resp.ok) { tokenStore.clear(); return false }
      const data = await resp.json() as TokenResponse
      if (data.access_token) {
        saveTokens(data)
        return true
      }
      return false
    } catch { return false }
    // ★ 移除 finally 中的 refreshPromise = null
    // 改为：仅在成功或明确失败时清理，避免竞态
  })()

  return refreshPromise
}

// ★ 新增：在 refreshPromise resolve 后清理
// （在 tryRefreshToken 调用处处理）
```

**修正**: 实际上 `refreshPromise` 的设计是正确的（同一个 Promise 实例被多个请求共享）。竞态问题的根源在于 `finally` 中的 `refreshPromise = null`。改为：

```typescript
export async function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  const refresh = getRefreshToken()
  if (!refresh) return false

  let result = false
  refreshPromise = (async () => {
    try {
      const resp = await fetch('/api/auth/refresh', { ... })
      if (!resp.ok) { tokenStore.clear(); return false }
      const data = await resp.json() as TokenResponse
      if (data.access_token) {
        saveTokens(data)
        result = true
      }
      return result
    } catch {
      return false
    }
    // ★ 不在这里清理 refreshPromise
  })()

  try {
    return await refreshPromise
  } finally {
    // ★ 在所有消费者都拿到结果后再清理
    // 使用 setTimeout 确保微任务队列清空
    setTimeout(() => { refreshPromise = null }, 0)
  }
}
```

---

### P3-2：增加用户级限流（第二层保护）

**文件**: 新增 `backend/app/core/rate_limit_user.py`

```python
"""用户级限流：补充 IP 级限流，防止 IP 共享场景下的滥用"""
import time
from collections import defaultdict

class UserTokenBucket:
    __slots__ = ("capacity", "refill_rate", "tokens", "last_check")
    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens: float = capacity
        self.last_check = time.time()
    def consume(self, count: int = 1) -> bool:
        now = time.time()
        elapsed = now - self.last_check
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_check = now
        if self.tokens >= count:
            self.tokens -= count
            return True
        return False

# user_id -> bucket（登录态限流）
_user_buckets: dict[str, UserTokenBucket] = defaultdict(
    lambda: UserTokenBucket(30, 30)  # 登录用户 30 req/s
)

def check_user_rate_limit(user_id: str) -> bool:
    """用户级限流检查（需要登录态）"""
    return _user_buckets[user_id].consume()
```

**在 `deps.py` 的 `get_current_user` 后增加装饰器**（或在具体端点使用）：

```python
from app.core.rate_limit_user import check_user_rate_limit

def get_current_user(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> User:
    user = _get_user_by_token(authorization[7:], db)
    if not check_user_rate_limit(user.id):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后重试")
    return user
```

---

### P3-3：前端 localStorage 清理增强

**文件**: `frontend/src/auth/AuthContext.tsx`

```tsx
// 在 logout 中增加（与 P1-3 合并）

// 额外清理可能残留的 SSE 相关状态
const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    // 清除所有持久化 stores
    const STORE_KEYS = ['task-store', 'competitor-store', 'profile-store', 'graph-store', 'tracker-store']
    STORE_KEYS.forEach(key => localStorage.removeItem(key))
    // 清除可能残留的临时状态
    sessionStorage.clear()
}, [])
```

---

## 六、后端安全加固（S-1 ~ S-6）

### S-1 修复：默认密码 + 强制修改

**文件**: `backend/app/main.py:288-304`

```python
def seed_admin() -> None:
    """启动时播种默认管理员账号（如不存在）"""
    from app.db.models import User
    with SessionLocal() as db:
        if not db.query(User).filter(User.role == "admin").first():
            admin = User(
                email="admin@example.com",
                password_hash=hash_password("Admin123456"),
                nickname="管理员",
                role="admin",
                plan="enterprise",
            )
            db.add(admin)
            db.commit()
            logger.warning(
                "已创建默认管理员：admin@example.com / Admin123456 "
                "—— 请立即修改密码并配置 JWT_SECRET"
            )
```

**新增启动检查** — `main.py` lifespan 中：

```python
@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    # ★ 生产环境安全检查
    if settings.jwt_secret in ("", "changeme", "your-secret-key"):
        logger.warning("⚠️  JWT_SECRET 未设置或使用默认值，请立即修改！")
    if not settings.smtp_host and not settings.tavily_api_key:
        logger.warning("⚠️  SMTP 和 Tavily 均未配置，部分功能不可用")
    # ... 其余不变
```

---

### S-2 修复：Fernet master_key 强制校验

**文件**: `backend/app/core/crypto.py`（新增检查）

```python
from app.core.config import get_settings

def _ensure_master_key():
    settings = get_settings()
    if not settings.master_key or len(settings.master_key) < 32:
        raise RuntimeError(
            "MASTER_KEY 未配置或过短（需 32 字节 base64）。"
            "生成方式: python -c \"import Fernet; print(Fernet.generate_key().decode())\""
        )
```

**在 `main.py` 启动时调用**：

```python
_assert_jwt_secret()
from app.core.crypto import _ensure_master_key
_ensure_master_key()
```

---

> 注：P3-1~P3-3 前端方案已部分实施（SSE 重连、主动刷新、logout 清理等）。

## 七、实施顺序建议

### 第一阶段：立即修复（P0-1 ~ P0-4）
1. `frontend/src/api/client.ts` — 主动刷新 + 401 优化 + SSE 重连
2. `frontend/src/auth/AuthContext.tsx` — 启动恢复逻辑 + logout 清理
3. 测试：模拟 token 过期场景，验证自动刷新

### 第二阶段：本周内（P1-1 ~ P1-3 + P2-1 ~ P2-3）
4. `backend/app/main.py` — CORS 环境变量
5. `backend/app/services/scheduler.py` — 时区修正
6. `frontend/src/auth/AuthContext.tsx` — logout stores 清理
7. `backend/app/db/models.py` — reset_code 长度修正
8. `backend/app/api/competitors.py` — 个人用户竞品创建
9. `backend/app/services/profile_extractor.py` — 内存缓存清理

### 第三阶段：近期（P2-4 ~ P2-5 + P3 + S-*）
10. 审计日志触发器
11. 爬虫去重修复 + sitemap_index
12. 并发 refresh 竞态防御
13. 用户级限流
14. 安全加固（master_key 校验、启动警告）

---

## 八、验证清单

修复完成后，逐项验证：

- [ ] 登录后保持页面打开 8+ 小时，观察是否自动刷新 token
- [ ] 手动将 token 过期时间改为过去，验证 refresh 流程
- [ ] 调研任务运行中关闭网络 10 秒，恢复后 SSE 自动重连
- [ ] 同时打开两个标签页，在一个标签页修改密码，另一个标签页应自动登出
- [ ] 修改密码后，旧设备的 token 应全部失效
- [ ] 登录状态下清除 localStorage 的 `cr_token`，验证启动恢复流程
- [ ] 调度器设置的追踪项在正确的时间触发（检查时区）
- [ ] 退出登录后，再次打开应用不应残留旧数据
- [ ] 个人用户（未入企）可以创建竞品
- [ ] 6 位验证码可以正确加密/解密（不超过 44 字符）
- [ ] 审计日志无法通过 ORM 或 SQL 修改/删除
