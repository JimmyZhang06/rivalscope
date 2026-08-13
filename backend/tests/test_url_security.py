import asyncio
import socket

import httpx
import pytest

from app.core.url_security import (
    UnsafeURLException,
    normalize_and_validate_url,
    safe_external_request,
)


def resolver_for(*addresses: str):
    def resolve(host: str, port: int, **_kwargs):
        family = socket.AF_INET6 if ":" in addresses[0] else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (address, port)) for address in addresses]

    return resolve


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/file",
        "http://user:secret@example.com/",
        "http://localhost/admin",
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://224.0.0.1/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[fe80::1]/",
    ],
)
def test_rejects_unsafe_urls(url: str):
    with pytest.raises(UnsafeURLException):
        normalize_and_validate_url(url)


def test_normalizes_bare_website_and_accepts_public_dns():
    result = normalize_and_validate_url(
        "Example.COM./products?q=1",
        allow_missing_scheme=True,
        resolver=resolver_for("93.184.216.34"),
    )
    assert result == "https://example.com/products?q=1"


def test_webhook_style_url_requires_scheme():
    with pytest.raises(UnsafeURLException):
        normalize_and_validate_url("example.com/hook", resolver=resolver_for("93.184.216.34"))


def test_rejects_hostname_if_any_dns_answer_is_not_public():
    with pytest.raises(UnsafeURLException):
        normalize_and_validate_url(
            "https://mixed.example/path",
            resolver=resolver_for("93.184.216.34", "192.168.1.9"),
        )


def test_redirect_target_is_revalidated_before_second_request():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(UnsafeURLException):
                await safe_external_request(
                    client,
                    "GET",
                    "https://public.example/start",
                    resolver=resolver_for("93.184.216.34"),
                )

    asyncio.run(run())

    assert seen == ["https://public.example/start"]


def test_safe_public_redirect_is_followed_manually():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/done"})
        return httpx.Response(200, text="ok")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await safe_external_request(
                client,
                "GET",
                "https://public.example/start",
                resolver=resolver_for("93.184.216.34"),
            )

    response = asyncio.run(run())

    assert response.text == "ok"
    assert seen == ["https://public.example/start", "https://public.example/done"]
