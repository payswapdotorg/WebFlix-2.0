/**
 * WFX2-A-W tests — the YouTube player component, jsdom-safe via happy-dom.
 * The YT iframe API global is stubbed (window.YT.Player class mock — the
 * loadYouTubeIframeApi fast-path resolves without injecting any script):
 * asserts videoId + playerVars passed on mount, loadVideoById on videoId
 * change (no remount), destroy() on unmount, onProgress ticking, progress
 * persistence + the once-per-session view ping.
 */
import { beforeAll, afterAll, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  YoutubePlayer,
  probeEmbedHealth,
  type EmbedBlockedReason,
  type EmbedStallSignal,
} from "@/components/watch/youtube-player";

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
  /** P12-UX — the getPlayerState override (default 1 = PLAYING). */
  static state = 1;
  el: Element;
  options: Record<string, unknown>;
  loadedVideoId: string | null = null;
  muteCalls = 0;
  unmuteCalls = 0;
  playCalls = 0;

  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  playVideo(): void {
    this.playCalls += 1;
  }
  pauseVideo(): void {}
  mute(): void {
    this.muteCalls += 1;
  }
  unMute(): void {
    this.unmuteCalls += 1;
  }
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
    return MockYTPlayer.state;
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
afterEach(() => {
  MockYTPlayer.state = 1; // never leak a blocked-state override between tests
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TestPlayerProps {
  videoId: string;
  onProgress?: (sec: number, durationSec: number) => void;
  onEnded?: () => void;
  onBlocked?: (reason: EmbedBlockedReason) => void;
  onStall?: (signal: EmbedStallSignal) => void;
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
  MockYTPlayer.state = 1;
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
    expect(vars["autoplay"]).toBe(1); // P12-UX: autoplay WITH sound on load
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
    MockYTPlayer.destroyed = [];
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

describe("Task 2-c — onBlocked (the fallback chain's trigger)", () => {
  test("onError 101/150 → onBlocked('embed-disabled') fires exactly once", async () => {
    MockYTPlayer.instances = [];
    const blocked: string[] = [];
    const { unmount } = await mountPlayer({
      videoId: "dQw4w9WgXcQ",
      onBlocked: (reason) => blocked.push(reason),
    });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onError: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onError({ data: 101 });
    });
    await act(async () => {
      events.onError({ data: 150 }); // deduped — the verdict already fired
    });
    expect(blocked).toEqual(["embed-disabled"]);
    await unmount();
  });

  test("onError 100 (removed video) → onBlocked('player-error')", async () => {
    MockYTPlayer.instances = [];
    const blocked: string[] = [];
    const { unmount } = await mountPlayer({
      videoId: "removed00000",
      onBlocked: (reason) => blocked.push(reason),
    });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onError: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onError({ data: 100 });
    });
    expect(blocked).toEqual(["player-error"]);
    await unmount();
  });

  test("no onBlocked prop → onError is still harmless (optional contract)", async () => {
    MockYTPlayer.instances = [];
    const { unmount } = await mountPlayer({ videoId: "dQw4w9WgXcQ" });
    const events = MockYTPlayer.instances[0].options["events"] as {
      onError: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onError({ data: 101 });
    });
    await unmount();
  });
});

describe("Task 2-c — probeEmbedHealth (the offscreen muted-autoplay detector)", () => {
  const probeInstance = (): MockYTPlayer => {
    const p = MockYTPlayer.instances.find(
      (i) => (i.el as Element).closest?.("[data-wfx-embed-probe]")
    );
    if (!p) throw new Error("no probe player created");
    return p;
  };

  test("muted probe reaches PLAYING → true; the probe player is destroyed + DOM removed", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    const verdict = probeEmbedHealth("PROBEOK0001", { timeoutMs: 500 });
    await sleep(30); // the api microtask creates the probe player
    const probe = probeInstance();
    const vars = probe.options["playerVars"] as Record<string, number>;
    expect(vars).toMatchObject({ autoplay: 1, mute: 1, controls: 0, playsinline: 1 });
    const events = probe.options["events"] as {
      onReady: () => void;
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onReady();
    });
    await act(async () => {
      events.onStateChange({ data: 3 }); // buffering — deadline extends, no verdict
    });
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING — health proof
    });
    expect(await verdict).toBe(true);
    expect(MockYTPlayer.destroyed).toContain(probe); // cleaned up
    expect(win.document.querySelector("[data-wfx-embed-probe]")).toBeNull();
  });

  test("no playback within the deadline → false (the walled-embed verdict)", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    const verdict = probeEmbedHealth("PROBEWALL01", { timeoutMs: 250 });
    await sleep(30);
    expect(probeInstance()).toBeTruthy();
    expect(await verdict).toBe(false);
    expect(MockYTPlayer.destroyed).toHaveLength(1); // cleaned up
    expect(win.document.querySelector("[data-wfx-embed-probe]")).toBeNull();
  });

  test("probe onError → false immediately (embed-disabled etc.)", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    const verdict = probeEmbedHealth("PROBEERR001", { timeoutMs: 5_000 });
    await sleep(30);
    const probe = probeInstance();
    const events = probe.options["events"] as { onError: (e: { data: number }) => void };
    await act(async () => {
      events.onError({ data: 150 });
    });
    expect(await verdict).toBe(false);
    expect(MockYTPlayer.destroyed).toContain(probe);
  });

  test("a new videoId supersedes an in-flight probe (abort + verdict for the new one)", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    const first = probeEmbedHealth("PROBESUP001", { timeoutMs: 5_000 });
    await sleep(30);
    const firstProbe = probeInstance();
    const second = probeEmbedHealth("PROBESUP002", { timeoutMs: 300 });
    expect(await first).toBe(false); // aborted by the supersede
    expect(MockYTPlayer.destroyed).toContain(firstProbe);
    expect(await second).toBe(false); // its own deadline
  });
});

describe("P12-UX — autoplay policy (sound attempt → mute+retry fallback)", () => {
  test("blocked unmuted autoplay (UNSTARTED at the 1.5s check) → mute()+playVideo() + the tap-to-unmute affordance; the tap unmutes and dismisses", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = -1; // UNSTARTED — the browser blocked autoplay
    win.sessionStorage.clear();
    const { unmount } = await mountPlayer({ videoId: "AUTOPLAY001" });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as { onReady: () => void };
    await act(async () => {
      events.onReady();
    });
    await act(async () => {
      await sleep(1700); // past AUTOPLAY_CHECK_MS (1500)
    });
    expect(player.muteCalls).toBe(1);
    expect(player.playCalls).toBeGreaterThanOrEqual(1);
    const btn = win.document.querySelector('button[aria-label="Tap to unmute"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      (btn as unknown as HTMLElement).click();
    });
    expect(player.unmuteCalls).toBe(1);
    expect(win.document.querySelector('button[aria-label="Tap to unmute"]')).toBeNull();
    await unmount();
  });

  test("autoplay WITH sound succeeds (PLAYING) → no mute fallback, no affordance", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = 1; // PLAYING — autoplay took, with sound
    win.sessionStorage.clear();
    const { unmount } = await mountPlayer({ videoId: "AUTOPLAY002" });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as {
      onReady: () => void;
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onReady();
    });
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING clears the check
    });
    await act(async () => {
      await sleep(1700);
    });
    expect(player.muteCalls).toBe(0);
    expect(win.document.querySelector('button[aria-label="Tap to unmute"]')).toBeNull();
    await unmount();
  });
});

// ---------------------------------------------------------------------------
// P22-C — the stall signals (onStall: the mid-play wall recheck trigger)
// ---------------------------------------------------------------------------

describe("P22-C — onStall (a stall is a RECHECK trigger, never a block verdict)", () => {
  test("UNSTARTED after PLAYING (state -1) → onStall('reset-after-playing')", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = 1;
    win.sessionStorage.clear();
    const stalls: EmbedStallSignal[] = [];
    const { unmount } = await mountPlayer({
      videoId: "STALLSIG001",
      onStall: (s) => stalls.push(s),
    });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as {
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING — latches hadPlayed
    });
    expect(stalls).toHaveLength(0);
    await act(async () => {
      events.onStateChange({ data: -1 }); // the mid-play wall reset
    });
    expect(stalls).toEqual(["reset-after-playing"]);
    await unmount();
  });

  test("a user PAUSE (state 2) never reports a stall; a first UNSTARTED (never played) neither", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = 1;
    win.sessionStorage.clear();
    const stalls: EmbedStallSignal[] = [];
    const { unmount } = await mountPlayer({
      videoId: "STALLSIG002",
      onStall: (s) => stalls.push(s),
    });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as {
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onStateChange({ data: -1 }); // pre-play unstarted — no hadPlayed
    });
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING
    });
    await act(async () => {
      events.onStateChange({ data: 2 }); // user pause
    });
    await act(async () => {
      events.onStateChange({ data: 3 }); // buffering
    });
    expect(stalls).toHaveLength(0);
    await unmount();
  });

  test("tap-to-unmute that fails to resume → onStall('unmute-no-resume') within the window", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = -1; // the player parks UNSTARTED after the unmute attempt (the wall)
    win.sessionStorage.clear();
    const stalls: EmbedStallSignal[] = [];
    const { unmount } = await mountPlayer({
      videoId: "STALLSIG003",
      onStall: (s) => stalls.push(s),
    });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as { onReady: () => void };
    await act(async () => {
      events.onReady();
    });
    await act(async () => {
      await sleep(1700); // past AUTOPLAY_CHECK_MS — the muted fallback arms
    });
    const btn = win.document.querySelector('button[aria-label="Tap to unmute"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      (btn as unknown as HTMLElement).click(); // unMute + playVideo + the 3s check
    });
    expect(player.unmuteCalls).toBe(1);
    expect(stalls).toHaveLength(0); // not yet — the window is still open
    await act(async () => {
      await sleep(3200); // past UNMUTE_RESUME_CHECK_MS (3000), still UNSTARTED
    });
    expect(stalls).toEqual(["unmute-no-resume"]);
    await unmount();
  }, 8000);

  test("the unmute check is cleared the moment playback resumes (no false stall)", async () => {
    MockYTPlayer.instances = [];
    MockYTPlayer.destroyed = [];
    MockYTPlayer.state = -1;
    win.sessionStorage.clear();
    const stalls: EmbedStallSignal[] = [];
    const { unmount } = await mountPlayer({
      videoId: "STALLSIG004",
      onStall: (s) => stalls.push(s),
    });
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as {
      onReady: () => void;
      onStateChange: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onReady();
    });
    await act(async () => {
      await sleep(1700); // the muted fallback arms
    });
    const btn = win.document.querySelector('button[aria-label="Tap to unmute"]');
    await act(async () => {
      (btn as unknown as HTMLElement).click(); // the unmute attempt + the 3s check
    });
    await act(async () => {
      events.onStateChange({ data: 1 }); // PLAYING — resumes within the window
    });
    await act(async () => {
      await sleep(3200); // past the window — the check was cleared on PLAYING
    });
    expect(stalls).toHaveLength(0);
    await unmount();
  }, 8000);
});
