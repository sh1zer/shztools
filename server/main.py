from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import CORS_ORIGINS, ROOT, ensure_dirs
from .registry import registry
from .retention import sweep


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    registry.load()
    # Walks data/artifacts and may rmtree gigabytes; --reload runs this on
    # every save, so it does not belong on the event loop.
    await asyncio.to_thread(sweep)
    yield


app = FastAPI(title="shztools", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


# In production `make serve` builds the frontend here and everything is served
# from this one process. In dev this directory does not exist and Vite serves
# the UI instead.
DIST = ROOT / "web" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str) -> FileResponse:
        candidate = (DIST / path).resolve()
        if path and DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
