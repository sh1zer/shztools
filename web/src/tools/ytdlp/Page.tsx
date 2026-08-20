import { useState, type FormEvent } from "react";
import { Button, Field, JobRunner, PageShell, Panel, useJob } from "../../ui";

export default function YtdlpPage() {
  const [url, setUrl] = useState("");
  const { job, start, cancel } = useJob();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || job.running) return;
    void start("ytdlp", { url: url.trim() });
  };

  return (
    <PageShell title="yt-dlp" subtitle="Paste a link, get an mp4.">
      <Panel>
        <form onSubmit={submit} style={{ display: "contents" }}>
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
          <div className="row">
            <Button type="submit" disabled={!url.trim() || job.running}>
              {job.running ? "Downloading…" : "Download"}
            </Button>
          </div>
        </form>
      </Panel>

      <JobRunner job={job} onCancel={cancel} />
    </PageShell>
  );
}
