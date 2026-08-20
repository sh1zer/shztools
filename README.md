# shztools

Personal toolkit, served over the browser. FastAPI gateway + React frontend.

## Run

```sh
make install     # once
make dev         # UI on :5173, API on :8787
```

Then browse **http://100.87.43.6:5173** from anywhere on the tailnet.
`make serve` builds the frontend and serves everything from FastAPI on one port
(prod-like, no hot reload).

## Architecture

```
browser ──> Vite (:5173) ──/api──> FastAPI gateway (:8787)
                                        │
                                        ├─ local tool  (server/tools/*.py)
                                        └─ remote tool (any HTTP service)
```

Everything a tool does is a **job**. A job streams `log` / `progress` /
`artifact` / `status` / `done` events over SSE, and writes output files into
`data/artifacts/<job_id>/`. Events are buffered per job, so reloading the page
mid-run replays the whole log and then follows live.

The gateway calls local and remote tools through the *same* contract
(`server/contract.py`), so moving a tool out of process is a config change:

```sh
SHZTOOLS_REMOTE="transcode=http://127.0.0.1:8081" make dev
```

A remote service (Rust, Go, anything) just has to implement `GET /spec`,
`POST /run`, `GET /jobs/{id}/events`, `GET /jobs/{id}/artifacts/{name}`.

## Adding a tool

**1. Backend** — `server/tools/mytool.py`:

```python
from ..contract import ToolSpec
from ..jobs import Job

SPEC = ToolSpec(id="mytool", name="My Tool", description="Does a thing.")

async def run(job: Job, inputs: dict) -> None:
    job.log("starting")
    job.progress(0.5, "halfway")
    out = job.dir / "result.txt"
    out.write_text("hi")
    job.add_artifact(out, "text/plain")
    # raise on failure; the gateway records it and tells the UI
```

Add `"server.tools.mytool"` to `LOCAL_TOOLS` in `server/registry.py`.

**2. Frontend** — `web/src/tools/mytool/Page.tsx`:

```tsx
import { Button, Field, JobRunner, PageShell, Panel, useJob } from "../../ui";

export default function MyToolPage() {
  const { job, start, cancel } = useJob();
  return (
    <PageShell title="My Tool">
      <Panel>
        <Button onClick={() => start("mytool", {})} disabled={job.running}>Run</Button>
      </Panel>
      <JobRunner job={job} onCancel={cancel} />
    </PageShell>
  );
}
```

Add one entry to `toolPages` in `web/src/tools/registry.ts`. Pages are
lazy-loaded and routed at `/t/<id>`.

`<JobRunner>` gives you status, progress bar, live log and artifact downloads —
you never write that plumbing per tool.

## Design

Pages are hand-written so tools can look however they need, but they compose a
shared kit (`web/src/ui/`) so they stay coherent:

- `ui/tokens.css` — colour, spacing, type, radius, and all three themes.
  **Never hardcode a hex, a radius or a font in a tool page**; use a token.
- `ui/kit.css` — styles for the shared classes.
- `ui/theme.ts` — theme state, persisted to `localStorage`.
- `ui/index.tsx` — `PageShell`, `Panel`, `Field`, `Button`, `JobRunner`,
  `LogView`, `Progress`, `StatusPill`, `Artifacts`, `ThemeSwitcher`.

The rules the tokens encode, so you don't undo them by accident:

| Decision | |
| --- | --- |
| **Monochrome by default** | dark neutral greys, `#141414` page. Themes: dark · light · gruvbox material, cycled from the sidebar footer. `prefers-color-scheme` is deliberately ignored. |
| **Square corners** | `--radius: 0`. A developer knob, not a UI setting — set it to `2px` and the whole toolkit softens. |
| **Structure from borders** | 1px borders plus background value steps. No shadows. |
| **Hue is reserved for run status** | `--ok` / `--warn` / `--err` and nothing else. It's what you scan a job list for, so spending it on decoration devalues it. |
| **Primary means inverted** | `--accent` is the *foreground* colour in the mono themes and the aqua in gruvbox, so one rule gives an inverted button in mono and an accented one in gruvbox. |
| **Contrast is a constraint** | `--text-faint` is labels and placeholders only and must clear 4.5:1 on `--surface`; anything carrying data (file sizes, percentages) uses `--text-dim`, which must clear 4.5:1 on `--surface-2`. |
| **Progress is a number** | no bar. Liveness comes from the blinking brackets in `[ RUNNING ]`, which also covers tools that never report a fraction. |

Adding a theme is a block of token overrides under
`:root[data-theme="name"]` plus an entry in `THEMES`.

## Config

| Env | Default | Meaning |
| --- | --- | --- |
| `SHZTOOLS_DATA` | `./data` | artifact storage root |
| `SHZTOOLS_JOB_HISTORY` | `200` | finished jobs kept in memory |
| `SHZTOOLS_REMOTE` | – | `id=url,…` overrides to remote services |
| `SHZTOOLS_CORS` | `*` | allowed origins |

## Not done yet

- Auth (planned: trivial auth once it leaves the tailnet).
- Jobs live in memory only; a restart loses history (artifacts survive on disk).
- yt-dlp is URL-in/mp4-out; cropping and format options come later.
