"""clip: fetch just the selected segment of a video, at full quality.

The page previews a cheap copy of the whole video, so by the time you press
Cut the only thing wanted at full quality is the part between the clamps. This
downloads exactly that -- measured on a 10-minute 4K video, 15 seconds costs
12s / 21 MiB against 16s / 722 MiB for the whole file -- and then cuts it to
the frame.

Two steps, because neither alone is both cheap and precise:

  1. yt-dlp --download-sections fetches a *padded* window around the selection.
     ffmpeg can seek remote URLs by byte range on its own, but googlevideo
     throttles a plain sequential read to ~87 KiB/s (measured: 317s for a
     27 MiB format); yt-dlp's downloader gets full speed, so the fetch goes
     through it.
  2. ffmpeg re-encodes the exact span out of that window. Cutting the boundary
     ourselves rather than trusting the section flag means the cut starts from
     a real keyframe inside the pad, so the result is frame-accurate whatever
     the source's GOP structure turned out to be.

Step 2 is not optional. A stream copy would be instant, but it can only cut on
keyframes, so it returns frames nobody asked for -- and there is no reason to
want the wrong ones. Selecting the whole video still costs nothing: the fetch
already is the answer, and run() hands it over without re-encoding.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from ..contract import ToolSpec
from ..jobs import Job
from ..media import (
    content_type_for,
    probe_duration,
    require,
    stream_process,
    terminating,
    validate_url,
)
from ..ytdlp_cli import download, parse_height

# No frontend page is registered for this id, so it stays out of the nav; the
# yt-dlp page drives it with the URL it previewed.
SPEC = ToolSpec(
    id="clip",
    name="Clip",
    description="Download just a segment of a video, cut to the frame.",
    icon="scissors",
    tags=["media"],
)

# Slack fetched either side of the selection. The precise cut needs a keyframe
# before the start to decode from, and nothing tells us the GOP length in
# advance; a few seconds of extra video is cheap insurance against a long one.
PAD = 5.0
UNSAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")

OUT_TIME_RE = re.compile(r"^out_time=(\d+):(\d\d):(\d\d(?:\.\d+)?)$")
PROGRESS_KEY_RE = re.compile(
    r"^(?:frame|fps|q|stream_\S+|bitrate|total_size|out_time\w*|dup_frames|"
    r"drop_frames|speed|progress)=",
)


def _stamp(seconds: float) -> str:
    """12.4 -> "12s40" -- readable in a filename without spending a dot."""
    return f"{seconds:.2f}".replace(".", "s")


def _output_name(src: Path, start: float, end: float) -> str:
    stem = UNSAFE_RE.sub("_", src.stem)[:80].strip("_") or "clip"
    return f"{stem}_{_stamp(start)}-{_stamp(end)}.mp4"


def _parse_inputs(inputs: dict[str, Any]) -> tuple[str, float, float, int | None]:
    url = validate_url(inputs.get("url", ""))
    try:
        start = float(inputs.get("start", 0.0))
        end = float(inputs.get("end", 0.0))
    except (TypeError, ValueError):
        raise ValueError("start and end must be numbers") from None
    if start < 0:
        raise ValueError("start must not be negative")
    if end - start < 0.02:
        raise ValueError("the selection is empty")
    return url, start, end, parse_height(inputs.get("height"))


async def _fetch(
    job: Job, url: str, section: tuple[float, float] | None, height: int | None
) -> Path:
    """Download into a scratch dir, replacing whatever a failed attempt left."""
    workdir = job.dir / "source"
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True)
    return (await download(job, url, workdir, height, section))[0]


def _cut_command(binary: str, src: Path, dst: Path, offset: float, span: float) -> list[str]:
    return [
        binary, "-hide_banner", "-nostdin", "-y",
        # Before -i: fast-seek to the preceding keyframe, then decode and
        # discard to the exact timestamp.
        "-ss", f"{offset:.3f}",
        "-i", str(src),
        "-t", f"{span:.3f}",
        # One video and, if there is one, one audio track. Copying every stream
        # would drag subtitle and data tracks the mp4 muxer then rejects.
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        # 10-bit sources would otherwise re-encode to a profile browsers will
        # not play, which defeats the point of previewing the result.
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats",
        str(dst),
    ]
    return cmd


async def _cut(job: Job, src: Path, dst: Path, offset: float, span: float) -> None:
    job.log(f"$ ffmpeg -ss {offset:.3f} -t {span:.3f}")
    job.progress(fraction=0.0, label="re-encoding")

    proc = await stream_process(_cut_command(require("ffmpeg"), src, dst, offset, span))
    try:
        async with terminating(proc):
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode("utf-8", "replace").rstrip()
                if not line:
                    continue
                m = OUT_TIME_RE.match(line)
                if m:
                    done = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                    job.progress(
                        fraction=min(done / span, 1.0) if span else None, label="re-encoding"
                    )
                elif not PROGRESS_KEY_RE.match(line):
                    job.log(line)
            code = await proc.wait()
        if code != 0:
            raise RuntimeError(f"ffmpeg exited with code {code}")
        if not dst.is_file() or dst.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced no output")
    except BaseException:
        # A half-written clip must not survive a cancelled or failed run:
        # retention would count it, and the UI would offer it for download.
        dst.unlink(missing_ok=True)
        raise


async def run(job: Job, inputs: dict[str, Any]) -> None:
    url, start, end, height = _parse_inputs(inputs)
    span = end - start
    fetch_start = max(0.0, start - PAD)
    window = (end + PAD) - fetch_start

    try:
        src = await _fetch(job, url, (fetch_start, end + PAD), height)
        fetched = await probe_duration(src)
        # yt-dlp's section output starts at the timestamp asked for, so the
        # selection sits this far into it. Verified against a full-length
        # preview of the same video: local t maps to global fetch_start + t.
        offset = start - fetch_start

        if fetched is None or fetched < min(span, 1.0):
            # Ranged fetches need a protocol that can seek. Where the host
            # cannot (no Range support, some live or DRM'd streams), yt-dlp
            # still exits 0 having written a stub -- so fall back rather than
            # cut up a stub.
            job.log("[clip] ranged fetch came back unusable; downloading the whole video instead")
            src = await _fetch(job, url, None, height)
            fetched = await probe_duration(src)
            offset = start
        elif fetched > window + 1.0:
            # The flag was accepted and ignored: the file starts at zero, so
            # the offset above would cut the wrong part of it.
            job.log("[clip] the section flag was not honoured; seeking in the full file instead")
            offset = start

        if fetched is not None:
            if offset >= fetched:
                raise ValueError(f"start is past the end of the video ({fetched:.2f}s)")
            span = min(span, max(fetched - offset, 0.0))
        if span < 0.02:
            raise ValueError("the selection is empty")

        dst = job.dir / _output_name(src, start, end)
        if fetched is not None and offset <= 0.02 and span >= fetched - 0.05:
            # The fetch is already exactly the selection -- re-encoding it
            # would cost minutes and change nothing.
            job.log("[clip] fetched segment already matches the selection; keeping it as-is")
            src.replace(dst)
        else:
            await _cut(job, src, dst, offset, span)
    finally:
        # The padded fetch is scratch either way. On the failure paths it is
        # pure waste -- no artifact came of it, and it would sit on disk
        # counting against the retention budget until a sweep reached it.
        shutil.rmtree(job.dir / "source", ignore_errors=True)

    job.progress(fraction=1.0, label="done")
    job.add_artifact(dst, content_type=content_type_for(dst))
