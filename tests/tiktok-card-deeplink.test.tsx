/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M3 — the deep-link pass battery: every
 * TikTok card (and the search shelf's Browse header) opens the shared
 * Shorts experience at the canonical href — the card law
 * (`/shorts?source=tiktok&post=<id>`), the shelf Browse law
 * (`/shorts?source=tiktok`), and the outbound TikTok link staying
 * user-initiated only. No network anywhere (lane law).
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

const { TikTokCard } = await import("@/components/tiktok/tiktok-card");
const { TikTokSearchShelf } = await import("@/components/search/tiktok-search-shelf");
import type { TikTokSearchResultsDTO } from "@/lib/tiktok/types";

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

const cardItem = (postId: string) => ({
  postId,
  author: "scout2015",
  authorUrl: "https://www.tiktok.com/@scout2015",
  title: `Post ${postId} caption`,
  thumbnailUrl: null,
  width: null,
  height: null,
  embedUrl: `https://www.tiktok.com/player/v1/${postId}`,
  deepLinkUrl: `https://www.tiktok.com/@scout2015/video/${postId}`,
  source: "tiktok-oembed" as const,
  unavailable: false,
  unavailableReason: null,
});

describe("TikTokCard — the M3 deep-link law", () => {
  test("the card opens the shared Shorts feed AT the post (no legacy hop)", async () => {
    await render(createElement(TikTokCard, { video: cardItem(ID_A) }));
    const link = q('[data-testid="tiktok-card"] a');
    expect(link?.getAttribute("href")).toBe(`/shorts?source=tiktok&post=${ID_A}`);
  });

  test("the outbound TikTok link stays user-initiated and honest", async () => {
    await render(createElement(TikTokCard, { video: cardItem(ID_A) }));
    const links = all('[data-testid="tiktok-card"] a');
    const outbound = links.find((a) => a.getAttribute("aria-label") === "Open on TikTok");
    expect(outbound?.getAttribute("href")).toBe(cardItem(ID_A).deepLinkUrl);
    expect(outbound?.getAttribute("target")).toBe("_blank");
    expect(outbound?.getAttribute("rel")).toContain("noopener");
  });
});

describe("TikTokSearchShelf — the M3 Browse law", () => {
  test("the Browse header opens the TikTok source in the shared feed", async () => {
    useApiData = {
      q: "scout",
      videos: [cardItem(ID_A)],
      universeSize: 1,
      source: "tiktok-oembed",
      note: null,
    } as unknown as TikTokSearchResultsDTO;
    await render(createElement(TikTokSearchShelf, { q: "scout" }));
    const browse = Array.from(
      win.document.body.querySelectorAll("a") as unknown as HTMLAnchorElement[],
    ).find((a) => (a.textContent ?? "").includes("Browse"));
    expect(browse?.getAttribute("href")).toBe("/shorts?source=tiktok");
  });

  test("no matches render nothing (the honest absence)", async () => {
    useApiData = {
      q: "nothing",
      videos: [],
      universeSize: 0,
      source: "tiktok-oembed",
      note: null,
    } as unknown as TikTokSearchResultsDTO;
    await render(createElement(TikTokSearchShelf, { q: "nothing" }));
    expect(q('[data-testid="tiktok-search-shelf"]')).toBeNull();
  });
});

// ---- P88 — the client preview lane ------------------------------------------

const sleepP88 = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TikTokCard — the P88 client preview lane", () => {
  test("a server-walled lane hydrates the official oEmbed thumbnail client-side", async () => {
    const realIO = (globalThis as Record<string, unknown>).IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
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
    (globalThis as Record<string, unknown>).fetch = (async () =>
      new Response(
        JSON.stringify({
          embed_product_id: ID_A,
          thumbnail_url: "https://cdn.tiktok.example/card-thumb.jpg",
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    // title present, thumbnail walled → hydration fills ONLY the thumbnail
    await render(createElement(TikTokCard, { video: cardItem(ID_A) }));
    await act(async () => {
      await sleepP88(20);
    });
    const img = q('[data-testid="tiktok-card-thumb"]') as unknown as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("https://cdn.tiktok.example/card-thumb.jpg");
    // R5 — the card's thumbnail requests no-referrer (the single img law)
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    // R8 — the hydration warmed the origin (both connection kinds, once)
    expect(
      win.document.head.querySelectorAll(
        'link[rel="preconnect"][href="https://www.tiktok.com"]'
      ).length
    ).toBe(2);
    (globalThis as Record<string, unknown>).IntersectionObserver = realIO;
  });

  test("an expired signed URL errors into the honest minimal card (R6)", async () => {
    const realIO = (globalThis as Record<string, unknown>).IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
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
    const R6_ID = "7301567890123456789";
    (globalThis as Record<string, unknown>).fetch = (async () =>
      new Response(
        JSON.stringify({
          embed_product_id: R6_ID,
          thumbnail_url: "https://cdn.tiktok.example/expired-card.jpg",
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    await render(createElement(TikTokCard, { video: cardItem(R6_ID) }));
    await act(async () => {
      await sleepP88(20);
    });
    const img = q('[data-testid="tiktok-card-thumb"]') as unknown as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("https://cdn.tiktok.example/expired-card.jpg");
    await act(() => {
      img!.dispatchEvent(new win.Event("error", { bubbles: true }) as unknown as Event);
    });
    // the honest minimal card replaces the broken image (id + embed handoff)
    expect(q('[data-testid="tiktok-card-thumb"]')).toBeNull();
    expect(q('[data-testid="tiktok-card"]')?.textContent).toContain("TikTok");
    (globalThis as Record<string, unknown>).IntersectionObserver = realIO;
  });

  test("hover past the dwell mounts the official player; leave unmounts it", async () => {
    const winObj = win as unknown as Record<string, unknown>;
    const realMM = winObj.matchMedia;
    winObj.matchMedia = (query: string) => ({
      matches: !query.includes("coarse"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    await render(createElement(TikTokCard, { video: cardItem(ID_A) }));
    const card = q('[data-testid="tiktok-card"]')!;
    await act(() => {
      card.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleepP88(600); // past the dwell
    });
    const iframe = q('iframe[data-testid="tiktok-card-preview"]') as unknown as
      | HTMLIFrameElement
      | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src") ?? "").toContain("force_muted=1");
    expect(iframe!.getAttribute("src") ?? "").toContain("autoplay=1");
    await act(() => {
      card.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
    });
    expect(q('[data-testid="tiktok-card-preview"]')).toBeNull();
    winObj.matchMedia = realMM;
  });
});
