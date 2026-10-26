/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the UI battery (the house happy-dom idiom): the embed
 * player builds its URL from the documented params, the official postMessage
 * error protocol surfaces as an honest banner (1001 / 2001 / 3002), and the
 * hub renders loading → grid / degraded / empty states. No network anywhere
 * (lane law).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM (the netflix-ui setup) --------------------
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

// ---- module mocks (captured + swapped, the lane idiom) --------------------
let useApiData: unknown = null;
let useApiUrls: (string | null)[] = [];

mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    useApiUrls.push(url);
    return { data: useApiData, loading: false, error: null, reload: () => {} };
  },
  postJson: async () => ({}),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { TikTokEmbedPlayer } = await import("@/components/tiktok/tiktok-embed-player");
const { TikTokHubView } = await import("@/app/tiktok/view");
import type { TikTokRailDTO, TikTokVideoDTO } from "@/lib/tiktok/types";

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
  useApiUrls = [];
});

const all = (sel: string): HTMLElement[] =>
  Array.from(win.document.body.querySelectorAll(sel)) as unknown as HTMLElement[];

const DOCS_ID = "6718335390845095173";

function postPlayerMessage(type: string, value: unknown) {
  win.dispatchEvent(
    new win.MessageEvent("message", {
      source: null as unknown as Window,
      origin: "https://www.tiktok.com",
      data: { "x-tiktok-player": true, type, value },
    })
  );
}

function videoDTO(overrides: Partial<TikTokVideoDTO> = {}): TikTokVideoDTO {
  return {
    postId: DOCS_ID,
    author: "scout2015",
    authorUrl: "https://www.tiktok.com/@scout2015",
    title: "Baby cat being cute on the couch",
    thumbnailUrl: null,
    width: 325,
    height: 578,
    embedUrl: `https://www.tiktok.com/player/v1/${DOCS_ID}?music_info=1&description=1&rel=0&controls=1&timestamp=1&closed_caption=1`,
    deepLinkUrl: `https://www.tiktok.com/@scout2015/video/${DOCS_ID}`,
    source: "tiktok-oembed",
    unavailable: false,
    unavailableReason: null,
    ...overrides,
  };
}

describe("TikTokEmbedPlayer — the official Embed Player host", () => {
  test("builds the iframe from the documented params (never the remote html)", async () => {
    await render(createElement(TikTokEmbedPlayer, { postId: DOCS_ID }));
    const iframe = win.document.body.querySelector("iframe");
    expect(iframe).toBeTruthy();
    const src = iframe!.getAttribute("src");
    expect(src).toBe(
      `https://www.tiktok.com/player/v1/${DOCS_ID}?music_info=1&description=1&rel=0&controls=1&timestamp=1&closed_caption=1`
    );
    expect(iframe!.getAttribute("allow")).toContain("fullscreen");
    expect(iframe!.getAttribute("loading")).toBe("lazy");
  });

  test("an untagged message is ignored (the protocol law)", async () => {
    await render(createElement(TikTokEmbedPlayer, { postId: DOCS_ID }));
    win.dispatchEvent(
      new win.MessageEvent("message", { source: null as unknown as Window, origin: "https://evil.test", data: { type: "onPlayerError", value: { errorCode: 1001 } } })
    );
    await act(async () => {});
    expect(all('[data-testid="tiktok-player-error"]').length).toBe(0);
  });

  test("1001 INVALID_VIDEO surfaces as the honest banner", async () => {
    await render(createElement(TikTokEmbedPlayer, { postId: DOCS_ID }));
    await act(async () => {
      postPlayerMessage("onPlayerError", { errorCode: 1001, errorType: "INVALID_VIDEO" });
    });
    const banner = all('[data-testid="tiktok-player-error"]')[0];
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("can't be embedded");
    expect(banner!.textContent).toContain("1001");
  });

  test("2001 SERVER_ERROR and 3002 AUTOPLAY_ERROR map to their honest texts", async () => {
    await render(createElement(TikTokEmbedPlayer, { postId: DOCS_ID }));
    await act(async () => {
      postPlayerMessage("onPlayerError", { errorCode: 2001, errorType: "SERVER_ERROR" });
    });
    expect(all('[data-testid="tiktok-player-error"]')[0]!.textContent).toContain("TikTok's servers failed");
    await act(async () => {
      postPlayerMessage("onPlayerError", { errorCode: 3002, errorType: "AUTOPLAY_ERROR" });
    });
    expect(all('[data-testid="tiktok-player-error"]')[0]!.textContent).toContain("autoplay");
  });

  test("onPlayerReady clears the loading note", async () => {
    await render(createElement(TikTokEmbedPlayer, { postId: DOCS_ID }));
    expect(all('[data-testid="tiktok-player-loading"]').length).toBe(1);
    await act(async () => {
      postPlayerMessage("onPlayerReady", null);
    });
    expect(all('[data-testid="tiktok-player-loading"]').length).toBe(0);
  });
});

describe("the TikTok hub view", () => {
  test("fetches the rail and renders the grid with cards", async () => {
    useApiData = {
      videos: [videoDTO(), videoDTO({ postId: "2222222222222222222", author: null, title: null, unavailable: true, unavailableReason: "walled" })],
      universeSize: 2,
      source: "tiktok-oembed",
      unavailable: false,
      unavailableReason: null,
      fetchedAt: new Date().toISOString(),
    } satisfies TikTokRailDTO;
    await render(createElement(TikTokHubView));
    expect(useApiUrls).toContain("/api/tiktok/rail");
    expect(all('[data-testid="tiktok-card"]').length).toBe(2);
    expect(all('[data-testid="tiktok-hub-grid"]').length).toBe(1);
  });

  test("the all-walled rail renders the honest degraded notice", async () => {
    useApiData = {
      videos: [videoDTO({ unavailable: true, unavailableReason: "TikTok's metadata endpoint is unreachable…" })],
      universeSize: 1,
      source: "tiktok-curated",
      unavailable: true,
      unavailableReason: "TikTok's metadata endpoint is unreachable from this egress right now — the curated posts stay listed with their embed players intact.",
      fetchedAt: new Date().toISOString(),
    } satisfies TikTokRailDTO;
    await render(createElement(TikTokHubView));
    const notice = all('[data-testid="tiktok-hub-degraded"]')[0];
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain("unreachable");
  });

  test("the empty universe renders the honest curation hint", async () => {
    useApiData = {
      videos: [],
      universeSize: 0,
      source: "",
      unavailable: false,
      unavailableReason: null,
      fetchedAt: new Date().toISOString(),
    } satisfies TikTokRailDTO;
    await render(createElement(TikTokHubView));
    const empty = all('[data-testid="tiktok-hub-empty"]')[0];
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain("TIKTOK_CURATED_IDS");
  });
});
