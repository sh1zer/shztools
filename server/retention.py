"""Artifact retention.

Artifacts are the only thing here that grows without bound: one 4K download is
most of a gigabyte, and trimming it writes another file beside it. Jobs are
evicted from memory by JOB_HISTORY, but that never touched the disk.

The sweep runs at startup and again at the *start* of every job, not the end.
Two reasons: the headroom is wanted before a download, not after it, and
whatever the last run produced survives until you next run something -- so the
file you are about to download is never swept out from under you.
"""

from __future__ import annotations

import logging
import shutil
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from .config import ARTIFACT_DIR, ARTIFACT_MAX_BYTES, ARTIFACT_TTL

# uvicorn owns the logging config and only attaches handlers to its own
# loggers, so a logger of our own would delete files in silence. The
# startup sweep has no job log to fall back on, so it has to land here.
log = logging.getLogger("uvicorn.error")


@dataclass
class Swept:
    removed: int = 0
    freed: int = 0
    kept: int = 0

    def __bool__(self) -> bool:
        return self.removed > 0

    def describe(self) -> str:
        runs = "run" if self.removed == 1 else "runs"
        return f"reclaimed {human(self.freed)} from {self.removed} old {runs}"


def human(n: int) -> str:
    value = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024


def _size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def sweep(protect: Iterable[str] = ()) -> Swept:
    """Delete old job directories until both limits are satisfied.

    `protect` names job ids that must survive regardless -- anything still
    running, plus the job asking for the sweep. Either limit set to 0 disables
    that half of the policy.
    """
    keep = set(protect)
    if not ARTIFACT_DIR.is_dir():
        return Swept()

    entries: list[tuple[float, Path, int]] = []
    protected_bytes = 0
    for child in ARTIFACT_DIR.iterdir():
        if not child.is_dir():
            continue
        try:
            size = _size(child)
            if child.name in keep:
                protected_bytes += size
            else:
                entries.append((child.stat().st_mtime, child, size))
        except OSError:
            continue
    entries.sort(key=lambda e: e[0])

    # Protected runs count against the cap even though they cannot be deleted:
    # otherwise a job in flight silently raises the ceiling by its own size.
    result = Swept(kept=protected_bytes + sum(e[2] for e in entries))
    now = time.time()

    def drop(entry: tuple[float, Path, int]) -> None:
        _, path, size = entry
        shutil.rmtree(path, ignore_errors=True)
        result.removed += 1
        result.freed += size
        result.kept -= size

    # Age first, so the size cap only has to reach for things that are still
    # young enough to want. `entries` is sorted oldest-first, so the expired
    # ones are a prefix -- same shape as the size pass below it.
    if ARTIFACT_TTL > 0:
        while entries and now - entries[0][0] > ARTIFACT_TTL:
            drop(entries.pop(0))

    if ARTIFACT_MAX_BYTES > 0:
        while entries and result.kept > ARTIFACT_MAX_BYTES:
            drop(entries.pop(0))

    if result:
        log.info("artifacts: %s, %s still on disk", result.describe(), human(result.kept))
    return result
