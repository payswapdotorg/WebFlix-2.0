"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * P18-SUBS-NOTIFS — the subscriptions feed's LAYOUT TOGGLE (grid ⇄ list),
 * the WebFlix-side view preference persisted to localStorage under
 * "wf-subs-layout" (the standing law: YouTube is the user-data source of
 * truth; localStorage owns WebFlix-side prefs — the same ownership split as
 * the sidebar store).
 *
 * Hydration follows the sidebar-store idiom (src/lib/sidebar-store.ts):
 * skipHydration + an explicit rehydrate after mount, so SSR renders the
 * DEFAULT (grid) and markup never mismatches. The feed rows themselves only
 * paint after the /api/subscriptions fetch resolves — after the mount-effect
 * rehydration in practice, so the stored choice never visibly flips.
 *
 * `createSubsLayoutStore(storage)` is the test seam (the sidebar-store
 * pattern): a fresh store over any Storage-like, verified without a DOM.
 */
export type SubsLayout = "grid" | "list";

export type SubsLayoutState = {
  layout: SubsLayout;
  setLayout: (value: SubsLayout) => void;
};

type StorageLike = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

export const SUBS_LAYOUT_STORAGE_KEY = "wf-subs-layout";

const subsLayoutInitializer = (set: {
  (partial: Partial<SubsLayoutState>): void;
  (fn: (state: SubsLayoutState) => Partial<SubsLayoutState>): void;
}) => ({
  layout: "grid" as SubsLayout,
  setLayout: (value: SubsLayout) => set({ layout: value }),
});

/** Only "list" is ever accepted from storage — anything else (hand-edited,
 * corrupted, a future format) falls back to the grid default. */
function mergeSubsLayout(persisted: unknown, current: SubsLayoutState): SubsLayoutState {
  const stored =
    persisted && typeof persisted === "object"
      ? (persisted as { layout?: unknown }).layout
      : undefined;
  return { ...current, ...(stored === "list" ? { layout: "list" as const } : {}) };
}

export function createSubsLayoutStore(storage: StorageLike) {
  return create<SubsLayoutState>()(
    persist(subsLayoutInitializer, {
      name: SUBS_LAYOUT_STORAGE_KEY,
      storage: createJSONStorage(() => storage as unknown as Storage),
      merge: (persisted, current) => mergeSubsLayout(persisted, current),
      // Rehydrate manually after mount (the sidebar idiom) — no SSR mismatch.
      skipHydration: true,
    })
  );
}

/** The app store. SSR renders with the default (grid); hydration happens in
 *  the subscriptions view's mount effect so markup never mismatches. */
export const useSubsLayout = createSubsLayoutStore(
  typeof window !== "undefined"
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
);

/** Rehydrate the persisted layout after mount (no hydration mismatch). */
export function useSubsLayoutHydration() {
  useEffect(() => {
    void useSubsLayout.persist.rehydrate();
  }, []);
}
