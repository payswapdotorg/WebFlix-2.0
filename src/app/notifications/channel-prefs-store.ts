"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChannelLite, NotificationDTO } from "@/lib/types";

/**
 * P18-SUBS-NOTIFS — the per-channel notification preferences (the YouTube
 * bell-menu "gear" surface), persisted to localStorage under
 * "wf-notif-channel-prefs". The standing law owns the shape: YouTube is the
 * user-data source of truth and localStorage owns WebFlix-side prefs — these
 * prefs are a WebFlix VIEW filter, never an upstream write.
 *
 * HONEST SCOPE (documented per the work order): the sheet carries YouTube's
 * exact three-way wording — All / Personalized / None — but the
 * All-vs-Personalized DISTINCTION is YouTube's own server-side logic
 * (upstream-only), so both levels pass the row through to the list; only
 * "none" filters the channel's rows out of THIS view. The REAL per-channel
 * levels live on youtube.com; a channel with no WebFlix-side pref is left
 * unset here (the sheet shows no active segment rather than guessing
 * YouTube's own state — the honest-absence doctrine).
 *
 * Persistence follows the sidebar-store idiom (skipHydration + explicit
 * rehydrate after mount — no SSR mismatch); `createChannelPrefsStore(storage)`
 * is the test seam.
 */
export type ChannelNotifPref = "all" | "personalized" | "none";

export type ChannelPrefsState = {
  /** channelKey → chosen level; absent = unset (YouTube's own level applies) */
  prefs: Record<string, ChannelNotifPref>;
  setPref: (channelKey: string, pref: ChannelNotifPref) => void;
  reset: () => void;
};

type StorageLike = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

export const CHANNEL_PREFS_STORAGE_KEY = "wf-notif-channel-prefs";

const VALID_PREFS: readonly ChannelNotifPref[] = ["all", "personalized", "none"];

/**
 * The stable per-channel key for one notification row: the channel id when
 * the payload carried one, else the DTO's own handle, else the name (the
 * notification mapper degrades honestly — some rows carry no browseId; the
 * DTO's own identity fields are reused, never re-derived).
 */
export function channelKeyOf(channel: ChannelLite): string {
  return channel.id || channel.handle || channel.name;
}

/** One notification row's channel key (see channelKeyOf). */
export function notificationChannelKey(n: Pick<NotificationDTO, "channel">): string {
  return channelKeyOf(n.channel);
}

/**
 * View state: does this row pass the per-channel prefs? Only "none" filters
 * (All/Personalized both pass — the distinction is upstream-only).
 */
export function channelAllowsNotification(
  n: NotificationDTO,
  prefs: Record<string, ChannelNotifPref>
): boolean {
  return prefs[notificationChannelKey(n)] !== "none";
}

/** Keep only valid level values keyed by non-empty strings — hand-edited or
 *  corrupted storage falls back to unset. */
function cleanPrefs(raw: unknown): Record<string, ChannelNotifPref> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ChannelNotifPref> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key && VALID_PREFS.includes(value as ChannelNotifPref)) {
      out[key] = value as ChannelNotifPref;
    }
  }
  return out;
}

const channelPrefsInitializer = (set: {
  (partial: Partial<ChannelPrefsState>): void;
  (fn: (state: ChannelPrefsState) => Partial<ChannelPrefsState>): void;
}) => ({
  prefs: {} as Record<string, ChannelNotifPref>,
  setPref: (channelKey: string, pref: ChannelNotifPref) =>
    set((s) => ({ prefs: { ...s.prefs, [channelKey]: pref } })),
  reset: () => set({ prefs: {} }),
});

export function createChannelPrefsStore(storage: StorageLike) {
  return create<ChannelPrefsState>()(
    persist(channelPrefsInitializer, {
      name: CHANNEL_PREFS_STORAGE_KEY,
      storage: createJSONStorage(() => storage as unknown as Storage),
      merge: (persisted, current) => ({
        ...current,
        prefs: cleanPrefs((persisted as { prefs?: unknown } | null)?.prefs),
      }),
      // Rehydrate manually after mount (the sidebar idiom) — no SSR mismatch.
      skipHydration: true,
    })
  );
}

/** The app store. SSR renders with no prefs (everything passes); hydration
 *  happens in the notifications view's mount effect so markup never
 *  mismatches. */
export const useChannelPrefs = createChannelPrefsStore(
  typeof window !== "undefined"
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
);

/** Rehydrate the persisted per-channel prefs after mount (no mismatch). */
export function useChannelPrefsHydration() {
  useEffect(() => {
    void useChannelPrefs.persist.rehydrate();
  }, []);
}
