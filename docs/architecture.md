# Architecture

Every tool run is a **job**. A job streams `log`, `progress`, `artifact`,
`status` and `done` events over SSE, and writes files into
`data/artifacts/<job_id>/`. Events are buffered per job, so a page reloaded
mid-run replays the log and then follows live.

Local and remote tools use the same contract (`server/contract.py`). Moving a
tool out of process is a config change:

```sh
SHZTOOLS_REMOTE="transcode=http://127.0.0.1:8081" make dev
```

A remote service implements `GET /spec`, `POST /run`, `GET /jobs/{id}/events`
and `GET /jobs/{id}/artifacts/{name}`.

Tools must not import each other, or a tool that moves out of process breaks
the ones left behind. Shared yt-dlp code is in `server/ytdlp_cli.py`; generic
subprocess and ffprobe helpers are in `server/media.py`.

## Adding a tool

Backend: `server/tools/mytool.py` exporting `SPEC: ToolSpec` and
`async def run(job, inputs)`. Add it to `LOCAL_TOOLS` in
`server/registry.py`. Use `job.log`, `job.progress` and `job.add_artifact`;
raise to fail the job.

Frontend: `web/src/tools/mytool/Page.tsx` and one entry in
`web/src/tools/registry.ts`. Pages are lazy-loaded and routed at `/t/<id>`.
`<JobRunner job={job}>` renders status, progress, log and artifact downloads.

A backend tool with no frontend page does not appear in the nav. `clip` works
this way: the yt-dlp page drives it.
