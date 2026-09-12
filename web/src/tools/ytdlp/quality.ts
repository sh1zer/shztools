/** Download quality presets.
 *
 * Caps, not promises: the backend's format selector falls back to the best
 * available, so a source with nothing under the cap still yields something.
 * Its own module so the page and the trimmer can both read it without either
 * importing the other -- and so Trimmer.tsx exports only its component, which
 * is what keeps fast refresh working there.
 */
interface Quality {
  label: string;
  /** Max height to fetch; null is whatever the source has. */
  height: number | null;
}

export const QUALITIES: Quality[] = [
  { label: "360p", height: 360 },
  { label: "480p", height: 480 },
  { label: "720p", height: 720 },
  { label: "1080p", height: 1080 },
  { label: "1440p", height: 1440 },
  { label: "Best available", height: null },
];

export const DEFAULT_HEIGHT = 1080;

/** What the scrubbing copy is capped at. Here rather than on the server so
 *  every cap lives in one place -- lowering it for long sources is this line. */
export const PREVIEW_HEIGHT = 480;
