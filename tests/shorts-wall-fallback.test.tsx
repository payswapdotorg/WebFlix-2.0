/// <reference types="bun-types" />
/**
 * P22-C tests — the shorts wall fallback (ShortsPlayerSlot).
 *
 * The shorts surface used a RAW `<iframe>` with no wall detection —
 * youtube.com's "Sign in to confirm you're not a bot" rendered inside the
 * 9:16 frame indefinitely (the operator's bug 2 on the one surface the
 * watch-page ladder never covered). The P22-C slot runs the same
 * embed-health probe the watch player uses:
 *  - pending → the poster COVER (the wall never surfaces; the iframe is
 *    already mounting underneath — healthy shorts pay no added delay);
 *  - healthy → the plain embed iframe, exactly as before (muted, looping);
 *  - walled  → the ladder swap (PlayerFallback: native stream → the honest
 *    blocked card with what-to-try actions);
 *  - inactive slides never probe (the poster alone).
 *
 * happy-dom + createRoot/act (the player-fallback.test.tsx pattern); the YT
 * iframe API stubbed; fetch stubbed for the /api/videos/[id]/playback DTO.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM (set before any component runs) ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
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

// ---- YT iframe API stub (the probe drives mute/play + events) ----
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  el: Element;
  options: Record<string, unknown>;
  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  playVideo(): void {}
  pauseVideo(): void {}
  mute(): void {}
  unMute(): void {}
  seekTo(): void {}
  getCurrentTime(): number {
    return 0;
  }
  getDuration(): number {
    return 60;
  }
  getPlayerState(): number {
    return -1;
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
}
(win as unknown as Record<string, unknown>).YT = { Player: MockYTPlayer, PlayerState: {} };

// ---- fetch stub: the playback DTO (NO formats → the honest blocked card) ----
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const href = String(url);
  if (/\/api\/videos\/([^/]+)\/playback/.test(href)) {
    await new Promise((r) => setTimeout(r, 5));
    return new Response(
      JSON.stringify({ streamFormats: [], storyboards: [], durationSec: null, source: "" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/shorts",
}));

const { ShortsPlayerSlot } = await import("@/components/shorts/shorts-player-slot");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isProbePlayer = (p: MockYTPlayer): boolean =>
  !!(p.el as Element).closest?.("[data-wfx-embed-probe]");
const probeFor = (videoId: string): MockYTPlayer | undefined =>
  MockYTPlayer.instances.find(
    (p) => isProbePlayer(p) && p.options["videoId"] === videoId && !MockYTPlayer.destroyed.includes(p)
  );

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

async function renderSlot(videoId: string, active: boolean) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<ShortsPlayerSlot videoId={videoId} active={active} />);
  });
  await sleep(20); // YT api microtask + probe creation settle
}

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
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

describe("P22-C — the shorts slot wall fallback", () => {
  test("ACTIVE + pending verdict → the poster cover over the mounting iframe (no wall window)", async () => {
    await renderSlot("SHWALL0001", true);
    // the iframe is already mounting (healthy shorts pay no added delay)…
    const iframe = q("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toContain("youtube.com/embed/SHWALL0001");
    expect(iframe!.getAttribute("src")).toContain("autoplay=1");
    expect(iframe!.getAttribute("src")).toContain("mute=1");
    // …but the opaque poster cover stands until the verdict
    const cover = q('[data-testid="shorts-wall-cover"]');
    expect(cover).not.toBeNull();
    expect(cover!.querySelector("img")!.getAttribute("src")).toContain("SHWALL0001");
  });

  test("healthy verdict → the cover lifts; the plain muted looping embed stands", async () => {
    await renderSlot("SHHEAL0001", true);
    expect(q('[data-testid="shorts-wall-cover"]')).not.toBeNull();
    const probe = probeFor("SHHEAL0001");
    expect(probe).toBeDefined();
    await act(async () => {
      (probe!.options["events"] as { onStateChange: (e: { data: number }) => void }).onStateChange({
        data: 1, // PLAYING — health proof
      });
    });
    await sleep(10);
    expect(q('[data-testid="shorts-wall-cover"]')).toBeNull();
    expect(q("iframe")).not.toBeNull();
    expect(q('[aria-label="Playback unavailable in the embedded player"]')).toBeNull();
  });

  test("walled verdict → the ladder swap (the honest blocked card, what-to-try actions)", async () => {
    await renderSlot("SHWALL0002", true);
    expect(q('[data-testid="shorts-wall-cover"]')).not.toBeNull();
    const probe = probeFor("SHWALL0002");
    await act(async () => {
      (probe!.options["events"] as { onError: () => void }).onError(); // blocked verdict
    });
    await act(async () => {
      await sleep(30); // the fallback's playback fetch settles (NO formats)
    });
    // the raw iframe is GONE (the wall can never render); the card stands in
    expect(q("iframe")).toBeNull();
    const card = q('[aria-label="Playback unavailable in the embedded player"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("This video can't play here right now");
    // Retry embed re-arms the verdict cycle (pending again — cover returns)
    const retry = card!.querySelector(
      'button[aria-label="Retry the embedded YouTube player"]'
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
    });
    await sleep(20);
    expect(q('[data-testid="shorts-wall-cover"]')).not.toBeNull();
    // hygiene: settle the re-armed probe healthy so no timer outlives the test
    const probe2 = probeFor("SHWALL0002");
    await act(async () => {
      (probe2!.options["events"] as { onStateChange: (e: { data: number }) => void }).onStateChange({
        data: 1,
      });
    });
    await sleep(10);
  });

  test("INACTIVE slides never probe — the poster alone (no iframe, no cover)", async () => {
    await renderSlot("SHINAC0001", false);
    expect(q('[data-wfx-embed-probe]')).toBeNull(); // no probe player mounted
    expect(q("iframe")).toBeNull(); // the inactive slide is the poster alone
    expect(q('[data-testid="shorts-wall-cover"]')).toBeNull();
  });
});
