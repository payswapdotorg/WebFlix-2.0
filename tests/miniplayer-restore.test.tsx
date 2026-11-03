/// <reference types="bun-types" />
/**
 * P81-a tests — the miniplayer playback-continuity laws (the operator's
 * "the miniplayer resets the play when you change pages" fix):
 *
 *  1. the live-position restore law — a RE-CREATED player for the SAME
 *     videoId with no explicit latch seeks to the host's playhead mirror
 *     (read at mount): the bare-route roundtrip / blocked-swap remount /
 *     StrictMode double-mount no longer restart playback at 0;
 *  2. the latch-wins law — an explicit startSec (?t= share links) still
 *     wins over the mirror; the mirror never fights a real latch;
 *  3. the sub-3s law — a <3s playhead is NOT restored (a restart IS the
 *     correct resume for a 2s watch);
 *  4. the takeover law — a DIFFERENT video resets the mirror (positionSec
 *     belongs to the current videoId only), so a fresh video never seeks;
 *  5. the bare-route law — AppShell renders the player host layer on
 *     /signin//signup too, so the account roundtrip no longer destroys
 *     the live iframe (the mini is a fixed overlay on the auth layout).
 *
 * happy-dom + createRoot/act (the miniplayer.test.tsx harness) with a
 * stubbed YT iframe API that RECORDS seekTo calls; next/navigation is
 * mocked with a MUTABLE pathname (the bare-route pin drives it).
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

// ---- stubs: fetch + next/navigation (MUTABLE pathname) ----
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response("{}", { status: 200 })) as unknown as typeof fetch;

let currentPathname = "/";
const navigations: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      navigations.push(url);
    },
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const { PlayerHostLayer } = await import("@/components/player/player-host-layer");
const { AppShell } = await import("@/components/app/app-shell");
const {
  playerHost,
  usePlayerHost,
  resetPlayerHostForTests,
} = await import("@/lib/player/player-host");

// ---- YT iframe API stub (records seekTo calls) ----
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  /** per-instance duration override (null → 100; 0 = live) */
  static nextDuration: number | null = null;
  el: Element;
  options: Record<string, unknown>;
  loadedVideoId: string | null = null;
  seekCalls: number[] = [];

  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  playVideo(): void {}
  pauseVideo(): void {}
  seekTo(sec?: number): void {
    this.seekCalls.push(sec ?? -1);
  }
  getCurrentTime(): number {
    return 42;
  }
  getDuration(): number {
    return MockYTPlayer.nextDuration ?? 100;
  }
  getPlayerState(): number {
    return 1;
  }
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void {
    this.loadedVideoId = opts.videoId;
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
  /** the test seam: fire the real onReady the player would fire */
  fireReady(): void {
    const events = this.options.events as
      | { onReady?: () => void; onStateChange?: (e: { data: number }) => void }
      | undefined;
    events?.onReady?.();
  }
}
(win as unknown as Record<string, unknown>).YT = {
  Player: MockYTPlayer,
  PlayerState: {},
};

const isProbePlayer = (p: MockYTPlayer): boolean =>
  !!(p.el as Element).closest?.("[data-wfx-embed-probe]");
const mainPlayers = (): MockYTPlayer[] => MockYTPlayer.instances.filter((p) => !isProbePlayer(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

async function renderLayer() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<PlayerHostLayer />);
  });
  await sleep(30); // YT API-ready microtask
}

async function renderShell() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<AppShell><div data-testid="page" /></AppShell>);
  });
  await sleep(30);
}

async function unmount() {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  host?.remove();
  host = null;
}

const attach = (videoId: string, extra?: { startSec?: number | null }) =>
  act(async () => {
    playerHost.attach({
      videoId,
      title: `Title ${videoId}`,
      channelName: `Channel ${videoId}`,
      thumbnailUrl: null,
      durationSec: 600,
      startSec: extra?.startSec ?? null,
    });
  });

/** drive the ~1/s playhead mirror exactly as the real player would */
const drive = (sec: number) =>
  act(async () => {
    playerHost.progress(sec, 600);
  });

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  MockYTPlayer.nextDuration = null;
  resetPlayerHostForTests();
  currentPathname = "/";
  navigations.length = 0;
});

afterEach(async () => {
  await unmount();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("P81-a — the live-position restore law (re-created players resume)", () => {
  test("a re-created player for the same video resumes from the playhead mirror", async () => {
    // first mount: attach + play to 300s (the mirror mirrors ~1/s)
    await renderLayer();
    await attach("vidAAAAAAAA");
    await drive(300);
    expect(usePlayerHost.getState().positionSec).toBe(300);
    // the layer unmounts (bare-route roundtrip / blocked swap): destroy fires
    await unmount();
    // the store SURVIVES (session-scoped — the layer is what died)
    expect(usePlayerHost.getState().videoId).toBe("vidAAAAAAAA");
    expect(usePlayerHost.getState().positionSec).toBe(300);
    // the layer comes back → a FRESH player for the SAME video → resume
    await renderLayer();
    const created = mainPlayers().at(-1);
    expect(created).toBeTruthy();
    created!.fireReady();
    expect(created!.seekCalls).toContain(300);
  });

  test("an explicit latch (?t=) wins — the mirror never fights it", async () => {
    await renderLayer();
    await attach("vidBBBBBBBB", { startSec: 83 });
    // the user hasn't played yet — mirror still 0, latch 83
    const created = mainPlayers().at(-1);
    expect(created).toBeTruthy();
    created!.fireReady();
    expect(created!.seekCalls).toContain(83);
  });

  test("a sub-3s playhead is not restored (a restart IS the correct resume)", async () => {
    await renderLayer();
    await attach("vidCCCCCCCC");
    await drive(2);
    await unmount();
    await renderLayer();
    const created = mainPlayers().at(-1);
    created!.fireReady();
    expect(created!.seekCalls).toHaveLength(0);
  });

  test("a different video resets the mirror — a fresh video never bogus-resumes", async () => {
    await renderLayer();
    await attach("vidDDDDDDDD");
    await drive(300);
    // takeover: a different video — the mirror MUST reset to 0
    await attach("vidEEEEEEEE");
    const st = usePlayerHost.getState();
    expect(st.videoId).toBe("vidEEEEEEEE");
    expect(st.positionSec).toBe(0);
    const created = mainPlayers().at(-1);
    created!.fireReady();
    expect(created!.seekCalls).toHaveLength(0);
  });

  test("a LIVE video (duration 0) never receives the resume seek", async () => {
    MockYTPlayer.nextDuration = 0; // the stub reports live
    await renderLayer();
    await attach("vidFFFFFFFF");
    await drive(300);
    await unmount();
    await renderLayer();
    const created = mainPlayers().at(-1);
    created!.fireReady();
    // the live guard sits ahead of the seek — no resume on a live stream
    expect(created!.seekCalls).toHaveLength(0);
  });
});

describe("P81-a — the bare-route law (the host layer rides /signin//signup)", () => {
  test("AppShell renders the layer on /signin — playback survives the account roundtrip", async () => {
    currentPathname = "/signin";
    await renderShell();
    // a playing video latched in the store (the pre-signin watch)
    await attach("vidGGGGGGGG");
    // the mini region EXISTS on the bare page (previously: unmounted → destroy)
    const region = win.document.querySelector('[aria-label="Miniplayer"]');
    expect(region).toBeTruthy();
  });

  test("AppShell renders the layer on /signup as well", async () => {
    currentPathname = "/signup";
    await renderShell();
    await attach("vidHHHHHHHH");
    const region = win.document.querySelector('[aria-label="Miniplayer"]');
    expect(region).toBeTruthy();
  });
});
