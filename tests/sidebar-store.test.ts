/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createSidebarStore, useQueue, SIDEBAR_STORAGE_KEY } from "@/lib/sidebar-store";

/** In-memory localStorage shim (zustand persist needs the Storage interface). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    removeItem: (name: string) => void map.delete(name),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  };
}

describe("sidebar collapse persistence", () => {
  test("toggle flips collapsed and persists under the storage key", () => {
    const storage = memoryStorage();
    const store = createSidebarStore(storage);
    expect(store.getState().collapsed).toBe(false);

    store.getState().toggle();
    expect(store.getState().collapsed).toBe(true);

    const raw = storage.dump()[SIDEBAR_STORAGE_KEY];
    expect(raw).toBeTruthy();
    expect(raw).toContain('"collapsed":true');
  });

  test("a fresh store rehydrates the persisted value (survives reload)", async () => {
    const storage = memoryStorage();
    const first = createSidebarStore(storage);
    first.getState().setCollapsed(true);

    const second = createSidebarStore(storage);
    // Mirrors the app shell: skipHydration + explicit rehydrate after mount.
    await second.persist.rehydrate();
    expect(second.getState().collapsed).toBe(true);
  });

  test("setCollapsed writes an explicit value", () => {
    const storage = memoryStorage();
    const store = createSidebarStore(storage);
    store.getState().setCollapsed(true);
    expect(store.getState().collapsed).toBe(true);
    store.getState().setCollapsed(false);
    expect(store.getState().collapsed).toBe(false);
  });
});

describe("watch queue store (Add to queue)", () => {
  test("add / dedupe / remove / has", () => {
    const store = useQueue;
    store.getState().clear();
    expect(store.getState().addToQueue("v1")).toBe(true);
    expect(store.getState().addToQueue("v1")).toBe(false); // duplicate
    expect(store.getState().has("v1")).toBe(true);
    store.getState().removeFromQueue("v1");
    expect(store.getState().has("v1")).toBe(false);
    expect(store.getState().queue).toHaveLength(0);
  });
});
