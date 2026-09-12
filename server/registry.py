"""Tool registry.

Add a tool by dropping a module in server/tools/ and listing it in LOCAL_TOOLS.
Point SHZTOOLS_REMOTE at a service to override any tool with a remote one:

    SHZTOOLS_REMOTE="ytdlp=http://127.0.0.1:8081,transcode=http://box:8082"
"""

from __future__ import annotations

import importlib
import os

from .contract import LocalTool, RemoteTool, ToolAdapter

# A tool with no page in web/src/tools/registry.ts stays out of the nav --
# `clip` is driven by the yt-dlp page, not opened on its own.
LOCAL_TOOLS = [
    "server.tools.ytdlp",
    "server.tools.clip",
]


def _remote_overrides() -> dict[str, str]:
    raw = os.environ.get("SHZTOOLS_REMOTE", "").strip()
    if not raw:
        return {}
    out: dict[str, str] = {}
    for part in raw.split(","):
        if "=" in part:
            tool_id, url = part.split("=", 1)
            out[tool_id.strip()] = url.strip()
    return out


class Registry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolAdapter] = {}

    def load(self) -> None:
        overrides = _remote_overrides()
        for path in LOCAL_TOOLS:
            module = importlib.import_module(path)
            tool: ToolAdapter = LocalTool(module)
            if tool.spec.id in overrides:
                tool = RemoteTool(tool.spec, overrides[tool.spec.id])
            self._tools[tool.spec.id] = tool

    def get(self, tool_id: str) -> ToolAdapter | None:
        return self._tools.get(tool_id)

    def specs(self) -> list[dict]:
        return [t.spec.as_dict() for t in self._tools.values()]


registry = Registry()
