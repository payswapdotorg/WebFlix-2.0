/// <reference types="bun-types" />
/**
 * P30 — the music destination (/music) battery: youtube.com's own Music
 * page re-shaped (the operator's 2026-10-20 report: "the music page also
 * looks different from the music page on the reference site (youtube.com)"
 * — measured live 2026-10-20: the channel-style header + the shelf family
 * of SQUARE lockups).
 *
 * happy-dom + createRoot/act (the subscriptions-layout harness pattern);
 * next/link, use-api, sonner and queue actions mocked via mock.module —
 * the hover-preview hook runs REAL (the shorts-shelf test's own pattern:
 * the store singleton + a stubbed global fetch keep the mount-time
 * playback prefetch silent). What must hold:
 *
 *  - THE HEADER: the banner + the overlapping circular avatar + the "Music"
 *    name + the Home tab (the channel-page shape, aria-current).
 *  - THE SHELF FAMILY: one shelf per Music seed query, the honest
 *    sentence-cased titles in seed order, hidden when a query came back
 *    empty; NO sentinel and NO chips (the one-page law — /podcasts' own).
 *  - THE SQUARE LOCKUP: 1:1 cover + [data-thumb-anchor] (the hover-preview
 *    contract) + title + channel + views·age; the watch link and the
 *    channel link are the card's own targets; 12 tiles per shelf max.
 *  - THE HONEST EDGES: cross-shelf de-dupe (a card renders ONCE on the
 *    page), publicMode's honest line, loading skeletons, the error state.
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
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (the subscriptions-layout set) ----
let destinationData: any = null;
let destinationError: string | null = null;
let destinationLoading = false;
mock.module("next/navigation", () => ({
  usePathname: () => "/music",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
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
      data: destinationData,
      loading: destinationLoading,
      error: destinationError,
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

// ---- the feeds mock (the compose battery drives getMusicDestinationShelves
// through canned per-query pages — the REAL seam the route rides) ----
let searchPages: Record<string, { videos: any[] } | null> = {};
mock.module("@/lib/youtube/feeds", () => ({
  getSearchVideoPage: async (query: string) => {
    const page = searchPages[query];
    if (page === null) throw new Error("search down");
    return { videos: page.videos, nextCursor: null };
  },
}));

const MusicView = (await import("@/app/music/view")).default;
const { getMusicDestinationShelves } = await import("@/lib/youtube/music-destination");
const { EXPLORE_CATEGORY_SEEDS } = await import("@/lib/youtube/explore-categories");

// ---- the fetch stub (the hover hook's mount-time playback prefetch rides
// raw fetch — stubbed silent, never the network) ----
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

// ---- fixtures (minimal honest DTOs) ----
const video = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    title,
    description: "",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    durationSec: 211,
    views: 1_000,
    viewsText: "1K views",
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "Music",
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

const threeShelves = {
  title: "Music",
  shelves: [
    { title: "Music videos", videos: [video("mv1", "Alpha MV"), video("mv2", "Beta MV"), video("mv3", "Gamma MV")] },
    { title: "New music", videos: [video("nm1", "Delta Drop"), video("nm2", "Epsilon Drop")] },
    { title: "Live music", videos: [video("lm1", "Zeta Live")] },
  ],
  source: "search",
  publicMode: true,
};

// ---- the render helpers ----
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qAll = (sel: string): HTMLElement[] =>
  host ? ([...host.querySelectorAll(sel)] as unknown as HTMLElement[]) : [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderView() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(createElement(MusicView));
  });
  await act(async () => {
    await sleep(10);
  });
}

beforeEach(() => {
  destinationData = JSON.parse(JSON.stringify(threeShelves));
  destinationError = null;
  destinationLoading = false;
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

describe("P30 — the music destination header (the channel-page shape)", () => {
  test("the banner + the overlapping avatar + the Music name + the Home tab", async () => {
    await renderView();
    // the h1 name
    expect(q("h1")?.textContent).toBe("Music");
    // the banner strip (decorative, aria-hidden) with the avatar disc above it
    expect(qAll("header div[aria-hidden='true']")).toHaveLength(1);
    // the Home tab — the only honest surface, aria-current
    const tab = q("nav[aria-label='Music sections'] span[aria-current='page']");
    expect(tab?.textContent).toBe("Home");
    // the subtitle line
    expect(q("header p")?.textContent).toContain("Music videos");
  });

  test("publicMode renders the honest degradation line", async () => {
    await renderView();
    const line = q('[data-testid="music-public-mode"]');
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("public mode");
  });

  test("NO sentinel and NO chips on the one-page destination (the /podcasts law)", async () => {
    await renderView();
    expect(q('[data-testid*="sentinel"]')).toBeNull();
    expect(q('[role="tablist"]')).toBeNull();
    expect(q('[data-testid="category-chip"]')).toBeNull();
  });
});

describe("P30 — the shelf family (one shelf per Music seed query)", () => {
  test("the three shelves render in seed order with their honest sentence-cased titles", async () => {
    await renderView();
    const shelves = qAll('[data-testid="music-shelf"]');
    expect(shelves).toHaveLength(3);
    expect(shelves.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Music videos",
      "New music",
      "Live music",
    ]);
    expect(shelves.map((s) => s.getAttribute("data-shelf-index"))).toEqual(["0", "1", "2"]);
    // each shelf renders its own h2 title
    expect(shelves[0].querySelector("h2")?.textContent).toBe("Music videos");
  });

  test("an empty shelf hides honestly — never a fabricated rail", async () => {
    destinationData.shelves[2].videos = [];
    await renderView();
    const shelves = qAll('[data-testid="music-shelf"]');
    expect(shelves).toHaveLength(2);
    expect(shelves.map((s) => s.getAttribute("aria-label"))).toEqual(["Music videos", "New music"]);
  });
});

describe("P30 — the compose (getMusicDestinationShelves, the /api/music route's seam)", () => {
  beforeEach(() => {
    // one canned page per Music seed query (fresh copies each test)
    searchPages = {
      [EXPLORE_CATEGORY_SEEDS.Music[0]]: {
        videos: [video("mv1", "Alpha MV"), video("mv2", "Beta MV")],
      },
      [EXPLORE_CATEGORY_SEEDS.Music[1]]: {
        videos: [video("nm1", "Delta Drop")],
      },
      [EXPLORE_CATEGORY_SEEDS.Music[2]]: {
        videos: [video("lm1", "Zeta Live")],
      },
    };
  });

  test("one shelf per seed query, the honest sentence-cased titles, in seed order", async () => {
    const shelves = await getMusicDestinationShelves();
    expect(shelves.map((s) => s.title)).toEqual(["Music videos", "New music", "Live music"]);
    expect(shelves[0].videos.map((v) => v.id)).toEqual(["mv1", "mv2"]);
    expect(shelves[1].videos.map((v) => v.id)).toEqual(["nm1"]);
    expect(shelves[2].videos.map((v) => v.id)).toEqual(["lm1"]);
  });

  test("cross-shelf de-dupe: a card found by two queries renders ONCE (the first shelf keeps it)", async () => {
    // "new music" also found Alpha MV — the destination keeps it in shelf 0
    searchPages[EXPLORE_CATEGORY_SEEDS.Music[1]] = {
      videos: [video("mv1", "Alpha MV"), video("nm9", "Fresh Find")],
    };
    const shelves = await getMusicDestinationShelves();
    const all = shelves.flatMap((s) => s.videos.map((v) => v.id));
    expect(all.filter((id) => id === "mv1")).toHaveLength(1);
    expect(shelves[1].videos.map((v) => v.id)).toEqual(["nm9"]);
  });

  test("a shelf caps at 12 tiles and filters shorts (the SHELF_LIMIT + non-shorts laws)", async () => {
    const many = Array.from({ length: 14 }, (_, i) => video(`cap${i}`, `Capped ${i}`));
    // a short rides the raw page — never a short on the music destination
    many[3] = video("sh1", "Sneaky Short", { isShort: true });
    searchPages[EXPLORE_CATEGORY_SEEDS.Music[0]] = { videos: many };
    const shelves = await getMusicDestinationShelves();
    expect(shelves[0].videos).toHaveLength(12);
    expect(shelves[0].videos.some((v) => v.id === "sh1")).toBe(false);
  });

  test("a failed query degrades honestly (that shelf empty); EVERY query down → the honest throw", async () => {
    searchPages[EXPLORE_CATEGORY_SEEDS.Music[2]] = null; // live music search failed
    const shelves = await getMusicDestinationShelves();
    expect(shelves[2].videos).toEqual([]);
    expect(shelves[0].videos).toHaveLength(2);

    for (const q of EXPLORE_CATEGORY_SEEDS.Music) searchPages[q] = null;
    await expect(getMusicDestinationShelves()).rejects.toThrow("search is down");
  });
});

describe("P30 — the square music lockup (the reference's shelf card)", () => {
  test("1:1 cover + the hover-preview anchor + title + channel + views", async () => {
    await renderView();
    const first = qAll('[data-testid="music-shelf"]')[0];
    const card = first.querySelector("article")!;
    // the square cover (aspect-square) carrying the hover-preview anchor
    const cover = card.querySelector("div[data-thumb-anchor]")!;
    expect(cover.className).toContain("aspect-square");
    expect(cover.querySelector("img")?.getAttribute("alt")).toBe("Alpha MV");
    // the duration badge rides the square cover
    expect(cover.textContent).toContain("3:31");
    // the title + the watch link
    const title = card.querySelector("h3")!;
    expect(title.getAttribute("title")).toBe("Alpha MV");
    expect(card.querySelector('a[href="/watch/mv1"]')).not.toBeNull();
    // the channel link (its own target, a sibling — never nested anchors)
    expect(card.querySelector('a[href="/channel/@mv1"]')).not.toBeNull();
    // the meta line carries the views
    expect(card.textContent).toContain("1K views");
  });

  test("live lockups carry the LIVE badge instead of a duration", async () => {
    destinationData.shelves[2].videos = [video("live1", "Live Now", { isLive: true, durationSec: null })];
    await renderView();
    const liveShelf = qAll('[data-testid="music-shelf"]').find(
      (s) => s.getAttribute("aria-label") === "Live music"
    )!;
    const cover = liveShelf.querySelector("div[data-thumb-anchor]")!;
    expect(cover.textContent).toContain("Live");
  });
});

describe("P30 — the honest edges", () => {
  test("loading renders the shelf skeletons (aria-busy)", async () => {
    destinationData = null;
    destinationLoading = true;
    await renderView();
    expect(q('[aria-busy="true"]')).not.toBeNull();
    expect(q('[aria-label="Loading music"]')).not.toBeNull();
    // the header renders even while loading (static chrome)
    expect(q("h1")?.textContent).toBe("Music");
  });

  test("the error state surfaces honestly (role=alert)", async () => {
    destinationData = null;
    destinationError = "Failed to load music shelves";
    await renderView();
    expect(q('[role="alert"]')?.textContent).toContain("Failed to load music shelves");
  });

  test("a shelf-less page answers the honest empty line", async () => {
    destinationData.shelves = [];
    await renderView();
    expect(qAll('[data-testid="music-shelf"]')).toHaveLength(0);
    expect(host!.textContent).toContain("Nothing on the music page right now");
  });
});
