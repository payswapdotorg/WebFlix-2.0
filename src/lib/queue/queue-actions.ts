"use client";

/**
 * WFX2-P4-QT — the WL-backed queue actions (the client seams).
 *
 * WFX2-P36: Add to queue = a watch-later write on the honest WebFlix-LOCAL
 * list FIRST (the existing /api/playlists/watch-later route — YouTube's own
 * WL is a system playlist the official API cannot write, so the local list
 * is the queue's truth); only a confirmed add appends to the session queue.
 * Never a fake append: a failed write leaves the queue untouched and
 * surfaces the honest error. Remove-from-queue is the same local remove,
 * same law. Toasts live in the components — these functions report outcomes.
 *
 * WFX2-P39: the add's watch-later post body carries the item's display
 * snapshot (title + channelName — QueueItem already holds them; conditional
 * spread, only when truthy) so the WL row the same write shapes renders real
 * display data on /playlist/WL, never the generic "YouTube video <id>"
 * fallback. Remove stays snapshot-free — removes need no display metadata.
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
 * {videoId, add: true} — the honest WebFlix-local watch-later add. The
 * session queue only gains the item after the server confirms the write.
 */
export async function addToQueue(item: QueueItem): Promise<QueueActionOutcome> {
  if (useQueueStore.getState().has(item.videoId)) {
    return { status: "already-queued" };
  }
  try {
    await post<{ ok: true; added: boolean; playlistId: string }>("/api/playlists/watch-later", {
      videoId: item.videoId,
      add: true,
      // WFX2-P39 — the item's display snapshot rides the WL-backed save
      // (conditional spread — a truthy-less field stays out of the body)
      ...(item.title ? { title: item.title } : {}),
      ...(item.channelName ? { channelName: item.channelName } : {}),
    });
  } catch (e) {
    // honest failure (unauthenticated / store error): the queue NEVER gains
    // an unconfirmed item — no fake append
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add to queue",
    };
  }
  return { status: useQueueStore.getState().append(item) };
}

/**
 * Remove from the queue: POST /api/playlists/watch-later {videoId, add: false}
 * — the same honest local remove. The session queue only loses the item
 * after the server confirms; an honest failure keeps it queued.
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
