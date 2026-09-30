/**
 * WFX2-C-S — replay chat seeking: the pure seek classifier.
 *
 * youtube.com behavior mirrored here: when the playhead jumps, the chat
 * replay window reacts differently depending on the direction and distance
 * of the jump relative to the currently fetched message window:
 *
 * - |jump| <= 1s → "none" (youtube.com tolerance — the playhead advances
 *   ~1s/sec during normal playback, so nothing should ever re-anchor from
 *   organic progress).
 * - BACKWARD (beyond tolerance) → "reanchor": drop future messages instantly
 *   (messages after the new playhead) and re-bootstrap the chat from the
 *   session-start token with `?replayOffsetSec=<target>` (the server walks
 *   the continuation chain from the start — see walkReplayToOffset).
 * - FORWARD within the fetched window (+10s grace) → "reveal": the messages
 *   are already fetched; the panel's reveal gating (offsetMsec <= playhead)
 *   shows them with NO fetch.
 * - FORWARD past windowEnd + 10s → "walk": leap-fetch from the CURRENT
 *   continuation token with `?replayOffsetSec=<target>` (the server walks
 *   forward from where we are).
 * - Replay exhausted (no continuation tokens) → "reveal" (nothing to walk;
 *   the video may simply be longer than its chat — honest no-op).
 * - Live chat (window === null) → "none": live chat never re-anchors.
 *
 * Pure module — no React, no fetch; unit-tested in tests/replay-seek.test.ts.
 */

/** ±1s — youtube.com's scrubbing tolerance for replay chat. */
export const SEEK_TOLERANCE_SEC = 1;

/** Forward grace past the fetched window before a leap becomes a walk. */
export const FORWARD_WALK_GRACE_SEC = 10;

export type ReplaySeekAction = "none" | "reveal" | "walk" | "reanchor";

export type ReplaySeekPlan =
  | { action: "none" }
  | { action: "reveal" }
  | { action: "walk"; targetSec: number }
  | { action: "reanchor"; targetSec: number };

/**
 * The fetched replay window the classifier reasons about.
 * - windowEndMsec: the newest message offset (msec); 0 when nothing fetched.
 * - hasMore: continuation tokens remain (false → replay exhausted).
 * `null` = live chat (no offsets — seeking never applies).
 */
export type ReplayWindowState = {
  windowEndMsec: number;
  hasMore: boolean;
} | null;

/**
 * Classify a playhead jump for chat replay.
 *
 * @param currentOffsetSec where the playhead was last seen (seconds)
 * @param targetOffsetSec  where the playhead is now (seconds)
 * @param windowState      the currently fetched replay window (null = live)
 */
export function planReplaySeek(
  currentOffsetSec: number,
  targetOffsetSec: number,
  windowState: ReplayWindowState,
): ReplaySeekPlan {
  // Live chat: no offsets, no seeking — the panel shows the live tail.
  if (windowState === null) return { action: "none" };

  const targetSec = Math.max(0, targetOffsetSec);
  const delta = targetSec - currentOffsetSec;

  // youtube.com tolerance: organic ~1s/sec playback never triggers a plan.
  if (Math.abs(delta) <= SEEK_TOLERANCE_SEC) return { action: "none" };

  // Backward seek: drop future messages + re-bootstrap from the
  // session-start token with ?replayOffsetSec (re-anchor).
  if (delta < 0) return { action: "reanchor", targetSec };

  // Forward seek: within the fetched window (+grace) the reveal gating
  // already has the messages — no fetch. Past that, leap-walk from the
  // current token — unless the replay is exhausted (honest no-op).
  const graceMsec = FORWARD_WALK_GRACE_SEC * 1000;
  if (targetSec * 1000 <= windowState.windowEndMsec + graceMsec) {
    return { action: "reveal" };
  }
  if (!windowState.hasMore) return { action: "reveal" };
  return { action: "walk", targetSec };
}

/**
 * Derive the ReplayWindowState from the hook's message list + token.
 * null-offset messages (should not exist in replay frames, but the mapper
 * is permissive) do not extend the window.
 */
export function replayWindowFrom(
  messages: { offsetMsec: number | null }[],
  nextToken: string | null,
): ReplayWindowState {
  let windowEndMsec = 0;
  for (const m of messages) {
    if (typeof m.offsetMsec === "number" && m.offsetMsec > windowEndMsec) {
      windowEndMsec = m.offsetMsec;
    }
  }
  return { windowEndMsec, hasMore: nextToken !== null };
}

/**
 * Backward seek drop rule: keep messages at/below the new playhead (and
 * offset-less system messages — they are position-independent).
 */
export function keepMessagesAtOrBelow<T extends { offsetMsec: number | null }>(
  messages: T[],
  targetSec: number,
): T[] {
  const edgeMsec = Math.max(0, targetSec) * 1000;
  return messages.filter(
    (m) => m.offsetMsec === null || m.offsetMsec === undefined || m.offsetMsec <= edgeMsec,
  );
}
