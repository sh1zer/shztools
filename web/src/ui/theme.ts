import { useCallback, useEffect, useState } from "react";

export const THEMES = ["dark", "light", "gruvbox"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "shztools.theme";

/** Deliberately ignores prefers-color-scheme: the preference is explicit. */
function initial(): Theme {
  const stored = localStorage.getItem(KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : "dark";
}

export function useTheme(): { theme: Theme; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const cycle = useCallback(
    () => setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]),
    [],
  );

  return { theme, cycle };
}
