"""LLM 模型定价表（每 1K tokens 的价格，单位：USD）"""

MODEL_PRICING: dict[str, dict[str, float]] = {
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
    # 默认回退（unknown model 时的保守估算）
    "_default": {"input": 0.0001, "output": 0.0002},
}


def calc_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """根据模型名称和 token 用量计算成本（USD）"""
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["_default"])
    return (prompt_tokens * pricing["input"] + completion_tokens * pricing["output"]) / 1000
