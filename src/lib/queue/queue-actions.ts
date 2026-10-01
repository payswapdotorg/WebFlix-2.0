"use client";

/**
 * WFX2-P4-QT — the WL-backed queue actions (the client seams).
 *
 * Add to queue = a REAL watch-later write on youtube.com FIRST (the existing
 * /api/playlists/watch-later route → the broker watch-later kind — NO new
 * broker kinds); only a verified add appends to the session queue. Never a
 * fake append: an offline/failed write leaves the queue untouched and
 * surfaces the honest error. Remove-from-queue is the real WL remove, same
 * law. Toasts live in the components — these functions report outcomes.
 */
import { post } from "@/lib/watch/client";
import { useQueueStore, type QueueItem } from "./queue-store";

export type QueueActionOutcome =
  | { status: "appended" }
  | { status: "already-queued" }
  | { status: "full" }
  | { status: "removed" }
  | { status: "not-in-queue" }
  | { status: "error"; message: string };

/**
 * Append to the WL-backed queue: POST /api/playlists/watch-later
 * {videoId, add: true} — the broker watch-later add. The session queue only
 * gains the item after the server confirms the real WL write.
 */
export async function addToQueue(item: QueueItem): Promise<QueueActionOutcome> {
  if (useQueueStore.getState().has(item.videoId)) {
    return { status: "already-queued" };
  }
  try {
    await post<{ ok: true; added: boolean; playlistId: string }>("/api/playlists/watch-later", {
      videoId: item.videoId,
      add: true,
    });
  } catch (e) {
    // honest failure (broker offline / action failed / 401): the queue NEVER
    // gains an unverified item — no fake append
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add to queue",
    };
  }
  return { status: useQueueStore.getState().append(item) };
}

/**
 * Remove from the queue: POST /api/playlists/watch-later {videoId, add: false}
 * — the real WL remove. The session queue only loses the item after the
 * server confirms; an honest failure keeps it queued.
 */
export async function removeFromQueue(videoId: string): Promise<QueueActionOutcome> {
  if (!useQueueStore.getState().has(videoId)) {
    return { status: "not-in-queue" };
  }
  try {
    await post<{ ok: true; added: boolean }>("/api/playlists/watch-later", {
      videoId,
      add: false,
    });
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to remove from queue",
    };
  }
  useQueueStore.getState().remove(videoId);
  return { status: "removed" };
}
