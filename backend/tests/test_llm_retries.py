import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import APIStatusError

from app.services import llm


@pytest.mark.parametrize("status,expected_calls", [(401, 1), (400, 1), (429, 3), (503, 3)])
def test_only_transient_errors_retry(monkeypatch, status, expected_calls):
    response = httpx.Response(status, request=httpx.Request("POST", "https://example.com"))
    error = APIStatusError("test", response=response, body=None)
    create = AsyncMock(side_effect=error)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    options = {}

    def factory(**kwargs):
        options.update(kwargs)
        return client

    monkeypatch.setattr(llm, "AsyncOpenAI", factory)
    monkeypatch.setattr(llm, "get_settings", lambda: SimpleNamespace(
        llm_model="test", llm_timeout_seconds=1,
        llm_base_url="https://example.com", llm_api_key="test",
    ))
    monkeypatch.setattr(llm.asyncio, "sleep", AsyncMock())
    with pytest.raises(APIStatusError):
        asyncio.run(llm.LLMClient().chat("system", "user"))
    assert create.await_count == expected_calls
    assert options["max_retries"] == 0
