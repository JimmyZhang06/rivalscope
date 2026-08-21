# RivalScope

[![CI](https://github.com/JimmyZhang06/rivalscope/actions/workflows/ci.yml/badge.svg?branch=agent-main)](https://github.com/JimmyZhang06/rivalscope/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20.19%2B-339933?logo=node.js&logoColor=white)
[![License](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-6B7280)](LICENSE)

**Evidence-backed competitive intelligence, from open-web research to durable organizational knowledge.**

RivalScope 是一套面向产品、市场、战略与研究团队的竞品情报平台。它将联网检索、网页采集、证据治理、企业画像、横向对比、关系图谱与持续监测整合为统一工作流，帮助团队形成可追溯、可复用、可协作的市场认知。

> 本项目以源码可见方式发布，仅允许符合许可证定义的非商业用途。商业部署或商业使用需要另行取得书面授权。

## 产品能力

| 能力 | 说明 |
| --- | --- |
| 竞品调研 | 根据产品与关注方向生成检索计划，采集公开信息并形成结构化报告 |
| 证据追溯 | 保存来源链接、发布时间、相关度、访问状态和报告引用关系 |
| 竞品资料库 | 管理竞品、站点采集任务及抓取页面，沉淀长期研究资产 |
| 企业画像 | 使用可配置模板生成标准化画像，并支持冻结、版本记录与横向比较 |
| 关系图谱 | 提取企业、产品、合作、投资及上下游关系，生成可交互图谱 |
| 持续监测 | 通过定时追踪捕获竞品变化，并归档为情报事件和内容资产 |
| 智能助手 | 基于已沉淀的调研数据提供问答、归纳和内容辅助 |
| 团队治理 | 提供个人/组织工作区、成员角色、套餐配额、审计与会话安全能力 |

## 工作流

```text
研究目标
   │
   ▼
检索规划 ──► 联网搜索 ──► 页面采集 ──► 证据清洗与去重
                                           │
                                           ▼
                         分析报告 / 企业画像 / 关系图谱
                                           │
                                           ▼
                              持续追踪与团队知识资产
```

调研任务通过 SSE 返回阶段进度；报告结论与来源材料保持引用关系，便于复核和二次分析。

## 技术架构

```text
┌──────────────────────────────────────────────────────────┐
│ React 18 · TypeScript · Vite · Zustand · Recharts       │
└───────────────────────────┬──────────────────────────────┘
                            │ REST / SSE
┌───────────────────────────▼──────────────────────────────┐
│ FastAPI · Pydantic · SQLAlchemy · JWT                   │
├──────────────────────────────────────────────────────────┤
│ Research · Crawling · Profiles · Graph · Monitoring     │
└───────────────┬───────────────────────┬──────────────────┘
                │                       │
        OpenAI-compatible LLM       Tavily Search
                │                       │
                └───────────┬───────────┘
                            ▼
                  SQLite by default
```

### 技术栈

- **前端**：React、TypeScript、Vite、Tailwind CSS、Zustand、Recharts、React Flow
- **后端**：Python、FastAPI、SQLAlchemy、Pydantic、SSE、JWT、bcrypt
- **数据与集成**：SQLite、OpenAI 兼容模型接口、Tavily、SMTP（可选）
- **质量保障**：pytest、TypeScript 编译、Vite 生产构建、GitHub Actions、Bandit、依赖审计

## 快速开始

### 环境要求

- Python 3.12+
- Node.js 20.19+ 或 22.12+
- npm 10+
- OpenAI 兼容的模型服务凭据
- Tavily API Key（需要联网检索时）

### 1. 获取项目

```powershell
git clone https://github.com/JimmyZhang06/rivalscope.git
cd rivalscope
Copy-Item backend/.env.example backend/.env
```

### 2. 配置服务

编辑 `backend/.env`，本地运行至少需要：

```dotenv
APP_ENV=development

LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=replace-with-your-key
LLM_MODEL=deepseek-chat

TAVILY_API_KEY=replace-with-your-key
JWT_SECRET=replace-with-a-long-random-secret
```

需要密码找回、敏感字段加密等功能时，生成独立的 Fernet 主密钥：

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

将输出写入 `backend/.env`：

```dotenv
MASTER_KEY=replace-with-generated-fernet-key
```

### 3. 启动应用

Windows 一键启动：

```powershell
.\start.ps1
```

也可以双击 `start.bat`。首次运行会创建 Python 虚拟环境并安装前后端依赖。

服务地址：

- 前端：<http://localhost:5173>
- API：<http://127.0.0.1:8000>
- OpenAPI：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/api/health>

### 手动启动

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

macOS 或 Linux 请将 Python 路径替换为 `.venv/bin/python`。

## 配置参考

| 变量 | 作用 | 要求 |
| --- | --- | --- |
| `APP_ENV` | 运行环境：`development`、`test`、`production` | 必填 |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | 必填 |
| `LLM_API_KEY` | 模型服务凭据 | 必填 |
| `LLM_MODEL` | 模型名称 | 必填 |
| `LLM_TIMEOUT_SECONDS` | 模型请求超时秒数 | 可选 |
| `TAVILY_API_KEY` | 联网检索凭据 | 调研功能需要 |
| `DATABASE_URL` | SQLAlchemy 数据库连接 | 默认使用 SQLite |
| `JWT_SECRET` | 登录令牌签名密钥 | 必填，生产环境必须更换 |
| `JWT_EXPIRE_DAYS` | 登录令牌有效期 | 可选 |
| `MASTER_KEY` | 敏感字段 Fernet 加密密钥 | 安全相关功能需要 |
| `SMTP_*` | 邮件服务器、账号与发件人 | 邮件功能需要 |
| `FRONTEND_BASE` | 邮件链接中的前端地址 | 可选 |
| `FRONTEND_ORIGINS` | CORS 允许来源，逗号分隔 | 生产环境必须限制 |
| `SEED_ADMIN_EMAIL` | 初始管理员邮箱 | 与密码同时配置 |
| `SEED_ADMIN_PASSWORD` | 初始管理员密码 | 与邮箱同时配置 |
| `ENABLE_SIMULATED_BILLING` | 本地演示账单 | 生产环境强制禁用 |

完整模板见 [`backend/.env.example`](backend/.env.example)。不得提交真实 `.env`、API Key、邮件密码、数据库或用户数据。

## 管理员初始化

在首次启动前配置以下两个变量：

```dotenv
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=replace-with-a-strong-password
```

仅当邮箱和密码同时存在时才会初始化管理员。完成首次部署后，建议从运行环境中移除明文初始化密码。

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

持续集成会执行：

- Python 编译与 pytest 回归测试
- Python 依赖漏洞审计与高置信度安全扫描
- npm 依赖安装、TypeScript 检查和 Vite 生产构建

## 项目结构

```text
.
├── backend/
│   ├── app/
│   │   ├── api/          # REST、SSE 与权限入口
│   │   ├── core/         # 配置、安全、配额与基础设施
│   │   ├── db/           # 数据模型、会话与审计触发器
│   │   ├── schemas/      # 请求和响应模型
│   │   └── services/     # 调研、采集、画像、图谱与监测服务
│   ├── scripts/          # 数据迁移与样例数据工具
│   └── tests/            # 后端回归测试
├── frontend/
│   └── src/
│       ├── api/          # API 客户端与共享类型
│       ├── auth/         # 身份状态与路由保护
│       ├── components/   # 通用界面组件
│       ├── pages/        # 页面与业务流程
│       └── stores/       # Zustand 状态管理
├── .github/workflows/    # 持续集成
├── start.ps1             # Windows 自动启动脚本
└── start.bat             # Windows 双击入口
```

## 生产部署基线

- 使用 `APP_ENV=production`，并通过密钥管理服务注入 `JWT_SECRET`、`MASTER_KEY` 和第三方凭据。
- 将 `FRONTEND_ORIGINS` 限制为可信 HTTPS 域名，不使用开发环境通配配置。
- 使用独立数据库、定期备份、迁移审查和最小权限账号。
- 仅在 SMTP 配置和邮件域名验证完成后启用真实邮件发送。
- 模拟账单只用于开发演示；生产环境不会接受模拟支付。
- 根据模型服务、搜索服务和目标站点的条款处理数据来源、个人信息与内容版权。

## 安全与负责任使用

- 不要在提交、Issue、日志或截图中披露密钥、邮箱密码、访问令牌或用户数据。
- 只采集依法允许访问的公开信息，并尊重目标站点条款、robots 策略和适用法律。
- AI 生成内容可能存在遗漏或错误；重要结论应结合引用来源进行人工复核。
- 安全问题请通过 GitHub 仓库所有者的私密联系方式报告，不要公开披露可利用细节。

## 许可证

Copyright © 2026 JimmyZhang06. All rights reserved.

RivalScope 依据 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供源码，仅授权许可证定义范围内的非商业用途，包括个人研究、学习、实验以及符合条款的非商业组织使用。

以下场景需要事先取得单独的书面商业授权：

- 将 RivalScope 用于营利性业务、商业服务或收费产品；
- 代表商业组织部署、托管、集成或修改本软件；
- 将本软件或其衍生版本作为商业解决方案的一部分提供给第三方。

第三方依赖及外部服务继续适用其各自的许可证和服务条款。完整且具有约束力的授权条件以 [LICENSE](LICENSE) 为准。

如需商业许可，请通过 [GitHub 仓库所有者](https://github.com/JimmyZhang06) 联系。
