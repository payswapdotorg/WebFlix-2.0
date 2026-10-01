"use client";

import { create } from "zustand";
import { postJson } from "@/hooks/use-api";
import type { NotificationDTO } from "@/lib/types";

/**
 * WFX2-P4-NC — the session-local read overlay: the per-item "opened marks
 * read" VIEW state, shared by the bell menu and the notification center.
 *
 * HONEST SCOPE (documented per the work order): this overlay never claims
 * an upstream write. No per-item notification write is verified against
 * youtube.com (research §12 — record_web_notifications_seen 404s; the
 * broker's notifications-mark-read opens the bell menu, clearing ALL
 * unseen at once — the mark-ALL granularity, reserved for the existing
 * POST /api/notifications/read route). Opening an item therefore:
 *   1. marks IT read in THIS browser session (the overlay);
 *   2. fires the menu re-read (POST /api/notifications/[id]/read — the
 *      §12-verified read endpoint) so the item's CURRENT upstream truth
 *      flows back for reconciliation;
 *   3. the feed poll (the upstream's own cadence) reconciles the rest.
 * The badge decrements against the overlay — the operator's own view, the
 * same UX youtube.com gives the signed-in user, without faking an
 * upstream effect.
 */
export type LocalReadState = {
  /** notification ids opened this session (were unread when opened) */
  readIds: string[];
  markLocalRead: (id: string) => void;
  /** drop overlay ids the upstream now reports as read (or no longer carries) */
  reconcile: (items: NotificationDTO[]) => void;
  reset: () => void;
};

export const useLocalRead = create<LocalReadState>()((set, get) => ({
  readIds: [],
  markLocalRead: (id) => {
    if (get().readIds.includes(id)) return;
    set((s) => ({ readIds: [...s.readIds, id] }));
  },
  reconcile: (items) => {
    if (get().readIds.length === 0) return;
    const upstreamRead = new Set(items.filter((i) => i.read).map((i) => i.id));
    const carried = new Set(items.map((i) => i.id));
    set((s) => ({
      readIds: s.readIds.filter((id) => !upstreamRead.has(id) && carried.has(id)),
    }));
  },
  reset: () => set({ readIds: [] }),
}));

/** View state: an item reads as read when the upstream OR the overlay says so. */
export function effectiveRead(item: NotificationDTO, readIds: string[]): boolean {
  return item.read || readIds.includes(item.id);
}

/**
 * The badge count the bell/center display: the feed's upstream unread
 * count minus the items THIS session opened (still unread upstream — the
 * reconciled overlay only carries those). Never negative, never above
 * the upstream's own number.
 */
export function effectiveUnread(unread: number, readIds: string[]): number {
  return Math.max(0, unread - readIds.length);
}

/**
 * Open one notification (the real client's unseen clearing, honestly
 * scoped): mark the item read in the session overlay, fire the menu
 * re-read for reconciliation, and let the caller navigate. The re-read is
 * best-effort — a failure never fakes a state; the poll reconciles.
 */
export function openNotification(id: string): void {
  useLocalRead.getState().markLocalRead(id);
  void postJson(`/api/notifications/${encodeURIComponent(id)}/read`, {})
    .then(() => null)
    .catch(() => null);
}
