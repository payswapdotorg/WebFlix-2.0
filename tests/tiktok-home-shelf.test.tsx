/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M3 — the home TikTok shelf battery: the
 * shelf renders the rail universe near the home Shorts shelf, every tile
 * deep-links the shared feed at its post, honest metadata-less tiles never
 * fabricate identity, and the graceful-hide law (loading / error / empty
 * render NOTHING). No network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as Record<string, unknown>).fetch = async () => new Response("{}", { status: 200 });
});
afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

const dom = await import("happy-dom");
const win = new dom.Window({ url: "http://localhost:3000" }) as unknown as typeof globalThis;
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "navigator",
  "CustomEvent",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
] as const) {
  (globalThis as Record<string, unknown>)[key] = win[key as keyof typeof win];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (the lane idiom) -----------------------------------------
let useApiData: unknown = null;
let useApiError: string | null = null;

mock.module("@/hooks/use-api", () => ({
  useApi: () => ({ data: useApiData, loading: false, error: useApiError, reload: () => {} }),
  postJson: async () => ({}),
}));

mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { TikTokShelf } = await import("@/components/home/tiktok-shelf");
import type { TikTokRailDTO } from "@/lib/tiktok/types";

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

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  useApiData = null;
  useApiError = null;
});

const q = (sel: string): HTMLElement | null =>
  win.document.body.querySelector(sel) as unknown as HTMLElement | null;
const all = (sel: string): HTMLElement[] =>
  Array.from(win.document.body.querySelectorAll(sel)) as unknown as HTMLElement[];

const ID_A = "6718335390845095173";
const ID_B = "7206561191609716014";

function railItem(postId: string, overrides: Record<string, unknown> = {}) {
  return {
    postId,
    author: "scout2015",
    authorUrl: "https://www.tiktok.com/@scout2015",
    title: `Post ${postId} caption`,
    thumbnailUrl: null,
    width: null,
    height: null,
    embedUrl: `https://www.tiktok.com/player/v1/${postId}`,
    deepLinkUrl: `https://www.tiktok.com/@scout2015/video/${postId}`,
    source: "tiktok-oembed",
    unavailable: false,
    unavailableReason: null,
    ...overrides,
  };
}

function rail(videos: unknown[]): TikTokRailDTO {
  return {
    videos,
    universeSize: videos.length,
    source: "tiktok-oembed",
    unavailable: false,
    unavailableReason: null,
    fetchedAt: new Date().toISOString(),
  } as unknown as TikTokRailDTO;
}

describe("TikTokShelf — the M3 home shelf", () => {
  test("renders the rail universe with the honest scope subtitle", async () => {
    useApiData = rail([railItem(ID_A), railItem(ID_B)]);
    await render(createElement(TikTokShelf, null));
    const shelf = q('[data-testid="tiktok-home-shelf"]');
    expect(shelf?.getAttribute("aria-label")).toBe("TikTok shelf");
    // the not-a-recommender law: the subtitle names the actual scope
    expect(shelf?.textContent).toContain("curated and community-imported posts");
    expect(all('[data-testid="tiktok-home-tile"]')).toHaveLength(2);
  });

  test("every tile deep-links the shared feed AT its post", async () => {
    useApiData = rail([railItem(ID_A)]);
    await render(createElement(TikTokShelf, null));
    const tile = q('[data-testid="tiktok-home-tile"]') as unknown as HTMLAnchorElement;
    expect(tile.getAttribute("href")).toBe(`/shorts?source=tiktok&post=${ID_A}`);
  });

  test("a metadata-less post renders the honest fallback — never a fabricated identity", async () => {
    useApiData = rail([
      railItem(ID_B, { author: null, authorUrl: null, title: null, thumbnailUrl: null }),
    ]);
    await render(createElement(TikTokShelf, null));
    const shelf = q('[data-testid="tiktok-home-shelf"]');
    expect(shelf?.textContent).not.toContain("@scout2015");
    expect(shelf?.textContent).not.toContain(`Post ${ID_B}`);
    // the fallback tile names the source honestly
    expect(shelf?.textContent).toContain("TikTok");
  });

  test("the graceful-hide law: empty, error and no-data render NOTHING", async () => {
    useApiData = rail([]);
    await render(createElement(TikTokShelf, null));
    expect(q('[data-testid="tiktok-home-shelf"]')).toBeNull();

    useApiData = null;
    useApiError = "HTTP 502";
    await render(createElement(TikTokShelf, null));
    expect(q('[data-testid="tiktok-home-shelf"]')).toBeNull();
  });
});

// ---- P88 — the client preview lane (thumbnails + hover-play) ----------------

const ID_C = "7157587293451062574";
const ID_D = "7322301313134415134";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An IO stub that reports the intersection synchronously on observe(). */
function intersectingIO(): unknown {
  return class {
    private cb: (entries: Array<{ isIntersecting: boolean }>) => void;
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.cb = cb;
    }
    observe() {
      this.cb([{ isIntersecting: true }]);
    }
    disconnect() {}
    unobserve() {}
  };
}

function setFinePointer(winObj: unknown, fine: boolean): () => void {
  const real = (winObj as Record<string, unknown>).matchMedia;
  (winObj as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: fine ? !query.includes("coarse") : query.includes("coarse"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  return () => {
    (winObj as Record<string, unknown>).matchMedia = real;
  };
}

describe("TikTokShelf — the P88 client preview lane", () => {
  beforeEach(() => {
    try {
      win.sessionStorage.clear();
    } catch {
      /* storage-less environments hydrate without the cache */
    }
  });

  test("a server-walled lane hydrates the official oEmbed thumbnail client-side", async () => {
    const realIO = (globalThis as Record<string, unknown>).IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = intersectingIO();
    const requested: string[] = [];
    (globalThis as Record<string, unknown>).fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(
        JSON.stringify({
          embed_product_id: ID_A,
          thumbnail_url: "https://cdn.tiktok.example/thumb-A.jpg",
          title: "A real caption",
          author_name: "scout2015",
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    useApiData = rail([railItem(ID_A, { thumbnailUrl: null, title: null, author: null })]);
    await render(createElement(TikTokShelf, null));
    await act(async () => {
      await sleep(20);
    });
    const img = q('[data-testid="tiktok-tile-thumb"]') as unknown as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("https://cdn.tiktok.example/thumb-A.jpg");
    // the hydration fills the caption + author too (official oEmbed fields)
    const shelf = q('[data-testid="tiktok-home-shelf"]');
    expect(shelf?.textContent).toContain("A real caption");
    expect(shelf?.textContent).toContain("@scout2015");
    // the URL law: the request is built through lib/tiktok/urls.ts — the
    // same player-shape target the server lane uses when the author is null
    expect(requested[0]?.startsWith("https://www.tiktok.com/oembed?url=")).toBe(true);
    expect(requested[0]).toContain(
      encodeURIComponent(`https://www.tiktok.com/player/v1/${ID_A}`)
    );
    (globalThis as Record<string, unknown>).IntersectionObserver = realIO;
  });

  test("a foreign embed_product_id is honest absence — the fallback tile stays", async () => {
    const realIO = (globalThis as Record<string, unknown>).IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = intersectingIO();
    (globalThis as Record<string, unknown>).fetch = (async () =>
      new Response(JSON.stringify({ embed_product_id: "9999999999999999999" }), {
        status: 200,
      })) as unknown as typeof fetch;
    useApiData = rail([railItem(ID_C, { thumbnailUrl: null, title: null, author: null })]);
    await render(createElement(TikTokShelf, null));
    await act(async () => {
      await sleep(20);
    });
    expect(q('[data-testid="tiktok-tile-thumb"]')).toBeNull();
    // the fallback names the source honestly — never a fabricated identity
    expect(q('[data-testid="tiktok-home-shelf"]')?.textContent).toContain("TikTok");
    (globalThis as Record<string, unknown>).IntersectionObserver = realIO;
  });

  test("hover past the dwell mounts the official muted-autoplay player; leave unmounts it", async () => {
    const restore = setFinePointer(win, true);
    useApiData = rail([railItem(ID_B)]);
    await render(createElement(TikTokShelf, null));
    const tile = q('[data-testid="tiktok-home-tile"]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(250); // inside the 450ms dwell — no preview yet
    });
    expect(q('[data-testid="tiktok-tile-preview"]')).toBeNull();
    await act(async () => {
      await sleep(400); // past the dwell
    });
    const iframe = q('iframe[data-testid="tiktok-tile-preview"]') as unknown as
      | HTMLIFrameElement
      | null;
    expect(iframe).not.toBeNull();
    const src = iframe!.getAttribute("src") ?? "";
    expect(src.startsWith(`https://www.tiktok.com/player/v1/${ID_B}`)).toBe(true);
    expect(src).toContain("autoplay=1");
    expect(src).toContain("force_muted=1");
    expect(src).toContain("loop=1");
    expect(src).toContain("music_info=0");
    expect(src).toContain("rel=0");
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
    });
    expect(q('[data-testid="tiktok-tile-preview"]')).toBeNull();
    // the static face returns after the preview unmounts
    expect(q('[data-testid="tiktok-home-tile"]')?.textContent).toContain("TikTok");
    restore();
  });

  test("leaving before the dwell cancels the preview", async () => {
    const restore = setFinePointer(win, true);
    useApiData = rail([railItem(ID_D)]);
    await render(createElement(TikTokShelf, null));
    const tile = q('[data-testid="tiktok-home-tile"]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(200);
    });
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(500); // past the dwell — the cancelled timer never fires
    });
    expect(q('[data-testid="tiktok-tile-preview"]')).toBeNull();
    restore();
  });

  test("coarse pointers never preview (hover does not exist there)", async () => {
    const restore = setFinePointer(win, false);
    useApiData = rail([railItem(ID_B)]);
    await render(createElement(TikTokShelf, null));
    const tile = q('[data-testid="tiktok-home-tile"]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(600); // past the dwell
    });
    expect(q('[data-testid="tiktok-tile-preview"]')).toBeNull();
    restore();
  });
});
