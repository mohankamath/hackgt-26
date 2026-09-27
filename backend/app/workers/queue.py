"""Moderation work queue.

Platform listeners enqueue raw payloads and return immediately; N async workers run the
(slow, network-bound) moderation + persistence. A slow OpenAI call therefore never blocks
Discord's gateway heartbeat or the Instagram poller.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger("screened.queue")

Handler = Callable[[Any], Awaitable[Any]]


class ModerationQueue:
    def __init__(self, handler: Handler, workers: int = 4, maxsize: int = 1000) -> None:
        self._handler = handler
        self._n = max(1, workers)
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._workers: list[asyncio.Task] = []
        self.processed = 0
        self.failed = 0

    @property
    def size(self) -> int:
        return self._queue.qsize()

    @property
    def running(self) -> bool:
        return any(not w.done() for w in self._workers)

    async def start(self) -> None:
        if self.running:
            return
        self._workers = [asyncio.create_task(self._worker(i), name=f"moderation-worker-{i}") for i in range(self._n)]

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []

    async def enqueue(self, item: Any) -> None:
        """Queue an item. Only waits if the queue is full (backpressure)."""
        await self._queue.put(item)

    async def join(self) -> None:
        await self._queue.join()

    async def _worker(self, idx: int) -> None:
        while True:
            item = await self._queue.get()
            try:
                await self._handler(item)
                self.processed += 1
            except asyncio.CancelledError:
                raise
            except Exception:
                self.failed += 1
                log.exception("worker %d failed to process item", idx)
            finally:
                self._queue.task_done()
