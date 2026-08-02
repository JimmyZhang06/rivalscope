# 竞品调研 Agent — 代码架构评审报告

**版本：** v6.0.0 | **日期：** 2026-08-03 | **分支：** agent-v6 | **评审范围：** 后端 + 前端

---

## 一、总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | ★★★★★ | 功能模块齐全，覆盖调研/图谱/追踪/画像/通知/企业/RBAC/竞品管理/审计/加密/限流 |
| 架构设计 | ★★★★☆ | 分层清晰（API/Service/Model），进程内调度为唯一架构隐患 |
| 安全性 | ★★★☆☆ | 有认证/加密/审计/限流，但进程内调度+内存状态+SQLite 有生产局限 |
| 数据一致性 | ★★★☆☆ | 有配额校验+快照，但并发场景存在竞态（SQLite 无行级锁） |
| 可扩展性 | ★★☆☆☆ | SQLite + 内存限流/缓存，多 worker 部署会出问题 |
| 可维护性 | ★★★★☆ | 代码结构清晰，注释充分，模块划分合理，23 张表 ORM 组织良好 |
| 错误处理 | ★★★★☆ | 大量 try/except 防止主流程中断，非阻断设计贯穿全系统 |

**综合评级：** 功能完整度极高，适合作为 MVP 或内部工具使用。**生产环境需关注并发竞态、SQLite 并发限制、内存限流多 worker 失效、前端 Token 存储方式** 四个架构级限制。

---

## 二、已修复的关键问题（agent-v6 已解决）

以下为 agent-v3/v4 阶段已知但已在 agent-v6 中修复的问题：

| 问题 | 原状态 | 修复状态 |
|------|--------|----------|
| Admin Users 列表序列化崩溃 | P0 — 500 错误 | ✅ 已修复 |
| ProfileTemplate/CompetitorProfile 序列化失败 | P0 — 500 错误 | ✅ 已修复 |
| run_research UnboundLocalError | P0 — 调研完全不可用 | ✅ 已修复 |
| BackgroundTasks async 执行 | P0 — 任务永远 pending | ✅ 已修复 |
| LLM 审计日志 user_id/org_id 为空 | P2 | ✅ 已修复（审计埋点完善） |
| SSE 断连后永久停止订阅 | P1 | ✅ 已修复 |
| 爬虫零页问题（多语言站点） | P1 — insta360.com/cn 0/50 页 | ✅ 已修复（语言前缀感知 + consent overlay 移除） |
| 引用编号排序后错位 | P1 | ✅ 已修复 |
| SSE 轮询 O(n) offset 开销 | P1 | ✅ 已修复（单 session 复用 + seq 增量查询） |
| 追踪列表 N+1 查询 | P1 | ✅ 已修复（窗口函数批量加载 _with_extras_batch） |
| 账号注销逐行删除 | P2 | ✅ 已修复（批量 SQL DELETE） |
| reset_code 列长度不足 | P2 | ✅ 已修复（VARCHAR(44) 适配 Fernet 输出） |
| Git hash 每次 subprocess | P2 | ✅ 已修复（启动时缓存 _GIT_HASH） |
| 审计日志无防篡改保护 | P2 | ✅ 已修复（DB 级触发器 prevent_audit_update/delete） |
| 画像任务进程重启丢失 | P2 | ✅ 已修复（recover_stale_tasks 自动恢复） |
| 调度器时区本地时间 | P2 | ✅ 已修复（UTC 基准 initial_next_run） |
| 列表端点无分页 | P2 | ✅ 已修复（research/trackers/runs 支持 page/page_size） |

---

## 三、爬虫架构更新（agent-v6.1）

`services/crawler.py` 在 agent-v6.1 中进行了关键修复，解决多语言站点（如 insta360.com/cn）返回 0 页内容的问题：

### 3.1 语言感知 URL 发现

- **语言前缀提取**：从竞品官网 URL 自动检测语言路径前缀（`/cn/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/ko/`, `/es/`, `/pt/`, `/it/`, `/ru/`, `/zh/`, `/zh-cn/`, `/zh-tw/`）
- **Sitemap 语言过滤**：sitemap 通常包含所有语言版本的 URL，发现阶段通过正则过滤只保留匹配语言前缀的 URL
- **启发式路径带前缀**：首页链接发现和启发式路径生成均携带语言前缀，避免 404

### 3.2 多路径 Sitemap 发现

- 优先尝试 `/{lang}/sitemap.xml`，回退到 `/sitemap.xml`
- Sitemap index 递归解析，支持多层级 sitemap 结构

### 3.3 Consent Overlay 移除

- 抓取页面内容前，使用正则移除包含 `consent`、`cookie`、`privacy-notice`、`gdpr`、`ccpa`、`onetrust`、`modal`、`overlay`、`banner` 关键词的 `div` 元素
- 质量回退机制：如果 readability 提取结果少于 3000 字符且匹配 consent 标记（如 "data subjects only"、"targeted advertising"、"CCPA"），回退到完整 body 文本提取

### 3.4 User-Agent 更新

- 从 `CompAgent-Crawler/1.0` 改为 Chrome 浏览器 UA：`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
- 降低被 WAF/Bot 检测系统拦截的概率

### 3.5 修复效果

| 竞品 | URL | 修复前 | 修复后 |
|------|-----|--------|--------|
| Insta360 | insta360.com/cn | 0 页 / 1377 字符（consent 弹层） | ~4600 字符实际正文 |
| 通用多语言站点 | 任意 /{lang}/ 路径 | 0 页（sitemap 无过滤） | 正常发现 + 爬取 |

---

## 四、当前架构风险

### 4.1 并发竞态：配额校验与任务创建之间有空窗

**位置：** `backend/app/api/research.py:45-57`
**描述：** `check_quota_or_403(db, user)` 在事务外执行，然后 `db.add(task)` 写入。两个并发请求可能在各自的事务中同时通过配额检查，然后各自创建任务，导致超出配额。
**修复建议：** 在数据库层面加唯一约束或使用悲观锁：
```python
with db.begin_nested():
    if not _can_create_task(db, user):
        raise HTTPException(...)
    task = ResearchTask(...)
    db.add(task)
```

### 4.2 SSE 端点轮询性能（已修复 ✅）

**位置：** `backend/app/api/research.py:282-318`
**原描述：** SSE 长连接每秒轮询一次，每次新建数据库连接。
**修复状态：** ✅ 已修复 — `research_events` 使用单 session 复用（`try/finally` 确保关闭），鉴权使用独立临时 session；查询使用 `seq > sent` 替代 `offset(sent)`，利用索引避免 O(n) 开销。

### 4.3 `parse_json` 正则存在潜在误匹配

**位置：** `backend/app/services/llm.py:93-97`
**描述：** `text.find("{")` 到 `text.rfind("}")` 截取逻辑会匹配到字符串中的非 JSON 花括号。
**修复建议：** 使用 `json.JSONDecoder().raw_decode()` 从字符串起始尝试解析。

### 4.4 内存限流在多 worker 部署下完全失效

**位置：** `backend/app/core/rate_limit.py`
**描述：** `_buckets` 是进程内全局字典。Gunicorn/Uvicorn 多个 worker 各自维护独立限流表。
**修复建议：** 生产环境替换为 Redis 实现（代码已预留接口注释）。

### 4.5 调度器时区（已修复 ✅）

**位置：** `backend/app/services/scheduler.py:73-84`
**原描述：** 服务重启后 `_running` 清空，可能导致重复触发。
**修复状态：** ✅ 时区已修复 — `initial_next_run()` 改为 UTC 基准，注释明确前端应传入 UTC 小时；`_running` 集合保持进程内防重入机制（next_run_at 持久化，重启不丢失调度计划）。git hash 启动时一次性缓存到 `_GIT_HASH`。

### 4.6 CORS 配置允许所有方法和请求头

**位置：** `backend/app/main.py:200-206`
**描述：** `allow_methods=["*"]` 和 `allow_headers=["*"]` 在开发环境可以，但生产环境应限制为实际使用的方法。

### 4.7 前端 Token 存储于 localStorage（XSS 风险）

**位置：** `frontend/src/api/client.ts:43-46`
**描述：** Access Token 和 Refresh Token 均存储在 `localStorage` 中。
**修复建议：** 生产环境改为 HttpOnly + Secure Cookie。

---

## 五、Medium 风险（建议迭代中修复）

### 4.1 后台任务无超时和资源限制

**位置：** `backend/app/services/agent.py:414`
**描述：** `run_research` 中的 LLM 调用和搜索调用没有设置超时。
**修复建议：** LLM 调用添加超时（如 120s）。

### 4.2 冲突检测策略过于宽泛

**位置：** `backend/app/services/dedup.py:96-121`
**描述：** `detect_conflicts` 将同一维度有多个来源就标记为 `pending`，会导致几乎所有维度都被标记为冲突。
**修复建议：** 改进策略：仅当来源断言直接矛盾时才标记冲突。

### 4.3 企业退出逻辑未处理「所有者转让」

**位置：** `backend/app/api/org.py:186-199`
**描述：** 企业所有者退出时无转让机制。

### 4.4 去重算法 O(n²) 性能问题

**位置：** `backend/app/services/dedup.py:76-91`
**描述：** 域名相同的来源两两比较标题相似度，来源数量较多时 O(n²)。

### 4.5 审计日志 IP/User-Agent 覆盖率

**描述：** LLM 审计的 IP 和 UA 通过调用方透传，覆盖率取决于各端点是否传入。
**修复建议：** 在 FastAPI 中间件层用 contextvars 注入请求 IP 和 UA。

---

## 六、Low 风险（技术债务，建议逐步改善）

### 5.1 重复 import

**位置：** `backend/app/api/research.py:1-5`
```python
import asyncio
# ...
import asyncio  # ← 重复
```

### 5.2 代码中有调试残留

- 部分文件含调试注释
- `backend/app/services/notify.py` 有被注释的链接 HTML 行

### 5.3 缺少日志结构化

当前使用 `logging.info("xxx %s", val)` 裸日志，无 request_id、trace_id。
**建议：** 集成 structlog 或 python-json-logger。

### 5.4 缺少健康检查深度

`/api/health` 仅返回 `{"status": "ok"}`，不检查数据库连接、LLM 可用性。
**建议：** 增加 `/api/health/ready` 检查数据库和外部依赖。

### 5.5 模块级 import 在函数内部

多处使用 `from app.services.xxx import ...` 在函数内部，虽然避免了循环导入，但掩盖了依赖关系。

### 5.6 前端 `any` 类型过多

部分文件大量使用 `any`，失去类型检查保护。

### 5.7 数据库连接未配置连接池参数

SQLite 下 `pool_size` 等参数不适用，但切换到 PostgreSQL 时应配置 `pool_size=5, max_overflow=10, pool_pre_ping=True`。

---

## 七、架构优势

1. **分层清晰：** API → Service → DB Model，职责分离明确
2. **渐进式 Agent 流程：** 规划→检索→去重/置信度/快照→分析→洞察→时间线→报告，每步持久化，前端 SSE 实时推送
3. **容错设计好：** 各阶段失败不阻断整体（洞察失败不影响报告，推送失败不影响结果）
4. **审计与可追溯：** AuditLog + ExecutionSnapshot + SourceArchive，三层可追溯
5. **加密存储：** 敏感字段（重置码）用 Fernet 加密，密钥从环境变量加载
6. **企业级功能：** RBAC 权限、企业配额、追踪调度、多渠道推送、竞品管理、画像系统，功能完整度高
7. **安全增强全面：** JWT+Refresh Token、限流、Fernet、审计、执行快照均已实现
8. **爬虫架构健壮：** 多语言站点智能识别、consent overlay 自动 stripping、Chrome UA，零页问题已解决

---

## 八、修复优先级排序

| 优先级 | 编号 | 风险 | 预估工作量 |
|--------|------|------|-----------|
| P0 | #1 | 并发竞态（配额绕过） | 1-2 天 |
| P0 | #2 | SSE 连接泄漏 | 1 天 |
| P1 | #4 | 内存限流多 worker 失效 | 2-3 天（Redis） |
| P1 | #7 | Token 存 localStorage | 2-3 天 |
| P1 | #5 | 调度器重启后状态丢失 | 1 天 |
| P2 | #3 | parse_json 鲁棒性 | 0.5 天 |
| P2 | #6 | CORS 配置收紧 | 0.5 天 |
| P2 | #11 | SQLite → PostgreSQL | 3-5 天 |
| P2 | #4.1 | 后台任务超时 | 1 天 |
| P3 | #4.2 | 冲突检测策略 | 1 天 |
| P3 | #4.4 | 去重性能 | 1 天 |
| P3 | #5.1-5.7 | 代码质量/技术债务 | 2-3 天 |

---

## 九、结论

当前代码在功能层面已经非常完整（竞品调研 Agent 流水线、企业协作、RBAC、定时追踪、审计日志、执行快照、竞品管理、竞品画像、来源存证），适合作为 MVP 或内部工具使用。

**最大的三个阻碍生产上线的风险是：**
1. 并发配额竞态（可能导致超额使用）
2. 内存限流/调度器状态在多 worker 下失效
3. 前端 Token 存储方式不安全

建议按 P0 → P1 → P2 的顺序修复后，再进行一轮安全渗透测试，即可考虑上线。
