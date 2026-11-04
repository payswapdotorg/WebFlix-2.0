/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M1 — the feed player battery (the house
 * happy-dom idiom): the active-slide mount law, the documented embed params
 * (autoplay=1 & force_muted=1 — the 2026-10-28 docs name), the inbound
 * origin+source validation law, the honest error/timeout/autoplay-denied
 * surfaces, the one-shot telemetry, and the pause-then-unmount command law.
 * No network anywhere (lane law) — telemetry is captured by the fetch stub.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- the fetch stub (the lane law: NO network from tests) -----------------
const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls.length = 0;
  (globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  };
});
afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

// ---- happy-dom as the global DOM (the tiktok-ui setup) --------------------
const dom = await import("happy-dom");
const win = new dom.Window({ url: "http://localhost:3000" }) as unknown as typeof globalThis;
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLIFrameElement",
  "Element",
  "Node",
  "navigator",
  "CustomEvent",
  "MessageEvent",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IntersectionObserver",
  "MutationObserver",
] as const) {
  (globalThis as Record<string, unknown>)[key] = win[key as keyof typeof win];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { TikTokFeedPlayer, sendTikTokCommand, TIKTOK_PAUSE_THEN_UNMOUNT_MS } = await import(
  "@/components/tiktok/tiktok-feed-player"
);
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

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

async function rerender(node: ReactElement) {
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
});

const q = (sel: string): HTMLElement | null =>
  win.document.body.querySelector(sel) as unknown as HTMLElement | null;

const all = (sel: string): HTMLElement[] =>
  Array.from(win.document.body.querySelectorAll(sel)) as unknown as HTMLElement[];

const POST_ID = "6718335390845095173";

function itemDTO(overrides: Partial<TikTokVideoDTO> = {}): TikTokVideoDTO {
  return {
    postId: POST_ID,
    author: "scout2015",
    authorUrl: "https://www.tiktok.com/@scout2015",
    title: "Baby cat being cute on the couch",
    thumbnailUrl: "https://p16-sign-va.tiktokcdn.com/img.jpg",
    width: 325,
    height: 578,
    embedUrl: `https://www.tiktok.com/player/v1/${POST_ID}`,
    deepLinkUrl: `https://www.tiktok.com/@scout2015/video/${POST_ID}`,
    source: "tiktok-oembed",
    unavailable: false,
    unavailableReason: null,
    ...overrides,
  };
}

/** Dispatch a player→host message. The default source is the mounted
 * iframe's own contentWindow (the acceptance path — exactly what a real
 * browser delivers); overrides exercise the rejection paths. */
function playerMessage(opts: {
  type: string;
  value?: unknown;
  origin?: string;
  source?: unknown;
  tagged?: boolean;
}) {
  const iframe = win.document.body.querySelector("iframe") as unknown as
    | { contentWindow: unknown }
    | null;
  win.dispatchEvent(
    new win.MessageEvent("message", {
      source: (opts.source ?? iframe?.contentWindow ?? null) as unknown as Window,
      origin: opts.origin ?? "https://www.tiktok.com",
      data: opts.tagged === false
        ? { type: opts.type, value: opts.value }
        : { "x-tiktok-player": true, type: opts.type, value: opts.value },
    })
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
describe("sendTikTokCommand — the outbound protocol unit", () => {
  test("sends the tagged envelope through the narrowest targetOrigin", () => {
    const sent: { message: unknown; origin: string }[] = [];
    const fake = {
      contentWindow: {
        postMessage: (message: unknown, origin: string) => sent.push({ message, origin }),
      },
    } as unknown as HTMLIFrameElement;
    expect(sendTikTokCommand(fake, "play")).toBe(true);
    expect(sendTikTokCommand(fake, "pause")).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      message: { "x-tiktok-player": true, type: "play" },
      origin: "https://www.tiktok.com",
    });
    expect(sent[1].message).toEqual({ "x-tiktok-player": true, type: "pause" });
  });

  test("a missing/null contentWindow is honest (no command, no crash)", () => {
    expect(sendTikTokCommand(null, "pause")).toBe(false);
    expect(
      sendTikTokCommand({ contentWindow: null } as unknown as HTMLIFrameElement, "pause"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("TikTokFeedPlayer — the active-slide mount law", () => {
  test("an inactive slide mounts NO iframe", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: false }));
    expect(all("iframe")).toHaveLength(0);
    expect(q('[data-testid="tiktok-feed-player"]')?.getAttribute("data-active")).toBe("false");
  });

  test("the active slide mounts the official embed with the documented feed params", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    const iframe = q("iframe");
    expect(iframe).toBeTruthy();
    const src = iframe!.getAttribute("src") ?? "";
    expect(src).toContain(`https://www.tiktok.com/player/v1/${POST_ID}`);
    expect(src).toContain("autoplay=1");
    expect(src).toContain("force_muted=1");
    expect(src).toContain("loop=1");
    // attribution rides (ADR 0004)
    expect(src).toContain("music_info=1");
    expect(src).toContain("description=1");
    expect(src).toContain("rel=0");
    // the retired pre-2026-10-28 name never surfaces
    expect(src).not.toContain("muted=1&");
    // the pending cover stands until the player proves ready
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();
  });

  test("pause-then-unmount: deactivation sends the pause beat, then the iframe leaves", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    expect(q("iframe")).toBeTruthy();
    // deactivation → the pause command rides out through the living iframe
    // (spy on the CrossOriginBrowserWindow's postMessage) → the unmount beat
    const iframeEl = q("iframe") as unknown as { contentWindow: { postMessage: (m: unknown, o: string) => void } | null } | null;
    const sent: { m: unknown; o: string }[] = [];
    if (iframeEl?.contentWindow) {
      iframeEl.contentWindow.postMessage = (m: unknown, o: string) => sent.push({ m, o });
    }
    await rerender(createElement(TikTokFeedPlayer, { item: itemDTO(), active: false }));
    // the command law: the tagged pause through the narrowest origin
    expect(sent).toEqual([{ m: { "x-tiktok-player": true, type: "pause" }, o: "https://www.tiktok.com" }]);
    // ...and then the unmount beat lands (the guarantee)
    await sleep(TIKTOK_PAUSE_THEN_UNMOUNT_MS + 120);
    expect(q("iframe")).toBeNull();
    expect(TIKTOK_PAUSE_THEN_UNMOUNT_MS).toBeGreaterThan(0);
  });

  test("no fabricated media: a metadata-less post renders the bare black stage", async () => {
    await render(
      createElement(TikTokFeedPlayer, {
        item: itemDTO({ thumbnailUrl: null, title: null, author: null }),
        active: false,
      }),
    );
    expect(all("img")).toHaveLength(0);
  });

  test("P89 R7: a server-walled DTO hydrates the poster through the client oEmbed lane", async () => {
    try {
      win.sessionStorage.clear();
    } catch {
      /* storage-less environments hydrate without the cache */
    }
    const R7_ID = "7410258934671205893";
    (globalThis as Record<string, unknown>).fetch = (async () =>
      new Response(
        JSON.stringify({
          embed_product_id: R7_ID,
          thumbnail_url: "https://cdn.tiktok.example/poster-hydrated.jpg",
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    await render(
      createElement(TikTokFeedPlayer, {
        item: itemDTO({ postId: R7_ID, thumbnailUrl: null, title: null, author: null }),
        active: true, // the active slide hydrates without waiting on the IO gate
      }),
    );
    await act(async () => {
      await sleep(20);
    });
    // the under-layer poster AND the starting cover both carry the hydrated
    // official thumbnail (the YouTube slides' posterUrl parity)
    const posters = all('img[src="https://cdn.tiktok.example/poster-hydrated.jpg"]');
    expect(posters.length).toBe(2);
    // R5 — the same single-img law: no-referrer requests
    expect(posters[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
    // the caption law is untouched: hydration does NOT fabricate attribution
    expect(all('[data-testid="tiktok-shorts-caption"]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("TikTokFeedPlayer — the inbound protocol law", () => {
  test("onPlayerReady from the TikTok origin clears the pending cover", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();
    await act(async () => {
      playerMessage({ type: "onPlayerReady", value: {} });
    });
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeNull();
  });

  test("a wrong-origin message is ignored (the cover stands)", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({ type: "onPlayerReady", value: {}, origin: "https://evil.example" });
    });
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();
  });

  test("a wrong-source message is ignored (the origin AND source law)", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({ type: "onPlayerReady", value: {}, source: {} });
    });
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();
  });

  test("an untagged message is ignored", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({ type: "onPlayerReady", value: {}, tagged: false });
    });
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();
  });

  test("a 1001 INVALID_VIDEO error renders the honest banner + one-shot telemetry", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({
        type: "onPlayerError",
        value: { errorCode: 1001, errorType: "INVALID_VIDEO" },
      });
    });
    const banner = q('[data-testid="tiktok-feed-player-error"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("can't be embedded");
    expect(banner!.textContent).toContain("Open on TikTok");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/tiktok/player-events");
    const body = JSON.parse(String(fetchCalls[0].init?.body));
    expect(body).toEqual({ postId: POST_ID, code: 1001, type: "INVALID_VIDEO" });

    // duplicate error → still exactly one telemetry report (the StrictMode law)
    await act(async () => {
      playerMessage({
        type: "onPlayerError",
        value: { errorCode: 1001, errorType: "INVALID_VIDEO" },
      });
    });
    expect(fetchCalls).toHaveLength(1);
  });

  test("a 3002 AUTOPLAY_ERROR shows the explicit tap-to-play recovery", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({
        type: "onPlayerError",
        value: { errorCode: 3002, errorType: "AUTOPLAY_ERROR" },
      });
    });
    const overlay = q('[data-testid="tiktok-feed-autoplay-blocked"]');
    expect(overlay).toBeTruthy();
    // the tap IS the user gesture — the overlay clears (the command path is
    // unit-covered; happy-dom's null contentWindow makes it an honest no-op)
    await act(async () => {
      (overlay as unknown as HTMLButtonElement).click();
    });
    expect(q('[data-testid="tiktok-feed-autoplay-blocked"]')).toBeNull();
  });

  test("onStateChange playing clears the autoplay-denied overlay (self-recovery)", async () => {
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await act(async () => {
      playerMessage({ type: "onPlayerError", value: { errorCode: 3002, errorType: "AUTOPLAY_ERROR" } });
    });
    expect(q('[data-testid="tiktok-feed-autoplay-blocked"]')).toBeTruthy();
    await act(async () => {
      playerMessage({ type: "onStateChange", value: { state: 1 } });
    });
    expect(q('[data-testid="tiktok-feed-autoplay-blocked"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("TikTokFeedPlayer — the readiness guard (the P59-R4 law, feed-mounted)", () => {
  test("a silent player flips the honest timeout banner with the outbound link", async () => {
    await render(
      createElement(TikTokFeedPlayer, { item: itemDTO(), active: true, readyTimeoutMs: 20 }),
    );
    await sleep(60);
    const banner = q('[data-testid="tiktok-feed-player-timeout"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("didn't load");
    const link = banner!.querySelector('a[data-testid="tiktok-feed-player-timeout-link"]') as unknown as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe(itemDTO().deepLinkUrl);
    const timeoutCall = fetchCalls.find((c) => {
      const body = JSON.parse(String(c.init?.body));
      return body.type === "READINESS_TIMEOUT";
    });
    expect(timeoutCall).toBeTruthy();
  });

  test("a late onPlayerReady clears the timeout banner", async () => {
    await render(
      createElement(TikTokFeedPlayer, { item: itemDTO(), active: true, readyTimeoutMs: 20 }),
    );
    await sleep(60);
    expect(q('[data-testid="tiktok-feed-player-timeout"]')).toBeTruthy();
    await act(async () => {
      playerMessage({ type: "onPlayerReady", value: {} });
    });
    expect(q('[data-testid="tiktok-feed-player-timeout"]')).toBeNull();
  });
});
