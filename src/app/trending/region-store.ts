"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { TRENDING_REGION_CODES } from "@/lib/youtube/trending-regions";

/**
 * P23-C (G7) — the trending region preference (the location switcher's
 * selection), persisted to localStorage under "wf-trending-region" (the
 * channel-prefs-store idiom: WebFlix owns UI prefs, YouTube owns the data —
 * the standing law). The region is a VIEW parameter on the read
 * (?gl= / context.client.gl — youtube.com's own region mechanism, measured);
 * it never claims to be the account's Content-location setting.
 *
 * skipHydration + explicit rehydrate after mount (the sidebar-store idiom —
 * no SSR mismatch); `createTrendingRegionStore(storage)` is the test seam.
 */

export type TrendingRegionState = {
  /** The chosen region code (null = the egress default — unset). */
  region: string | null;
  setRegion: (code: string | null) => void;
};

type StorageLike = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

export const TRENDING_REGION_STORAGE_KEY = "wf-trending-region";

/** A code from the real region map or nothing — anything else drops to unset. */
function cleanRegion(raw: unknown): string | null {
  return typeof raw === "string" && TRENDING_REGION_CODES.includes(raw)
    ? raw
    : null;
}

const trendingRegionInitializer = (set: {
  (partial: Partial<TrendingRegionState>): void;
}) => ({
  region: null as string | null,
  setRegion: (code: string | null) => set({ region: cleanRegion(code) }),
});

export function createTrendingRegionStore(storage: StorageLike) {
  return create<TrendingRegionState>()(
    persist(trendingRegionInitializer, {
      name: TRENDING_REGION_STORAGE_KEY,
      storage: createJSONStorage(() => storage as unknown as Storage),
      merge: (persisted, current) => ({
        ...current,
        region: cleanRegion((persisted as { region?: unknown } | null)?.region),
      }),
      // Rehydrate manually after mount (the sidebar idiom) — no SSR mismatch.
      skipHydration: true,
    })
  );
}

/** The app store. SSR renders with no region (the egress default); hydration
 * happens in the trending view's mount effect so markup never mismatches. */
export const useTrendingRegion = createTrendingRegionStore(
  typeof window !== "undefined"
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
);

/** Rehydrate the persisted region after mount (no mismatch). */
export function useTrendingRegionHydration() {
  useEffect(() => {
    void useTrendingRegion.persist.rehydrate();
  }, []);
}
