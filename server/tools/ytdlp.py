"""yt-dlp: fetch a URL as an mp4.

Thin by design -- the CLI wrapper is in server/ytdlp_cli.py so that `clip` can
use it without importing this module. All this adds is the tool contract.

`height` caps the resolution; the page sends a low one to get something
scrubbable in a few seconds rather than waiting on the full-quality file. See
server/tools/clip.py for what the export does instead.
"""

from __future__ import annotations

from typing import Any

from ..contract import ToolSpec
from ..jobs import Job
from ..media import content_type_for, validate_url
from ..ytdlp_cli import download, parse_height

SPEC = ToolSpec(
    id="ytdlp",
    name="yt-dlp",
    description="Download a video from a URL as mp4.",
    icon="video",
    tags=["media"],
)


async def run(job: Job, inputs: dict[str, Any]) -> None:
    url = validate_url(inputs.get("url", ""))
    height = parse_height(inputs.get("height"))

    produced = await download(job, url, job.dir, height)

    job.progress(fraction=1.0, label="done")
    for path in produced:
        job.add_artifact(path, content_type=content_type_for(path))
