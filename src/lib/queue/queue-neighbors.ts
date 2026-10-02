"use client";

/**
 * WFX2-P5-MQ — the queue neighbor selectors (ADDITIVE — the WL-write laws
 * and the store's order semantics are untouched).
 *
 * ONE order opinion: the NEXT direction stays the store's own nextAfter —
 * the exact method the queue engine (queue-engine.ts) and the watch page's
 * countdown (watch-page.tsx) already drive. selectNext DELEGATES to it
 * (never a second implementation of "next"). This module's only new law is
 * PREV: the item immediately before now-playing in insertion order — the
 * mirror of nextAfter. Pure reads — no store mutation, no network.
 */
import { useQueueStore, type QueueItem } from "./queue-store";

/**
 * The item immediately BEFORE `videoId` in the session queue's insertion
 * order — nextAfter's mirror:
 * - null videoId (no player) → null
 * - an unqueued videoId (-1) → null (nothing is "before" an item outside
 *   the order — same honesty as nextAfter's unqueued→head, mirrored)
 * - the head (idx 0) → null (no wraparound)
 */
export function selectPrevBefore(
  items: QueueItem[],
  videoId: string | null,
): QueueItem | null {
  if (videoId === null) return null;
  const idx = items.findIndex((i) => i.videoId === videoId);
  if (idx <= 0) return null;
  return items[idx - 1] ?? null;
}

/**
 * The queue's next for `videoId` — DELEGATES to the store's nextAfter (the
 * one order opinion the engine + the watch-page countdown already drive).
 * Fresh-state read — for the chrome's click handlers.
 */
export function selectNext(videoId: string | null): QueueItem | null {
  return useQueueStore.getState().nextAfter(videoId);
}

/**
 * The item before now-playing (fresh-state read) — for the chrome's click
 * handlers. The mirror of selectNext.
 */
export function selectPrev(videoId: string | null): QueueItem | null {
  return selectPrevBefore(useQueueStore.getState().items, videoId);
}
