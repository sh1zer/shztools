from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .jobs import Job, store
from .registry import registry
from .retention import sweep

router = APIRouter(prefix="/api")


class RunRequest(BaseModel):
    inputs: dict[str, Any] = {}


@router.get("/tools")
async def list_tools() -> list[dict]:
    return registry.specs()


@router.post("/tools/{tool_id}/run")
async def run_tool(tool_id: str, req: RunRequest) -> dict:
    tool = registry.get(tool_id)
    if tool is None:
        raise HTTPException(404, f"unknown tool: {tool_id}")
    job = store.create(tool_id, req.inputs)
    job.task = asyncio.create_task(_execute(tool, job))
    return {"job_id": job.id}


async def _execute(tool, job: Job) -> None:
    job.set_state("running")
    # Reclaim disk before the tool asks for any, and say so in this job's log
    # rather than only the server console -- it is the user's files going away.
    swept = await asyncio.to_thread(sweep, {job.id, *store.active_ids()})
    if swept:
        job.log(f"[retention] {swept.describe()}")
    try:
        await tool.run(job, job.inputs)
    except asyncio.CancelledError:
        job.set_state("cancelled")
        raise
    except Exception as exc:  # surfaced to the UI, not swallowed
        job.log(f"error: {exc}")
        job.set_state("failed", error=str(exc))
    else:
        job.set_state("succeeded")


@router.get("/jobs")
async def list_jobs(tool: str | None = None, limit: int = 50) -> list[dict]:
    return [j.summary() for j in store.list(tool=tool, limit=limit)]


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job")
    return job.summary()


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict:
    ok = await store.cancel(job_id)
    if not ok:
        raise HTTPException(409, "job is not cancellable")
    return {"ok": True}


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request, after: int = 0) -> StreamingResponse:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job")

    async def gen():
        # Prime the connection so proxies flush immediately.
        yield ": open\n\n"
        async for ev in job.stream(after=after):
            if await request.is_disconnected():
                break
            yield f"event: {ev.type}\ndata: {json.dumps(ev.as_dict())}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/artifacts/{name}")
async def get_artifact(job_id: str, name: str, inline: bool = False) -> FileResponse:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job")
    art = next((a for a in job.artifacts if a.name == name), None)
    path = (job.dir / name).resolve()
    # Reject traversal: the resolved path must stay inside the job directory.
    if art is None or job.dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "no such artifact")
    # `inline` drops the attachment disposition so a <video> can play the
    # artifact in place. Byte ranges are served either way, which is what
    # makes scrubbing the preview work.
    if inline:
        return FileResponse(path, media_type=art.content_type)
    return FileResponse(path, media_type=art.content_type, filename=art.name)
