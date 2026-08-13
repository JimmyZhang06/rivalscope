"""Helpers for keeping long-running async workflows off the API event loop."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar


T = TypeVar("T")


async def run_coroutine_in_worker(
    func: Callable[..., Awaitable[T]],
    *args: Any,
    **kwargs: Any,
) -> T:
    """Run an async workflow in a worker thread with its own event loop.

    Research, graph, and profile workflows mix async network requests with
    synchronous SQLite writes. Running them on the API loop can stall every
    frontend request while SQLite waits for a write lock.
    """

    def _run() -> T:
        return asyncio.run(func(*args, **kwargs))

    return await asyncio.to_thread(_run)
