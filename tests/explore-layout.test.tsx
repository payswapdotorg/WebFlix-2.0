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
const { HOME_CHIPS } = await import("@/lib/categories");

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
  test("renders HOME_CHIPS in order with the right destinations", async () => {
    viewData = publicPage();
    await render(createElement(CategoryPage, { category: "Music" }));

    const chips = all('[data-testid="category-chip"]');
    expect(chips.map((c) => c.textContent)).toEqual(HOME_CHIPS); // All + 14
    expect(chips).toHaveLength(15);

    const chipHrefs = hrefs('[data-testid="category-chip"]');
    expect(chipHrefs[0]).toBe("/explore"); // All → the explore hub
    expect(chipHrefs[HOME_CHIPS.indexOf("Music")]).toBe("/explore/category/Music");
    expect(chipHrefs[HOME_CHIPS.indexOf("Gaming")]).toBe("/explore/category/Gaming");
    expect(chipHrefs[HOME_CHIPS.indexOf("Podcasts")]).toBe("/explore/category/Podcasts");
    expect(chipHrefs[HOME_CHIPS.indexOf("Live")]).toBe("/explore/live"); // Live keeps its own surface
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
  test("Live keeps /explore/live; the 13 browse categories → their own pages", async () => {
    await render(createElement(ExploreHub));

    const cardLinks = all("a").filter((a) => a.getAttribute("href")?.startsWith("/explore"));
    expect(cardLinks.map((a) => a.getAttribute("href"))).toContain("/explore/live");
    for (const category of HOME_CHIPS.filter((c) => c !== "All" && c !== "Live")) {
      expect(cardLinks.map((a) => a.getAttribute("href"))).toContain(
        `/explore/category/${category}`
      );
    }
    // 13 category cards + the Live card = 14 explore links (no scoped-search stragglers)
    expect(cardLinks).toHaveLength(14);
  });
});
