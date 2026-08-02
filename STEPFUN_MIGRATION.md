# StepFun 迁移报告

> **版本**: v6.0.0 | **日期**: 2026-08-03 | **分支**: agent-v6

## TL;DR

**改动极小，改动量约 10 行，核心代码几乎不需要动。** 原因是该项目已经基于 OpenAI 兼容接口设计，而 StepFun 的 `step-3.7-flash` 等模型完全兼容 OpenAI Chat Completions API。

---

## 一、当前 LLM 架构分析

### 1.1 核心客户端（唯一入口）

文件：`backend/app/services/llm.py`（105 行）

```python
from openai import AsyncOpenAI, APIError, APITimeoutError

class LLMClient:
    def __init__(self, ...):
        settings = get_settings()
        self.model = settings.llm_model
        self.client = AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key
        )

    async def _chat_raw(self, messages, temperature=0.3):
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content
```

关键设计：
- 使用 `openai` Python SDK 的 `AsyncOpenAI`
- 调用的是 `chat.completions.create` — **标准 OpenAI Chat Completions 格式**
- `base_url` 和 `api_key` 从 `Settings`（环境变量）读取
- 提供 `chat()` / `chat_messages()` / `chat_json()` 三种调用方式

### 1.2 配置链路

```
.env 文件
  → pydantic-settings (config.py: Settings)
    → LLMClient.__init__() 读取 llm_base_url / llm_api_key / llm_model
```

`backend/.env.example` 当前默认：
```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-llm-api-key
LLM_MODEL=deepseek-chat
```

### 1.3 调用方（6 个服务模块，全部通过 LLMClient）

| 文件 | 用途 |
|------|------|
| `services/agent.py` | 竞品调研 Agent（规划/分析/洞察/报告 5 阶段） |
| `services/graph_agent.py` | 产业链图谱 Agent（规划/抽取/报告） |
| `services/product_intel.py` | 竞品产品情报（两层 LLM 调用：广度综合 + 深度提取） |
| `services/digest.py` | 追踪任务变更摘要 |
| `services/assistant.py` | 全局 AI 问答助手 |
| `services/profile_report.py` | 画像报告生成 |

**全部通过 `from app.services.llm import LLMClient` 调用，改动只需集中在一处。**

---

## 二、StepFun API 兼容性对比

根据你提供的 StepFun 接入信息：

| 项目 | StepFun | 当前代码 |
|------|----------|----------|
| **Base URL** | `https://api.stepfun.com/step_plan/v1` | 传入 `llm_base_url` 环境变量 |
| **Chat API** | `POST /chat/completions` (OpenAI 兼容) | ✅ 完全兼容 |
| **Messages API** | `POST /messages` (Claude 兼容) | 代码只用了 Chat 格式，不需要 |
| **认证方式** | Bearer Token | ✅ `api_key` 参数 |
| **Model 名称** | `step-3.7-flash` 等 | 传入 `llm_model` 环境变量 |

**结论：StepFun 的 Chat Completions API 与当前代码使用的 `client.chat.completions.create()` 100% 兼容。**

---

## 三、迁移方案（分步）

### 步骤 1：修改 `.env` 文件（核心配置）

当前 `backend/.env`：
```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-deepseek-api-key
LLM_MODEL=deepseek-chat
```

改为：
```env
LLM_BASE_URL=https://api.stepfun.com/step_plan/v1
LLM_API_KEY=6upSgh...SM1j92    # 你的 StepFun 密钥
LLM_MODEL=step-3.7-flash        # 或 step-3.5-flash / step-router-v1
```

### 步骤 2：更新 `model_pricing.py`（成本统计）

当前支持的模型定价：

文件：`backend/app/core/model_pricing.py`

需要添加 StepFun 模型的定价：

```python
MODEL_PRICING = {
    # DeepSeek
    "deepseek-chat": {"input": 0.0001, "output": 0.0002},
    "deepseek-reasoner": {"input": 0.0004, "output": 0.0016},
    # OpenAI
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "o3-mini": {"input": 0.0011, "output": 0.0044},
    # Anthropic
    "claude-sonnet-4-20250514": {"input": 0.003, "output": 0.015},
    "claude-haiku-4-5-20251001": {"input": 0.0008, "output": 0.004},
    # ★ 新增：StepFun
    "step-3.7-flash": {"input": 0.0005, "output": 0.0020},   # 参考价格，以实际账单为准
    "step-3.5-flash": {"input": 0.0003, "output": 0.0010},
    "step-3.5-flash-2603": {"input": 0.0003, "output": 0.0010},
    "step-router-v1": {"input": 0.0008, "output": 0.0024},
    # 默认回退
    "_default": {"input": 0.0001, "output": 0.0002},
}
```

> ⚠️ StepFun 定价请以官方文档为准，上面是估算值。

### 步骤 3：更新 `.env.example` 注释（文档）

文件：`backend/.env.example`

把注释从 DeepSeek 示例改为 StepFun 示例即可：

```env
# LLM 配置（OpenAI 兼容接口，支持 OpenAI / DeepSeek / 通义千问 / Kimi / StepFun 等）
# 示例（StepFun）: https://api.stepfun.com/step_plan/v1
LLM_BASE_URL=https://api.stepfun.com/step_plan/v1
LLM_API_KEY=your-llm-api-key
LLM_MODEL=step-3.7-flash
```

### 步骤 4：验证迁移

启动后端服务，执行一次完整调研，观察日志中 LLM 调用的 model 名称：

```bash
cd backend
pip install -r requirements.txt   # openai SDK 已包含，无需额外安装
uvicorn app.main:app --reload
```

在日志中确认：
- `model_name=step-3.7-flash`（审计日志中的 model 名称）
- 调研流程正常完成

---

## 四、改动汇总

| 文件 | 改动 | 行数 |
|------|------|------|
| `backend/.env` | 修改 3 个值（base_url, api_key, model） | 3 |
| `backend/app/core/model_pricing.py` | 添加 StepFun 模型定价条目 | ~4 |
| `backend/.env.example` | 更新注释和示例值 | ~3 |
| **合计** | | **~10 行** |

**不需要修改的文件（零改动）：**
- `app/services/llm.py` — OpenAI SDK 兼容，不需要改
- `app/services/agent.py` — 所有 LLM 调用通过 LLMClient，不需要改
- `app/services/graph_agent.py` — 同上
- `app/services/product_intel.py` — 同上
- `app/services/digest.py` — 同上
- `app/services/assistant.py` — 同上
- `app/services/profile_report.py` — 同上
- `app/core/config.py` — 配置字段是通用的
- `requirements.txt` — `openai` SDK 已存在
- `app/api/*` — API 层不涉及 LLM 调用细节

---

## 五、风险与注意事项

1. **StepFun 兼容性**：StepFun 的 Chat Completions 接口与 OpenAI 格式完全兼容，但不同模型的能力和输出风格有差异。建议先用 `step-3.7-flash`（推理模型）替代 `deepseek-chat`，推理能力更强，适合调研分析场景。

2. **Prompt 调整**：DeepSeek 和 StepFun 的系统 prompt 遵循能力接近，现有 prompt（中文分析、JSON 输出等）大概率无需调整。如果发现 JSON 解析失败率增加，可微调 system prompt 中的格式要求。

3. **定价准确性**：StepFun 定价以官方文档为准，迁移前请确认各模型的价格。

4. **速率限制**：StepFun 的 rate limit 可能与 DeepSeek 不同，如果遇到 429，需在 `LLMClient` 中调整重试策略（当前是 3 次指数退避，可直接复用）。

5. **审计日志**：`_log_llm_audit` 会记录 model_name，迁移后审计日志中会自然显示 `step-3.7-flash` 等，无需修改。

---

## 六、一句话总结

> **只改环境变量和配置文件，不动一行业务代码。** 因为项目从第一天起就是基于 OpenAI 兼容接口设计的，StepFun 的 Chat Completions API 完美适配。
