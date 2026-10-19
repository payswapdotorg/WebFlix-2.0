/// <reference types="bun-types" />
/**
 * P27-HOME-TAIL — the home feed's COMPOSITION ORDER battery (the operator's
 * 2026-10-19 directive, verbatim: "the infinite scrolling of the long format
 * videos should be loaded as the last element of the home page, not the
 * shorts — that creates a feeling of infinite scrolling without requiring
 * the user to scroll up to see the videos loaded up").
 *
 * happy-dom + createRoot/act (the subscriptions-layout harness pattern);
 * navigation, next/link, use-api, sonner and queue actions are mocked via
 * mock.module — NEVER the network; loadMore rides a stubbed global fetch
 * (fetchLog records every URL the hook fires). What must hold:
 *
 *  - THE ORDER: chips → first grid rows → the interleaved Shorts shelf →
 *    continue-watching → because-you-watched → trending → THE GROWING GRID
 *    (the long-form infinite-scroll feed) as the LAST content element, with
 *    the sentinel directly beneath it. The scaffold-era SECOND shorts shelf
 *    (parked at the bottom, a duplicate of the same data.shorts) is GONE —
 *    exactly one shelf renders.
 *  - THE FEEL: firing the sentinel (the user reaching the bottom) appends
 *    the next page INSIDE the last grid — BELOW the trending rail, never
 *    above the user's viewport. The first grid rows never change. The
 *    load-more skeletons render in that same last grid (where the user is
 *    looking), and the sentinel honestly unmounts when the cursor runs out.
 *  - THE CATEGORY LAW: a filtered feed (category=Music) hides the shorts
 *    shelf exactly like youtube.com, and the growing grid STILL rides last.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom window (the repo's subscriptions-layout harness idiom) ----
const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).window = win;
for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement"]) {
  (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
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

// ---- a FIRING IntersectionObserver stub (the sentinel tests need the
// callback; the real browser fires it on scroll, rootMargin 600px) ----
let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
win.IntersectionObserver = class {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    ioCallback = cb;
  }
  observe() {}
  disconnect() {
    ioCallback = null;
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;
const fireSentinel = () =>
  act(async () => {
    ioCallback?.([{ isIntersecting: true }]);
  });
// the component references the GLOBAL IntersectionObserver — the stub must
// live on globalThis too, not just the happy-dom window
(globalThis as Record<string, unknown>).IntersectionObserver = win.IntersectionObserver;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (the subscriptions-layout set) ----
let searchParams = new URLSearchParams("");
let feedData: any = null;
mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    if (url && url.includes("/api/auth/session")) {
      return { data: null, loading: false, error: null, reload: () => {} };
    }
    return {
      data: feedData,
      loading: url !== null && feedData === null,
      error: null,
      reload: () => {},
    };
  },
  postJson: async () => ({}),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
mock.module("@/lib/queue/queue-actions", () => ({
  addToQueue: async () => ({ status: "error", message: "no" }),
}));

const { HomeFeed } = await import("@/components/home/home-feed");

// ---- the fetch stub (loadMore rides raw fetch, not useApi) ----
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
const fetchLog: string[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  fetchLog.push(u);
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

// ---- fixtures (minimal honest DTOs; the feed renders titles/aria only) ----
const video = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    title,
    description: "",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    durationSec: 200,
    views: 1_000,
    viewsText: "1K views",
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "All",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: null,
    channel: {
      id: `ch-${id}`,
      name: `Channel ${id}`,
      handle: `@${id}`,
      avatarUrl: "",
      verified: false,
      subscriberCount: 0,
      subscriberCountText: null,
    },
    ...extra,
  }) as any;

// 10 long-form recommended videos: 8 ride above the shelf, 2 start the tail.
const recommended = Array.from({ length: 10 }, (_, i) => video(`rec${i}`, `Long ${String(i + 1).padStart(2, "0")}`));
// 3 shorts for the ONE interleaved shelf.
const shorts = ["s1", "s2", "s3"].map((id, i) => video(id, `Short ${i + 1}`, { isShort: true }));
const continueWatching = [video("cw1", "CW One"), video("cw2", "CW Two")].map((v) => ({
  ...v,
  watchedSec: 42,
  watchedAt: "2026-10-19T00:00:00Z",
}));
const becauseYouWatched = {
  label: "Fonsi Hits",
  videos: [video("byw1", "BYW One"), video("byw2", "BYW Two")],
};
const trending = [video("tr1", "Trend One"), video("tr2", "Trend Two"), video("tr3", "Trend Three")];

feedData = {
  hero: null,
  trending,
  continueWatching,
  becauseYouWatched,
  shorts,
  recommended,
  recommendedCursor: "cursor-page-1",
  chips: ["All", "Music"],
  source: "search-compose",
};

// Page two: 4 fresh long-form videos, then the honest end (no next cursor).
const pageTwo = {
  videos: Array.from({ length: 4 }, (_, i) => video(`p2-${i}`, `Page Two ${String(i + 1).padStart(2, "0")}`)),
  nextCursor: null,
};

// ---- the render helpers ----
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qAll = (sel: string): HTMLElement[] =>
  host ? ([...host.querySelectorAll(sel)] as unknown as HTMLElement[]) : [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderFeed() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(createElement(HomeFeed));
  });
  await act(async () => {
    await sleep(10);
  });
}

/** The feed's section-level children in DOM order ("sentinel" for the loader). */
const sectionsInOrder = (): string[] => {
  const feedRoot = host?.firstElementChild;
  if (!feedRoot) return [];
  return [...feedRoot.children]
    .filter(
      (el) =>
        el.tagName === "SECTION" || el.getAttribute("data-testid") === "infinite-scroll-sentinel"
    )
    .map((el) =>
      el.getAttribute("data-testid") === "infinite-scroll-sentinel"
        ? "sentinel"
        : (el.getAttribute("aria-label") ?? "")
    );
};

/** Titles present inside a given grid section (card order = video order;
 *  each card's h3 carries the title attribute — one per card). */
const gridTitles = (section: HTMLElement): string[] =>
  [...section.querySelectorAll("h3[title]")].map((el) => el.getAttribute("title") ?? "");

beforeEach(() => {
  searchParams = new URLSearchParams("");
  fetchLog.length = 0;
  fetchHandler = (url) => {
    if (url.startsWith("/api/videos")) {
      return new Response(JSON.stringify(pageTwo), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
});

afterEach(() => {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
    root = null;
  }
  host?.remove();
  host = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("P27-HOME-TAIL — the home composition: the growing grid rides LAST", () => {
  test("the section order: grid rows → shorts shelf → rails → the growing grid → sentinel", async () => {
    await renderFeed();
    // The operator's 2026-10-19 order, as one pinned sequence: every static
    // section renders BEFORE the growing long-form feed, and the sentinel
    // is the very last element of the page.
    expect(sectionsInOrder()).toEqual([
      "Recommended videos", // the first rows (above the shelf)
      "Shorts shelf", // the ONE interleaved shelf
      "Continue watching rail",
      "Because you watched rail",
      "Trending now rail",
      "Recommended videos", // THE GROWING GRID — the last content element
      "sentinel",
    ]);
    // exactly ONE shorts shelf — the scaffold-era bottom duplicate is gone
    expect(qAll('[aria-label="Shorts shelf"]')).toHaveLength(1);
    // the feed root's last element child IS the sentinel, and the section
    // immediately before it is the growing grid (not shorts, not a rail)
    const feedRoot = host!.firstElementChild!;
    const last = feedRoot.lastElementChild!;
    expect(last.getAttribute("data-testid")).toBe("infinite-scroll-sentinel");
    const before = feedRoot.children[feedRoot.children.length - 2];
    expect(before.getAttribute("aria-label")).toBe("Recommended videos");
  });

  test("the first grid rows are the initial 8; the tail grid starts with the rest", async () => {
    await renderFeed();
    const grids = qAll('[aria-label="Recommended videos"]');
    expect(grids).toHaveLength(2);
    const first = gridTitles(grids[0]);
    expect(first).toHaveLength(8);
    expect(first[0]).toContain("Long 01");
    expect(first[7]).toContain("Long 08");
    const tail = gridTitles(grids[1]);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain("Long 09");
    expect(tail[1]).toContain("Long 10");
  });

  test("firing the sentinel appends page two BELOW trending — inside the last grid, never above the viewport", async () => {
    await renderFeed();
    const orderBefore = sectionsInOrder();
    await fireSentinel();
    await act(async () => {
      await sleep(25); // the stubbed fetch resolves; state settles
    });

    // the loadMore fetch carried the feed's cursor
    expect(fetchLog.some((u) => u.startsWith("/api/videos") && u.includes("cursor=cursor-page-1"))).toBe(
      true
    );

    // the composition held through the append: the tail grid stays the
    // last content section — only the sentinel itself is gone (the cursor
    // ran out, the honest end unmounts the loader)
    expect(sectionsInOrder()).toEqual(orderBefore.filter((s) => s !== "sentinel"));
    expect(sectionsInOrder().at(-1)).toBe("Recommended videos");

    const grids = qAll('[aria-label="Recommended videos"]');
    expect(grids).toHaveLength(2);
    // page two landed INSIDE the tail grid (2 initial + 4 fresh = 6 cards)
    const tail = gridTitles(grids[1]);
    expect(tail).toHaveLength(6);
    expect(tail.slice(0, 2).map((t) => t.includes("Long 09") || t.includes("Long 10"))).toEqual([true, true]);
    expect(tail.filter((t) => t.includes("Page Two"))).toHaveLength(4);
    // the first rows never change (no reflow of the top of the page)
    const first = gridTitles(grids[0]);
    expect(first).toHaveLength(8);
    expect(first.some((t) => t.includes("Page Two"))).toBe(false);

    // the cursor ran out → the sentinel honestly unmounts (the honest end)
    expect(q('[data-testid="infinite-scroll-sentinel"]')).toBeNull();
  });

  test("while a page loads, the skeletons render in the LAST grid (where the user is looking)", async () => {
    // a never-resolving page fetch: loading stays true, skeletons visible
    fetchHandler = (url) => {
      if (url.startsWith("/api/videos")) {
        return new Promise(() => {}) as unknown as Response;
      }
      return new Response("{}", { status: 200 });
    };
    await renderFeed();
    // (lucide icons carry their own aria-hidden svgs — the skeleton probe
    // scopes to the wrapper DIVS the grid renders for load skeletons)
    const grids = qAll('[aria-label="Recommended videos"]');
    expect(grids[1].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    await fireSentinel();
    await act(async () => {
      await sleep(25);
    });
    const gridsAfter = qAll('[aria-label="Recommended videos"]');
    // skeletons ride the TAIL grid only — the top of the page stays still
    expect(gridsAfter[0].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    expect(gridsAfter[1].querySelectorAll("div[aria-hidden='true']").length).toBeGreaterThan(0);
    // and the composition order held through the load
    expect(sectionsInOrder().at(-1)).toBe("sentinel");
    expect(sectionsInOrder().at(-2)).toBe("Recommended videos");
  });

  test("a category filter hides the shorts shelf — and the growing grid STILL rides last", async () => {
    searchParams = new URLSearchParams("category=Music");
    await renderFeed();
    expect(q('[aria-label="Shorts shelf"]')).toBeNull();
    expect(sectionsInOrder()).toEqual([
      "Recommended videos",
      "Continue watching rail",
      "Because you watched rail",
      "Trending now rail",
      "Recommended videos", // the growing grid, still the last content element
      "sentinel",
    ]);
  });
});
