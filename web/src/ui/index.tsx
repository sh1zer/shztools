import { useEffect, useRef, type ReactNode } from "react";
import { formatBytes, api } from "../api";
import type { JobView } from "./useJob";

export { useJob } from "./useJob";
export type { JobView } from "./useJob";

/** Standard page frame: title, optional subtitle, stacked content. */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page-head row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="panel">
      {title && <div className="panel-title">{title}</div>}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Button({
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return <button {...props} className={`btn btn-${variant} ${props.className ?? ""}`} />;
}

export function StatusPill({ state }: { state: string }) {
  if (state === "idle") return null;
  return <span className={`pill pill-${state}`}>{state}</span>;
}

export function Progress({ fraction }: { fraction: number | null }) {
  const indeterminate = fraction == null;
  return (
    <div className={`progress ${indeterminate ? "indeterminate" : ""}`}>
      <div style={indeterminate ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
    </div>
  );
}

/** Auto-scrolling log view, pinned to the bottom unless the user scrolls up. */
export function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className="log"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {lines.join("\n")}
    </div>
  );
}

export function Artifacts({ jobId, artifacts }: { jobId: string; artifacts: JobView["artifacts"] }) {
  if (!artifacts.length) return null;
  return (
    <>
      {artifacts.map((a) => (
        <div className="artifact" key={a.name}>
          <div style={{ minWidth: 0 }}>
            <div className="name">{a.name}</div>
            <div className="size">{formatBytes(a.size)}</div>
          </div>
          <a className="btn btn-ghost" href={api.artifactUrl(jobId, a.name)} download>
            Download
          </a>
        </div>
      ))}
    </>
  );
}

/**
 * The whole job UI in one component: status, progress, log, artifacts.
 * Drop this under any tool's form and that tool is done.
 */
export function JobRunner({ job, onCancel }: { job: JobView; onCancel?: () => void }) {
  if (job.state === "idle") return null;
  return (
    <Panel title="Run">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <StatusPill state={job.state} />
          {job.label && <span className="hint">{job.label}</span>}
        </div>
        {job.running && onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {job.running && <Progress fraction={job.fraction} />}
      {job.error && <div className="field"><span className="error">{job.error}</span></div>}

      <LogView lines={job.lines} />
      {job.id && <Artifacts jobId={job.id} artifacts={job.artifacts} />}
    </Panel>
  );
}
