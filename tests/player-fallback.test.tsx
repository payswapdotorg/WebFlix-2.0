/// <reference types="bun-types" />
/**
 * Task 2-c tests — the player swap chain (PlayerHostLayer + PlayerFallback).
 *
 * The embed-wall fallback behavior, end to end against the real layer:
 *  - the embed player mounts normally (the healthy path never changes);
 *  - a blocked verdict (probe/onError → playerHost.markBlocked) swaps the
 *    iframe lane for the fallback INSIDE the persistent wrapper:
 *      · streamFormats available → a native <video controls autoplay> fed
 *        by /api/stream?url=<encoded googlevideo url> (poster = thumbnail);
 *      · no formats → the blocked card (the P22-C what-to-try wording:
 *        "This video can't play here right now" + the youtube.com-sign-in
 *        hint + Open on YouTube + Retry embed);
 *  - Retry embed clears the verdict → the iframe lane re-mounts fresh.
 *
 * happy-dom + createRoot/act (the miniplayer.test.tsx pattern); next/navigation
 * mocked; fetch stubbed per video id (the /api/videos/[id]/playback DTO).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, useCallback } from "react";

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

// ---- YT iframe API stub (mute/unMute included — the probe calls them) ----
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  el: Element;
  options: Record<string, unknown>;
  loadedVideoId: string | null = null;
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
    return 100;
  }
  getPlayerState(): number {
    return -1;
  }
  loadVideoById(opts: { videoId: string }): void {
    this.loadedVideoId = opts.videoId;
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
}
(win as unknown as Record<string, unknown>).YT = { Player: MockYTPlayer, PlayerState: {} };

// ---- stubs: fetch (playback DTO per id) + next/navigation ----
const realFetch = globalThis.fetch;
const playbackRequests: string[] = [];
globalThis.fetch = (async (url: string | URL | Request) => {
  const href = String(url);
  const m = /\/api\/videos\/([^/]+)\/playback/.exec(href);
  if (m) {
    playbackRequests.push(href);
    // a MACROTASK delay keeps the "Trying alternate playback" loading state
    // deterministically observable — a microtask-resolving stub would let
    // act() flush the whole DTO round-trip before the first assertion
    await new Promise((r) => setTimeout(r, 5));
    const id = decodeURIComponent(m[1]);
    const payload = id.startsWith("NOFMT")
      ? { streamFormats: [], storyboards: [], durationSec: null, source: "" }
      : {
          streamFormats: [
            {
              itag: 18,
              url: "https://rr4.googlevideo.com/videoplayback?itag=18&source=youtube&ip=1.2.3.4",
              mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
              qualityLabel: "360p",
              width: 640,
              height: 360,
              fps: 25,
              bitrate: 444226,
              contentLength: null,
              approxDurationMs: "213089",
              hasAudio: true,
            },
            {
              itag: 22,
              url: "https://rr4.googlevideo.com/videoplayback?itag=22&source=youtube&ip=1.2.3.4",
              mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
              qualityLabel: "720p",
              width: 1280,
              height: 720,
              fps: 25,
              bitrate: 1200000,
              contentLength: null,
              approxDurationMs: "213089",
              hasAudio: true,
            },
          ],
          storyboards: [],
          durationSec: 213,
          source: "player",
        };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/",
}));

const { PlayerHostLayer } = await import("@/components/player/player-host-layer");
const { playerHost, usePlayerHost, resetPlayerHostForTests } = await import(
  "@/lib/player/player-host"
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isProbePlayer = (p: MockYTPlayer): boolean =>
  !!(p.el as Element).closest?.("[data-wfx-embed-probe]");
const mainPlayers = (): MockYTPlayer[] => MockYTPlayer.instances.filter((p) => !isProbePlayer(p));
const mainDestroyed = (): MockYTPlayer[] => MockYTPlayer.destroyed.filter((p) => !isProbePlayer(p));
/** Main players still alive (the instances array is CUMULATIVE — destroyed ones stay). */
const liveMainPlayers = (): MockYTPlayer[] =>
  mainPlayers().filter((p) => !MockYTPlayer.destroyed.includes(p));

// ---- harness: a fake watch page slot + the real layer ----------------------
// The fallback renders into the PERSISTENT wrapper, which only lands in the
// DOM when a watch slot is registered (the miniplayer.test.tsx SlotHost
// pattern) — without the slot the portal content stays detached and no
// host.querySelector can see it.

let slotEl: HTMLElement | null = null;

function SlotHost() {
  const setSlot = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      slotEl = el;
      playerHost.registerSlot(el);
    } else {
      playerHost.releaseSlot(slotEl);
    }
  }, []);
  return (
    <div className="relative aspect-video w-[640px]" data-testid="watch-slot">
      <div ref={setSlot} className="absolute inset-0" />
    </div>
  );
}

function App() {
  return (
    <div>
      <SlotHost />
      <PlayerHostLayer />
    </div>
  );
}

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

async function renderApp() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<App />);
  });
  await sleep(30); // YT api microtask + probe creation settle
}

async function attach(videoId: string) {
  await act(async () => {
    playerHost.attach({
      videoId,
      title: `Title ${videoId}`,
      channelName: `Channel ${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSec: 213,
    });
  });
  await sleep(10);
}

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  playbackRequests.length = 0;
  resetPlayerHostForTests();
  slotEl = null;
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

describe("Task 2-c — the player swap chain", () => {
  test("healthy path: the embed mounts; nothing changes until a blocked verdict", async () => {
    await renderApp();
    await attach("HEALTHY0001");
    expect(mainPlayers()).toHaveLength(1); // the iframe lane is live
    expect(mainPlayers()[0].options["videoId"]).toBe("HEALTHY0001");
    expect(q("video")).toBeNull(); // no native player without a verdict
    expect(q('[aria-label="Playback unavailable in the embedded player"]')).toBeNull();
    expect(playbackRequests).toHaveLength(0); // no playback fetch without a verdict
  });

  test("blocked + formats → the native <video> swap with the proxied best format", async () => {
    await renderApp();
    await attach("FMT00000001");
    expect(mainPlayers()).toHaveLength(1);
    await act(async () => {
      playerHost.markBlocked("FMT00000001", "wall");
    });
    // the loading state shows while the playback DTO round-trips
    expect(q('[aria-label="Trying alternate playback"]')).not.toBeNull();
    expect(mainDestroyed()).toHaveLength(1); // the walled iframe was destroyed
    await act(async () => {
      await sleep(30); // fetch settles
    });
    const video = q("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    // itag 22 (720p) wins; the googlevideo URL is proxied + encoded
    expect(video.getAttribute("src")).toBe(
      `/api/stream?url=${encodeURIComponent("https://rr4.googlevideo.com/videoplayback?itag=22&source=youtube&ip=1.2.3.4")}`
    );
    expect(video.getAttribute("poster")).toBe("https://i.ytimg.com/vi/FMT00000001/hqdefault.jpg");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
  });

  test("blocked + NO formats → the blocked card with the P22-C what-to-try wording + actions", async () => {
    await renderApp();
    await attach("NOFMT000001");
    await act(async () => {
      playerHost.markBlocked("NOFMT000001", "wall");
    });
    await act(async () => {
      await sleep(30);
    });
    const card = q('[aria-label="Playback unavailable in the embedded player"]');
    expect(card).not.toBeNull();
    // P22-C — the honest-exhaustion card says WHAT TO TRY (youtube-style):
    // the bot-check explanation + the youtube.com sign-in cure + the retry.
    expect(card!.textContent).toContain("This video can't play here right now");
    expect(card!.textContent).toContain("confirm you're not a bot");
    expect(card!.textContent).toContain("Signing in on youtube.com in this browser usually clears the check");
    const openLink = card!.querySelector(
      'a[aria-label="Open this video on YouTube in a new tab"]'
    ) as HTMLAnchorElement;
    expect(openLink.getAttribute("href")).toBe("https://www.youtube.com/watch?v=NOFMT000001");
    // the sign-in affordance (the actual bot-wall cure, its own CTA now)
    const signInLink = card!.querySelector(
      'a[aria-label="Open youtube.com to sign in, in a new tab"]'
    ) as HTMLAnchorElement | null;
    expect(signInLink).not.toBeNull();
    expect(signInLink!.getAttribute("href")).toBe("https://www.youtube.com/");
    const retry = card!.querySelector(
      'button[aria-label="Retry the embedded YouTube player"]'
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    // Retry embed → the iframe lane re-mounts fresh (a new main player)
    const before = mainPlayers().length;
    await act(async () => {
      retry!.click();
    });
    await sleep(30);
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
    expect(mainPlayers().length).toBe(before + 1); // fresh embed lane
    expect(q("video")).toBeNull();
  });

  test("a takeover to a NEW video clears the blocked verdict (fresh embed lane)", async () => {
    await renderApp();
    await attach("NOFMT000002");
    await act(async () => {
      playerHost.markBlocked("NOFMT000002", "wall");
    });
    await act(async () => {
      await sleep(30);
    });
    expect(usePlayerHost.getState().blockedVideoId).toBe("NOFMT000002");
    await attach("NEXT0000001"); // different videoId → takeover
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
    // the blocked iframe lane was destroyed by the fallback swap; the fresh
    // embed lane is the ONLY live player owning the wrapper (instances is
    // cumulative — the destroyed one still sits in it)
    expect(mainDestroyed()).toHaveLength(1);
    expect(liveMainPlayers()).toHaveLength(1);
    expect(q("video")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P22-C — the wall never shows: the cover + the stall re-probe chain
// ---------------------------------------------------------------------------

describe("P22-C — the embed-wall cover (the wall text is never visible)", () => {
  /** The current video's live probe player (created ~a microtask after attach). */
  const probeFor = (videoId: string): MockYTPlayer | undefined =>
    MockYTPlayer.instances.find(
      (p) => isProbePlayer(p) && p.options["videoId"] === videoId && !MockYTPlayer.destroyed.includes(p)
    );

  test("a fresh attach shows the poster cover until the probe's healthy verdict", async () => {
    await renderApp();
    await attach("COVER00001");
    // pending verdict + no proof of playback → the opaque cover is up (the
    // iframe's wall text — cross-origin, unreadable — cannot surface)
    const cover = q('[data-testid="embed-wall-cover"]');
    expect(cover).not.toBeNull();
    expect(cover!.getAttribute("role")).toBe("status");
    expect(cover!.textContent).toContain("Starting playback");
    // the cover carries the poster (the same i.ytimg.com thumbnail)
    const poster = cover!.querySelector("img");
    expect(poster?.getAttribute("src")).toBe("https://i.ytimg.com/vi/COVER00001/hqdefault.jpg");
    // healthy verdict → the cover lifts, the embed lane stands
    const probe = probeFor("COVER00001");
    expect(probe).toBeDefined();
    await act(async () => {
      (probe!.options["events"] as any).onStateChange({ data: 1 }); // PLAYING — health proof
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
    expect(liveMainPlayers()).toHaveLength(1);
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
  });

  test("the cover lifts the moment the MAIN player proves playback (probe still pending)", async () => {
    await renderApp();
    await attach("COVER00002");
    expect(q('[data-testid="embed-wall-cover"]')).not.toBeNull();
    const main = liveMainPlayers()[0];
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: 1 }); // main PLAYING
    });
    await sleep(10);
    // playing proof beats a pending verdict — the video is visible NOW
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
    // hygiene: settle the still-pending probe (healthy — no lane change) so
    // no 7s deadline timer outlives the test
    const probe = probeFor("COVER00002");
    await act(async () => {
      (probe!.options["events"] as any).onStateChange({ data: 1 });
    });
    await sleep(10);
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
  });

  test("a walled first probe swaps straight to the ladder (no wall window at all)", async () => {
    await renderApp();
    await attach("WALLCOVER3");
    expect(q('[data-testid="embed-wall-cover"]')).not.toBeNull();
    const probe = probeFor("WALLCOVER3");
    await act(async () => {
      (probe!.options["events"] as any).onError(); // the probe's blocked verdict
    });
    await act(async () => {
      await sleep(30); // the fallback's playback fetch settles
    });
    expect(usePlayerHost.getState().blockedVideoId).toBe("WALLCOVER3");
    // the ladder owned the wrapper: native <video> (formats available for this id)
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
    expect(q("video")).not.toBeNull();
  });
});

describe("P22-C — the mid-playback stall → re-probe (the 'playing some videos' wall)", () => {
  const probeFor = (videoId: string): MockYTPlayer | undefined =>
    MockYTPlayer.instances.find(
      (p) => isProbePlayer(p) && p.options["videoId"] === videoId && !MockYTPlayer.destroyed.includes(p)
    );

  test("reset-after-playing (state -1) re-covers, re-probes, and a walled verdict swaps the ladder in", async () => {
    await renderApp();
    await attach("STALLWALL1");
    // establish healthy playback (cover lifts, hadPlayed latches in the player)
    const main = liveMainPlayers()[0];
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: 1 });
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
    // the mid-play wall: the player resets to UNSTARTED (-1) — never a user
    // pause (that's state 2) — the stall reports, the cover re-arms while a
    // FRESH probe runs
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: -1 });
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).not.toBeNull();
    // the stall arm's wording (a recheck, not a first start)
    expect(q('[data-testid="embed-wall-cover"]')!.textContent).toContain("Checking playback");
    // the fresh probe walls → the ladder swap (not the embed lane)
    const probe = probeFor("STALLWALL1");
    await act(async () => {
      (probe!.options["events"] as any).onError();
    });
    await act(async () => {
      await sleep(30);
    });
    expect(usePlayerHost.getState().blockedVideoId).toBe("STALLWALL1");
    expect(q("video")).not.toBeNull(); // the native lane (formats available)
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
  });

  test("a HEALTHY re-probe after a stall lifts the cover and never blocks (a stall is not a verdict)", async () => {
    await renderApp();
    await attach("STALLHEAL1");
    const main = liveMainPlayers()[0];
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: 1 });
    });
    await sleep(10);
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: -1 }); // stall (a hiccup)
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).not.toBeNull();
    const probe = probeFor("STALLHEAL1");
    await act(async () => {
      (probe!.options["events"] as any).onStateChange({ data: 1 }); // still healthy
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull();
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
    expect(liveMainPlayers()).toHaveLength(1); // the embed lane kept its slot
  });

  test("a user PAUSE (state 2) never reports a stall", async () => {
    await renderApp();
    await attach("STALLPAU1");
    const main = liveMainPlayers()[0];
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: 1 }); // playing
    });
    await act(async () => {
      (main.options["events"] as any).onStateChange({ data: 2 }); // user pause
    });
    await sleep(10);
    expect(q('[data-testid="embed-wall-cover"]')).toBeNull(); // no re-cover
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
    // hygiene: settle the pending initial probe healthy (playback was proven)
    const probe = probeFor("STALLPAU1");
    await act(async () => {
      (probe!.options["events"] as any).onStateChange({ data: 1 });
    });
    await sleep(10);
    expect(usePlayerHost.getState().blockedVideoId).toBeNull();
  });
});
