"""Driving the yt-dlp binary.

Not a tool: both tools in server/tools/ shell out to yt-dlp, and server/
contract.py promises a tool can be moved to a remote service by editing one
registry line. If `clip` reached into `ytdlp` for these, relocating `ytdlp`
would break `clip` -- so the CLI wrapper lives beside the tools rather than
inside one of them.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .jobs import Job
from .media import require, stream_process, terminating

# "[download]  42.3% of 118.20MiB at 4.11MiB/s ETA 00:18"
PROGRESS_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")


def format_selector(height: int | None) -> str:
    """Capped by height rather than by a format id: format numbers vary per
    site and per video. The trailing uncapped branch means a source that has
    nothing under the cap still yields its best, rather than failing."""
    if not height:
        return "bv*+ba/b"
    return f"bv*[height<={height}]+ba/b[height<={height}]/bv*+ba/b"


def parse_height(value: Any) -> int | None:
    """None means uncapped. Anything else must be an integer -- it is spliced
    into a format expression, so it never reaches yt-dlp as free text."""
    if value in (None, "", "best"):
        return None
    try:
        height = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"bad quality: {value!r}") from None
    if not 144 <= height <= 4320:
        raise ValueError("quality must be between 144 and 4320")
    return height


async def download(
    job: Job,
    url: str,
    dest: Path,
    height: int | None,
    section: tuple[float, float] | None = None,
) -> list[Path]:
    """Fetch `url` into `dest`, optionally only a time range of it.

    Returns what was written. Both tools go through here, so the progress
    relay, the cancellation handling and the "did anything come out" check
    exist once.
    """
    spec = f"*{section[0]:.3f}-{section[1]:.3f}" if section else None
    label = "fetching segment" if spec else f"downloading {height}p" if height else "downloading"

    cmd = [
        require("yt-dlp"),
        "--newline",
        "--no-playlist",
        "--restrict-filenames",
        "-f", format_selector(height),
        "--merge-output-format", "mp4",
        # Move the moov atom to the front so the browser can start playing a
        # preview without first range-fetching the tail of the file.
        "--postprocessor-args", "Merger+ffmpeg_o:-movflags +faststart",
        *(["--download-sections", spec] if spec else []),
        "-o", "%(title).120s.%(ext)s",
        "-P", str(dest),
        url,
    ]

    job.log(f"$ yt-dlp {spec or '(full video)'} {url}")
    job.progress(fraction=None, label=label)

    proc = await stream_process(cmd)
    async with terminating(proc):
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            if not line:
                continue
            job.log(line)
            m = PROGRESS_RE.search(line)
            if m:
                job.progress(fraction=float(m.group(1)) / 100.0, label=label)
        code = await proc.wait()

    if code != 0:
        raise RuntimeError(f"yt-dlp exited with code {code}")
    produced = sorted(p for p in dest.iterdir() if p.is_file())
    if not produced:
        raise RuntimeError("yt-dlp produced no output file")
    return produced
