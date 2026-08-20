import { Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, type ToolSpec } from "./api";
import { toolPages } from "./tools/registry";
import { PageShell, ThemeSwitcher } from "./ui";

export default function App() {
  // The backend is the source of truth for which tools are actually available;
  // the frontend registry only supplies the pages.
  const [available, setAvailable] = useState<ToolSpec[] | null>(null);

  useEffect(() => {
    api.tools().then(setAvailable).catch(() => setAvailable([]));
  }, []);

  const tools = toolPages.filter((p) => !available || available.some((s) => s.id === p.id));
  const specOf = (id: string) => available?.find((s) => s.id === id);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          shz<span>tools</span>
        </div>
        <nav className="nav">
          <div className="nav-label">Tools</div>
          <NavLink to="/" end>
            Home
          </NavLink>
          {tools.map((t) => (
            <NavLink key={t.id} to={`/t/${t.id}`}>
              {specOf(t.id)?.name ?? t.name}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemeSwitcher />
        </div>
      </aside>

      <main className="main">
        <Suspense fallback={<div className="empty">Loading…</div>}>
          <Routes>
            <Route
              path="/"
              element={
                <PageShell title="Toolkit" subtitle="Personal utilities, reachable from anywhere.">
                  {tools.length === 0 ? (
                    <div className="empty">No tools available.</div>
                  ) : (
                    <div className="grid">
                      {tools.map((t) => (
                        <NavLink className="card" key={t.id} to={`/t/${t.id}`}>
                          <h3>{specOf(t.id)?.name ?? t.name}</h3>
                          <p>{specOf(t.id)?.description ?? t.description}</p>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </PageShell>
              }
            />
            {toolPages.map((t) => {
              const Page = t.component;
              return <Route key={t.id} path={`/t/${t.id}`} element={<Page />} />;
            })}
            <Route
              path="*"
              element={<PageShell title="Not found" subtitle="No such tool.">{null}</PageShell>}
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}