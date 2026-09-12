.PHONY: dev api web serve build install clean

TS_IP := $(shell tailscale ip -4 2>/dev/null | head -1)

install:
	uv sync
	cd web && npm install

# Dev: FastAPI on :8787, Vite on :5173 with /api proxied to it.
# Browse http://$(TS_IP):5173 from anywhere on the tailnet.
dev:
	@echo "UI  -> http://$(TS_IP):5173"
	@echo "API -> http://127.0.0.1:8787"
	@trap 'kill 0' EXIT INT TERM; \
	uv run uvicorn server.main:app --reload --timeout-graceful-shutdown 2 --host 127.0.0.1 --port 8787 & \
	cd web && npm run dev -- --host 0.0.0.0 & \
	wait

# --timeout-graceful-shutdown: a job's SSE stream stays open as long as the
# browser tab does, and --reload otherwise waits on it forever.
api:
	uv run uvicorn server.main:app --reload --timeout-graceful-shutdown 2 --host 127.0.0.1 --port 8787

web:
	cd web && npm run dev -- --host 0.0.0.0

build:
	cd web && npm run build

# Prod-like: one process, one port, frontend served by FastAPI.
serve: build
	@echo "http://$(TS_IP):8787"
	uv run uvicorn server.main:app --host 0.0.0.0 --port 8787

clean:
	rm -rf web/dist data/artifacts
