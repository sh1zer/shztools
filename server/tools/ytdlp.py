"""yt-dlp: fetch a URL as an mp4.

Deliberately minimal for now -- one URL in, one file out. Cropping and format
options come later; the job/artifact plumbing around it is what matters.
"""

from __future__ import annotations

import asyncio
import re
import shutil
from typing import Any
from urllib.parse import urlparse

from ..contract import ToolSpec
from ..jobs import Job

SPEC = ToolSpec(
    id="ytdlp",
    name="yt-dlp",
    description="Download a video from a URL as mp4.",
    icon="video",
    tags=["media"],
)

# "[download]  42.3% of 118.20MiB at 4.11MiB/s ETA 00:18"
PROGRESS_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")


def _validate_url(raw: str) -> str:
    url = (raw or "").strip()
    if not url:
        raise ValueError("a URL is required")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL must be http(s)")
    return url


async def run(job: Job, inputs: dict[str, Any]) -> None:
    url = _validate_url(inputs.get("url", ""))

    binary = shutil.which("yt-dlp")
    if binary is None:
        raise RuntimeError("yt-dlp is not installed on the server")

    outdir = job.dir
    cmd = [
        binary,
        "--newline",
        "--no-playlist",
        "--restrict-filenames",
        "-f", "bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", "%(title).120s.%(ext)s",
        "-P", str(outdir),
        url,
    ]

    job.log(f"$ yt-dlp {url}")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    try:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            if not line:
                continue
            job.log(line)
            m = PROGRESS_RE.search(line)
            if m:
                job.progress(fraction=float(m.group(1)) / 100.0, label="downloading")
        code = await proc.wait()
    except asyncio.CancelledError:
        proc.terminate()
        await proc.wait()
        raise

    if code != 0:
        raise RuntimeError(f"yt-dlp exited with code {code}")

    produced = sorted(p for p in outdir.iterdir() if p.is_file())
    if not produced:
        raise RuntimeError("yt-dlp produced no output file")

    job.progress(fraction=1.0, label="done")
    for path in produced:
        job.add_artifact(path, content_type="video/mp4")
