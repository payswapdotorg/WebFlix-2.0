/// <reference types="bun-types" />
/**
 * WFX2-P23-C tests — the trending view's REGION SWITCHER (G7): the
 * end-of-chip-row location control (the Globe + the region's name), the
 * country list from the static map, the region-shaped refetch
 * (?region=<code> on /api/trending), the persisted selection
 * (wf-trending-region — the store survives a simulated reload), and the
 * honest public-mode note naming the region. happy-dom + createRoot/act
 * (the clip-page pattern) with a stubbed fetch + useSearchParams.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "NodeList",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- stubs: next/navigation (useSearchParams) + fetch ----
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

const fetched: string[] = [];
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  fetched.push(u);
  return new Response(
    JSON.stringify({
      category: "Now",
      region: null,
      source: "search",
      videos: [
        {
          id: "regionvideo01",
          title: "Popular this week",
          channel: { name: "Some Channel", verified: false },
          viewsText: "1.2M views",
          publishedText: "3 days ago",
          thumbnailUrl: "https://i.ytimg.com/vi/regionvideo01/hqdefault.jpg",
          category: "All",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as unknown as typeof fetch;

const { default: TrendingPage } = await import("@/app/trending/view");
const {
  useTrendingRegion,
  createTrendingRegionStore,
} = await import("@/app/trending/region-store");

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qa = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

beforeEach(() => {
  // fresh app store per test (persist off — hydration handled explicitly)
  useTrendingRegion.setState({ region: null });
  win.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  fetched.length = 0;
});

async function render() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<TrendingPage />);
  });
}

describe("the trending region switcher (P23-C G7 — youtube.com's location control)", () => {
  test("the control rides the END of the chip row: the Globe + the region list", async () => {
    await render();
    const select = q('[data-testid="trending-region-switcher"]');
    expect(select).toBeTruthy();
    expect(select!.getAttribute("aria-label") ?? select!.id).toBeTruthy();
    // the option set: the "Location" default + the static map's countries
    const options = Array.from(select!.querySelectorAll("option"));
    expect(options.length).toBeGreaterThanOrEqual(101);
    expect(options[0]?.textContent).toBe("Location");
    expect(options.some((o) => o.textContent === "United Kingdom")).toBe(true);
    expect(options.some((o) => o.textContent === "Japan")).toBe(true);
    // the category chips row is intact (Now | Music | Gaming | Movies)
    const chipTexts = qa("nav a").map((a) => a.textContent?.trim());
    expect(chipTexts).toEqual(["Now", "Music", "Gaming", "Movies"]);
  });

  test("unset (default) → the read carries NO region param (the egress default)", async () => {
    await render();
    expect(fetched.some((u) => u.includes("/api/trending?category=Now"))).toBe(true);
    expect(fetched.some((u) => u.includes("region="))).toBe(false);
    // the honest note stays region-silent
    expect(host!.textContent).toContain("Popular this week");
  });

  test("selecting a region refetches with ?region= and the note names it", async () => {
    await render();
    const select = q('[data-testid="trending-region-switcher"]') as unknown as {
      value: string;
      dispatchEvent: (e: unknown) => boolean;
    };
    await act(async () => {
      useTrendingRegion.setState({ region: "GB" });
    });
    // the store change drives the refetch (the view's query is store-derived)
    expect(fetched.some((u) => u.includes("region=GB"))).toBe(true);
    // the public-mode note names the region
    expect(host!.textContent).toContain("Popular this week in United Kingdom");
    // the select reflects the choice
    const selectEl = q('[data-testid="trending-region-switcher"]') as unknown as {
      value: string;
    };
    expect(selectEl.value).toBe("GB");
  });

  test("the selection persists: a fresh store rehydrates the saved region", async () => {
    await render();
    await act(async () => {
      useTrendingRegion.getState().setRegion("JP");
    });
    // persisted under the house key
    const raw = win.localStorage.getItem("wf-trending-region");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.region).toBe("JP");
    // a simulated reload: a fresh store rehydrates the persisted region
    const fresh = createTrendingRegionStore(win.localStorage);
    await fresh.persist.rehydrate();
    expect(fresh.getState().region).toBe("JP");
  });

  test("every category tab read carries the same region (the feed + tabs reshape)", async () => {
    await render();
    searchParams = new URLSearchParams({ category: "Music" });
    await act(async () => {
      root!.render(<TrendingPage />);
    });
    await act(async () => {
      useTrendingRegion.setState({ region: "GB" });
    });
    const musicFetches = fetched.filter((u) => u.includes("category=Music"));
    expect(musicFetches.length).toBeGreaterThan(0);
    // the region-shaped refetch fires for the category (the initial unset
    // read lands first, then the store change refetches with the region)
    expect(musicFetches.some((u) => u.includes("region=GB"))).toBe(true);
    searchParams = new URLSearchParams();
  });
});
