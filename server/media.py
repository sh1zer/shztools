"""Bits both media tools need: input validation and probing.

Small on purpose. The interesting logic stays in the tools; this is only what
would otherwise be copy-pasted between them.
"""

from __future__ import annotations

import asyncio
import mimetypes
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse


def validate_url(raw: str) -> str:
    url = (raw or "").strip()
    if not url:
        raise ValueError("a URL is required")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL must be http(s)")
    return url


def require(binary: str) -> str:
    path = shutil.which(binary)
    if path is None:
        raise RuntimeError(f"{binary} is not installed on the server")
    return path


async def probe_duration(path: Path) -> float | None:
    """Seconds, or None if ffprobe is missing or the file has no duration."""
    probe = shutil.which("ffprobe")
    if probe is None:
        return None
    proc = await asyncio.create_subprocess_exec(
        probe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        return None


def content_type_for(path: Path) -> str:
    """Artifact types have to be right -- the preview player reads them."""
    return mimetypes.guess_type(path.name)[0] or "video/mp4"


async def stream_process(cmd: list[str]) -> asyncio.subprocess.Process:
    """stderr folded into stdout, so a caller has one stream to read."""
    return await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )


@asynccontextmanager
async def terminating(
    proc: asyncio.subprocess.Process,
) -> AsyncIterator[asyncio.subprocess.Process]:
    """Reap the child if the job is cancelled.

    A cancelled job that leaves yt-dlp or ffmpeg running keeps writing to a
    directory retention is about to delete, so this is the one piece of
    subprocess lifecycle no caller may forget -- which is why it is a context
    manager and not a block to copy.
    """
    try:
        yield proc
    except asyncio.CancelledError:
        proc.terminate()
        await proc.wait()
        raise
