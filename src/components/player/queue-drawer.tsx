"use client";

/**
 * WFX2-P5-MQ — the miniplayer-attached queue drawer.
 *
 * The queue list attached to the miniplayer chrome: opens from the bar's
 * queue button (ListVideo + count badge — player-host-layer.tsx), REUSES
 * the watch page's QueuePanel (promoted, not forked — its currentVideoId
 * prop widens additively to string | null so the drawer can pass the
 * player host's now-playing id; watch-page callers are unaffected), and
 * follows the honest-state laws:
 * - it exists ONLY while the miniplayer is alive (a video + mini mode)
 *   AND the session queue is non-empty — no queue, no chrome;
 * - when the mini dies (Close) or a watch page takes the player inline,
 *   the attached drawer closes itself — the watch page's own QueuePanel
 *   section owns that surface (P4-QT shipped it; it stays);
 * - removes ride the existing removeFromQueue (the REAL WL write — honest
 *   outcomes only, surfaced by QueuePanel's toasts).
 *
 * Mounted ONCE in the AppShell next to <PlayerHostLayer/> — the global
 * mount (available on every page while the miniplayer is alive with a
 * queue). Drawer-open state lives in a session-scoped store (the
 * player-host / queue-store idiom: factory + singleton + test reset).
 */
import { useEffect } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { usePlayerHost } from "@/lib/player/player-host";
import { useQueueStore } from "@/lib/queue/queue-store";
import { QueuePanel } from "@/components/watch/queue-panel";

interface QueueDrawerState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

/** The store factory (tests construct isolated stores). */
export function createQueueDrawerStore() {
  return create<QueueDrawerState>()((set) => ({
    open: false,
    toggle: () => set((s) => ({ open: !s.open })),
    close: () => set({ open: false }),
  }));
}

/** The app store. Session-scoped — NOT persisted (like the queue itself). */
export const useQueueDrawer: UseBoundStore<StoreApi<QueueDrawerState>> =
  createQueueDrawerStore();

/** Test seam: reset the drawer between cases (production never calls). */
export function resetQueueDrawerForTests(): void {
  useQueueDrawer.setState({ open: false });
}

export function QueueDrawer() {
  const videoId = usePlayerHost((s) => s.videoId);
  const hostMode = usePlayerHost((s) => s.hostMode);
  const count = useQueueStore((s) => s.items.length);
  const open = useQueueDrawer((s) => s.open);

  // The mini's alive law: a video + mini mode. When the mini dies (Close)
  // or a watch page takes the player inline, the attached drawer closes —
  // and an emptied queue closes it too (no chrome on the empty state).
  const miniAlive = videoId !== null && hostMode === "mini";
  useEffect(() => {
    if (!miniAlive || count === 0) useQueueDrawer.getState().close();
  }, [miniAlive, count]);

  // Escape closes (a local affordance of THIS drawer — the global
  // shortcuts registry is another lane's surface).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useQueueDrawer.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Honest states: no mini, no queue, or closed → NO drawer chrome at all.
  if (!miniAlive || !open || count === 0) return null;

  return (
    <aside
      aria-label="Miniplayer queue"
      className="fixed right-4 z-50 max-h-[60vh] w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      style={{
        // anchored ABOVE the mini chrome (same fixed geometry: bottom-4 +
        // the bar (~54px incl. border) + the 16:9 video at the mini's width
        // + a 0.5rem gap) — attached to the miniplayer, wherever it is.
        bottom:
          "calc(1rem + 54px + 0.5rem + min(400px, calc(100vw - 2rem)) * 0.5625)",
      }}
    >
      <QueuePanel currentVideoId={videoId} />
    </aside>
  );
}
