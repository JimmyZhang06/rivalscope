# RivalScope

一套面向产品、市场和战略团队的竞品情报工作台。系统将联网检索、网页采集、结构化分析、企业画像、关系图谱和持续追踪整合在一个可审计的工作流中。

> The application provides an end-to-end workspace for competitive research, evidence-backed reports, company profiling, relationship graphs, and ongoing market monitoring.

## 核心能力

- **竞品调研**：生成检索计划，采集公开来源并输出带引用的结构化报告。
- **证据追溯**：保留来源、相关度、发布时间、访问状态及报告引用关系。
- **竞品资料库**：维护竞品信息，执行站点爬取并管理采集页面。
- **企业画像**：通过可配置模板生成、冻结和横向比较企业画像。
- **关系图谱**：分析企业、产品、合作伙伴、投资和上下游关系。
- **持续追踪**：按计划监测竞品变化，沉淀情报事件与资产。
- **组织协作**：支持个人与组织工作区、角色权限、套餐配额和审计能力。
- **智能助手**：基于已有调研数据进行问答和内容辅助。

## 技术架构

```text
React + TypeScript + Vite
          │
          │ REST / SSE
          ▼
FastAPI + SQLAlchemy
    ├── LLM（OpenAI 兼容接口）
    ├── Tavily 联网检索
    ├── 网页采集与正文抽取
    └── SQLite（默认，可替换数据库）
```

主要技术：

- 前端：React 18、TypeScript、Vite、Tailwind CSS、Zustand、Recharts、React Flow
- 后端：Python 3.12、FastAPI、SQLAlchemy、Pydantic、SSE
- 外部服务：OpenAI 兼容 LLM、Tavily；SMTP 可选

## 运行要求

- Python 3.12+
- Node.js 20.19+ 或 22.12+
- npm 10+
- 可用的 LLM API Key
- Tavily API Key（需要联网检索时）

## 快速开始

### 1. 获取代码并配置环境

```powershell
git clone https://github.com/JimmyZhang06/competitive-intel-agent.git
cd competitive-intel-agent
Copy-Item backend/.env.example backend/.env
```

编辑 `backend/.env`，至少配置：

```dotenv
APP_ENV=development
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-llm-api-key
LLM_MODEL=deepseek-chat
TAVILY_API_KEY=your-tavily-api-key
JWT_SECRET=replace-with-a-long-random-secret
```

需要找回密码、敏感字段加密等功能时，请生成 Fernet 主密钥：

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

将输出写入：

```dotenv
MASTER_KEY=generated-fernet-key
```

### 2. Windows 一键启动

```powershell
.\start.ps1
```

也可以双击 `start.bat`。首次启动会创建后端虚拟环境、安装依赖并启动前后端服务。

启动完成后访问：

- Web 应用：<http://localhost:5173>
- 后端 API：<http://127.0.0.1:8000>
- OpenAPI 文档：<http://127.0.0.1:8000/docs>

### 3. 手动启动

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

前端（新终端）：

```powershell
cd frontend
npm install
npm run dev
```

在 macOS 或 Linux 上，将虚拟环境解释器路径替换为 `.venv/bin/python`。

## 管理员初始化

首次启动前，可以在 `backend/.env` 中设置：

```dotenv
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=replace-with-a-strong-password
```

仅当两个变量同时存在时才会创建初始管理员。生产环境不要使用示例账号或弱密码。

## 配置说明

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `APP_ENV` | `development`、`test` 或 `production` | 是 |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | 是 |
| `LLM_API_KEY` | LLM 服务密钥 | 是 |
| `LLM_MODEL` | 使用的模型名称 | 是 |
| `TAVILY_API_KEY` | 联网检索 | 调研功能需要 |
| `DATABASE_URL` | 数据库连接，默认 SQLite | 否 |
| `JWT_SECRET` | 登录令牌签名密钥 | 是 |
| `MASTER_KEY` | 敏感字段的 Fernet 加密密钥 | 部分安全功能需要 |
| `SMTP_*` | 邮件发送配置 | 否 |
| `FRONTEND_BASE` | 邮件中的前端访问地址 | 否 |
| `FRONTEND_ORIGINS` | CORS 允许来源，逗号分隔 | 生产环境需要 |
| `ENABLE_SIMULATED_BILLING` | 本地演示账单；生产环境强制关闭 | 否 |

完整示例见 `backend/.env.example`。不要提交真实的 `.env`、API Key、数据库或运行日志。

## 测试与构建

后端测试：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

前端生产构建：

```powershell
cd frontend
npm ci
npm run build
```

GitHub Actions 会执行后端测试、依赖审计、安全扫描和前端生产构建。

## 项目结构

```text
.
├── backend/
│   ├── app/
│   │   ├── api/          # HTTP 与 SSE 接口
│   │   ├── core/         # 配置、安全与配额
│   │   ├── db/           # 数据库模型与会话
│   │   ├── schemas/      # API 数据模型
│   │   └── services/     # 调研、画像、图谱与采集服务
│   ├── scripts/          # 数据迁移与样例数据工具
│   └── tests/            # 后端回归测试
├── frontend/
│   └── src/
│       ├── api/          # API 客户端与类型
│       ├── auth/         # 登录态与路由保护
│       ├── components/   # 通用界面组件
│       ├── pages/        # 页面与业务交互
│       └── stores/       # 前端状态管理
├── .github/workflows/    # 持续集成
├── start.ps1             # Windows 启动脚本
└── start.bat             # Windows 双击入口
```

## 生产部署注意事项

- 设置 `APP_ENV=production`，使用强随机 `JWT_SECRET` 和独立 `MASTER_KEY`。
- 将 `FRONTEND_ORIGINS` 限制为实际域名，并通过 HTTPS 提供服务。
- 使用受控的生产数据库、备份策略和密钥管理服务。
- 配置 SMTP 后再启用真实邮件流程。
- 模拟账单只用于本地演示，生产环境不会接受模拟支付。
- 根据所使用的 LLM、搜索服务和抓取目标，遵守其服务条款与数据合规要求。

## 许可证

除第三方依赖另有声明外，本仓库内容采用 [Creative Commons Attribution-NonCommercial 4.0 International](LICENSE) 许可。

- 允许在署名的前提下复制、修改和分享。
- 仅限非商业用途。
- 商业使用、商业部署或再授权需要事先取得仓库所有者的书面许可。
- 软件及分析结果按现状提供，不附带适销性、特定用途适用性或无错误保证。

第三方依赖继续适用其各自许可证；完整法律条款以 [LICENSE](LICENSE) 为准。

## 安全

请勿在公开 Issue、日志或提交中披露 API Key、JWT 密钥、邮箱密码、数据库文件或用户数据。发现安全问题时，请通过 GitHub 仓库所有者的私密联系方式报告。
