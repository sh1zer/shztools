import { useSyncExternalStore } from "react";

export const THEMES = ["dark", "light", "gruvbox"] as const;
export type Theme = (typeof THEMES)[number];

/** Must match the key used by the pre-paint script in index.html. */
const KEY = "shztools.theme";

/* The theme is global state (it lives on <html>), so it is held in a module
 * store rather than component state: every useTheme() consumer sees the same
 * value, instead of each getting a private copy that goes stale when another
 * one cycles.
 *
 * localStorage access is wrapped throughout -- it throws, not returns null,
 * when site data is blocked or inside a sandboxed iframe, and an unguarded
 * read here would run during render and blank the whole app. */

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (THEMES.includes(stored as Theme)) return stored as Theme;
  } catch {
    /* storage unavailable; fall through to the default */
  }
  return "dark";
}

let current: Theme = read();
const listeners = new Set<() => void>();

/* Module scope, not per-render closures: useSyncExternalStore compares the
   subscribe identity, and these capture nothing render-specific. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Theme {
  return current;
}

/** Commits a user's choice: updates the DOM, persists, and notifies. */
function apply(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preference simply will not persist */
  }
  listeners.forEach((fn) => fn());
}

export function cycle(): void {
  apply(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
}

/* The pre-paint script in index.html has normally set this already. Sync only
   if it was blocked or stored nothing -- writing back a value we just read
   would persist nothing new and invalidate document style before first
   render. */
if (document.documentElement.dataset.theme !== current) {
  document.documentElement.dataset.theme = current;
}

/** Deliberately ignores prefers-color-scheme: the preference is explicit. */
export function useTheme(): { theme: Theme; cycle: () => void } {
  return { theme: useSyncExternalStore(subscribe, getSnapshot), cycle };
}
