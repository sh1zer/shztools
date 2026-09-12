# Design

Tool pages are hand-written but use a shared kit in `web/src/ui/`:

- `tokens.css` — colour, spacing, type, radius, and the three themes
- `kit.css` — styles for the shared classes
- `theme.ts` — theme state, persisted to `localStorage`
- `index.tsx` — `PageShell`, `Panel`, `Field`, `Button`, `JobRunner`,
  `LogView`, `Progress`, `Status`, `Artifacts`, `ThemeSwitcher`

**Never hardcode a hex, a radius or a font in a tool page.** Use a token.

| Rule | |
| --- | --- |
| **Monochrome by default** | Dark neutral greys, `#141414` page. Themes: dark, light, gruvbox material, cycled from the sidebar footer. `prefers-color-scheme` is ignored. |
| **Square corners** | `--radius: 0`. Set it to `2px` to round the whole toolkit. |
| **Structure from borders** | 1px borders and background value steps. No shadows. |
| **Hue only for run status** | `--ok`, `--warn`, `--err`. Not used for decoration. |
| **Primary means inverted** | `--accent` is the foreground colour in the mono themes and the aqua in gruvbox. One rule gives an inverted button in mono and an accented one in gruvbox. |
| **Contrast minimums** | `--text-faint` for labels and placeholders only, 4.5:1 on `--surface`. Anything carrying data uses `--text-dim`, 4.5:1 on `--surface-2`. |
| **Progress is a number** | No bar. Liveness comes from the blinking brackets in `[ RUNNING ]`, which also covers tools that report no fraction. |
| **No explanatory prose** | The log collapses to its last line. Run status sits beside the form, not under it. A control that needs a sentence under it is the wrong control. |

A page can fit the viewport instead of scrolling: `<PageShell fill>` plus a
child with `panel-fill`, which takes the height the rest of the page leaves.

Adding a theme is a block of token overrides under `:root[data-theme="name"]`
and an entry in `THEMES`.
