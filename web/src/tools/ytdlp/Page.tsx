import { useCallback, useState, type FormEvent } from "react";
import { api } from "../../api";
import { Button, Field, JobRunner, PageShell, Panel, useJob } from "../../ui";
import Trimmer, { type Selection } from "./Trimmer";
import { DEFAULT_HEIGHT, PREVIEW_HEIGHT, QUALITIES } from "./quality";

export default function YtdlpPage() {
  const [url, setUrl] = useState("");
  const [height, setHeight] = useState<number | null>(DEFAULT_HEIGHT);

  // Two jobs, and neither downloads the full video up front. The first pulls
  // a cheap preview of the whole thing so there is something to scrub in a
  // few seconds; the second produces whatever is actually being kept -- a
  // segment, or the whole video if Download was pressed instead of Trim.
  const { job: preview, start: startPreview, cancel: cancelPreview, reset: resetPreview } = useJob();
  const { job: output, start: startOutput, cancel: cancelOutput, reset: resetOutput } = useJob();
  /** The URL the player is showing, which is what the cut must be fetched
   *  from -- not whatever has since been typed into the box. */
  const [loaded, setLoaded] = useState<string | null>(null);
  /** Only one run card, so it follows whichever job ran last. */
  const [showing, setShowing] = useState<"preview" | "output">("preview");

  const previewVideo =
    preview.state === "succeeded" && preview.id
      ? preview.artifacts.find((a) => a.content_type.startsWith("video/")) ?? preview.artifacts[0]
      : undefined;
  const source = previewVideo ? { job_id: preview.id!, name: previewVideo.name } : null;

  const busy = preview.running || output.running;

  /** The form's own action, so Enter in the URL box downloads. */
  const downloadWhole = (e: FormEvent) => {
    e.preventDefault();
    const next = url.trim();
    if (!next || busy) return;
    resetPreview();
    setLoaded(null);
    setShowing("output");
    void startOutput("ytdlp", { url: next, height });
  };

  const trim = () => {
    const next = url.trim();
    if (!next || busy) return;
    resetOutput();
    setLoaded(next);
    setShowing("preview");
    void startPreview("ytdlp", { url: next, height: PREVIEW_HEIGHT });
  };

  // Stable, so the memoised Trimmer does not reconcile on every SSE event
  // the running job emits.
  const onCut = useCallback(
    (sel: Selection) => {
      if (!loaded) return;
      setShowing("output");
      void startOutput("clip", { url: loaded, start: sel.start, end: sel.end, height });
    },
    [loaded, height, startOutput],
  );

  const shown = showing === "preview" ? preview : output;
  const cancelShown = showing === "preview" ? cancelPreview : cancelOutput;

  return (
    <PageShell fill>
      <div className="tool-head">
        <Panel>
          <form onSubmit={downloadWhole} style={{ display: "contents" }}>
            <Field label="URL" hint="Any site yt-dlp supports.">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
                spellCheck={false}
              />
            </Field>
            <Field label="Quality">
              <select
                value={height ?? "best"}
                onChange={(e) =>
                  setHeight(e.target.value === "best" ? null : Number(e.target.value))
                }
              >
                {QUALITIES.map((q) => (
                  <option key={q.label} value={q.height ?? "best"}>
                    {q.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Button type="submit" disabled={!url.trim() || busy}>
                {output.running ? "Downloading…" : "Download"}
              </Button>
              {/* type="button" or it submits the form as well as running this:
                  a button inside a form defaults to type="submit". */}
              <Button
                type="button"
                variant="ghost"
                onClick={trim}
                disabled={!url.trim() || busy}
              >
                {preview.running ? "Loading…" : "Trim"}
              </Button>
            </div>
          </form>
        </Panel>

        <JobRunner job={shown} onCancel={cancelShown} compact />
      </div>

      {source && (
        <Panel title="Trim" className="panel-fill">
          <Trimmer
            key={`${source.job_id}/${source.name}`}
            src={api.artifactUrl(source.job_id, source.name, { inline: true })}
            busy={output.running}
            onCut={onCut}
          />
        </Panel>
      )}
    </PageShell>
  );
}
