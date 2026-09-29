"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Sidebar collapse state (persisted to localStorage — ZTube remembers it).
 * `createSidebarStore(storage)` factory is used by the tests to verify
 * persistence without a DOM.
 */
export type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};

type StorageLike = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

export const SIDEBAR_STORAGE_KEY = "webflix2.sidebar";

const sidebarInitializer = (set: {
  (partial: Partial<SidebarState>): void;
  (fn: (state: SidebarState) => Partial<SidebarState>): void;
}) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setCollapsed: (value: boolean) => set({ collapsed: value }),
});

export function createSidebarStore(storage: StorageLike) {
  return create<SidebarState>()(
    persist(sidebarInitializer, {
      name: SIDEBAR_STORAGE_KEY,
      storage: createJSONStorage(() => storage as unknown as Storage),
      // Rehydrate manually in the shell to avoid SSR hydration mismatches.
      skipHydration: true,
    })
  );
}

/** The app store. SSR renders with the default (expanded); hydration happens
 *  in <SidebarHydration /> so markup never mismatches. */
export const useSidebar = createSidebarStore(
  typeof window !== "undefined"
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
);

/** Rehydrate persisted sidebar state after mount (no hydration mismatch). */
export function useSidebarHydration() {
  useEffect(() => {
    void useSidebar.persist.rehydrate();
  }, []);
}

/**
 * Watch queue ("Add to queue") — session-scoped, in-memory (matches YouTube,
 * where the queue is a session construct).
 */
export type QueueState = {
  queue: string[];
  addToQueue: (videoId: string) => boolean;
  removeFromQueue: (videoId: string) => void;
  clear: () => void;
  has: (videoId: string) => boolean;
};

export const useQueue = create<QueueState>()((set, get) => ({
  queue: [],
  addToQueue: (videoId) => {
    if (get().queue.includes(videoId)) return false;
    set((s) => ({ queue: [...s.queue, videoId] }));
    return true;
  },
  removeFromQueue: (videoId) =>
    set((s) => ({ queue: s.queue.filter((id) => id !== videoId) })),
  clear: () => set({ queue: [] }),
  has: (videoId) => get().queue.includes(videoId),
}));

/** The current watch queue (ids, in order). */
export function selectQueue(s: QueueState): string[] {
  return s.queue;
}
