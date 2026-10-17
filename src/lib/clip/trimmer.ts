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
 * Clamp a drag position to the law: the window length pinned to
 * [CLIP_MIN_SEC, CLIP_MAX_SEC] against the ANCHORED side (youtube.com's
 * handle semantics: dragging one handle moves that edge; the other edge
 * stays; the length law clamps), THEN bounded to the timeline — and the
 * start handle additionally obeys the runway law (a 15s window needs 15s
 * of video ahead, so start can never pass duration − MIN; youtube.com's
 * own trimmer behaves the same).
 */
export function clampClipHandle(
  dragging: "start" | "end",
  proposed: number,
  anchor: number,
  durationSec: number
): number {
  const max = Math.max(0, durationSec || 0);
  if (dragging === "start") {
    // window law: start ∈ [anchor − MAX, anchor − MIN]
    let v = Math.min(Math.max(proposed, anchor - CLIP_MAX_SEC), anchor - CLIP_MIN_SEC);
    if (max > 0) {
      // timeline + runway law: [0, duration − MIN]
      v = Math.min(Math.max(v, 0), Math.max(0, max - CLIP_MIN_SEC));
    }
    return Math.max(0, v);
  }
  // window law: end ∈ [anchor + MIN, anchor + MAX]
  let v = Math.min(Math.max(proposed, anchor + CLIP_MIN_SEC), anchor + CLIP_MAX_SEC);
  if (max > 0) v = Math.min(v, max);
  return Math.max(0, v);
}

/** The default window when the trimmer opens: 15s at the playhead. */
export function defaultClipWindow(currentTime: number, durationSec: number): ClipWindow {
  const dur = Math.max(0, durationSec || 0);
  if (dur > 0 && dur < CLIP_MIN_SEC) {
    // the video itself is shorter than the minimum — the honest degenerate
    // window (the create refuses; the UI shows the reason)
    return { startSec: 0, endSec: dur };
  }
  // duration unknown (0/null — the `next` read carries no length) → the
  // playhead window without a timeline clamp
  const start =
    dur > 0
      ? Math.min(Math.max(0, Math.floor(currentTime)), Math.max(0, dur - CLIP_MIN_SEC))
      : Math.max(0, Math.floor(currentTime));
  const end = dur > 0 ? Math.min(start + CLIP_MIN_SEC, dur) : start + CLIP_MIN_SEC;
  return { startSec: start, endSec: end };
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
