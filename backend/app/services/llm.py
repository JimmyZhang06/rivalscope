import json
import logging
import re
import asyncio

from openai import AsyncOpenAI, APIError, APITimeoutError

from app.core.config import get_settings
from app.core.model_pricing import calc_cost

logger = logging.getLogger(__name__)


def _log_llm_audit(
    model: str, system_preview: str, user_preview: str, usage: dict,
    user_id: str = "", org_id: str = "",
    ip: str = "", user_agent: str = "",
) -> None:
    """记录 LLM 调用审计（失败不阻断主流程）"""
    try:
        from app.services.audit import log_audit
        log_audit(
            user_id=user_id,
            org_id=org_id,
            action="llm.call",
            resource_type="llm",
            resource_id=model,
            input_data=f"system: {system_preview[:100]}\nuser: {user_preview[:100]}",
            status="success",
            model_name=model[:100],
            tokens_prompt=int(usage.get("prompt_tokens") or 0),
            tokens_completion=int(usage.get("completion_tokens") or 0),
            cost=calc_cost(model, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)),
            ip=ip[:64],
            user_agent=user_agent[:300],
        )
    except Exception:
        pass


class LLMClient:
    """OpenAI 兼容接口的 LLM 客户端封装"""

    def __init__(self, user_id: str = "", org_id: str = "", ip: str = "", user_agent: str = ""):
        settings = get_settings()
        self.model = settings.llm_model
        self.client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
        self.user_id = user_id
        self.org_id = org_id
        self.ip = ip
        self.user_agent = user_agent

    async def _chat_raw(self, messages: list[dict], temperature: float = 0.3) -> str:
        last_err: Exception | None = None
        settings = get_settings()
        timeout = settings.llm_timeout_seconds
        for attempt in range(3):
            try:
                resp = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        temperature=temperature,
                    ),
                    timeout=timeout,
                )
                content = resp.choices[0].message.content or ""
                try:
                    usage = resp.usage or {}
                    _log_llm_audit(self.model, str(messages[-1].get("content", ""))[:100], str(messages[-1].get("content", ""))[:100], usage, self.user_id, self.org_id, self.ip, self.user_agent)
                except Exception:
                    pass
                return content
            except asyncio.TimeoutError:
                last_err = TimeoutError(f"LLM 调用超时（{timeout}s），模型：{self.model}")
                logger.warning("LLM timeout after %ds (attempt %d/2): %s", timeout, attempt + 1, last_err)
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise last_err  # type: ignore[misc]
            except (APITimeoutError, APIError) as exc:
                last_err = exc
                wait = 2 ** attempt
                logger.warning("LLM call retry %d/2 after %s", attempt + 1, exc)
                if attempt < 2:
                    await asyncio.sleep(wait)
        raise last_err or RuntimeError("LLM call failed")  # type: ignore[misc]

    async def chat(self, system: str, user: str, temperature: float = 0.3) -> str:
        return await self._chat_raw([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], temperature=temperature)

    async def chat_messages(self, messages: list[dict], temperature: float = 0.3) -> str:
        """多轮对话：直接传入完整 messages 列表（含 system/user/assistant）"""
        return await self._chat_raw(messages, temperature=temperature)

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
