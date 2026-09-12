"""Job store and event fan-out.

Every tool run is a Job. A job emits a stream of events; the HTTP layer
replays past events to late subscribers and then follows the live stream, so
a browser that reloads mid-run still sees the whole log.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Literal

from .config import ARTIFACT_DIR, JOB_HISTORY

JobState = Literal["queued", "running", "succeeded", "failed", "cancelled"]
TERMINAL: set[str] = {"succeeded", "failed", "cancelled"}


@dataclass
class Event:
    seq: int
    type: str  # "log" | "status" | "progress" | "artifact" | "done"
    data: dict[str, Any]
    ts: float = field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "type": self.type, "ts": self.ts, **self.data}


@dataclass
class Artifact:
    name: str
    size: int
    content_type: str = "application/octet-stream"

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "size": self.size, "content_type": self.content_type}


class Job:
    def __init__(self, tool: str, inputs: dict[str, Any]) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.tool = tool
        self.inputs = inputs
        self.state: JobState = "queued"
        self.error: str | None = None
        self.created_at = time.time()
        self.finished_at: float | None = None
        self.events: list[Event] = []
        self.artifacts: list[Artifact] = []
        self.task: asyncio.Task[Any] | None = None
        self._subscribers: set[asyncio.Queue[Event | None]] = set()
        self._seq = 0

    # -- directories ----------------------------------------------------
    @property
    def dir(self) -> Path:
        d = ARTIFACT_DIR / self.id
        d.mkdir(parents=True, exist_ok=True)
        return d

    # -- emitting -------------------------------------------------------
    def emit(self, type: str, **data: Any) -> None:
        self._seq += 1
        ev = Event(seq=self._seq, type=type, data=data)
        self.events.append(ev)
        for q in list(self._subscribers):
            q.put_nowait(ev)

    def log(self, line: str) -> None:
        self.emit("log", line=line.rstrip("\n"))

    def progress(self, fraction: float | None = None, label: str | None = None) -> None:
        self.emit("progress", fraction=fraction, label=label)

    def set_state(self, state: JobState, error: str | None = None) -> None:
        self.state = state
        self.error = error
        if state in TERMINAL:
            self.finished_at = time.time()
        self.emit("status", state=state, error=error)
        if state in TERMINAL:
            self.emit("done", state=state, error=error,
                      artifacts=[a.as_dict() for a in self.artifacts])
            self._close_subscribers()

    def add_artifact(self, path: Path, content_type: str = "application/octet-stream") -> None:
        art = Artifact(name=path.name, size=path.stat().st_size, content_type=content_type)
        self.artifacts.append(art)
        self.emit("artifact", **art.as_dict())

    # -- subscription ---------------------------------------------------
    async def stream(self, after: int = 0) -> AsyncIterator[Event]:
        """Replay events after `after`, then follow live until terminal."""
        q: asyncio.Queue[Event | None] = asyncio.Queue()
        backlog = [e for e in self.events if e.seq > after]
        last = backlog[-1].seq if backlog else after
        self._subscribers.add(q)
        try:
            for ev in backlog:
                yield ev
            if self.state in TERMINAL and self._is_finalised(last):
                return
            while True:
                ev = await q.get()
                if ev is None:
                    return
                if ev.seq <= last:
                    continue
                last = ev.seq
                yield ev
        finally:
            self._subscribers.discard(q)

    def _is_finalised(self, last_seq: int) -> bool:
        return bool(self.events) and self.events[-1].seq <= last_seq

    def _close_subscribers(self) -> None:
        for q in list(self._subscribers):
            q.put_nowait(None)

    # -- serialisation --------------------------------------------------
    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tool": self.tool,
            "state": self.state,
            "error": self.error,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "inputs": self.inputs,
            "artifacts": [a.as_dict() for a in self.artifacts],
        }


class JobStore:
    def __init__(self, limit: int = JOB_HISTORY) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._limit = limit

    def create(self, tool: str, inputs: dict[str, Any]) -> Job:
        job = Job(tool, inputs)
        self._jobs[job.id] = job
        self._evict()
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self, tool: str | None = None, limit: int = 50) -> list[Job]:
        jobs = [j for j in self._jobs.values() if tool is None or j.tool == tool]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)[:limit]

    def active_ids(self) -> set[str]:
        """Job ids still writing to disk -- retention must not touch these."""
        return {j.id for j in self._jobs.values() if j.state not in TERMINAL}

    async def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None or job.state in TERMINAL:
            return False
        if job.task is not None:
            job.task.cancel()
        return True

    def _evict(self) -> None:
        finished = [j for j in self._jobs.values() if j.state in TERMINAL]
        while len(self._jobs) > self._limit and finished:
            victim = finished.pop(0)
            self._jobs.pop(victim.id, None)


store = JobStore()
