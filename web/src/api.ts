export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Artifact {
  name: string;
  size: number;
  content_type: string;
}

export interface JobSummary {
  id: string;
  tool: string;
  state: JobState;
  error: string | null;
  created_at: number;
  finished_at: number | null;
  inputs: Record<string, unknown>;
  artifacts: Artifact[];
}

export interface ToolSpec {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tools: () => fetch("/api/tools").then(json<ToolSpec[]>),

  run: (toolId: string, inputs: Record<string, unknown>) =>
    fetch(`/api/tools/${toolId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs }),
    }).then(json<{ job_id: string }>),

  job: (id: string) => fetch(`/api/jobs/${id}`).then(json<JobSummary>),

  jobs: (tool?: string) =>
    fetch(`/api/jobs${tool ? `?tool=${encodeURIComponent(tool)}` : ""}`).then(json<JobSummary[]>),

  cancel: (id: string) => fetch(`/api/jobs/${id}/cancel`, { method: "POST" }).then(json),

  artifactUrl: (jobId: string, name: string) =>
    `/api/jobs/${jobId}/artifacts/${encodeURIComponent(name)}`,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
