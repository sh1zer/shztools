import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatBytes, api, type JobState } from "../api";
import type { JobView } from "./useJob";
import { useTheme } from "./theme";

export { useJob } from "./useJob";
export type { JobView } from "./useJob";
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

/** Standard page frame: stacked content under an optional header.
 *  A tool whose name is already in the nav does not need to repeat it, and
 *  the vertical space is worth more than the restatement -- so every part of
 *  the header is optional, and with none of them there is no header. */
export function PageShell({
  title,
  subtitle,
  actions,
  fill,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Fit the viewport rather than scroll: a child marked `panel-fill` then
   *  takes whatever height the rest of the page leaves. */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={fill ? "page page-fill" : "page"}>
      {(title || subtitle || actions) && (
        <header className="page-head row" style={{ justifyContent: "space-between" }}>
          <div>
            {title && <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </div>
  );
}

export function Panel({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `panel ${className}` : "panel"}>
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

/** The live/terminal partition of the job state machine, in one place.
 *  A total map over JobState, so adding a state on the server fails the build
 *  here rather than silently rendering as unstyled text -- and the CSS keys
 *  off the tone, so it never enumerates states at all. */
const TONE: Record<JobState | "idle", "live" | "ok" | "warn" | "err" | null> = {
  idle: null,
  queued: "live",
  running: "live",
  succeeded: "ok",
  cancelled: "warn",
  failed: "err",
};

/** Bracketed mono status: `[ RUNNING ]`. Brackets blink while live, which is
 *  what signals a job is alive now that there is no progress bar. */
export function Status({ state }: { state: JobState | "idle" }) {
  const tone = TONE[state];
  if (!tone) return null;
  return (
    <span className="status" data-tone={tone}>
      <span className="bracket">[</span> {state.toUpperCase()} <span className="bracket">]</span>
    </span>
  );
}

/** Progress is a number, not a bar. `fraction` is null until a tool reports one. */
export function Progress({ fraction, label }: { fraction: number | null; label?: string | null }) {
  const parts = [fraction == null ? null : `${(fraction * 100).toFixed(1)}%`, label].filter(Boolean);
  if (!parts.length) return null;
  return <span className="status-meta">{parts.join(" · ")}</span>;
}

/** The log, collapsed to its last line. Expanded it auto-scrolls, pinned to
 *  the bottom unless the user scrolls up. */
export function LogView({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines, expanded]);

  return (
    <div className="log-wrap">
      {expanded ? (
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
      ) : (
        <div className="log log-tail">{lines[lines.length - 1] ?? ""}</div>
      )}
      {lines.length > 1 && (
        <button
          type="button"
          className="log-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "collapse" : `${lines.length} lines`}
        </button>
      )}
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
 *
 * `compact` drops the log, for tools that put this beside the form rather
 * than under it. A failed job shows it regardless -- that is the one time the
 * output is the point.
 */
export function JobRunner({
  job,
  onCancel,
  compact,
}: {
  job: JobView;
  onCancel?: () => void;
  compact?: boolean;
}) {
  if (job.state === "idle") {
    // A panel rather than nothing: pages that give the runner a fixed slot
    // would otherwise render a hole in the layout until the first run.
    return (
      <Panel title="Run">
        <div className="empty">Nothing running.</div>
      </Panel>
    );
  }
  return (
    <Panel title="Run">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row row-tight">
          <Status state={job.state} />
          <Progress fraction={job.running ? job.fraction : null} label={job.label} />
        </div>
        {job.running && onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {job.error && <div className="field"><span className="error">{job.error}</span></div>}

      {(!compact || job.state === "failed") && <LogView lines={job.lines} />}
      {job.id && <Artifacts jobId={job.id} artifacts={job.artifacts} />}
    </Panel>
  );
}
