# 竞品调研 Agent

一个可商用交付的 SaaS 化竞品调研 Agent 应用：输入产品/公司名称，Agent 自动完成「规划 → 联网检索 → 分析 → 报告」全流程，实时展示执行进度，最终产出结构化的 Markdown 竞品调研报告（含功能对比表、SWOT 分析、信息来源引用）。

内置完整的商业化账号体系：邮箱注册登录（JWT + 会话版本控制）、三级会员套餐与月度配额、模拟支付升级、订单记录、管理员后台，以及成熟的账号管理能力（改资料/改密码/忘记密码/登录历史/退出所有设备/账号注销/用量统计）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python 3.12 · FastAPI · SQLAlchemy · SQLite · SSE · PyJWT · bcrypt |
| Agent | OpenAI 兼容 LLM（DeepSeek / 通义千问 / Kimi / OpenAI 等）· Tavily 联网检索 |
| 前端 | React 18 · TypeScript · Vite · Tailwind CSS 4 · react-router · react-markdown · recharts · html2pdf.js |

## 功能总览

- **营销首页**：Hero、产品能力、工作流程、定价表，未登录可浏览
- **账号体系**：邮箱+密码注册登录，JWT 会话（7 天）+ token 版本控制（改密码/退出所有设备后旧 token 立即失效），密码 bcrypt 加密（≥8 位含字母数字），忘记密码走验证码重置（演示模式直接展示验证码）
- **会员分级**：

  | 套餐 | 价格 | 月度调研次数 | 检索关键词组/次 | 优先队列 |
  | --- | --- | --- | --- | --- |
  | 免费版 | ¥0 | 3 | 4 | — |
  | 专业版 | ¥99/月 | 30 | 8 | ✓ |
  | 企业版 | ¥399/月 | 不限 | 12 | ✓ |

- **模拟支付**：套餐升级走模拟支付流程，支付即生效 30 天，同套餐续费自动顺延；付费到期自动回落免费版
- **工作台**：仪表盘（配额进度、统计卡、最近任务）、新建调研、调研记录、任务详情
- **任务详情**：SSE 实时进度时间线（运行中置顶展示，完成后折叠为按钮）；报告 Tab（封面头、右侧悬浮目录、引用角标气泡、来源章节结构化卡片渲染）；数据洞察 Tab（recharts 雷达图、评分对比、SWOT 矩阵、总体结论）；信息来源 Tab（概览统计卡、可信度堆叠分布条、分级/维度筛选、相关度/编号/时间排序、双列来源卡片、来源详情抽屉）
- **报告导出**：头部下拉菜单一键下载 PDF / Word / Markdown，或调起浏览器打印；导出走独立离屏模板（封面 + 正文 + 来源附录），与页面目录/布局完全解耦，PDF 为 A4 纵向自动分页，Word 以页面视图 + A4 页边距打开
- **个人中心（三 Tab）**：
  - 概览：头像（8 种预设色，或上传图片自动压缩为 128×128）、昵称行内编辑、本月用量进度条、近 6 个月用量柱状图、套餐状态
  - 安全：修改密码（当前设备无感换新 token）、登录历史（时间/动作/IP/设备）、退出所有设备、注销账号（密码确认 + 级联删除全部数据，管理员不可注销）
  - 订单：订单记录表格
- **管理后台**（仅管理员）：运营统计（用户数/付费用户/收入/任务量）、用户搜索、直接调整用户套餐与角色（不能取消自己的管理员权限）
- **数据隔离**：用户只能访问自己的调研任务，管理员可查看全部

## 项目结构

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（CORS、路由注册、建表+轻量迁移、播种管理员）
│   │   ├── core/
│   │   │   ├── config.py        # 环境变量配置（含 JWT_SECRET）
│   │   │   ├── plans.py         # 会员套餐权益表与有效套餐计算
│   │   │   └── security.py      # bcrypt 密码哈希 + JWT 签发/校验（含会话版本 ver）
│   │   ├── db/                  # SQLAlchemy engine + ORM 模型（User/Order/LoginLog/Task/Step/Source）
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── api/
│   │   │   ├── deps.py          # 认证依赖（token 版本校验）+ 配额计算
│   │   │   ├── auth.py          # 注册/登录/资料/改密码/登录历史/退出所有设备/注销/用量/忘记密码
│   │   │   ├── research.py      # 调研任务 REST + SSE（鉴权 + 用户隔离 + 配额）
│   │   │   ├── billing.py       # 套餐列表/模拟支付升级/订单
│   │   │   └── admin.py         # 管理后台统计与用户管理
│   │   └── services/
│   │       ├── llm.py           # OpenAI 兼容 LLM 客户端
│   │       ├── search.py        # Tavily 检索客户端
│   │       └── agent.py         # Agent 编排（规划→检索→分析→报告，按套餐限定检索规模）
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    └── src/
        ├── api/                 # API client（Bearer token 注入、401 处理）+ SSE 订阅
        ├── auth/                # AuthContext + 路由守卫（RequireAuth/RequireAdmin）
        ├── layouts/             # 工作台侧边栏布局
        ├── pages/               # 营销首页、登录/注册/忘记密码、app/ 下各工作台页面
        ├── components/          # 进度时间线、报告渲染、目录、来源抽屉、洞察图表、套餐徽标等
        └── utils/               # 报告导出模块（PDF/Word/Markdown 独立模板）、来源章节拆分
```

## 快速开始

### 1. 配置 API Key

```powershell
Copy-Item backend\.env.example backend\.env
```

编辑 `backend/.env`，填入：

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`：任意 OpenAI 兼容服务，例如
  - DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
  - 通义千问：`https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-plus`
- `TAVILY_API_KEY`：在 [tavily.com](https://tavily.com) 免费注册获取（1000 次/月）
- `JWT_SECRET`：生产环境务必改为随机长字符串

### 2. 启动后端（端口 8000）

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

首次启动自动建表并播种默认管理员：`admin@example.com` / `Admin123456`（生产环境请立即修改）。

### 3. 启动前端（端口 5173）

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问 http://localhost:5173 即可使用。API 文档见 http://localhost:8000/docs。

## Agent 工作流

1. **规划**：LLM 根据调研对象与重点，确定竞品清单并生成多组搜索关键词（组数由用户套餐决定：4/8/12 组）
2. **检索**：并发调用 Tavily API 执行搜索，按 URL 去重后入库
3. **分析**：LLM 基于检索材料按维度提炼，材料未覆盖的内容明确标注信息不足
4. **报告**：LLM 生成 Markdown 报告（执行摘要、功能对比表、定价对比、SWOT、结论建议、来源引用）

每一步写入 `task_steps` 表，前端通过 SSE（`GET /api/research/{id}/events?token=…`）实时展示进度时间线。

## API 一览

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 注册并返回 JWT | — |
| POST | `/api/auth/login` | 登录并返回 JWT | — |
| GET | `/api/auth/me` | 当前用户信息 | 用户 |
| PATCH | `/api/auth/profile` | 修改昵称/头像 | 用户 |
| POST | `/api/auth/change-password` | 修改密码（返回新 token，旧 token 全部失效） | 用户 |
| GET | `/api/auth/logins` | 最近 20 条登录历史 | 用户 |
| POST | `/api/auth/logout-all` | 退出所有设备（返回新 token） | 用户 |
| DELETE | `/api/auth/account` | 注销账号（密码确认，级联删除全部数据） | 用户 |
| GET | `/api/auth/usage` | 近 6 个月用量 + 本月配额 | 用户 |
| POST | `/api/auth/forgot` | 获取重置验证码（演示模式直接返回） | — |
| POST | `/api/auth/reset` | 验证码重置密码 | — |
| GET | `/api/research/quota` | 本月配额与用量 | 用户 |
| POST | `/api/research` | 创建调研任务（校验配额） | 用户 |
| GET | `/api/research` | 我的任务列表 | 用户 |
| GET | `/api/research/{id}` | 任务详情（含报告、步骤、来源） | 用户 |
| GET | `/api/research/{id}/events?token=…` | SSE 实时进度 | 用户 |
| GET | `/api/research/{id}/sources/{sid}` | 来源详情（含原文摘录） | 用户 |
| DELETE | `/api/research/{id}` | 删除任务 | 用户 |
| GET | `/api/billing/plans` | 套餐列表 | — |
| POST | `/api/billing/upgrade` | 模拟支付升级套餐 | 用户 |
| GET | `/api/billing/orders` | 我的订单 | 用户 |
| GET | `/api/admin/stats` | 运营统计 | 管理员 |
| GET | `/api/admin/users?q=` | 用户列表/搜索 | 管理员 |
| PATCH | `/api/admin/users/{id}` | 调整用户套餐/角色 | 管理员 |
