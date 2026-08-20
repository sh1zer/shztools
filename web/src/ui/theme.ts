import { useCallback, useSyncExternalStore } from "react";

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

// Runs at import so <html> is correct even if the pre-paint script was blocked.
apply(current);

/** Deliberately ignores prefers-color-scheme: the preference is explicit. */
export function useTheme(): { theme: Theme; cycle: () => void } {
  const theme = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => current,
  );

  const cycle = useCallback(
    () => apply(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]),
    [],
  );

  return { theme, cycle };
}
