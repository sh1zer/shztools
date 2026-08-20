from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.environ.get("SHZTOOLS_DATA", ROOT / "data"))
ARTIFACT_DIR = DATA_DIR / "artifacts"

# How many finished jobs to keep in memory before evicting the oldest.
JOB_HISTORY = int(os.environ.get("SHZTOOLS_JOB_HISTORY", "200"))

# Origins allowed to call the API. The Vite dev server runs on a different
# port, and over Tailscale it is reached by IP, so allow-all in dev.
CORS_ORIGINS = os.environ.get("SHZTOOLS_CORS", "*").split(",")


def ensure_dirs() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
