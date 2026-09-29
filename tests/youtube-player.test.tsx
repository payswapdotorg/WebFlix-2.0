/**
 * WFX2-A-W tests — the YouTube player component, jsdom-safe via happy-dom.
 * The YT iframe API global is stubbed (window.YT.Player class mock — the
 * loadYouTubeIframeApi fast-path resolves without injecting any script):
 * asserts videoId + playerVars passed on mount, loadVideoById on videoId
 * change (no remount), destroy() on unmount, onProgress ticking, progress
 * persistence + the once-per-session view ping.
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { YoutubePlayer } from "@/components/watch/youtube-player";

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

// ---- YT iframe API stub (loadScript no-op: window.YT.Player present) ----
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
  seekTo(sec: number): void {
    this.time = sec;
  }
  time = 0;
  getCurrentTime(): number {
    return 42;
  }
  getDuration(): number {
    return 100;
  }
  getPlayerState(): number {
    return 1;
  }
  loadVideoById(opts: { videoId: string }): void {
    this.loadedVideoId = opts.videoId;
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
}
// YT iframe API stub installed on the happy-dom window (typed loosely)
const setWinYT = (v: unknown) => {
  (win as unknown as Record<string, unknown>).YT = v;
};
setWinYT({ Player: MockYTPlayer, PlayerState: {} });

// ---- fetch stub (the view ping) ----
const realFetch = globalThis.fetch;
const viewPings: { url: string; body: unknown }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  viewPings.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response("{}", { status: 200 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TestPlayerProps {
  videoId: string;
  onProgress?: (sec: number, durationSec: number) => void;
  onEnded?: () => void;
}

async function mountPlayer(props: TestPlayerProps) {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root: Root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root.render(<YoutubePlayer {...props} />);
  });
  await sleep(30); // let the API-ready microtask settle
  return { root, unmount: async () => act(async () => { root.unmount(); }) };
}

beforeAll(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
});

describe("YoutubePlayer lifecycle (YT iframe API stub)", () => {
  test("mount passes videoId + playerVars to YT.Player; destroy() on unmount", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    const { unmount } = await mountPlayer({
      videoId: "dQw4w9WgXcQ",
      onProgress: () => {},
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    const player = MockYTPlayer.instances[0];
    expect(player.options["videoId"]).toBe("dQw4w9WgXcQ");
    const vars = player.options["playerVars"] as Record<string, number>;
    expect(vars["playsinline"]).toBe(1);
    expect(vars["rel"]).toBe(0);
    expect(vars["modestbranding"]).toBe(1);
    await unmount();
    expect(MockYTPlayer.destroyed).toContain(player);
  });

  test("videoId change → loadVideoById (the iframe is NOT reloaded)", async () => {
    MockYTPlayer.instances = [];
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root.render(<YoutubePlayer videoId="aaaaaaaaaaa" />);
    });
    await sleep(30);
    expect(MockYTPlayer.instances).toHaveLength(1);
    await act(async () => {
      root.render(<YoutubePlayer videoId="bbbbbbbbbbb" />);
    });
    await sleep(30);
    expect(MockYTPlayer.instances).toHaveLength(1);
    expect(MockYTPlayer.instances[0].loadedVideoId).toBe("bbbbbbbbbbb");
    await act(async () => {
      root.unmount();
    });
  });

  test("PLAYING → onProgress ticks ~1/sec with (sec, durationSec)", async () => {
    MockYTPlayer.instances = [];
    const progress: [number, number][] = [];
    const { unmount } = await mountPlayer({
      videoId: "jNQXAC9IVRw",
      onProgress: (s: number, d: number) => progress.push([s, d]),
    });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as { onStateChange: (e: { data: number }) => void };
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING
    });
    await sleep(1200);
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]).toEqual([42, 100]);
    await unmount();
  });

  test("one view ping per session: POST /api/view {videoId, watchedSec}", async () => {
    MockYTPlayer.instances = [];
    viewPings.length = 0;
    win.sessionStorage.clear();
    const { unmount } = await mountPlayer({ videoId: "jNQXAC9IVRw" });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING → ping
    });
    await act(async () => {
      events.onStateChange({ data: 2 }); // PAUSED
    });
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING again → no second ping
    });
    const pings = viewPings.filter((p) => p.url === "/api/view");
    expect(pings).toHaveLength(1);
    expect(pings[0].body).toEqual({ videoId: "jNQXAC9IVRw", watchedSec: 42 });
    await unmount();
  });

  test("position memory: paused → localStorage webflix-progress:<videoId>", async () => {
    MockYTPlayer.instances = [];
    win.localStorage.clear();
    const { unmount } = await mountPlayer({ videoId: "9bZkp7q19f0" });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onStateChange({ data: 2 }); // PAUSED → savePosition
    });
    const raw = win.localStorage.getItem("webflix-progress:9bZkp7q19f0");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { sec: number };
    expect(parsed.sec).toBe(42);
    await unmount();
  });

  test("ENDED → onEnded fires (autoplay-next wiring point)", async () => {
    MockYTPlayer.instances = [];
    win.sessionStorage.clear();
    let ended = 0;
    const { unmount } = await mountPlayer({
      videoId: "y6120QOlsfU",
      onEnded: () => {
        ended += 1;
      },
    });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onStateChange({ data: 0 }); // ENDED
    });
    expect(ended).toBe(1);
    await unmount();
  });
});
