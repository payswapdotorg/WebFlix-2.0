"use client";

/**
 * WFX2-P4-QT — the queue engine: continuous play.
 *
 * On player ENDED (miniplayer / limbo — no watch page owns the player), the
 * engine advances to the next queue item in place: the consumed (played)
 * video leaves the session queue (it STAYS in Watch Later on youtube.com —
 * only an explicit remove-from-queue writes WL), and the miniplayer takes
 * over the next video via loadVideoById (attach + re-mini in one task — no
 * repaint between the moves, so the mini never flashes).
 *
 * While a watch page owns the player (slot registered), the engine defers:
 * the page's autoplay countdown machine advances the queue there (the
 * queue's next takes priority over the related next — watch-page.tsx).
 * The autoplay preference (the Wave-1 key) is honored.
 *
 * Started from the watch page mount (idempotent — the subscription lives on
 * the playerHost singleton for the session). A queue can only become
 * non-empty from a watch page affordance, so the engine is always active
 * before any ENDED it could act on.
 */
import { playerHost, usePlayerHost } from "@/lib/player/player-host";
import { useQueueStore } from "./queue-store";

/** The Wave-1 autoplay preference key (watch-page.tsx owns the UI toggle). */
const AUTOPLAY_KEY = "wfx2-autoplay";

function autoplayEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "0";
  } catch {
    return true; // private mode → the default (on)
  }
}

let started = false;
let stopListener: (() => void) | null = null;

/** Start the queue engine (idempotent). Returns a stop function (tests). */
export function startQueueEngine(): () => void {
  if (started) {
    return () => {};
  }
  started = true;
  stopListener = playerHost.onEnded(() => {
    // a watch page owns the player → its countdown machine advances the
    // queue (queue-first) — the engine drives only the miniplayer/limbo
    if (playerHost.slot !== null) return;
    if (!autoplayEnabled()) return;

    const store = useQueueStore.getState();
    const currentId = usePlayerHost.getState().videoId;
    const next = store.nextAfter(currentId);
    if (!next) return;

    if (currentId !== null) store.markPlayed(currentId);

    // attach swaps the video (loadVideoById takeover, no reload) but forces
    // inline mode; re-mini in the SAME synchronous task → no intermediate
    // paint (the wrapper goes miniHost without a flash).
    playerHost.attach({
      videoId: next.videoId,
      title: next.title,
      channelName: next.channelName,
      thumbnailUrl: next.thumbnailUrl,
      durationSec: next.durationSec,
    });
    playerHost.setMini(true);
  });
  return () => {
    stopListener?.();
    stopListener = null;
    started = false;
  };
}

/** Test seam: stop the engine + reset the started flag (production never calls). */
export function resetQueueEngineForTests(): void {
  stopListener?.();
  stopListener = null;
  started = false;
}
