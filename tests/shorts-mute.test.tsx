/// <reference types="bun-types" />
/**
 * P90 — the Shorts mute control battery: the shared preference store
 * (default muted, localStorage-persisted, broadcast to every mirror), the
 * ShortsMuteButton contract, the YouTube IFrame API command envelope (the
 * JSON-string form through the narrowest origin — the sendTikTokCommand
 * mirror), the YouTube slot's mount params (enablejsapi=1 + the
 * preference's mute value; a live flip NEVER reloads the iframe), and the
 * TikTok feed player's re-mount law (the documented force_muted param
 * flips — the Embed Player documents no mute command).
 *
 * happy-dom + createRoot/act (the tiktok-feed-player.test.tsx idiom).
 * No network anywhere (lane law) — the wall probe and the fallback ladder
 * are module-mocked, the oEmbed lane answers from stubs.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM -------------------------------------------
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
  "ResizeObserver",
  "MutationObserver",
] as const) {
  (globalThis as Record<string, unknown>)[key] = win[key as keyof typeof win];
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (BEFORE the modules under test load) ---------------------
const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as Record<string, unknown>).fetch = async () => new Response("{}", { status: 200 });
});
afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

mock.module("@/components/watch/youtube-player", () => ({
  probeEmbedHealth: async () => true,
}));
mock.module("@/components/player/player-fallback", () => ({
  PlayerFallback: () => null,
}));

const {
  getShortsMuted,
  sendYouTubePlayerCommand,
  setShortsMuted,
  ShortsMuteButton,
  subscribeShortsMuted,
} = await import("@/components/shorts/shorts-mute");
const { ShortsPlayerSlot } = await import("@/components/shorts/shorts-player-slot");
const { TikTokFeedPlayer } = await import("@/components/tiktok/tiktok-feed-player");
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
  // the store is file-global module state — every test re-arms its own state
  setShortsMuted(true);
  win.localStorage.removeItem("webflix:shorts:muted");
});

const q = (sel: string): HTMLElement | null =>
  win.document.body.querySelector(sel) as unknown as HTMLElement | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ---------------------------------------------------------------------------
describe("the shorts-mute store", () => {
  test("the default is MUTED (the autoplay law) and the flip persists", () => {
    expect(getShortsMuted()).toBe(true);
    setShortsMuted(false);
    expect(getShortsMuted()).toBe(false);
    expect(win.localStorage.getItem("webflix:shorts:muted")).toBe("0");
    setShortsMuted(true);
    expect(win.localStorage.getItem("webflix:shorts:muted")).toBe("1");
  });

  test("a subscription receives the CURRENT value async and every flip after", async () => {
    setShortsMuted(false);
    const seen: boolean[] = [];
    const unsubscribe = subscribeShortsMuted((m) => seen.push(m));
    await sleep(5); // the hydration microtask
    expect(seen).toEqual([false]);
    setShortsMuted(true);
    setShortsMuted(false);
    unsubscribe();
    setShortsMuted(true); // after unsubscribe — no delivery
    expect(seen).toEqual([false, true, false]);
  });
});

// ---------------------------------------------------------------------------
describe("sendYouTubePlayerCommand — the outbound protocol unit", () => {
  test("sends the IFrame API JSON envelope through the narrowest origin", () => {
    const sent: { message: unknown; origin: string }[] = [];
    const fake = {
      contentWindow: {
        postMessage: (message: unknown, origin: string) => sent.push({ message, origin }),
      },
    } as unknown as HTMLIFrameElement;
    expect(sendYouTubePlayerCommand(fake, "unMute")).toBe(true);
    expect(sendYouTubePlayerCommand(fake, "setVolume", [100])).toBe(true);
    expect(sendYouTubePlayerCommand(fake, "mute")).toBe(true);
    expect(sent).toHaveLength(3);
    expect(sent[0].origin).toBe("https://www.youtube.com");
    expect(JSON.parse(String(sent[0].message))).toEqual({
      event: "command",
      func: "unMute",
      args: [],
    });
    expect(JSON.parse(String(sent[1].message))).toEqual({
      event: "command",
      func: "setVolume",
      args: [100],
    });
    expect(JSON.parse(String(sent[2].message))).toEqual({
      event: "command",
      func: "mute",
      args: [],
    });
  });

  test("a missing/null contentWindow is honest (no command, no crash)", () => {
    expect(sendYouTubePlayerCommand(null, "mute")).toBe(false);
    expect(
      sendYouTubePlayerCommand({ contentWindow: null } as unknown as HTMLIFrameElement, "mute"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("ShortsMuteButton — the shared control", () => {
  test("renders the muted state and the click flips the shared store", async () => {
    setShortsMuted(true);
    await render(createElement(ShortsMuteButton, null));
    const button = q('[data-testid="shorts-mute-button"]') as HTMLButtonElement;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Unmute");
    await act(() => {
      button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    expect(getShortsMuted()).toBe(false);
    expect(win.localStorage.getItem("webflix:shorts:muted")).toBe("0");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Mute");
  });

  test("two mounted mirrors stay in lockstep (the store broadcast)", async () => {
    setShortsMuted(true);
    await render(
      createElement(
        "div",
        null,
        createElement(ShortsMuteButton, { key: "a" }),
        createElement(ShortsMuteButton, { key: "b" }),
      ),
    );
    const buttons = win.document.body.querySelectorAll('[data-testid="shorts-mute-button"]');
    expect(buttons).toHaveLength(2);
    await act(() => {
      (buttons[0] as HTMLElement).dispatchEvent(
        new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
      );
    });
    expect((buttons[1] as HTMLElement).getAttribute("aria-pressed")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
describe("ShortsPlayerSlot — the YouTube mute transport", () => {
  test("the embed mounts with enablejsapi and the preference's mute value", async () => {
    setShortsMuted(true);
    await render(
      createElement(ShortsPlayerSlot, { videoId: "SHORTMUTE01", active: true, posterUrl: null }),
    );
    let src = q("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("youtube.com/embed/SHORTMUTE01");
    expect(src).toContain("enablejsapi=1");
    expect(src).toContain("mute=1");

    // a FRESH mount with the stored unmuted preference starts unmuted
    await act(async () => root!.unmount());
    setShortsMuted(false);
    await render(
      createElement(ShortsPlayerSlot, { videoId: "SHORTMUTE02", active: true, posterUrl: null }),
    );
    src = q("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("enablejsapi=1");
    expect(src).toContain("mute=0");
  });

  test("a live flip NEVER reloads the iframe (the src is frozen at mount)", async () => {
    setShortsMuted(true);
    await render(
      createElement(ShortsPlayerSlot, { videoId: "SHORTMUTE03", active: true, posterUrl: null }),
    );
    const iframe = q("iframe") as unknown as HTMLIFrameElement;
    const srcAtMount = iframe.getAttribute("src");
    // the flip posts the live commands (into the happy-dom iframe window —
    // a no-op sink) and must not change the src attribute
    await act(() => {
      setShortsMuted(false);
    });
    await act(async () => {
      await sleep(5);
    });
    expect(q("iframe")).toBe(iframe); // same element — no remount, no reload
    expect(iframe.getAttribute("src")).toBe(srcAtMount);
    expect(iframe.getAttribute("src")).toContain("mute=1");
  });
});

// ---------------------------------------------------------------------------
describe("TikTokFeedPlayer — the P90 re-mount mute law", () => {
  test("the feed embed mounts force_muted and a flip RE-MOUNTS with the param flipped", async () => {
    setShortsMuted(true);
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    const first = q("iframe") as unknown as HTMLIFrameElement;
    expect(first.getAttribute("src")).toContain("force_muted=1");

    await act(() => {
      setShortsMuted(false);
    });
    await act(async () => {
      await sleep(10);
    });
    const second = q("iframe") as unknown as HTMLIFrameElement;
    expect(second).not.toBe(first); // the documented re-mount (no mute command exists)
    expect(second.getAttribute("src")).not.toContain("force_muted=1");
    expect(second.getAttribute("src")).toContain("autoplay=1");
    // the boot cover stands again (the reset identity is (post, muted))
    expect(q('[data-testid="tiktok-feed-starting"]')).toBeTruthy();

    await act(() => {
      setShortsMuted(true);
    });
    await act(async () => {
      await sleep(10);
    });
    const third = q("iframe") as unknown as HTMLIFrameElement;
    expect(third).not.toBe(second);
    expect(third.getAttribute("src")).toContain("force_muted=1");
  });

  test("an unmuted preference mounts the feed embed WITHOUT force_muted", async () => {
    setShortsMuted(false);
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    await rerender(createElement(TikTokFeedPlayer, { item: itemDTO(), active: true }));
    const src = q("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain(`https://www.tiktok.com/player/v1/${POST_ID}`);
    expect(src).not.toContain("force_muted=1");
  });

  test("an inactive slide mounts no iframe regardless of the preference", async () => {
    setShortsMuted(false);
    await render(createElement(TikTokFeedPlayer, { item: itemDTO(), active: false }));
    expect(q("iframe")).toBeNull();
  });
});
