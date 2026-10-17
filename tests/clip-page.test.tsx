/// <reference types="bun-types" />
/**
 * WFX2-P23-A tests — the /clip/[id] view (youtube.com's measured clip
 * page: the ranged player cued to [start, end) + the loopCommand loop +
 * the attribution panel + "Watch full video" / "Share clip" + the honest
 * error families). happy-dom + createRoot/act (the comment-composer
 * pattern) with a stubbed fetch and the REAL player host manager (its
 * progress fan-out drives the loop; a mocked handle receives the seeks).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeList",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
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

// ---- stubs: sonner + fetch (the view's /api/clip read) ----
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const fetched: { url: string }[] = [];
let clipResponse: Record<string, unknown> = { status: 404, error: "Clip not found" };
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  fetched.push({ url: u });
  const status = typeof clipResponse.status === "number" ? clipResponse.status : 200;
  return new Response(JSON.stringify(clipResponse), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

const { ClipPageView } = await import("@/app/clip/[id]/view");
const { playerHost, resetPlayerHostForTests } = await import("@/lib/player/player-host");

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qa = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

/** The seek spy handle the host delegates to. */
const seeks: number[] = [];
let attachCalls: { videoId: string; startSec?: number | null }[] = [];

beforeEach(() => {
  resetPlayerHostForTests();
  seeks.length = 0;
  attachCalls = [];
  const realAttach = playerHost.attach.bind(playerHost);
  playerHost.attach = ((video: { videoId: string; startSec?: number | null }) => {
    attachCalls.push({ videoId: video.videoId, startSec: video.startSec ?? null });
    return realAttach(video);
  }) as typeof playerHost.attach;
  playerHost.handleRef.current = {
    play: () => {},
    pause: () => {},
    togglePlay: () => {},
    seekTo: (sec: number) => seeks.push(sec),
    getCurrentTime: () => 0,
    getDuration: () => 0,
    getStats: () => null,
  };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
});

async function render(clipId: string) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<ClipPageView clipId={clipId} />);
  });
}

const WEBFLIX_CLIP = {
  source: "webflix",
  clipId: "cltestclip000000001",
  videoId: "Jlpy8KtoXOUB",
  startSec: 464,
  endSec: 471,
  title: "payment",
  clipAuthor: "Demo User",
  clipAuthorAvatarUrl: null,
  createdText: "2 days ago",
  videoTitle: "Game Collecting - Scott The Woz",
  channelName: "Scott The Woz",
  channelHandle: "@ScottTheWoz",
  channelAvatarUrl: null,
};

describe("the clip page — the resolved state (youtube.com's measured layout)", () => {
  test("the h1 is the SOURCE video's title; the panel carries the clip's own metadata", async () => {
    clipResponse = { ...WEBFLIX_CLIP };
    await render(WEBFLIX_CLIP.clipId);
    // the measured page shape: h1 = the source video title
    const h1 = host!.querySelector("h1");
    expect(h1?.textContent).toBe("Game Collecting - Scott The Woz");
    // the attribution panel: author, age, clip title
    expect(q('[data-testid="clip-title"]')?.textContent).toBe("payment");
    expect(host!.textContent).toContain("Demo User");
    expect(host!.textContent).toContain("2 days ago");
    // the footer buttons
    const full = q('a[href="/watch/Jlpy8KtoXOUB"]');
    expect(full?.textContent).toContain("Watch full video");
    const share = qa("button").find((b) => /Share clip/.test(b.textContent ?? ""));
    expect(share).toBeTruthy();
    // the honest local note (never a YouTube claim)
    expect(q('[data-testid="clip-local-note"]')?.textContent).toContain("WebFlix clip");
  });

  test("the player is taken over at the clip start (attach + the seek ladder)", async () => {
    clipResponse = { ...WEBFLIX_CLIP };
    await render(WEBFLIX_CLIP.clipId);
    expect(attachCalls.length).toBeGreaterThan(0);
    expect(attachCalls[0]).toEqual({ videoId: "Jlpy8KtoXOUB", startSec: 464 });
    // the retry ladder seeks to the clip start (the handle appears immediately here)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(seeks).toContain(464);
    // the inline slot is registered with the host (the persistent player's landing node)
    expect(q('[data-testid="clip-player-slot"]')).toBeTruthy();
  });

  test("the ranged loop: past the end seeks back to the start (loopCommand loop:true)", async () => {
    clipResponse = { ...WEBFLIX_CLIP };
    await render(WEBFLIX_CLIP.clipId);
    seeks.length = 0;
    await act(async () => {
      playerHost.progress(470.9, 471);
    });
    expect(seeks).toContain(464);
  });

  test("scrubbing before the window disarms the loop → 'Watching full video' + Return to clip", async () => {
    clipResponse = { ...WEBFLIX_CLIP };
    await render(WEBFLIX_CLIP.clipId);
    seeks.length = 0;
    await act(async () => {
      playerHost.progress(100, 471); // well before the window
    });
    const toast = q('[data-testid="clip-watching-full"]');
    expect(toast).toBeTruthy();
    expect(toast?.textContent).toContain("Watching full video");
    // the loop no longer seeks (disarmed)
    seeks.length = 0;
    await act(async () => {
      playerHost.progress(101, 471);
    });
    expect(seeks).not.toContain(464);
    // Return to clip re-arms + seeks back
    const btn = qa("button").find((b) => /Return to clip/.test(b.textContent ?? ""));
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(seeks).toContain(464);
    expect(q('[data-testid="clip-watching-full"]')).toBeFalsy();
  });

  test("Share clip copies the /clip/<id> link (the house clipboard + toast family)", async () => {
    clipResponse = { ...WEBFLIX_CLIP };
    const copied: string[] = [];
    Object.defineProperty(win.navigator, "clipboard", {
      value: {
        writeText: (t: string) => {
          copied.push(t);
          return Promise.resolve();
        },
      },
      configurable: true,
      writable: true,
    });
    await render(WEBFLIX_CLIP.clipId);
    const share = qa("button").find((b) => /Share clip/.test(b.textContent ?? ""));
    await act(async () => {
      share!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(copied).toContain(`${win.location.origin}/clip/${WEBFLIX_CLIP.clipId}`);
    expect(toasts.some((t) => t.includes("Clip link copied"))).toBe(true);
    // the share row carries the same URL
    expect(q('[data-testid="share-url"]')?.textContent).toBe(
      `${win.location.origin}/clip/${WEBFLIX_CLIP.clipId}`
    );
  });
});

describe("the clip page — the honest states", () => {
  test("a dead clip → youtube.com's measured wording ('Clip not available - Try again later')", async () => {
    clipResponse = { status: 404, error: "Clip not available - Try again later" };
    await render("Ugkxdeadclip0000000000000");
    const h1 = host!.querySelector("h1");
    expect(h1?.textContent).toBe("Clip not available - Try again later");
    expect(host!.textContent).toContain("Go to home");
  });

  test("a read failure → the P22-B unavailable family", async () => {
    clipResponse = { status: 502, error: "the clip page could not be read" };
    await render("Ugkxwalledclip00000000000");
    const h1 = host!.querySelector("h1");
    expect(h1?.textContent).toBe("This clip is unavailable right now");
    expect(/open it on youtube\.com to check/i.test(host!.textContent ?? "")).toBe(true);
  });
});
