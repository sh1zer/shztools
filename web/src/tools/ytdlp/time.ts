/** Clip timestamps, formatted and parsed in one place so the readout, the
 *  editable inputs and the aria labels never disagree. */

/** 75.25 -> "1:15.25"; 3601 -> "1:00:01.00". Centiseconds, because the whole
 *  point of cutting here rather than in yt-dlp is sub-second boundaries. */
export function formatTime(t: number): string {
  if (!Number.isFinite(t)) return "--:--.--";
  const sign = t < 0 ? "-" : "";
  const abs = Math.abs(t);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = (abs % 60).toFixed(2).padStart(5, "0");
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, "0")}:${s}` : `${sign}${m}:${s}`;
}

/** Accepts "12.4", "1:15.25" or "1:00:01.5". Returns null if it is not a time. */
export function parseTime(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d*\.?\d*$/.test(part) || part === "" || part === ".") return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) && total >= 0 ? total : null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
