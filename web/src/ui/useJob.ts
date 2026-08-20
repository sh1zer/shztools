import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Artifact, type JobState } from "../api";

export interface JobView {
  id: string | null;
  state: JobState | "idle";
  error: string | null;
  lines: string[];
  fraction: number | null;
  label: string | null;
  artifacts: Artifact[];
  running: boolean;
}

const IDLE: JobView = {
  id: null,
  state: "idle",
  error: null,
  lines: [],
  fraction: null,
  label: null,
  artifacts: [],
  running: false,
};

/**
 * Subscribes to a job's SSE stream. This is the one place that knows how job
 * events map to UI state -- every tool page gets live logs, progress and
 * artifacts for free by calling this.
 */
export function useJob(): {
  job: JobView;
  start: (toolId: string, inputs: Record<string, unknown>) => Promise<void>;
  attach: (jobId: string) => void;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [job, setJob] = useState<JobView>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);
  const seenRef = useRef(0);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => close, [close]);

  const attach = useCallback(
    (jobId: string) => {
      close();
      seenRef.current = 0;
      setJob({ ...IDLE, id: jobId, state: "queued", running: true });

      const es = new EventSource(`/api/jobs/${jobId}/events`);
      sourceRef.current = es;

      const dedupe = (raw: string): any | null => {
        const data = JSON.parse(raw);
        if (data.seq <= seenRef.current) return null;
        seenRef.current = data.seq;
        return data;
      };

      es.addEventListener("log", (e) => {
        const d = dedupe((e as MessageEvent).data);
        if (d) setJob((j) => ({ ...j, lines: [...j.lines, d.line] }));
      });

      es.addEventListener("progress", (e) => {
        const d = dedupe((e as MessageEvent).data);
        if (d) setJob((j) => ({ ...j, fraction: d.fraction ?? null, label: d.label ?? null }));
      });

      es.addEventListener("status", (e) => {
        const d = dedupe((e as MessageEvent).data);
        if (d) setJob((j) => ({ ...j, state: d.state, error: d.error ?? null }));
      });

      es.addEventListener("artifact", (e) => {
        const d = dedupe((e as MessageEvent).data);
        if (d)
          setJob((j) => ({
            ...j,
            artifacts: [...j.artifacts, { name: d.name, size: d.size, content_type: d.content_type }],
          }));
      });

      es.addEventListener("done", (e) => {
        const d = dedupe((e as MessageEvent).data);
        close();
        if (!d) {
          setJob((j) => ({ ...j, running: false }));
          return;
        }
        setJob((j) => ({
          ...j,
          state: d.state,
          error: d.error ?? null,
          artifacts: d.artifacts?.length ? d.artifacts : j.artifacts,
          running: false,
        }));
      });

      // A dropped connection on an unfinished job: fall back to polling once
      // so the UI does not sit on a stale "running".
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          api
            .job(jobId)
            .then((j) =>
              setJob((prev) => ({
                ...prev,
                state: j.state,
                error: j.error,
                artifacts: j.artifacts,
                running: j.state === "running" || j.state === "queued",
              })),
            )
            .catch(() => setJob((prev) => ({ ...prev, running: false })));
        }
      };
    },
    [close],
  );

  const start = useCallback(
    async (toolId: string, inputs: Record<string, unknown>) => {
      setJob({ ...IDLE, state: "queued", running: true });
      try {
        const { job_id } = await api.run(toolId, inputs);
        attach(job_id);
      } catch (err) {
        setJob({ ...IDLE, state: "failed", error: String(err), running: false });
      }
    },
    [attach],
  );

  const cancel = useCallback(async () => {
    if (job.id) await api.cancel(job.id).catch(() => {});
  }, [job.id]);

  const reset = useCallback(() => {
    close();
    setJob(IDLE);
  }, [close]);

  return { job, start, attach, cancel, reset };
}
