import asyncio
import threading

from app.core.background import run_coroutine_in_worker


def test_coroutine_runs_outside_api_event_loop_thread():
    caller_thread = threading.get_ident()

    async def workflow():
        return threading.get_ident()

    worker_thread = asyncio.run(run_coroutine_in_worker(workflow))

    assert worker_thread != caller_thread


def test_blocking_workflow_does_not_stall_caller_loop():
    ticked = False

    async def workflow():
        threading.Event().wait(0.05)

    async def ticker():
        nonlocal ticked
        await asyncio.sleep(0.01)
        ticked = True

    async def scenario():
        await asyncio.gather(run_coroutine_in_worker(workflow), ticker())

    asyncio.run(scenario())

    assert ticked
