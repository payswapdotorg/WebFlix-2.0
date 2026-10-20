/// <reference types="bun-types" />
/**
 * WFX2-P19-EXPL — the explore surfaces' layout laws, pinned with the repo's
 * happy-dom + createRoot/act harness (the search-layout/subscriptions-layout
 * idiom — mocked modules, NEVER the network):
 *
 *  - the category page: the chip row (All + the 14 categories — URL-synced
 *    Link navigation, the active chip keyed by the URL's category), the
 *    ranked VideoCard grid, the honest public-mode degradation banner (shown
 *    exactly when the payload says publicMode), the infinite-scroll sentinel
 *    + the honest end, loadMore paging + client dedupe;
 *  - the hub: every non-Live card links to /explore/category/<key>, Live
 *    keeps /explore/live.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom window (the repo's channel-page/you-hub harness idiom) ----
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

// a CAPTURING IntersectionObserver stub — the sentinel's callback can be
// fired manually to drive loadMore without a real viewport (registered on
// BOTH the happy-dom window and Node's globalThis — the view's effects
// construct against the Node realm; the you-hub/youtube-player idiom)
const observerCallbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
const CapturingIntersectionObserver = class {
  callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
    observerCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
win.IntersectionObserver = CapturingIntersectionObserver as unknown as typeof IntersectionObserver;
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: CapturingIntersectionObserver,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (the search-layout set) ----
mock.module("next/navigation", () => ({
  usePathname: () => "/explore/category/Music",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// URL-aware useApi stub: the session probe vs the category page (loading is
// derived exactly like the real hook).
let viewData: any = null;
let viewError: string | null = null;
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    if (url && url.includes("/api/auth/session")) {
      return { data: null, loading: false, error: null, reload: () => {} };
    }
    return {
      data: viewData,
      loading: url !== null && viewData === null && viewError === null,
      error: viewError,
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

const { default: CategoryPage } = await import("@/app/explore/category/[key]/view");
const { default: ExploreHub } = await import("@/app/explore/view");
const { CATEGORY_CHIPS } = await import("@/lib/categories");

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

// ---- fixtures (the REAL payload shape the view consumes) ----
const CHAN = {
  id: "UC1",
  handle: "@chanone",
  name: "Chan One",
  avatarUrl: "https://example.com/a.jpg",
  verified: true,
  subscriberCount: 1400000,
};

const video = (id: string, over: Record<string, any> = {}) => ({
  id,
  title: `Video ${id} — a real category-grid row`,
  description: "",
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
  videoUrl: `/watch/${id}`,
  durationSec: 213,
  views: 149000,
  viewsText: "149K views",
  publishedText: "2 days ago",
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
  channel: CHAN,
  ...over,
});

const publicPage = (over: Record<string, any> = {}) => ({
  category: "Music",
  videos: [video("cat1"), video("cat2")],
  nextCursor: "CUR1",
  source: "search",
  publicMode: true,
  ...over,
});

// ---- render helpers (the search-layout idiom) ----
let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {});
}

const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const text = (sel: string) => all(sel).map((e) => (e.textContent ?? "").trim());
const hrefs = (sel: string) => all(sel).map((e) => e.getAttribute("href"));

/** Fire the sentinel's IntersectionObserver callback (a viewport hit). */
async function fireSentinel() {
  const callback = observerCallbacks[observerCallbacks.length - 1];
  await act(async () => {
    callback([{ isIntersecting: true }]);
  });
  await act(async () => {});
}

beforeEach(() => {
  observerCallbacks.length = 0;
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  viewData = null;
  viewError = null;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

// ---------------------------------------------------------------------------

describe("the category page — the chip row (All + the 14, URL-synced)", () => {
  test("renders CATEGORY_CHIPS in order with the right destinations", async () => {
    viewData = publicPage();
    await render(createElement(CategoryPage, { category: "Music" }));

    // REA-3 — the explore/category browse surface keeps the CATEGORY ladder
    // (All + the 14 categories incl. Live/Mixes); the dynamic chip family
    // (Recently uploaded / live-scoped Live) is the HOME feed's own row.
    const chips = all('[data-testid="category-chip"]');
    expect(chips.map((c) => c.textContent)).toEqual(CATEGORY_CHIPS); // All + 14
    expect(chips).toHaveLength(15);

    const chipHrefs = hrefs('[data-testid="category-chip"]');
    expect(chipHrefs[0]).toBe("/explore"); // All → the explore hub
    // P30 — Music is a DESTINATION now: youtube.com's own Music page routes
    // to the dedicated /music surface (measured live 2026-10-20), so the
    // chip row (categoryDestination) routes there too — the composed grid
    // stays reachable at /explore/category/Music but is no longer the
    // destination.
    expect(chipHrefs[CATEGORY_CHIPS.indexOf("Music")]).toBe("/music");
    expect(chipHrefs[CATEGORY_CHIPS.indexOf("Gaming")]).toBe("/explore/category/Gaming");
    // P25 G13 — Podcasts is a DESTINATION now: youtube.com's own card routes
    // to the dedicated /podcasts surface (measured live 2026-10-19), so the
    // chip row (categoryDestination) routes there too — the composed grid
    // stays reachable at /explore/category/Podcasts but is no longer the
    // destination.
    expect(chipHrefs[CATEGORY_CHIPS.indexOf("Podcasts")]).toBe("/podcasts");
    expect(chipHrefs[CATEGORY_CHIPS.indexOf("Mixes")]).toBe("/explore/category/Mixes");
    expect(chipHrefs[CATEGORY_CHIPS.indexOf("Live")]).toBe("/explore/live"); // Live keeps its own surface
  });

  test("the URL's category is the active chip (aria-current, never client state)", async () => {
    viewData = publicPage();
    await render(createElement(CategoryPage, { category: "Cooking" }));

    const active = all('[data-testid="category-chip"][data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe("Cooking");
    expect(active[0].getAttribute("aria-current")).toBe("page");
    expect(active[0].getAttribute("href")).toBe("/explore/category/Cooking");
  });

  test("the page heading names the category", async () => {
    viewData = publicPage();
    await render(createElement(CategoryPage, { category: "Fitness" }));
    const h1 = all("h1")[0];
    expect(h1?.textContent).toContain("Fitness");
  });
});

describe("the category page — the ranked grid + the honest banner", () => {
  test("the grid renders the payload's videos as VideoCards", async () => {
    viewData = publicPage();
    await render(createElement(CategoryPage, { category: "Music" }));

    const grid = all('[data-testid="category-grid"]');
    expect(grid).toHaveLength(1);
    const watchLinks = hrefs('[data-testid="category-grid"] a[href^="/watch/"]');
    expect(watchLinks).toEqual(["/watch/cat1", "/watch/cat1", "/watch/cat2", "/watch/cat2"]);
  });

  test("the public-mode banner shows exactly when the payload says publicMode", async () => {
    viewData = publicPage({ publicMode: true });
    await render(createElement(CategoryPage, { category: "Music" }));
    expect(all('[data-testid="category-public-mode"]')).toHaveLength(1);
    expect(text('[data-testid="category-public-mode"]')[0]).toContain("public mode");
    expect(text('[data-testid="category-public-mode"]')[0]).toContain("YouTube search");

    act(() => root?.unmount());
    host?.remove();

    viewData = publicPage({ publicMode: false }); // operator session present
    await render(createElement(CategoryPage, { category: "Music" }));
    expect(all('[data-testid="category-public-mode"]')).toHaveLength(0);
  });

  test("the error state is honest (role=alert, no fabricated grid)", async () => {
    viewError = "Failed to load category videos";
    await render(createElement(CategoryPage, { category: "Music" }));
    const alert = all('[role="alert"]');
    expect(alert).toHaveLength(1);
    expect(alert[0].textContent).toContain("Failed to load category videos");
    expect(all('[data-testid="category-grid"]')).toHaveLength(0);
  });

  test("the empty state names the category honestly", async () => {
    viewData = publicPage({ videos: [], nextCursor: null });
    await render(createElement(CategoryPage, { category: "News" }));
    expect(text("p")).toEqual(
      expect.arrayContaining([expect.stringContaining("Nothing in News right now")])
    );
    expect(all('[data-testid="category-grid"]')).toHaveLength(0);
  });
});

describe("the category page — infinite scroll (the search-view sentinel pattern)", () => {
  test("the sentinel mounts while a cursor remains; loadMore pages + dedupes; the honest end", async () => {
    viewData = publicPage({ videos: [video("cat1"), video("cat2")], nextCursor: "CUR1" });
    await render(createElement(CategoryPage, { category: "Music" }));

    expect(all('[data-testid="category-scroll-sentinel"]')).toHaveLength(1);
    expect(all('[data-testid="category-end"]')).toHaveLength(0);

    // the continuation page: one fresh video + one REPEATED id (client dedupes)
    fetchHandler = () =>
      new Response(
        JSON.stringify(publicPage({ videos: [video("cat3"), video("cat1")], nextCursor: null })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    await fireSentinel();

    // loadMore hit the route with the opaque cursor
    expect(fetchLog).toEqual([
      expect.stringContaining("/api/explore/category?key=Music&cursor=CUR1"),
    ]);
    const watchLinks = hrefs('[data-testid="category-grid"] a[href^="/watch/"]');
    expect(watchLinks.filter((h) => h === "/watch/cat3")).toHaveLength(2); // appended once…
    expect(watchLinks.filter((h) => h === "/watch/cat1")).toHaveLength(2); // …the repeat deduped
    // the chain ended honestly: sentinel gone, the end message in
    expect(all('[data-testid="category-scroll-sentinel"]')).toHaveLength(0);
    expect(all('[data-testid="category-end"]')).toHaveLength(1);
  });

  test("no sentinel when the first page already ended (nextCursor null)", async () => {
    viewData = publicPage({ nextCursor: null });
    await render(createElement(CategoryPage, { category: "Music" }));
    expect(all('[data-testid="category-scroll-sentinel"]')).toHaveLength(0);
  });
});

describe("the explore hub — every card lands on a real-data destination", () => {
  test("Live keeps /explore/live; the 11 browse categories → their own pages; Music + Podcasts → their destinations (P30 / P25 G13)", async () => {
    await render(createElement(ExploreHub));

    // REA-3 — the hub's cards are the 14 CATEGORIES (the browse ladder);
    // the home-only dynamic chips (Recently uploaded) are not cards here.
    // P25 G13 — the Podcasts card is a DESTINATION card now (youtube.com's
    // own Podcasts browse surface, measured): it links /podcasts, not the
    // composed /explore/category/Podcasts grid.
    // P30 — the Music card is a DESTINATION card too (youtube.com's own
    // Music page, measured 2026-10-20): it links /music, not the composed
    // /explore/category/Music grid.
    const cardLinks = all("a").filter((a) => a.getAttribute("href")?.startsWith("/explore"));
    expect(cardLinks.map((a) => a.getAttribute("href"))).toContain("/explore/live");
    for (const category of CATEGORY_CHIPS.filter(
      (c) => c !== "All" && c !== "Live" && c !== "Podcasts" && c !== "Music"
    )) {
      expect(cardLinks.map((a) => a.getAttribute("href"))).toContain(
        `/explore/category/${category}`
      );
    }
    // 11 category cards + the Live card = 12 explore links (the Podcasts
    // and Music cards left the /explore family for their own destinations)
    expect(cardLinks).toHaveLength(12);
    // …and the Podcasts destination card itself is present with its own copy
    const podcastsCard = all("a").find((a) => a.getAttribute("href") === "/podcasts");
    expect(podcastsCard?.textContent).toContain("Podcasts");
    expect(podcastsCard?.textContent).toContain("podcasts destination");
    expect(podcastsCard?.textContent).not.toContain("from YouTube search");
    // …and the Music destination card too
    const musicCard = all("a").find((a) => a.getAttribute("href") === "/music");
    expect(musicCard?.textContent).toContain("Music");
    expect(musicCard?.textContent).toContain("music destination");
    expect(musicCard?.textContent).not.toContain("from YouTube search");
  });
});

// ---------------------------------------------------------------------------
// P25 G13 — the dedicated podcasts page view (src/app/podcasts/view.tsx),
// pinned against the sanitized REAL capture
// (tests/fixtures/yt/podcasts_destination_public.json — youtube.com's
// FEpodcasts_destination page, logged-out, 2026-10-19) parsed through the
// REAL parsePodcastsPage: the header + the shelf family in document order +
// the response's own card targets + the honest states + the measured
// one-page law (NO sentinel, NO chips — nothing continuation-shaped was
// measured in the payload).
// ---------------------------------------------------------------------------
const { default: PodcastsView } = await import("@/app/podcasts/view");
const { parsePodcastsPage } = await import("@/lib/youtube/podcasts");
import { readFileSync } from "node:fs";

const podcastsDto = (over: Record<string, any> = {}) => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/yt/podcasts_destination_public.json", "utf8")
  );
  const parsed = parsePodcastsPage(fixture);
  return { ...parsed, source: "ssr", publicMode: true, ...over };
};

describe("the podcasts page (P25 G13 — youtube.com's own destination surface)", () => {
  test("the header (Mic + the response's own title) + the 13 shelves in document order", async () => {
    viewData = podcastsDto();
    await render(createElement(PodcastsView));

    const h1 = all("h1")[0];
    expect(h1?.textContent).toContain("Podcasts");
    const shelves = all('[data-testid="podcast-shelf"]');
    expect(shelves.map((s) => s.querySelector("h2")?.textContent)).toEqual([
      "Popular episodes",
      "Popular podcasts",
      "Live now",
      "Ghost stories",
      "Wealth",
      "Stock markets",
      "Economics",
      "Finances",
      "Psychology",
      "Health care",
      "AI",
      "Vocabulary",
      "Popular podcast creators",
    ]);
    // the honest public-mode label rides the payload's own flag
    expect(all('[data-testid="podcasts-public-mode"]')).toHaveLength(1);
    expect(text('[data-testid="podcasts-public-mode"]')[0]).toContain("public mode");
  });

  test("every card target is the response's own: episodes → /watch/<id>, shows → the measured Play-all form, creators → /channel/<handle>", async () => {
    viewData = podcastsDto();
    await render(createElement(PodcastsView));

    // episodes ride the house VideoCard rail — real /watch targets
    const watchLinks = all("a").filter((a) => /^\/watch\/[\w-]+$/.test(a.getAttribute("href") ?? ""));
    expect(watchLinks.map((a) => a.getAttribute("href"))).toContain("/watch/lmRCN_E9ZI8");

    // the show card's own target is the MEASURED Play-all watchEndpoint in
    // the APP's own form — the house Play-all idiom /watch/<videoId>?list=<PL>
    // (the playlist page's own link; the watch route is /watch/[id])
    const showCards = all('[data-testid="podcast-show-card"]');
    expect(showCards.length).toBeGreaterThan(0);
    expect(showCards[0].getAttribute("href")).toBe(
      "/watch/svf7jACondc?list=PLdY_rFY03hT4ezNATc8jI_4QhXf60ol9G"
    );
    // the publisher row links the measured channel handle
    expect(hrefs("a")).toContain("/channel/@celebuzzhk");

    // the creator card links the measured channel handle
    const creatorCards = all('[data-testid="podcast-creator-card"]');
    expect(creatorCards.length).toBeGreaterThan(0);
    expect(creatorCards[0].getAttribute("href")).toBe("/channel/@CalebHammer");
    expect(creatorCards[0].textContent).toContain("4M subscribers");
    expect(creatorCards[0].textContent).toContain("5,014 videos");
  });

  test("the measured ONE-PAGE law: NO sentinel, NO IntersectionObserver, NO chips (nothing to scroll)", async () => {
    viewData = podcastsDto();
    await render(createElement(PodcastsView));

    expect(all('[data-testid*="sentinel"]')).toHaveLength(0);
    expect(all('[data-testid="category-chip"]')).toHaveLength(0);
    // the capturing stub proves the view registered NO observer at all
    expect(observerCallbacks).toHaveLength(0);
  });

  test("the honest states: skeletons while loading, role=alert on error, the empty note", async () => {
    // loading (the useApi stub derives loading from null data)
    viewData = null;
    viewError = null;
    await render(createElement(PodcastsView));
    expect(all('[aria-busy="true"]')).toHaveLength(1);
    expect(all('[data-testid="podcast-shelf"]')).toHaveLength(0);
    act(() => root?.unmount());
    host?.remove();

    // error — honest, never a fabricated grid
    viewError = "Failed to load podcasts";
    await render(createElement(PodcastsView));
    const alert = all('[role="alert"]');
    expect(alert).toHaveLength(1);
    expect(alert[0].textContent).toContain("Failed to load podcasts");
    expect(all('[data-testid="podcast-shelf"]')).toHaveLength(0);
    act(() => root?.unmount());
    host?.remove();

    // empty — the honest note, not a promo
    viewData = { title: "Podcasts", shelves: [], source: "ssr", publicMode: true };
    viewError = null;
    await render(createElement(PodcastsView));
    expect(text("p")).toEqual(
      expect.arrayContaining([expect.stringContaining("Nothing on the podcasts page right now")])
    );
    expect(all('[data-testid="podcast-shelf"]')).toHaveLength(0);
  });
});
