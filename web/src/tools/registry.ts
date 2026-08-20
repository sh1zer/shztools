import { lazy, type LazyExoticComponent } from "react";

/**
 * Frontend tool registry.
 *
 * To add a tool: create src/tools/<id>/Page.tsx, then add one entry here whose
 * `id` matches the backend ToolSpec.id. Pages are lazy-loaded, so a heavy tool
 * page costs nothing until you open it.
 */
export interface ToolPage {
  id: string;
  /** Fallback label/blurb if the backend is unreachable. */
  name: string;
  description?: string;
  component: LazyExoticComponent<React.ComponentType>;
}

export const toolPages: ToolPage[] = [
  {
    id: "ytdlp",
    name: "yt-dlp",
    description: "Download a video from a URL as mp4.",
    component: lazy(() => import("./ytdlp/Page")),
  },
];

export const pageById = (id: string) => toolPages.find((t) => t.id === id);
