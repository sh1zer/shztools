"""The single contract every tool is called through.

A tool is either LOCAL (a Python module in server/tools/) or REMOTE (any HTTP
service that speaks the same three endpoints). The gateway does not care
which: it hands both a Job and awaits `run`. Moving a tool out of process is
a one-line change in the registry, not a rewrite -- which is the whole point
of routing even local calls through this indirection.

Remote services must implement:
    GET  /spec                  -> ToolSpec JSON
    POST /run    {inputs}       -> {"job_id": "..."}
    GET  /jobs/{job_id}/events  -> SSE stream of the same event types
    GET  /jobs/{job_id}/artifacts/{name} -> bytes
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

import httpx

from .jobs import Job


@dataclass
class ToolSpec:
    """What the frontend needs to list a tool. The *page* is hand-written in
    React per tool, so this deliberately carries no form schema."""

    id: str
    name: str
    description: str = ""
    icon: str = ""
    tags: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class ToolAdapter(Protocol):
    spec: ToolSpec

    async def run(self, job: Job, inputs: dict[str, Any]) -> None: ...


class LocalTool:
    """Wraps a Python module exposing SPEC and `async def run(job, inputs)`."""

    def __init__(self, module: Any) -> None:
        self.module = module
        self.spec: ToolSpec = module.SPEC

    async def run(self, job: Job, inputs: dict[str, Any]) -> None:
        await self.module.run(job, inputs)


class RemoteTool:
    """Proxies a tool running as its own HTTP service (Rust, Go, whatever).

    It relays the remote event stream onto the local job verbatim and pulls
    artifacts back, so the browser cannot tell the difference.
    """

    def __init__(self, spec: ToolSpec, base_url: str) -> None:
        self.spec = spec
        self.base_url = base_url.rstrip("/")

    async def run(self, job: Job, inputs: dict[str, Any]) -> None:
        timeout = httpx.Timeout(30.0, read=None)
        async with httpx.AsyncClient(base_url=self.base_url, timeout=timeout) as client:
            resp = await client.post("/run", json={"inputs": inputs})
            resp.raise_for_status()
            remote_id = resp.json()["job_id"]

            artifacts: list[dict[str, Any]] = []
            async with client.stream("GET", f"/jobs/{remote_id}/events") as stream:
                async for event_type, data in _iter_sse(stream):
                    if event_type == "log":
                        job.log(data.get("line", ""))
                    elif event_type == "progress":
                        job.progress(data.get("fraction"), data.get("label"))
                    elif event_type == "artifact":
                        artifacts.append(data)
                    elif event_type == "done":
                        if data.get("state") == "failed":
                            raise RuntimeError(data.get("error") or "remote tool failed")
                        artifacts = data.get("artifacts", artifacts) or artifacts
                        break

            for art in artifacts:
                name = art["name"]
                dest = job.dir / name
                async with client.stream("GET", f"/jobs/{remote_id}/artifacts/{name}") as r:
                    r.raise_for_status()
                    with dest.open("wb") as fh:
                        async for chunk in r.aiter_bytes():
                            fh.write(chunk)
                job.add_artifact(dest, art.get("content_type", "application/octet-stream"))


async def _iter_sse(response: httpx.Response):
    """Minimal SSE parser: yields (event, parsed_data) pairs."""
    event = "message"
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        if line.startswith(":"):
            continue
        if line == "":
            if data_lines:
                raw = "\n".join(data_lines)
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    payload = {"raw": raw}
                yield event, payload
            event, data_lines = "message", []
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
