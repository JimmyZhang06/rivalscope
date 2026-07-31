import json
import re

from openai import AsyncOpenAI

from app.core.config import get_settings


class LLMClient:
    """OpenAI 兼容接口的 LLM 客户端封装"""

    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.llm_model
        self.client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)

    async def chat(self, system: str, user: str, temperature: float = 0.3) -> str:
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""

    async def chat_messages(self, messages: list[dict], temperature: float = 0.3) -> str:
        """多轮对话：直接传入完整 messages 列表（含 system/user/assistant）"""
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""

    async def chat_json(self, system: str, user: str) -> dict:
        """要求 LLM 输出 JSON 并解析；容忍代码块包裹等常见格式"""
        text = await self.chat(system + "\n\n只输出 JSON，不要输出任何其他内容。", user)
        return parse_json(text)


def parse_json(text: str) -> dict:
    """从 LLM 输出中尽力提取 JSON 对象"""
    text = text.strip()
    # 去掉 ```json ... ``` 代码块包裹
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match.group(1)
    # 截取第一个 { 到最后一个 } 之间的内容
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)
