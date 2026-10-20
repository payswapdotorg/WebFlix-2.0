/// <reference types="bun-types" />
/**
 * P30-HOME-GRID — the home feed's COMPOSITION + DENSITY battery (the
 * operator's 2026-10-20 directive, verbatim: "the home page should be:
 * one row of long format video boxes / one row of long format video boxes
 * / one row of short video boxes / one row of long format video boxes /
 * one row of short video boxes / one row of long format video boxes /
 * one row of long format video boxes / one row of continue watching /
 * one row of long format video boxes / … (infinite scrolling)" — with
 * "the long format video boxes need to be bigger such that 3 fit in one
 * row").
 *
 * happy-dom + createRoot/act (the subscriptions-layout harness pattern);
 * navigation, next/link, use-api, sonner and queue actions are mocked via
 * mock.module — NEVER the network; loadMore rides a stubbed global fetch
 * (fetchLog records every URL the hook fires). What must hold:
 *
 *  - THE PATTERN (3-up rows): grid rows 1-2 (6 cards) → SHORTS shelf 1 →
 *    grid row 4 (3 cards) → SHORTS shelf 2 → grid rows 6-7 (6 cards) →
 *    the continue-watching rail → THE GROWING GRID (the long-form
 *    infinite-scroll feed) as the LAST content element, sentinel directly
 *    beneath it. The two shorts rows split the deck at its midpoint —
 *    never the same tiles twice. The because-you-watched and trending
 *    rails are GONE from the home page (the operator's composition has
 *    neither; the DTO still carries them — unrendered).
 *  - THE FEEL: firing the sentinel (the user reaching the bottom) appends
 *    the next page INSIDE the last grid — BELOW the continue-watching
 *    rail, never above the user's viewport. The three opening blocks
 *    never change. The load-more skeletons render in that same last grid
 *    (where the user is looking), and the sentinel honestly unmounts when
 *    the cursor runs out.
 *  - THE CATEGORY LAW: a filtered feed (category=Music) hides BOTH shorts
 *    shelves exactly like youtube.com — the five long rows collapse into
 *    one 15-card opening grid — and the growing grid STILL rides last.
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

// 17 long-form recommended videos: 15 open the pattern (rows 1-2, 4,
// 6-7 = 6+3+6 at 3-up), 2 start the growing tail grid.
const recommended = Array.from(
  { length: 17 },
  (_, i) => video(`rec${i}`, `Long ${String(i + 1).padStart(2, "0")}`)
);
// 6 shorts for the TWO interleaved shelves (the deck splits at its
// midpoint: 3 tiles + 3 tiles — never the same tile twice).
const shorts = Array.from({ length: 6 }, (_, i) =>
  video(`s${i + 1}`, `Short ${i + 1}`, { isShort: true })
);
const continueWatching = [video("cw1", "CW One"), video("cw2", "CW Two")].map((v) => ({
  ...v,
  watchedSec: 42,
  watchedAt: "2026-10-19T00:00:00Z",
}));
// still carried by the /api/home DTO — the home page no longer renders
// them (the operator's composition has neither).
const becauseYouWatched = {
  label: "Fonsi Hits",
  videos: [video("byw1", "BYW One"), video("byw2", "BYW Two")],
};
const trending = [
  video("tr1", "Trend One"),
  video("tr2", "Trend Two"),
  video("tr3", "Trend Three"),
];

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
  videos: Array.from(
    { length: 4 },
    (_, i) => video(`p2-${i}`, `Page Two ${String(i + 1).padStart(2, "0")}`)
  ),
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

/** Tile titles inside a shorts shelf (each tile's Link carries the
 *  aria-label "Open Shorts: <title>"). */
const shelfTiles = (shelf: HTMLElement): string[] =>
  [...shelf.querySelectorAll('a[aria-label^="Open Shorts:"]')].map(
    (el) => el.getAttribute("aria-label")?.replace(/^Open Shorts: /, "").replace(/ \(live\)$/, "") ?? ""
  );

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

describe("P30-HOME-GRID — the operator's interleave pattern (3-up rows, two shorts rows)", () => {
  test("the section order: L,L → shorts → L → shorts → L,L → continue watching → the growing grid → sentinel", async () => {
    await renderFeed();
    // The operator's 2026-10-20 row pattern, as one pinned sequence: two
    // long rows, shorts, one long row, shorts, two long rows, the
    // continue-watching rail — then THE GROWING GRID as the last content
    // element with the sentinel directly beneath it.
    expect(sectionsInOrder()).toEqual([
      "Recommended videos", // rows 1-2 (6 cards)
      "Shorts shelf", // row 3 — the FIRST shorts row
      "Recommended videos", // row 4 (3 cards)
      "Shorts shelf", // row 5 — the SECOND shorts row
      "Recommended videos", // rows 6-7 (6 cards)
      "Continue watching rail", // row 8
      "Recommended videos", // THE GROWING GRID — the last content element
      "sentinel",
    ]);
    // exactly TWO shorts shelves — and the rails the operator's composition
    // dropped are GONE (the DTO still carries them: unrendered)
    expect(qAll('[aria-label="Shorts shelf"]')).toHaveLength(2);
    expect(q('[aria-label="Because you watched rail"]')).toBeNull();
    expect(q('[aria-label="Trending now rail"]')).toBeNull();
    expect(host!.textContent).not.toContain("Trend One");
    expect(host!.textContent).not.toContain("BYW One");
    // the feed root's last element child IS the sentinel, and the section
    // immediately before it is the growing grid (not shorts, not the rail)
    const feedRoot = host!.firstElementChild!;
    const last = feedRoot.lastElementChild!;
    expect(last.getAttribute("data-testid")).toBe("infinite-scroll-sentinel");
    const before = feedRoot.children[feedRoot.children.length - 2];
    expect(before.getAttribute("aria-label")).toBe("Recommended videos");
  });

  test("the block math at 3-up: 6 + 3 + 6 open the pattern; the tail grid starts with the rest", async () => {
    await renderFeed();
    const grids = qAll('[aria-label="Recommended videos"]');
    expect(grids).toHaveLength(4);
    const first = gridTitles(grids[0]);
    expect(first).toHaveLength(6);
    expect(first[0]).toContain("Long 01");
    expect(first[5]).toContain("Long 06");
    const mid = gridTitles(grids[1]);
    expect(mid).toHaveLength(3);
    expect(mid[0]).toContain("Long 07");
    expect(mid[2]).toContain("Long 09");
    const last = gridTitles(grids[2]);
    expect(last).toHaveLength(6);
    expect(last[0]).toContain("Long 10");
    expect(last[5]).toContain("Long 15");
    const tail = gridTitles(grids[3]);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain("Long 16");
    expect(tail[1]).toContain("Long 17");
  });

  test("the two shorts rows split the deck — disjoint tiles, never the same short twice", async () => {
    await renderFeed();
    const shelves = qAll('[aria-label="Shorts shelf"]');
    expect(shelves).toHaveLength(2);
    const firstTiles = shelfTiles(shelves[0]);
    const secondTiles = shelfTiles(shelves[1]);
    // the deck's midpoint split: 3 tiles + 3 tiles, in deck order
    expect(firstTiles).toEqual(["Short 1", "Short 2", "Short 3"]);
    expect(secondTiles).toEqual(["Short 4", "Short 5", "Short 6"]);
    // disjoint — no tile id rides both rows (the duplicate-shelf disease
    // stays dead)
    const overlap = firstTiles.filter((t) => secondTiles.includes(t));
    expect(overlap).toHaveLength(0);
  });

  test("firing the sentinel appends page two BELOW the rail — inside the last grid, never above the viewport", async () => {
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
    expect(grids).toHaveLength(4);
    // page two landed INSIDE the tail grid (2 initial + 4 fresh = 6 cards)
    const tail = gridTitles(grids[3]);
    expect(tail).toHaveLength(6);
    expect(tail.slice(0, 2).map((t) => t.includes("Long 16") || t.includes("Long 17"))).toEqual([true, true]);
    expect(tail.filter((t) => t.includes("Page Two"))).toHaveLength(4);
    // the three opening blocks never change (no reflow of the top of the page)
    expect(gridTitles(grids[0])).toHaveLength(6);
    expect(gridTitles(grids[1])).toHaveLength(3);
    expect(gridTitles(grids[2])).toHaveLength(6);
    expect(gridTitles(grids[0]).concat(gridTitles(grids[1]), gridTitles(grids[2])).some((t) => t.includes("Page Two"))).toBe(
      false
    );

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
    expect(grids[3].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    await fireSentinel();
    await act(async () => {
      await sleep(25);
    });
    const gridsAfter = qAll('[aria-label="Recommended videos"]');
    // skeletons ride the TAIL grid only — the top of the page stays still
    expect(gridsAfter[0].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    expect(gridsAfter[1].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    expect(gridsAfter[2].querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    expect(gridsAfter[3].querySelectorAll("div[aria-hidden='true']").length).toBeGreaterThan(0);
    // and the composition order held through the load
    expect(sectionsInOrder().at(-1)).toBe("sentinel");
    expect(sectionsInOrder().at(-2)).toBe("Recommended videos");
  });

  test("a category filter hides BOTH shorts shelves — one 15-card opening grid, and the growing grid STILL rides last", async () => {
    searchParams = new URLSearchParams("category=Music");
    await renderFeed();
    expect(qAll('[aria-label="Shorts shelf"]')).toHaveLength(0);
    expect(sectionsInOrder()).toEqual([
      "Recommended videos", // the five long rows collapsed into ONE opening grid
      "Continue watching rail",
      "Recommended videos", // the growing grid, still the last content element
      "sentinel",
    ]);
    const grids = qAll('[aria-label="Recommended videos"]');
    expect(grids).toHaveLength(2);
    expect(gridTitles(grids[0])).toHaveLength(15);
    expect(gridTitles(grids[0])[14]).toContain("Long 15");
    expect(gridTitles(grids[1])).toHaveLength(2);
  });
});
