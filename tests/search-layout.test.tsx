/**
 * P13-SEARCH — youtube.com's search results page layout (vertical list).
 *
 * The 2026 parity laws this file pins:
 *  - results are a VERTICAL LIST of horizontal cards (SearchVideoCard) —
 *    never the home grid;
 *  - the quick-chip row (All / Videos / Shorts / Recently uploaded / Live)
 *    renders and edits the URL state;
 *  - channel + playlist cards interleave INLINE in the list;
 *  - shorts ride a mid-list shelf;
 *  - the page has NO second search form (the topbar owns the query).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
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
win.IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof IntersectionObserver;

const routerPushes: string[] = [];
mock.module("next/navigation", () => ({
  usePathname: () => "/search",
  useRouter: () => ({ push: (u: string) => routerPushes.push(u), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(viewParams),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("@/hooks/use-api", () => ({
  useApi: () => ({ data: viewData, loading: false, error: null, reload: () => {} }),
  postJson: async () => ({}),
}));
mock.module("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }) }));
mock.module("@/lib/queue/queue-actions", () => ({ addToQueue: async () => ({ status: "error", message: "no" }) }));

const { default: SearchPage } = await import("@/app/search/view");

let viewParams = "q=lofi";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewData: any = null;

const loadFixture = (): unknown => {
  const dto = JSON.parse(
    readFileSync("tests/fixtures/yt/search_lofi.json", "utf8")
  );
  return dto;
};

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
  routerPushes.length = 0;
  viewParams = "q=lofi";
  viewData = null;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

const video = (id: string, title: string) => ({
  id,
  title,
  description: `The description snippet for ${title}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
  videoUrl: `/watch/${id}`,
  durationSec: 213,
  views: 149000,
  viewsText: "149K views",
  publishedText: "23 hours ago",
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
    id: "UC123",
    handle: "@LofiGirl",
    name: "Lofi Girl",
    avatarUrl: "https://example.com/a.jpg",
    verified: true,
    subscriberCount: 14000000,
  },
});

const RESULTS_PAGE = {
  query: "lofi",
  videos: [video("v1", "cozy autumn lofi beats"), video("v2", "lofi hip hop radio")],
  channels: [
    {
      id: "UC123",
      handle: "@LofiGirl",
      name: "Lofi Girl",
      avatarUrl: "https://example.com/a.jpg",
      verified: true,
      subscriberCount: 14000000,
      subscriberCountText: "14M subscribers",
      description: "beats to relax/study to",
    },
  ],
  playlists: [
    {
      id: "PL1",
      title: "lofi mix",
      thumbnailUrl: "https://example.com/p.jpg",
      videoCount: 28,
      videoCountText: "28 videos",
      channelName: "Lofi Girl",
      updatedText: "Updated last week",
      isMix: false,
    },
  ],
  resultCountText: "About 3,839,607 results",
  correction: null,
  nextCursor: null,
};

describe("P13-SEARCH — the vertical-list layout parity", () => {
  test("video results are HORIZONTAL list cards (the dedicated search card), never the home grid", async () => {
    viewData = RESULTS_PAGE;
    await render(createElement(SearchPage));
    // the dedicated list card testid
    expect(all('[data-testid="search-video-card"]').length).toBe(2);
    // the home grid card shape must NOT be used
    expect(all("article").every((a) => !a.className.includes("w-[320px]"))).toBe(true);
    // horizontal cards carry the thumb-anchor (the shared hover-preview layer tracks it)
    expect(all("[data-thumb-anchor]").length).toBe(2);
  });

  test("channel + playlist cards interleave INLINE (no separate Channels/Playlists sections)", async () => {
    viewData = RESULTS_PAGE;
    await render(createElement(SearchPage));
    expect(all('[data-testid="search-channel-card"]').length).toBe(1);
    // no "Channels"/"Playlists" grouping headings (the old grouped shape)
    const headings = texts("h2").map((t) => t.toLowerCase());
    expect(headings).not.toContain("channels");
    expect(headings).not.toContain("playlists");
    // the playlist card still renders (the PlaylistResultCard's stacked thumb)
    expect(all("article a[aria-label^='Open playlist']").length).toBe(1);
  });

  test("the quick-chip row renders the live 2026 labels and edits the URL state", async () => {
    viewData = RESULTS_PAGE;
    await render(createElement(SearchPage));
    const chips = texts('[data-testid="search-quick-chips"] button');
    expect(chips).toEqual(["All", "Videos", "Shorts", "Recently uploaded", "Live"]);
    // clicking "Shorts" → ?type=shorts search
    const shortsChip = all('[data-testid="search-quick-chips"] button')[2];
    await act(async () => {
      shortsChip.click();
    });
    expect(routerPushes).toContain("/search?q=lofi&type=shorts");
    // clicking "Live" → live=1
    const liveChip = all('[data-testid="search-quick-chips"] button')[4];
    await act(async () => {
      liveChip.click();
    });
    expect(routerPushes).toContain("/search?q=lofi&live=1");
  });

  test("no second search form on the results page (the topbar owns the query)", async () => {
    viewData = RESULTS_PAGE;
    await render(createElement(SearchPage));
    expect(all('form[role="search"]').length).toBe(0);
    expect(all("input").length).toBe(0);
  });

  test("shorts ride the mid-list shelf with 9:16 tiles", async () => {
    viewData = {
      ...RESULTS_PAGE,
      videos: [
        video("v1", "cozy autumn lofi beats"),
        { ...video("s1", "short lofi moment"), isShort: true },
        ...Array.from({ length: 8 }, (_, i) => video(`v${i + 10}`, `lofi radio ${i}`)),
      ],
    };
    await render(createElement(SearchPage));
    const shelf = all('section[aria-label="Shorts results"]');
    expect(shelf.length).toBe(1);
    const shortLinks = all('section[aria-label="Shorts results"] a[aria-label]');
    expect(shortLinks.some((a) => a.getAttribute("aria-label") === "short lofi moment")).toBe(true);
  });
});
