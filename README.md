# shztools

Personal toolkit, served over the browser. FastAPI gateway + React frontend.

## Run

```sh
make install     # once
make dev         # UI on :5173, API on :8787
```

Browse **http://100.87.43.6:5173** from anywhere on the tailnet. `make serve`
builds the frontend and serves it from FastAPI on one port, without hot reload.

```
browser ──> Vite (:5173) ──/api──> FastAPI gateway (:8787)
                                        ├─ local tool  (server/tools/*.py)
                                        └─ remote tool (any HTTP service)
```

## Docs

- [architecture](docs/architecture.md) — jobs, the tool contract, adding a tool
- [design](docs/design.md) — the shared UI kit and its tokens
- [trimming](docs/trimming.md) — how a frame-accurate segment gets downloaded
- [config](docs/config.md) — env vars and artifact retention

## Not done yet

- No auth. Planned once it leaves the tailnet.
- Jobs are in memory only, so a restart loses the history. Artifacts stay on
  disk until a sweep collects them.
- No spatial crop. The clamps cut time, not frame.
- The preview is a second download of the same video.
- Quality presets are fixed caps, not the formats a given video has. Reading
  those needs another yt-dlp round trip.
