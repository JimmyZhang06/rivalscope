"""External URL validation and redirect-safe HTTP requests.

All URLs that can be influenced by users or remote content must be validated
immediately before a request.  Resolving every address is intentional: accepting
a hostname when *one* of its answers is private still permits DNS-based SSRF.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx


class UnsafeURLException(ValueError):
    """Raised when an external URL is malformed or can reach a non-public host."""


Resolver = Callable[..., list[tuple[Any, ...]]]
_ALLOWED_SCHEMES = {"http", "https"}
_MAX_REDIRECTS = 5


def _public_ip(address: str) -> bool:
    """Return whether *address* is globally routable.

    ``is_global`` excludes private, loopback, link-local, reserved, multicast and
    unspecified ranges for both IPv4 and IPv6.
    """
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        return ip.is_global and not any(
            (
                ip.is_private,
                ip.is_loopback,
                ip.is_link_local,
                ip.is_reserved,
                ip.is_multicast,
                ip.is_unspecified,
            )
        )
    except ValueError:
        return False


def normalize_and_validate_url(
    value: str,
    *,
    allow_missing_scheme: bool = False,
    resolver: Resolver | None = None,
) -> str:
    """Normalize and validate an Internet-facing HTTP(S) URL.

    ``allow_missing_scheme`` is reserved for competitor websites, where a bare
    domain is normalized to HTTPS.  Webhooks and discovered links must provide a
    complete URL.  DNS is resolved synchronously so this function can also be
    used from Pydantic validators.
    """
    resolver = resolver or socket.getaddrinfo
    if not isinstance(value, str):
        raise UnsafeURLException("URL 必须是字符串")
    url = value.strip()
    if not url:
        raise UnsafeURLException("URL 不能为空")
    if allow_missing_scheme and "://" not in url:
        url = "https://" + url
    if any(ch.isspace() or ord(ch) < 32 for ch in url) or "\\" in url:
        raise UnsafeURLException("URL 不能包含空白、控制字符或反斜杠")

    try:
        parsed = urlsplit(url)
        scheme = parsed.scheme.lower()
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise UnsafeURLException("URL 格式无效") from exc

    if scheme not in _ALLOWED_SCHEMES:
        raise UnsafeURLException("URL 仅支持 http / https")
    if not parsed.netloc or not hostname:
        raise UnsafeURLException("URL 必须包含主机名")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeURLException("URL 不允许包含用户名或密码")

    host = hostname.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        raise UnsafeURLException("URL 不允许访问 localhost")
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise UnsafeURLException("URL 主机名无效") from exc

    # Literal IPs do not need DNS, but are subject to exactly the same policy.
    try:
        literal = ipaddress.ip_address(ascii_host.split("%", 1)[0])
    except ValueError:
        literal = None
    if literal is not None:
        if not _public_ip(str(literal)):
            raise UnsafeURLException("URL 不允许访问非公网 IP")
    else:
        try:
            answers = resolver(ascii_host, port or (443 if scheme == "https" else 80), type=socket.SOCK_STREAM)
        except (OSError, UnicodeError) as exc:
            raise UnsafeURLException("URL 主机名无法解析") from exc
        addresses = {item[4][0] for item in answers if len(item) >= 5 and item[4]}
        if not addresses:
            raise UnsafeURLException("URL 主机名无法解析")
        if any(not _public_ip(address) for address in addresses):
            raise UnsafeURLException("URL 主机名解析到非公网 IP")

    # Rebuild the authority so a trailing dot and Unicode spelling cannot create
    # discrepancies between validation and the HTTP client's interpretation.
    rendered_host = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    netloc = rendered_host + (f":{port}" if port is not None else "")
    return urlunsplit((scheme, netloc, parsed.path or "", parsed.query, parsed.fragment))


async def safe_external_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_redirects: int = _MAX_REDIRECTS,
    resolver: Resolver | None = None,
    **kwargs: Any,
) -> httpx.Response:
    """Issue a request while validating the initial URL and every redirect hop."""
    request_kwargs = dict(kwargs)
    request_kwargs.pop("follow_redirects", None)
    current_url = normalize_and_validate_url(url, resolver=resolver)
    current_method = method.upper()

    for hop in range(max_redirects + 1):
        # Re-resolve directly before every request to narrow DNS-rebinding races.
        current_url = normalize_and_validate_url(current_url, resolver=resolver)
        response = await client.request(
            current_method,
            current_url,
            follow_redirects=False,
            **request_kwargs,
        )
        if not response.is_redirect:
            return response
        if hop >= max_redirects:
            raise UnsafeURLException("URL 重定向次数过多")

        next_request = response.next_request
        if next_request is None:
            raise UnsafeURLException("URL 重定向缺少有效目标")
        current_url = normalize_and_validate_url(str(next_request.url), resolver=resolver)
        current_method = next_request.method.upper()
        # 301/302/303 may turn POST into GET; do not leak its body to the new URL.
        if current_method in {"GET", "HEAD"}:
            request_kwargs.pop("json", None)
            request_kwargs.pop("data", None)
            request_kwargs.pop("content", None)
            request_kwargs.pop("files", None)

    raise UnsafeURLException("URL 重定向次数过多")
