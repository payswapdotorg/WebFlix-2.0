/// <reference types="bun-types" />
/**
 * REA-1 — the feed-family VIEW laws, pinned with the repo's happy-dom +
 * createRoot/act harness (the search-layout/explore-layout idiom — mocked
 * modules, NEVER the network):
 *
 *  - G17 the hashtag page: the "#tag" header + the meta line + the
 *    VideoCard grid + the sentinel + the honest error/empty states;
 *  - G16 the playlist page: Play all carries ?list= (the queue context),
 *    the Shuffle click navigates with list+seed (the deterministic law),
 *    the mix-unviewable verdict renders youtube.com's own wording + the
 *    start-radio affordance;
 *  - G19 the mix result card: the MIX badge + the start-radio href;
 *  - G17 the description box: hashtag links route to /hashtag/<tag>;
 *  - G17 the shorts title hashtag tokens route to /hashtag/<tag> (source-
 *    scan law — the llm-seam precedent: the feed harness renders per-slot
 *    components, so the routing law is pinned at the source level).
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
// P24-SEND (G12): the ⋯-menu tests open the VideoCard's radix dropdown —
// the portal + presence machinery needs the fuller global set (the
// personal-surface-states/you-hub domProps family: getComputedStyle,
// rAF, the event constructors, ResizeObserver).
for (const k of [
  "Element",
  "Node",
  "NodeList",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
  "ResizeObserver",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
]) {
  const v = (win as unknown as Record<string, unknown>)[k];
  if (v !== undefined) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
const CapturingIntersectionObserver = class {
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

const routerPushes: string[] = [];
let routeParams = "PLFgquLnL59al";
mock.module("next/navigation", () => ({
  usePathname: () => "/playlist",
  useParams: () => ({ id: routeParams }),
  useRouter: () => ({
    push: (u: string) => routerPushes.push(u),
    replace: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
let viewData: any = null;
let viewError: string | null = null;
// P24-SEND (G12) — the logged postJson seam + its per-test handler
const postJsonLog: { url: string; body: unknown }[] = [];
let postJsonHandler: (url: string, body: unknown) => Promise<unknown> = async () => ({});
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => ({
    data: viewData,
    loading: url !== null && viewData === null && viewError === null,
    error: viewError,
    reload: () => {},
  }),
  // P24-SEND (G12): postJson is a logged programmable seam now — the
  // video card's feedback writes (not-interested / dont-recommend-channel /
  // the undos) ride it; the personal-surface-states fetch-stub idiom,
  // scoped to the module the card actually imports.
  postJson: async (url: string, body: unknown) => {
    postJsonLog.push({ url, body });
    return postJsonHandler(url, body);
  },
}));
const toasts: { text: string; action?: { label: string; onClick: () => void } }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(
    (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => {
      toasts.push({ text: String(msg), action: opts?.action });
    },
    {
      success: (m: string) => toasts.push({ text: `success:${m}` }),
      error: (m: string) => toasts.push({ text: `error:${m}` }),
      info: (m: string) => toasts.push({ text: `info:${m}` }),
    },
  ),
}));

const { default: HashtagView } = await import("@/app/hashtag/[tag]/view");
const { default: PlaylistPage } = await import("@/app/playlist/[id]/page");
const { PlaylistResultCard } = await import("@/components/search/playlist-result-card");
const { DescriptionBox } = await import("@/components/watch/description-box");

const video = (id: string, title: string) => ({
  id,
  title,
  description: "",
  videoUrl: `/watch/${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
  durationSec: 213,
  views: 101,
  viewsText: "101 views",
  publishedText: "2 days ago",
  likeCountText: null,
  likes: 0,
  dislikes: 0,
  visibility: "public",
  category: "All",
  isMembersOnly: false,
  membersTier: null,
  isShort: false,
  premieredAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  channel: { id: "UCx", handle: "@lofi", name: "Lofi Girl", avatarUrl: "", verified: false },
  isLive: false,
});

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
  routeParams = "PLFgquLnL59al";
  viewData = null;
  viewError = null;
  postJsonLog.length = 0;
  postJsonHandler = async () => ({});
  toasts.length = 0;
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
// G17 — the hashtag page
// ---------------------------------------------------------------------------

describe("the hashtag page (/hashtag/[tag]) — youtube.com's measured surface", () => {
  test("the '#tag' header + the meta line + the video grid", async () => {
    viewData = {
      tag: "lofi",
      title: "#lofi",
      metaText: "7M videos • 1.4M channels",
      videos: [video("sF80I-TQiW0", "90's Chill Lofi"), video("BCxTQq0UiFs", "Chill Lofi Beats")],
      nextCursor: null,
    };
    await render(createElement(HashtagView, { tag: "lofi" }));
    expect(texts("[data-testid='hashtag-title']")).toEqual(["#lofi"]);
    expect(texts("[data-testid='hashtag-meta']")).toEqual(["7M videos • 1.4M channels"]);
    expect(all("[data-testid='hashtag-grid'] a").length).toBeGreaterThan(0);
    expect(texts("[data-testid='hashtag-grid'] a").join(" ")).toContain("90's Chill Lofi");
  });

  test("the honest upstream-failure state (the P22-B wording family, never a fabricated grid)", async () => {
    viewError = "Failed to load hashtag videos";
    await render(createElement(HashtagView, { tag: "lofi" }));
    expect(all("[data-testid='hashtag-error']").length).toBe(1);
    expect(texts("[data-testid='hashtag-error'] h1, [data-testid='hashtag-error'] p")[0]).toContain(
      "unavailable right now"
    );
    expect(all("[data-testid='hashtag-grid']").length).toBe(0);
  });

  test("the honest served-empty state", async () => {
    viewData = { tag: "nothing", title: "#nothing", metaText: null, videos: [], nextCursor: null };
    await render(createElement(HashtagView, { tag: "nothing" }));
    expect(all("[data-testid='hashtag-empty']").length).toBe(1);
  });

  test("the infinite-scroll sentinel renders while the cursor chain continues", async () => {
    viewData = {
      tag: "lofi",
      title: "#lofi",
      metaText: "7M videos",
      videos: [video("sF80I-TQiW0", "90's Chill Lofi")],
      nextCursor: "4qmFsgLFBRIJRkVoYXNodGFn",
    };
    await render(createElement(HashtagView, { tag: "lofi" }));
    expect(all("[data-testid='hashtag-scroll-sentinel']").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G16 — the playlist page's Play all / Shuffle
// ---------------------------------------------------------------------------

describe("the playlist page — Play all + Shuffle (the queue context)", () => {
  test("Play all carries ?list= (youtube.com's measured /watch?v=<first>&list=<id>)", async () => {
    viewData = {
      playlist: {
        id: "PLFgquLnL59al",
        title: "Lofi Loft",
        channelName: "YouTube Music",
        videoCountText: "25 videos",
        viewsText: null,
        description: null,
      },
      videos: [video("v1111111111", "First"), video("v2222222222", "Second"), video("v3333333333", "Third")],
      nextCursor: null,
    };
    await render(createElement(PlaylistPage));
    const playAll = all("[data-testid='playlist-play-all']").find((e) => e.tagName === "A");
    expect(playAll?.getAttribute("href")).toBe("/watch/v1111111111?list=PLFgquLnL59al");
  });

  test("the Shuffle click navigates with list + a fresh deterministic seed (the URL law)", async () => {
    viewData = {
      playlist: {
        id: "PLFgquLnL59al",
        title: "Lofi Loft",
        channelName: "YouTube Music",
        videoCountText: "25 videos",
        viewsText: null,
        description: null,
      },
      videos: [
        video("v1111111111", "First"),
        video("v2222222222", "Second"),
        video("v3333333333", "Third"),
        video("v4444444444", "Fourth"),
      ],
      nextCursor: null,
    };
    await render(createElement(PlaylistPage));
    const shuffle = all("[data-testid='playlist-shuffle']").find((e) => e.tagName === "BUTTON");
    expect(shuffle).toBeDefined();
    await act(async () => {
      shuffle!.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    });
    expect(routerPushes).toHaveLength(1);
    const url = new URL(routerPushes[0]!, "http://localhost");
    expect(url.pathname).toMatch(/^\/watch\/v\d{10}$/);
    expect(url.searchParams.get("list")).toBe("PLFgquLnL59al");
    expect(url.searchParams.get("shuffle")).toMatch(/^\d{1,10}$/);
    // the start video IS one of the list's (the shuffled head)
    expect(["v1111111111", "v2222222222", "v3333333333", "v4444444444"]).toContain(
      url.pathname.split("/").pop() ?? ""
    );
  });

  test("two Shuffle clicks carry different seeds (a fresh seed per click)", async () => {
    viewData = {
      playlist: { id: "PLFgquLnL59al", title: "L", channelName: "c", videoCountText: null, viewsText: null, description: null },
      videos: Array.from({ length: 8 }, (_, i) => video(`v${i}${i}${i}111111`, `Video ${i}`)),
      nextCursor: null,
    };
    await render(createElement(PlaylistPage));
    const shuffle = all("[data-testid='playlist-shuffle']").find((e) => e.tagName === "BUTTON")!;
    await act(async () => {
      shuffle.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      shuffle.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    });
    expect(routerPushes).toHaveLength(2);
    const seedA = new URL(routerPushes[0]!, "http://localhost").searchParams.get("shuffle");
    const seedB = new URL(routerPushes[1]!, "http://localhost").searchParams.get("shuffle");
    expect(seedA).not.toBe(seedB);
  });
});

// ---------------------------------------------------------------------------
// G19 — the mix verdict on the playlist page + the mix result card
// ---------------------------------------------------------------------------

describe("the playlist page — the mix verdict (youtube.com's own wording)", () => {
  test("RD<videoId> renders the unviewable note + the start-radio affordance", async () => {
    routeParams = "RDn61ULEU7CO0";
    viewData = {
      playlist: { id: "RDn61ULEU7CO0", title: "Mix", channelName: "", videoCountText: null, viewsText: null, description: null },
      videos: [],
      nextCursor: null,
      mixUnviewable: true,
      mixSeedVideoId: "n61ULEU7CO0",
    };
    await render(createElement(PlaylistPage));
    expect(texts("[data-testid='playlist-mix-unviewable'] p")[0]).toBe(
      "This playlist type is unviewable."
    );
    const radio = all("[data-testid='playlist-mix-start-radio']").find((e) => e.tagName === "A");
    expect(radio?.getAttribute("href")).toBe("/watch/n61ULEU7CO0?list=RDn61ULEU7CO0&start_radio=1");
    // no Play all / Shuffle on an unviewable mix (nothing to play here)
    expect(all("[data-testid='playlist-play-all']").length).toBe(0);
    expect(all("[data-testid='playlist-shuffle']").length).toBe(0);
  });

  test("an opaque mix id renders the verdict WITHOUT the start-radio guess", async () => {
    routeParams = "RDATfmbG9maSBoaXAgaG9w";
    viewData = {
      playlist: { id: "RDATfmbG9maSBoaXAgaG9w", title: "Mix", channelName: "", videoCountText: null, viewsText: null, description: null },
      videos: [],
      nextCursor: null,
      mixUnviewable: true,
      mixSeedVideoId: null,
    };
    await render(createElement(PlaylistPage));
    expect(all("[data-testid='playlist-mix-unviewable']").length).toBe(1);
    expect(all("[data-testid='playlist-mix-start-radio']").length).toBe(0);
  });
});

describe("the search mix card — the measured start-radio click", () => {
  test("a mix with a seed links to /watch/<seed>?list=RD…&start_radio=1 + the MIX badge", async () => {
    await render(
      createElement(PlaylistResultCard, {
        playlist: {
          id: "RDn61ULEU7CO0",
          title: "Mix - Best of lofi hip hop 2021",
          videoCount: 0,
          videoCountText: null,
          thumbnailUrl: "https://i.ytimg.com/vi/n61ULEU7CO0/hqdefault.jpg",
          channelName: "LoFi GIRL, Burbank, and more",
          updatedText: null,
          isMix: true,
          mixSeedVideoId: "n61ULEU7CO0",
        },
      })
    );
    const card = all("[data-testid='mix-result-card']")[0];
    expect(card?.getAttribute("href")).toBe(
      "/watch/n61ULEU7CO0?list=RDn61ULEU7CO0&start_radio=1"
    );
    expect(all("[data-testid='mix-badge']").length).toBe(1);
    expect(texts("[data-testid='mix-badge']")[0]).toBe("Mix");
    expect(texts("p").some((t) => t.includes("Start radio"))).toBe(true);
  });

  test("a mix WITHOUT an extractable seed keeps the playlist-page link (the honest verdict stands there)", async () => {
    await render(
      createElement(PlaylistResultCard, {
        playlist: {
          id: "RDATfmbG9maSBoaXAgaG9w",
          title: "Mix • Lofi hip hop",
          videoCount: 0,
          videoCountText: null,
          thumbnailUrl: null,
          channelName: "YouTube",
          updatedText: null,
          isMix: true,
          mixSeedVideoId: null,
        },
      })
    );
    const card = all("[data-testid='mix-result-card']")[0];
    expect(card?.getAttribute("href")).toBe("/playlist/RDATfmbG9maSBoaXAgaG9w");
    expect(all("[data-testid='mix-badge']").length).toBe(1);
  });

  test("an ordinary playlist card keeps the playlist-page link (no mix chrome)", async () => {
    await render(
      createElement(PlaylistResultCard, {
        playlist: {
          id: "PLFgquLnL59alCl_2TQvOiD5",
          title: "Lofi playlist",
          videoCount: 25,
          videoCountText: "25 videos",
          thumbnailUrl: null,
          channelName: "someone",
          updatedText: "2 days ago",
          isMix: false,
          mixSeedVideoId: null,
        },
      })
    );
    const card = all("[data-testid='playlist-result-card']")[0];
    expect(card?.getAttribute("href")).toBe("/playlist/PLFgquLnL59alCl_2TQvOiD5");
    expect(all("[data-testid='mix-badge']").length).toBe(0);
    expect(all("[data-testid='mix-result-card']").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G17 — the description box hashtag routing
// ---------------------------------------------------------------------------

describe("the description box — hashtags route to /hashtag/<tag>", () => {
  const base = {
    videoId: "dQw4w9WgXcQ",
    description: "Chill beats to relax\n#lofi #chill #LofiGirl",
    views: 1000,
    viewsText: "1K views",
    createdAt: "2026-10-01T00:00:00.000Z",
    publishedText: "2 weeks ago",
    durationSec: 200,
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg",
    onSeek: () => {},
  };

  test("the collapsed chip row links every hashtag to its /hashtag/ route", async () => {
    await render(createElement(DescriptionBox, base));
    const links = all("[data-testid='description-hashtag']");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/hashtag/lofi",
      "/hashtag/chill",
      "/hashtag/LofiGirl",
    ]);
  });

  test("the expanded body tokens link to /hashtag/<tag> (never /search?q=%23…)", async () => {
    await render(createElement(DescriptionBox, base));
    const more = all("button").find((b) => (b.textContent ?? "").includes("...more"));
    await act(async () => {
      more!.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    });
    const hrefs = Array.from(
      host?.querySelectorAll("a[href^='/hashtag/']") ?? []
    ).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/hashtag/lofi");
    expect(hrefs).toContain("/hashtag/LofiGirl");
    expect(host?.innerHTML).not.toContain("/search?q=%23");
  });
});

// ---------------------------------------------------------------------------
// G17 — the shorts title hashtag routing (the source-scan law)
// ---------------------------------------------------------------------------

describe("the shorts title hashtag routing (source-scan — the llm-seam precedent)", () => {
  test("the shorts feed renders title tokens through the /hashtag/ link family", () => {
    const source = readFileSync("src/components/shorts/shorts-feed.tsx", "utf8");
    expect(source).toContain("hashtagHref");
    expect(source).toContain("data-testid=\"shorts-hashtag\"");
    // the old /search?q=%23 routing is gone from the shorts surface
    expect(source).not.toContain("/search?q=");
  });

  test("the description tokenizer carries the /hashtag/ href (the shared law)", () => {
    const source = readFileSync("src/lib/watch/chapters.ts", "utf8");
    expect(source).toContain("hashtagHref(m[1])");
    expect(source).not.toContain("/search?q=");
  });
});

// ---------------------------------------------------------------------------
// P24-SEND (G12) — the feed card's ⋯ menu gains "Don't recommend channel"
// + the feedback-toast UNDO family. Measured adjacency basis: this repo's
// own real capture tests/fixtures/yt/ssr_trending.json (youtube.com's card
// menu logged-out): … Share | ⋯ | "Not interested", "Don't recommend
// channel", "Report" — the channel variant follows Not interested. The
// toast family is youtube.com's own: "Video removed · UNDO" / "We won't
// recommend this channel anymore · UNDO"; the undo click drives the
// broker's feedback-undo while youtube.com's toast window is live.
// ---------------------------------------------------------------------------

describe("the feed card's ⋯ menu — Don't recommend channel + the undo family (P24-SEND G12)", () => {
  const menuItems = () =>
    Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).map((el) => (el.textContent ?? "").trim());

  async function openFirstCardMenu() {
    const trigger = all("[aria-label^='More options for']")[0]!;
    await act(async () => {
      trigger.dispatchEvent(
        new win.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {});
  }

  function serveTwoVideos() {
    viewData = {
      tag: "lofi",
      title: "#lofi",
      metaText: "7M videos",
      videos: [video("sF80I-TQiW0", "90's Chill Lofi"), video("BCxTQq0UiFs", "Chill Lofi Beats")],
      nextCursor: null,
    };
  }

  test("the ⋯ menu carries 'Don't recommend channel' directly AFTER 'Not interested' (the measured adjacency)", async () => {
    serveTwoVideos();
    await render(createElement(HashtagView, { tag: "lofi" }));
    await openFirstCardMenu();
    const items = menuItems();
    expect(items).toContain("Not interested");
    expect(items).toContain("Don't recommend channel");
    expect(items.indexOf("Don't recommend channel")).toBe(items.indexOf("Not interested") + 1);
  });

  test("Don't recommend channel → the real write, the card hides, the toast carries UNDO", async () => {
    serveTwoVideos();
    await render(createElement(HashtagView, { tag: "lofi" }));
    await openFirstCardMenu();
    const item = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === "Don't recommend channel")!;
    await act(async () => {
      item.click();
    });
    await act(async () => {});
    await act(async () => {});
    expect(postJsonLog).toContainEqual({ url: "/api/dont-recommend-channel", body: { videoId: "sF80I-TQiW0" } });
    // the first card left the feed; its sibling stays
    expect(host?.textContent ?? "").not.toContain("90's Chill Lofi");
    expect(host?.textContent ?? "").toContain("Chill Lofi Beats");
    const t = toasts.find((x) => x.text === "We won't recommend this channel anymore");
    expect(t).toBeDefined();
    expect(t?.action?.label).toBe("Undo");
  });

  test("the UNDO click drives the undo route and restores the card", async () => {
    serveTwoVideos();
    await render(createElement(HashtagView, { tag: "lofi" }));
    await openFirstCardMenu();
    const item = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === "Don't recommend channel")!;
    await act(async () => {
      item.click();
    });
    await act(async () => {});
    const undo = toasts.find((x) => x.text === "We won't recommend this channel anymore")?.action;
    expect(undo).toBeDefined();
    await act(async () => {
      undo!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(postJsonLog).toContainEqual({ url: "/api/dont-recommend-channel/undo", body: {} });
    expect(host?.textContent ?? "").toContain("90's Chill Lofi");
    expect(toasts.some((x) => x.text === "Recommendations restored")).toBe(true);
  });

  test("Not interested now carries the same UNDO family (the shared seam — youtube.com's one toast, one Undo button)", async () => {
    serveTwoVideos();
    await render(createElement(HashtagView, { tag: "lofi" }));
    await openFirstCardMenu();
    const item = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === "Not interested")!;
    await act(async () => {
      item.click();
    });
    await act(async () => {});
    await act(async () => {});
    expect(postJsonLog).toContainEqual({ url: "/api/not-interested", body: { videoId: "sF80I-TQiW0" } });
    expect(host?.textContent ?? "").not.toContain("90's Chill Lofi");
    const t = toasts.find((x) => x.text === "Video removed");
    expect(t?.action?.label).toBe("Undo");
    await act(async () => {
      t!.action!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(postJsonLog).toContainEqual({ url: "/api/not-interested/undo", body: {} });
    expect(host?.textContent ?? "").toContain("90's Chill Lofi");
  });

  test("an expired undo window surfaces the honest error — the card stays hidden, never a fake restoration", async () => {
    serveTwoVideos();
    postJsonHandler = (url) =>
      url.includes("/undo")
        ? Promise.reject(new Error("undo-toast-not-found"))
        : Promise.resolve({});
    await render(createElement(HashtagView, { tag: "lofi" }));
    await openFirstCardMenu();
    const item = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === "Don't recommend channel")!;
    await act(async () => {
      item.click();
    });
    await act(async () => {});
    const undo = toasts.find((x) => x.text === "We won't recommend this channel anymore")?.action;
    expect(undo).toBeDefined();
    await act(async () => {
      undo!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(postJsonLog).toContainEqual({ url: "/api/dont-recommend-channel/undo", body: {} });
    expect(
      toasts.some((x) => x.text === "error:Undo is no longer available — undo-toast-not-found"),
    ).toBe(true);
    expect(toasts.some((x) => x.text === "Recommendations restored")).toBe(false);
    expect(host?.textContent ?? "").not.toContain("90's Chill Lofi");
  });
});
