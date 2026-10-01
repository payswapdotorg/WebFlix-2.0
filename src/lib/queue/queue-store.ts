"use client";

/**
 * WFX2-P4-QT — the WL-backed session queue store.
 *
 * The queue is the SESSION view of the operator's Watch Later playlist
 * (youtube.com's add-to-queue appends to WL; the queue panel orders it for
 * continuous play). The store itself is session-scoped and in-memory — the
 * WL writes happen in queue-actions BEFORE any store mutation (never a fake
 * append); the store owns order/dedupe/cap, remove, and played-consumption.
 *
 * Factory + singleton + test reset — the player-host / sidebar-store idiom.
 */
import { create, type StoreApi, type UseBoundStore } from "zustand";

export interface QueueItem {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  /** 0 → live (the panel hides the duration badge). */
  durationSec: number;
}

/**
 * The session queue cap. youtube.com's Watch Later playlist itself holds
 * thousands of videos — the QUEUE is the session-ordered view of it, capped
 * in memory; the cap refuses honestly ("full") instead of silently dropping.
 */
export const QUEUE_CAP = 200;

export type QueueAppendResult = "appended" | "already-queued" | "full";

export interface QueueState {
  items: QueueItem[];
  /** Ordered append (dedupe + cap). NO network — WL truth is queue-actions' job. */
  append: (item: QueueItem) => QueueAppendResult;
  /** Remove from the session queue (the WL write is queue-actions' job). */
  remove: (videoId: string) => void;
  /**
   * Session consumption: the PLAYED video leaves the queue. It STAYS in the
   * operator's Watch Later on youtube.com — continuous play never removes
   * from WL; only an explicit remove-from-queue does.
   */
  markPlayed: (videoId: string) => void;
  /**
   * The next queue item after `videoId` (insertion order). `videoId` null or
   * not queued → the queue's head; the current item being last → null.
   */
  nextAfter: (videoId: string | null) => QueueItem | null;
  has: (videoId: string) => boolean;
  clear: () => void;
}

/** The store factory (tests construct isolated stores). */
export function createQueueStore() {
  return create<QueueState>()((set, get) => ({
    items: [],
    append: (item) => {
      const { items } = get();
      if (items.some((i) => i.videoId === item.videoId)) return "already-queued";
      if (items.length >= QUEUE_CAP) return "full";
      set({ items: [...items, item] });
      return "appended";
    },
    remove: (videoId) =>
      set((s) => ({ items: s.items.filter((i) => i.videoId !== videoId) })),
    markPlayed: (videoId) =>
      set((s) => ({ items: s.items.filter((i) => i.videoId !== videoId) })),
    nextAfter: (videoId) => {
      const { items } = get();
      if (items.length === 0) return null;
      if (videoId === null) return items[0];
      const idx = items.findIndex((i) => i.videoId === videoId);
      if (idx === -1) return items[0];
      return items[idx + 1] ?? null;
    },
    has: (videoId) => get().items.some((i) => i.videoId === videoId),
    clear: () => set({ items: [] }),
  }));
}

/** The app store. Session-scoped — NOT persisted (the queue is a session
 * construct, like the miniplayer). */
export const useQueueStore: UseBoundStore<StoreApi<QueueState>> = createQueueStore();

/** Test seam: reset the singleton between cases (production never calls). */
export function resetQueueStoreForTests(): void {
  useQueueStore.setState({ items: [] });
}
