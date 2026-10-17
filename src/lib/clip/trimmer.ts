/**
 * WFX2-P23-A — the clip trimmer's pure logic (youtube.com's measured
 * contract: a [start, end) window over the video timeline with the 15s
 * minimum / 60s maximum enforcement; the scrubber's own text-inputs row
 * takes m:ss timestamps — allowed pattern [\d\.\:]).
 *
 * Pure + exported: the dialog tests pin the clamp law directly.
 */
import { CLIP_MIN_SEC, CLIP_MAX_SEC } from "@/lib/clip/clip-service";

export { CLIP_MIN_SEC, CLIP_MAX_SEC };

export interface ClipWindow {
  startSec: number;
  endSec: number;
}

/**
 * Clamp a drag position to the law: 0 ≤ start, end ≤ duration, and the
 * window length pinned to [CLIP_MIN_SEC, CLIP_MAX_SEC] against the
 * ANCHORED side (youtube.com's handle semantics: dragging one handle
 * moves that edge; the other edge stays; the length law clamps).
 */
export function clampClipHandle(
  dragging: "start" | "end",
  proposed: number,
  anchor: number,
  durationSec: number
): number {
  const max = Math.max(0, durationSec || 0);
  const raw = Math.min(Math.max(proposed, 0), max);
  if (dragging === "start") {
    // start ≤ anchor - MIN and ≥ anchor - MAX
    return Math.min(Math.max(raw, anchor - CLIP_MAX_SEC), anchor - CLIP_MIN_SEC);
  }
  // end ≥ anchor + MIN and ≤ anchor + MAX
  return Math.min(Math.max(raw, anchor + CLIP_MIN_SEC), anchor + CLIP_MAX_SEC);
}

/** The default window when the trimmer opens: 15s at the playhead. */
export function defaultClipWindow(currentTime: number, durationSec: number): ClipWindow {
  const dur = Math.max(0, durationSec || 0);
  if (dur > 0 && dur < CLIP_MIN_SEC) {
    // the video itself is shorter than the minimum — the honest degenerate
    // window (the create refuses; the UI shows the reason)
    return { startSec: 0, endSec: dur };
  }
  const start = Math.min(Math.max(0, Math.floor(currentTime)), Math.max(0, dur - CLIP_MIN_SEC));
  return { startSec: start, endSec: Math.min(start + CLIP_MIN_SEC, dur || start + CLIP_MIN_SEC) };
}

/** Parse an m:ss / h:mm:ss / s / m.ss timestamp (the input pattern). */
export function parseTimeInput(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^[\d.:]+$/.test(t)) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p))) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Format seconds as m:ss (h:mm:ss past an hour — the watch formats). */
export function formatTimeInput(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}
