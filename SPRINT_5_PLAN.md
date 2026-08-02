# Sprint 5 修复计划 — 已完成总结

> **更新说明**：基于 agent-v5 实际代码更新。Sprint 5 计划中的 P0 和 P1 问题大部分已在 agent-v5 中修复，本文件记录实施状态和剩余工作。

---

## 实施状态总览

| 级别 | 计划数量 | 已完成 | 剩余 |
|------|----------|--------|------|
| P0 | 5 | 5 | 0 |
| P1 | 10 | 8 | 2 |
| P2 | 8 | 5 | 3 |
| P1 | 2 | 1 | 1 |

---

## P0 — 已完成 ✅

### 1. Admin Users API 500 序列化崩溃 ✅
- **修复**：手动映射 `UserOut.model_validate(u)` 替代泛型序列化
- **文件**：`backend/app/api/admin.py`

### 2. TaskDetailPage SSE 断连后永久停止订阅 ✅
- **修复**：useEffect cleanup 中重置 `subscribed.current = false`
- **文件**：`frontend/src/pages/app/TaskDetailPage.tsx`

### 3. TaskDetailPage 引用编号排序后错位 ✅
- **修复**：将原始 index 绑定到 filteredSources 元素上
- **文件**：`frontend/src/pages/app/TaskDetailPage.tsx`

### 4. NewResearchPage 额度 API 静默失败 ✅
- **修复**：增加 `quotaError` 状态和用户提示
- **文件**：`frontend/src/pages/app/NewResearchPage.tsx`

### 5. ComparisonPage 表头显示 UUID 片段 ✅
- **修复**：构建 id → name 映射，表头显示竞品名称
- **文件**：`frontend/src/pages/app/ComparisonPage.tsx`

---

## P1 — 部分完成 ⚠️

### 6. 全局 catch(() => {}) 静默吞错 ✅
- **修复**：创建 `useErrorHandler.ts` hook，各页面逐步替换
- **文件**：`frontend/src/hooks/useErrorHandler.ts`

### 7. 骨架屏替代纯文字加载 ✅
- **修复**：创建 `Skeleton.tsx` 组件
- **文件**：`frontend/src/components/Skeleton.tsx`

### 8. TrackerForm pushEmail 默认值无企业时自动关闭 ✅
- **修复**：接收 hasOrg prop，无企业时默认 false + 提示
- **文件**：`frontend/src/components/TrackerForm.tsx`

### 9. ProfileTemplatesPage 已冻结模板仍可编辑 ✅
- **修复**：编辑按钮 disabled + tooltip
- **文件**：`frontend/src/pages/app/ProfileTemplatesPage.tsx`

### 10. SourceCard 置信度条始终显示 ✅
- **修复**：始终显示置信度条，0% 时灰色空条
- **文件**：`frontend/src/components/SourceCard.tsx`

### 11. CompetitorsPage 关键词支持中文逗号 ✅
- **修复**：`split(/[,，、;\s]+/)`
- **文件**：`frontend/src/pages/app/CompetitorsPage.tsx`

### 12. TrackersPage 变更摘要保留 Markdown 格式 ✅
- **修复**：使用 ReactMarkdown 渲染
- **文件**：`frontend/src/pages/app/TrackersPage.tsx`

### 13. 统一删除确认弹窗 ✅
- **修复**：创建 `ConfirmDialog.tsx` 组件
- **文件**：`frontend/src/components/ConfirmDialog.tsx`

### 14. 轮询状态可视化 🔲（部分完成）
- **现状**：各页面有基本加载状态，但缺少"最后更新于 X 秒前"的统一显示
- **建议**：后续迭代中添加

---

## P2 — 部分完成 ⚠️

### 15. TaskDetailPage 拆分 🔲
- **现状**：870 行，尚未拆分为子组件
- **建议**：后续 Sprint 中处理

### 16. 统一 input class 常量 ✅
- **修复**：创建 `cn.ts` 工具 + `INPUT_CLS` 常量
- **文件**：`frontend/src/utils/cn.ts`

### 17. ForgotPasswordPage demo code 持久化 ✅
- **修复**：使用 sessionStorage 持久化 demo code
- **文件**：`frontend/src/pages/app/ForgotPasswordPage.tsx`

### 18. AdminPage Pagination 组件提取 ✅
- **修复**：创建独立 Pagination 组件
- **文件**：`frontend/src/components/` 下相关组件

### 19. TrackersPage reload 缓存 org 状态 🔲
- **现状**：每次 reload 都调用 getOrgMe()，可用 ref 缓存
- **建议**：后续优化

### 20. GraphDetailPage 添加「重置布局」按钮 ✅
- **修复**：添加 fitView 按钮
- **文件**：`frontend/src/pages/app/GraphDetailPage.tsx`

### 21. TrackerDetailPage 添加面包屑 ✅
- **修复**：顶部添加导航面包屑
- **文件**：`frontend/src/pages/app/TrackerDetailPage.tsx`

### 22. 全局添加 title / meta 管理 ✅
- **修复**：创建 `usePageTitle.ts` hook
- **文件**：`frontend/src/hooks/usePageTitle.ts`

### 23. 顶层 ErrorBoundary ✅
- **修复**：创建 `ErrorBoundary.tsx` 组件
- **文件**：`frontend/src/components/ErrorBoundary.tsx`

---

## 新增功能（超出原计划）

Agent 7 实现引入了以下超出原 Sprint 5 计划的功能：

| 功能 | 说明 |
|------|------|
| 竞品管理页面 | `/app/competitors` + CRUD + 爬虫 |
| 画像模板页面 | `/app/profiles/templates` + JSON 编辑器 + 冻结 |
| 竞品画像页面 | `/app/profiles` + 生成器 |
| 横向对比页面 | `/app/profiles/compare` + 矩阵表格 |
| 审计日志独立页面 | `/app/admin/audit-logs` + 完整筛选器 |
| 画像详情页面 | `/app/profiles/:id` |
| 来源去重/置信度/冲突检测 | `services/dedup.py` |
| 页面快照存档 | `services/snapshot.py` + `SourceArchive` 表 |
| RBAC 细粒度权限 | `user_permissions` 表 + `require_permission` |
| 执行快照 | `execution_snapshots` 表 + 调度器自动生成 |
| 加密服务 | `core/crypto.py` Fernet 加密 |
| 限流服务 | `core/rate_limit.py` 令牌桶 |
| 竞品爬虫 | `crawl.py` API + `crawler.py` 服务 |
| 一键启动脚本 | `start.bat` + `start.ps1` |
| SMTP 测试工具 | `_smtp_test.py` |

## v5.1 爬虫多语言修复 ✅

| 问题 | 说明 |
|------|------|
| 零页爬取 | 多语言站点（如 insta360.com/cn）爬取结果 0/50 页 |
| 根因 | 缺少语言前缀感知（启发式路径 /pricing 不带 /cn/ 前缀 → 404）、Sitemap 多语言混排不按语言过滤、readability 提取被 US privacy consent overlay 覆盖 |
| 修复 | `crawler.py`：语言前缀自动检测 + Sitemap 语言过滤 + 启发式路径适配语言前缀 + 隐私弹层 DOM 移除 + readability 提取质量回退检测 + Chrome UA |
| 验证 | insta360.com/cn 首页从 1377 字（英文弹层）修复为 ~4648 字（中文产品内容）；多语言 Sitemap 发现正常；consent overlay 自动 stripping 生效 |

---

## 执行顺序（已完成）

```
Phase 1（P0）✅ 全部完成
Phase 2（P1）✅ 大部分完成，轮询状态可视化为部分完成
Phase 3（P2）✅ 大部分完成，TaskDetailPage 拆分为待办
```

**总体完成度：约 90%**
