import { useEffect, useRef, type ReactNode } from "react";
import { formatBytes, api } from "../api";
import type { JobView } from "./useJob";

export { useJob } from "./useJob";
export type { JobView } from "./useJob";
import { useTheme } from "./theme";

export { useTheme, THEMES } from "./theme";
export type { Theme } from "./theme";

/** Cycles dark -> light -> gruvbox. Choice is explicit and persisted; the OS
 *  colour-scheme preference is deliberately ignored. */
export function ThemeSwitcher() {
  const { theme, cycle } = useTheme();
  return (
    <Button variant="ghost" className="theme-btn" onClick={cycle} title="Change theme">
      <span>theme</span>
      <span className="value">{theme}</span>
    </Button>
  );
}

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

/** Bracketed mono status: `[ RUNNING ]`. Brackets blink while live, which is
 *  what signals a job is alive now that there is no progress bar. */
export function StatusPill({ state }: { state: string }) {
  if (state === "idle") return null;
  return (
    <span className={`status status-${state}`}>
      <span className="bracket">[</span> {state.toUpperCase()} <span className="bracket">]</span>
    </span>
  );
}

/** Progress is a number, not a bar. `fraction` is null until a tool reports one. */
export function Progress({ fraction, label }: { fraction: number | null; label?: string | null }) {
  const pct = fraction == null ? null : `${(fraction * 100).toFixed(1)}%`;
  if (!pct && !label) return null;
  return (
    <span className="status-meta">
      {[pct, label].filter(Boolean).join(" · ")}
    </span>
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
        <div className="row" style={{ gap: "var(--s2)" }}>
          <StatusPill state={job.state} />
          <Progress fraction={job.running ? job.fraction : null} label={job.label} />
        </div>
        {job.running && onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {job.error && <div className="field"><span className="error">{job.error}</span></div>}

      <LogView lines={job.lines} />
      {job.id && <Artifacts jobId={job.id} artifacts={job.artifacts} />}
    </Panel>
  );
}
