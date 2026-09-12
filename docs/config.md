# Config

| Env | Default | Meaning |
| --- | --- | --- |
| `SHZTOOLS_DATA` | `./data` | artifact storage root |
| `SHZTOOLS_JOB_HISTORY` | `200` | finished jobs kept in memory |
| `SHZTOOLS_ARTIFACT_TTL` | `86400` | seconds before a job's files are swept; `0` disables |
| `SHZTOOLS_ARTIFACT_MAX_BYTES` | `5368709120` | total artifact budget (5 GiB); `0` disables |
| `SHZTOOLS_REMOTE` | – | `id=url,…` overrides to remote services |
| `SHZTOOLS_CORS` | `*` | allowed origins |

## Retention

`server/retention.py` deletes whole job directories, oldest first. It runs at
startup and at the start of every job.

- Sweeping before a job frees space ahead of the download, and leaves the
  previous run's output in place until the next run.
- Running jobs are never deleted, but their size counts against the cap.
- A download larger than the cap overshoots it. The size is not known until the
  file arrives.
