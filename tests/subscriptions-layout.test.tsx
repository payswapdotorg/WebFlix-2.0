/// <reference types="bun-types" />
/**
 * P18-SUBS-NOTIFS tests — the subscriptions feed's LAYOUT TOGGLE battery
 * (happy-dom + createRoot/act, the search-layout pattern; the session seam,
 * use-api, next/link, navigation, sonner and queue actions are mocked via
 * mock.module — NEVER the network; loadMore rides a stubbed global fetch):
 *
 *  - THE SWITCHER: YouTube's grid/list toggle in the feed header — two icon
 *    buttons, aria-pressed states, the active pill, default grid; the guest
 *    gate still owns the surface (no toggle behind the signed-out screen);
 *  - THE LIST ROW: the exact YouTube subscription list-row shape — the 16:9
 *    ~168px thumbnail left, the 2-line clamped title, the views · age meta
 *    line, the channel avatar + name row, and the description snippet ONLY
 *    when the feed's own payload carries one (honest absence otherwise);
 *  - PERSISTENCE: localStorage "wf-subs-layout" via the sidebar-store idiom
 *    (skipHydration + mount rehydrate — SSR renders the default grid), the
 *    app's own persisted bytes round-trip across a simulated reload, and an
 *    invalid stored value falls back to grid;
 *  - THE UNCHANGED SEAMS: list-view skeletons, the honest error state, and
 *    cursor paging (the P22-C sentinel auto-loads rows in list view too).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom window (the repo's search-layout harness idiom) ----
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
// WFX2-P22-C: a firing stub — the sentinel tests need the observer callback
// (records it so a test can simulate the sentinel entering the viewport; the
// real browser fires it on scroll, rootMargin 600px).
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

// ---- module mocks (the search-layout set) ----
mock.module("next/navigation", () => ({
  usePathname: () => "/subscriptions",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// URL-aware useApi stub: the session probe vs the subscriptions feed
// (loading is derived exactly like the real hook).
let sessionData: any = null;
let feedData: any = null;
let feedError: string | null = null;
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    if (url && url.includes("/api/auth/session")) {
      return { data: sessionData, loading: sessionData === null, error: null, reload: () => {} };
    }
    return {
      data: feedData,
      loading: url !== null && feedData === null && feedError === null,
      error: feedError,
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

const { default: SubscriptionsPage } = await import("@/app/subscriptions/view");
const {
  useSubsLayout,
  SUBS_LAYOUT_STORAGE_KEY,
  createSubsLayoutStore,
} = await import("@/app/subscriptions/layout-store");

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
const AUTHED_SESSION = { user: { id: "u1", name: "The Operator", email: "operator@webflix.test", avatarSeed: 12 } };

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
  title: `Video ${id} — a real subscriptions-feed row`,
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

const FEED = {
  channels: [CHAN],
  videos: [video("v1"), video("v2", { description: "A real description snippet from the payload" })],
  nextCursor: "CUR1",
  loginRequired: false,
  session: true,
};

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
const texts = (sel: string) => all(sel).map((e) => (e.textContent ?? "").trim());

beforeEach(() => {
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  sessionData = AUTHED_SESSION;
  feedData = null;
  feedError = null;
  // fresh store default + clean browser storage (the wrapped setState
  // persists, so the reset ALSO writes the default — storage is then cleared)
  useSubsLayout.setState({ layout: "grid" });
  win.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("the layout store (the sidebar-store persistence idiom)", () => {
  // the sidebar-store.test.ts in-memory Storage shim
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

  test("default is grid; setLayout(list) persists under wf-subs-layout", () => {
    const storage = memoryStorage();
    const store = createSubsLayoutStore(storage);
    expect(store.getState().layout).toBe("grid");
    store.getState().setLayout("list");
    expect(store.getState().layout).toBe("list");
    const raw = storage.dump()[SUBS_LAYOUT_STORAGE_KEY];
    expect(raw).toBeTruthy();
    expect(raw).toContain('"layout":"list"');
  });

  test("a fresh store rehydrates the persisted choice (survives reload)", async () => {
    const storage = memoryStorage();
    const first = createSubsLayoutStore(storage);
    first.getState().setLayout("list");
    const second = createSubsLayoutStore(storage);
    // Mirrors the view's mount effect: skipHydration + explicit rehydrate.
    await second.persist.rehydrate();
    expect(second.getState().layout).toBe("list");
  });

  test("an invalid stored value falls back to grid (only 'list' is ever accepted)", async () => {
    const storage = memoryStorage();
    // the zustand envelope around a bogus layout value
    storage.setItem(SUBS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: "banana" }, version: 0 }));
    const store = createSubsLayoutStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().layout).toBe("grid");
  });

  test("corrupted raw storage never throws — the grid default stands", async () => {
    const storage = memoryStorage();
    storage.setItem(SUBS_LAYOUT_STORAGE_KEY, "not json {{{");
    const store = createSubsLayoutStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().layout).toBe("grid");
  });
});

describe("P18 — the feed header's grid/list switcher", () => {
  test("renders two icon buttons with aria-pressed; grid is the default (no list rows)", async () => {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    const toggle = all('[data-testid="subs-layout-toggle"]');
    expect(toggle).toHaveLength(1);
    const buttons = all('[data-testid="subs-layout-toggle"] button');
    expect(buttons).toHaveLength(2);
    const gridBtn = all('[data-testid="subs-layout-grid"]')[0];
    const listBtn = all('[data-testid="subs-layout-list"]')[0];
    expect(gridBtn.getAttribute("aria-pressed")).toBe("true");
    expect(listBtn.getAttribute("aria-pressed")).toBe("false");
    expect(gridBtn.getAttribute("aria-label")).toBe("Grid view");
    expect(listBtn.getAttribute("aria-label")).toBe("List view");
    // the GRID renders the existing VideoCard grid (thumb-anchor cards) — unchanged
    expect(all("[data-thumb-anchor]").length).toBe(2);
    expect(all('[data-testid="subs-list-row"]').length).toBe(0);
  });

  test("guest → the gate's signed-out screen owns the surface (no toggle)", async () => {
    sessionData = {}; // a session payload without a user → guest
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    expect((host!.textContent ?? "")).toContain("Sign in to see your subscriptions on WebFlix");
    expect(all('[data-testid="subs-layout-toggle"]').length).toBe(0);
    expect(all("[data-thumb-anchor]").length).toBe(0);
  });

  test("clicking list flips aria-pressed and swaps the grid for list rows (and back)", async () => {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    const listBtn = all('[data-testid="subs-layout-list"]')[0];
    await act(async () => {
      listBtn.click();
    });
    await act(async () => {});
    expect(all('[data-testid="subs-layout-grid"]')[0].getAttribute("aria-pressed")).toBe("false");
    expect(all('[data-testid="subs-layout-list"]')[0].getAttribute("aria-pressed")).toBe("true");
    expect(all('[data-testid="subs-list-row"]').length).toBe(2);
    expect(all("[data-thumb-anchor]").length).toBe(0); // the grid cards are gone
    // the active pill styling rides the data-active marker (YouTube's filled chip)
    expect(all('[data-testid="subs-layout-list"]')[0].getAttribute("data-active")).toBe("true");
    // and back to grid
    await act(async () => {
      all('[data-testid="subs-layout-grid"]')[0].click();
    });
    await act(async () => {});
    expect(all('[data-testid="subs-list-row"]').length).toBe(0);
    expect(all("[data-thumb-anchor]").length).toBe(2);
  });
});

describe("P18 — the list row (YouTube's subscription list-row shape)", () => {
  async function renderList() {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    await act(async () => {
      all('[data-testid="subs-layout-list"]')[0].click();
    });
    await act(async () => {});
  }

  test("16:9 ~168px thumbnail left + 2-line clamped title + views · age meta + channel row", async () => {
    await renderList();
    const row = all('[data-testid="subs-list-row"]')[0];
    // the thumbnail link: 16:9, ~168px wide
    const thumb = row.querySelector("a") as unknown as HTMLElement;
    expect(thumb.className).toContain("w-[168px]");
    const aspect = thumb.querySelector("div") as unknown as HTMLElement;
    expect(aspect.className).toContain("aspect-video");
    expect(thumb.getAttribute("href")).toBe("/watch/v1");
    // the title: 2-line clamp, links to the watch page
    const title = row.querySelector("h3") as unknown as HTMLElement;
    expect(title.className).toContain("line-clamp-2");
    expect(title.textContent).toContain("Video v1");
    expect((row.querySelector('a[href="/watch/v1"]') as HTMLElement).getAttribute("aria-label")).toContain("Video v1");
    // the meta line: views · age (the live passthrough texts)
    const meta = texts('[data-testid="subs-list-row"] > div > p')[0];
    expect(meta).toBe("149K views · 2 days ago");
    // the channel row: avatar + name, links to the channel page
    const channelLink = row.querySelector('a[href="/channel/@chanone"]') as unknown as HTMLElement;
    expect(channelLink).not.toBeNull();
    expect(channelLink.textContent).toContain("Chan One");
    // the thumbnail image itself (radix avatars render their fallback until
    // the avatar image loads — happy-dom never loads images)
    const thumbImg = row.querySelector('a[href="/watch/v1"] img') as unknown as HTMLElement;
    expect(thumbImg.getAttribute("src")).toContain("v1");
  });

  test("the description snippet renders ONLY when the payload carries one (honest absence)", async () => {
    await renderList();
    const rows = all('[data-testid="subs-list-row"]');
    expect(rows).toHaveLength(2);
    // v1 carries NO description → no snippet line at all
    const v1Snippets = rows[0].querySelectorAll(".line-clamp-1");
    expect(v1Snippets.length).toBe(0);
    // v2 carries one → the 1-line clamped snippet
    const v2Snippets = rows[1].querySelectorAll(".line-clamp-1");
    expect(v2Snippets.length).toBe(1);
    expect((v2Snippets[0].textContent ?? "")).toContain("A real description snippet from the payload");
  });
});

describe("P18 — the persisted choice (wf-subs-layout)", () => {
  test("choosing list writes the key; the app's own bytes survive a simulated reload", async () => {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    await act(async () => {
      all('[data-testid="subs-layout-list"]')[0].click();
    });
    await act(async () => {});
    const stored = win.localStorage.getItem(SUBS_LAYOUT_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(stored).toContain('"layout":"list"');

    // simulate the reload: fresh store state (the SSR default), the app's
    // own persisted bytes restored, a fresh mount rehydrates them
    act(() => {
      root?.unmount();
    });
    host?.remove();
    useSubsLayout.setState({ layout: "grid" }); // the wrapped setState clobbers storage…
    win.localStorage.setItem(SUBS_LAYOUT_STORAGE_KEY, String(stored)); // …so restore the app's own bytes
    await render(createElement(SubscriptionsPage));
    await act(async () => {
      await useSubsLayout.persist.rehydrate(); // the view's mount effect (deterministic here)
    });
    await act(async () => {});
    expect(all('[data-testid="subs-list-row"]').length).toBe(2); // the list view is back
    expect(all('[data-testid="subs-layout-list"]')[0].getAttribute("aria-pressed")).toBe("true");
  });

  test("an invalid stored value leaves the default grid standing", async () => {
    win.localStorage.setItem(
      SUBS_LAYOUT_STORAGE_KEY,
      JSON.stringify({ state: { layout: "banana" }, version: 0 })
    );
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    await act(async () => {
      await useSubsLayout.persist.rehydrate();
    });
    await act(async () => {});
    expect(all('[data-testid="subs-layout-grid"]')[0].getAttribute("aria-pressed")).toBe("true");
    expect(all('[data-testid="subs-list-row"]').length).toBe(0);
  });
});

describe("P18 — the unchanged seams (skeletons, error, paging)", () => {
  test("loading in list mode renders LIST-shaped skeletons (not the grid ones)", async () => {
    feedData = null; // loading
    useSubsLayout.setState({ layout: "list" });
    await render(createElement(SubscriptionsPage));
    expect(all('[aria-label="Loading subscriptions"]').length).toBe(1);
    const listSkeletons = all('div[class*="w-[168px]"]');
    expect(listSkeletons.length).toBe(6); // one per skeleton row
    // the grid skeleton shape is not used in list mode
    const gridSkeletonCards = all('div[class*="w-full"][class*="rounded-xl"]');
    expect(gridSkeletonCards.length).toBe(0);
  });

  test("loading in grid mode keeps the existing grid skeletons", async () => {
    feedData = null;
    await render(createElement(SubscriptionsPage));
    expect(all('[aria-label="Loading subscriptions"]').length).toBe(1);
    expect(all('div[class*="w-[168px]"]').length).toBe(0);
  });

  test("the honest error state is unchanged (role=alert)", async () => {
    feedError = "Failed to load subscriptions";
    await render(createElement(SubscriptionsPage));
    const alert = all('[role="alert"]');
    expect(alert).toHaveLength(1);
    expect(alert[0].textContent).toContain("Failed to load subscriptions");
  });

  test("cursor paging — the sentinel auto-loads rows in list view (the P22-C seam)", async () => {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    await act(async () => {
      all('[data-testid="subs-layout-list"]')[0].click();
    });
    await act(async () => {});
    // the house sentinel renders while the chain holds a cursor (no button —
    // youtube.com's subscriptions feed auto-loads)
    expect(all('button').some((b) => (b.textContent ?? "").includes("Load more"))).toBe(false);
    expect(all('[data-testid="subs-infinite-scroll-sentinel"]').length).toBe(1);
    fetchHandler = () =>
      new Response(
        JSON.stringify({
          channels: [],
          videos: [video("v3")],
          nextCursor: null,
          loginRequired: false,
          session: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    await fireSentinel();
    await act(async () => {});
    expect(fetchLog.filter((u) => u.includes("/api/subscriptions?cursor=CUR1"))).toHaveLength(1);
    expect(all('[data-testid="subs-list-row"]').length).toBe(3); // 2 + the auto-loaded page
    // WFX2-P22-C: the chain's honest end UNMOUNTS the sentinel (hasMore is
    // the chain cursor only) — no in-view sentinel, no refetch loop.
    expect(all('[data-testid="subs-infinite-scroll-sentinel"]').length).toBe(0);
  });

  test("cursor paging — the honest end unmounts the sentinel (no refetch loop)", async () => {
    feedData = { ...FEED, nextCursor: null }; // a one-page feed
    await render(createElement(SubscriptionsPage));
    await act(async () => {});
    expect(all('[data-testid="subs-infinite-scroll-sentinel"]').length).toBe(0);
    expect(all('[data-thumb-anchor]').length).toBe(2);
    expect(fetchLog.filter((u) => u.includes("/api/subscriptions?cursor="))).toHaveLength(0);
  });

  test("cursor paging — a failed page keeps the rows and the sentinel re-arms (retry on the next pass)", async () => {
    feedData = FEED;
    await render(createElement(SubscriptionsPage));
    fetchHandler = () => new Response("{}", { status: 500 });
    await fireSentinel();
    await act(async () => {});
    // the rows are intact and NO duplicate fetch storm: the loading flag
    // guards concurrency, the failed cursor is kept for the retry
    expect(all('[data-thumb-anchor]').length).toBe(2);
    expect(all('[data-testid="subs-infinite-scroll-sentinel"]').length).toBe(1);
    fetchHandler = () =>
      new Response(
        JSON.stringify({ channels: [], videos: [video("v9")], nextCursor: null, loginRequired: false, session: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    await fireSentinel();
    await act(async () => {});
    expect(all('[data-thumb-anchor]').length).toBe(3);
  });
});
