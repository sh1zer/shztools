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

## Trimming

Paste a link and press **Download** or **Trim**. Download is the form's own
action, so Enter does that; it fetches the whole video at the chosen quality.
Trim fetches a low-resolution copy of the *whole* video first, which is what
the player scrubs. Two clamps bound a segment;
dragging one seeks the video to it, so you pick against the frame you will
actually cut on. Scroll the track to zoom, and drag the overview strip beneath
it to move the window. The **start** and **end** labels are buttons -- clicking
one sets that clamp to the playhead. ⏮ under the video plays the selection, and
playback stops at the end clamp. **Download segment** then fetches only what is
between the clamps, at the quality picked next to it.

The quality dropdown sits with the URL because both buttons read it. It caps
height (360p through 1440p, or best available) and defaults to 1080p. They are
caps, not promises: a source with nothing under the cap still yields its best,
so every entry works on every video. The preview is always ≤480p regardless --
it exists to be scrubbed, not kept.

Nothing ever downloads the full-quality video just to choose a timestamp.
Measured on a 10-minute 4K video:

| | time | bytes |
| --- | --- | --- |
| old flow: full download before you can scrub | 16s | 722 MiB |
| preview (≤480p, whole video) | 3s | 36 MiB |
| a 15s segment at full 4K | 30s | 25 MiB |

And the cap does the rest -- a 5s segment, same video:

| quality | bytes |
| --- | --- |
| 720p | 1.1 MiB |
| 1080p | 2.0 MiB |
| best (4K) | 6.0 MiB |

YouTube no longer serves pre-muxed formats, so there is no single URL to hand
the player -- the preview is still a video+audio merge, just a cheap one.

### Why the segment is fetched, then cut, rather than cut on the way down

`yt-dlp --download-sections` fetches a time range, and its output starts at the
timestamp asked for. But a stream copy can only cut on keyframes, so the edges
land wherever the GOP structure puts them -- on a real 4K YouTube download,
asking for 30.000s starts the clip at 27.433s. So `clip` asks for a *padded*
window and cuts the exact span out of it itself: `ffmpeg -ss` fast-seeks to a
real keyframe inside the pad and then decodes and discards to the exact
timestamp, which is frame-accurate.

ffmpeg can range-seek a remote URL on its own, which would skip the two-step
entirely -- but googlevideo throttles a plain sequential read to about
87 KiB/s (317s for a 27 MiB format, measured), where yt-dlp's downloader gets
full speed. So the fetch goes through yt-dlp and the cut through ffmpeg.

Ranged fetches need a host that supports them. Where one does not, yt-dlp still
exits 0 having written a stub, so `clip` checks the fetched length against what
it asked for and falls back to downloading the whole video -- silently wrong
output being the one outcome worth spending code to avoid.

`clip` has no page of its own in `web/src/tools/registry.ts`, so it never
appears in the nav -- a backend tool is only listed if the frontend registers a
page for it. That is the way to add an operation another tool's page drives.

Everything a tool does is a **job**. A job streams `log` / `progress` /
`artifact` / `status` / `done` events over SSE, and writes output files into
`data/artifacts/<job_id>/`. Events are buffered per job, so reloading the page
mid-run replays the whole log and then follows live.

The gateway calls local and remote tools through the *same* contract
(`server/contract.py`), so moving a tool out of process is a config change:

```sh
SHZTOOLS_REMOTE="transcode=http://127.0.0.1:8081" make dev
```

Because a tool must be relocatable that way, tools never import each other.
Both media tools shell out to yt-dlp, so that wrapper lives in
`server/ytdlp_cli.py` beside them, with the generic subprocess and ffprobe
helpers in `server/media.py`.

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

`<JobRunner>` gives you status, progress, live log and artifact downloads —
you never write that plumbing per tool.

## Design

Pages are hand-written so tools can look however they need, but they compose a
shared kit (`web/src/ui/`) so they stay coherent:

- `ui/tokens.css` — colour, spacing, type, radius, and all three themes.
  **Never hardcode a hex, a radius or a font in a tool page**; use a token.
- `ui/kit.css` — styles for the shared classes.
- `ui/theme.ts` — theme state, persisted to `localStorage`.
- `ui/index.tsx` — `PageShell`, `Panel`, `Field`, `Button`, `JobRunner`,
  `LogView`, `Progress`, `Status`, `Artifacts`, `ThemeSwitcher`.

The rules the tokens encode, so you don't undo them by accident:

| Decision | |
| --- | --- |
| **Monochrome by default** | dark neutral greys, `#141414` page. Themes: dark · light · gruvbox material, cycled from the sidebar footer. `prefers-color-scheme` is deliberately ignored. |
| **Square corners** | `--radius: 0`. A developer knob, not a UI setting — set it to `2px` and the whole toolkit softens. |
| **Structure from borders** | 1px borders plus background value steps. No shadows. |
| **Hue is reserved for run status** | `--ok` / `--warn` / `--err` and nothing else. It's what you scan a job list for, so spending it on decoration devalues it. |
| **Primary means inverted** | `--accent` is the *foreground* colour in the mono themes and the aqua in gruvbox, so one rule gives an inverted button in mono and an accented one in gruvbox. |
| **Contrast is a constraint** | `--text-faint` is labels and placeholders only and must clear 4.5:1 on `--surface`; anything carrying data (file sizes, percentages) uses `--text-dim`, which must clear 4.5:1 on `--surface-2`. |
| **The tool page fits the viewport** | `<PageShell fill>` plus a `panel-fill` child: the trim panel takes whatever height the form above it leaves, and the video takes what the track and readouts below it leave. Nothing is sized against a guessed `vh` figure, and below a 180px floor it overflows and scrolls as normal. The page has no header -- the nav already says which tool this is. |
| **Run status sits beside the form, not under it** | `.tool-head` is a two-column grid, and `<JobRunner compact>` drops the log. A tool's real work then starts above the fold instead of below a terminal. A failed job shows its log regardless -- that is the one time the output is the point. |
| **Controls carry their own labels** | no instruction paragraphs. The start/end labels *are* the set-to-playhead buttons. If a control needs a sentence underneath it explaining itself, it is the wrong control -- or, as with the precise/sloppy toggle, it should not be a control at all. |
| **The log is one line** | collapsed to its last line, because a download is a thousand lines of progress nobody reads. A toggle expands it for when a job fails and you do want them. |
| **Progress is a number** | no bar. Liveness comes from the blinking brackets in `[ RUNNING ]`, which also covers tools that never report a fraction. |

Adding a theme is a block of token overrides under
`:root[data-theme="name"]` plus an entry in `THEMES`.

## Retention

Artifacts are the only thing here that grows without bound -- one 4K download is
most of a gigabyte. `server/retention.py` deletes whole job directories
oldest-first, once at startup and again at the *start* of every job: the
headroom is wanted before a download, not after it, and sweeping at the start
means whatever the last run produced survives until you next run something, so
a file is never swept out from under you while you are downloading it.

Runs still in flight are never deleted, but they do count against the size cap,
so a job in flight cannot quietly raise the ceiling by its own size. The cap is
enforced before a job, not during it, so a single download larger than the cap
will still overshoot it -- nothing knows how big a video is until it arrives.
What gets reclaimed is logged into the job that triggered it, and to the console
for the startup sweep.

## Config

| Env | Default | Meaning |
| --- | --- | --- |
| `SHZTOOLS_DATA` | `./data` | artifact storage root |
| `SHZTOOLS_JOB_HISTORY` | `200` | finished jobs kept in memory |
| `SHZTOOLS_ARTIFACT_TTL` | `86400` | seconds before a job's files are swept; `0` disables |
| `SHZTOOLS_ARTIFACT_MAX_BYTES` | `5368709120` | total artifact budget (5 GiB); `0` disables |
| `SHZTOOLS_REMOTE` | – | `id=url,…` overrides to remote services |
| `SHZTOOLS_CORS` | `*` | allowed origins |

## Not done yet

- Auth (planned: trivial auth once it leaves the tailnet).
- Jobs live in memory only; a restart loses history. Artifacts outlive it on
  disk, and the next startup sweep is what eventually collects them.
- No spatial crop -- the clamps cut time, not frame.
- The preview is a second download of the same video. Fine at 36 MiB; a
  feature-length source would want `PREVIEW_HEIGHT` lowered.
- The quality dropdown lists fixed caps rather than the formats this video
  actually has; reading those needs another yt-dlp round trip.
