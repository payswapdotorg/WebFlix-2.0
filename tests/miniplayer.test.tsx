/// <reference types="bun-types" />
/**
 * WFX2-C-S tests — the persistent player host (miniplayer persistence):
 * store lifecycle (attach / setMini / updateMeta / close), the wrapper's
 * DOM survival across releases and takeovers (the wrapper NEVER unmounts —
 * React never removes the re-parented node; Close is the only destroy
 * path), the navigation survival matrix (every route keeps the mini;
 * /watch takes the player inline; a watch page without a slot — e.g. an
 * error page — keeps the mini too), same-video expand (no reload), and
 * different-video takeover via loadVideoById (no remount, no mini flash).
 *
 * happy-dom + createRoot/act (the youtube-player.test.tsx pattern) with a
 * stubbed YT iframe API; next/navigation is mocked (no Next router in the
 * bun test runtime) and fetched dynamically AFTER mock.module applies.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useCallback } from "react";

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

// ---- stubs: fetch (view pings) + next/navigation (no router in bun) ----
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response("{}", { status: 200 })) as unknown as typeof fetch;

const navigations: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      navigations.push(url);
    },
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => "/",
}));

const { PlayerHostLayer } = await import("@/components/player/player-host-layer");
const {
  playerHost,
  usePlayerHost,
  resetPlayerHostForTests,
} = await import("@/lib/player/player-host");

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
  seekTo(): void {}
  getCurrentTime(): number {
    return 42;
  }
  getDuration(): number {
    return 100;
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
}
(win as unknown as Record<string, unknown>).YT = {
  Player: MockYTPlayer,
  PlayerState: {},
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- harness: a fake watch page slot + the real layer ----------------------

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

function App({ hasSlot, slotKey = "A" }: { hasSlot: boolean; slotKey?: string }) {
  return (
    <div>
      {hasSlot ? <SlotHost key={slotKey} /> : null}
      <PlayerHostLayer />
    </div>
  );
}

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

async function renderApp(hasSlot: boolean, slotKey = "A") {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<App hasSlot={hasSlot} slotKey={slotKey} />);
  });
  await sleep(30); // YT API-ready microtask
}

async function rerenderApp(hasSlot: boolean, slotKey = "A") {
  await act(async () => {
    root!.render(<App hasSlot={hasSlot} slotKey={slotKey} />);
  });
  await sleep(30);
}

const attach = (videoId: string, extra?: { startSec?: number | null; durationSec?: number }) =>
  act(async () => {
    playerHost.attach({
      videoId,
      title: `Title ${videoId}`,
      channelName: `Channel ${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSec: extra?.durationSec ?? 100,
      startSec: extra?.startSec ?? null,
    });
  });

const store = () => usePlayerHost.getState();

/** Wait for the scheduled post-release mini decision (rAF). */
const settleFrames = () => sleep(50);

/** Query the rendered host (cast through unknown: happy-dom element tree). */
const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;


beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  resetPlayerHostForTests();
  slotEl = null;
  navigations.length = 0;
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
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("player host store lifecycle (mount / persist / close / expand)", () => {
  test("attach: videoId + meta latch, hostMode inline, wrapper in the watch slot, player created", async () => {
    await renderApp(true);
    await attach("V1");
    expect(store().videoId).toBe("V1");
    expect(store().hostMode).toBe("inline");
    expect(store().meta?.title).toBe("Title V1");
    expect(playerHost.wrapper).not.toBeNull();
    expect(playerHost.wrapper!.parentElement).toBe(slotEl);
    expect(MockYTPlayer.instances).toHaveLength(1);
    // the mini chrome is mounted but hidden (opacity transition)
    const mini = q('[aria-label="Miniplayer"]');
    expect(mini).not.toBeNull();
    expect((mini as HTMLElement).className).toContain("opacity-0");
  });

  test("close() is the ONLY destroy path: player destroyed, wrapper detached, store reset", async () => {
    await renderApp(true);
    await attach("V1");
    const player = MockYTPlayer.instances[0];
    await act(async () => {
      playerHost.close();
    });
    expect(store().videoId).toBeNull();
    expect(MockYTPlayer.destroyed).toContain(player);
    expect(playerHost.wrapper!.isConnected).toBe(false); // limbo, never painted
    expect(q('[aria-label="Miniplayer"]')).toBeNull();
  });

  test("setMini toggles the wrapper slot↔mini (scroll-dock geometry)", async () => {
    await renderApp(true);
    await attach("V1");
    await act(async () => {
      playerHost.setMini(true);
    });
    expect(store().hostMode).toBe("mini");
    expect(playerHost.wrapper!.parentElement).toBe(playerHost.miniHost);
    await act(async () => {
      playerHost.setMini(false);
    });
    expect(store().hostMode).toBe("inline");
    expect(playerHost.wrapper!.parentElement).toBe(slotEl);
  });

  test("updateMeta enriches the mini chrome (detail arrives after attach)", async () => {
    await renderApp(true);
    await attach("V1");
    await act(async () => {
      playerHost.updateMeta({ title: "Real title", channelName: "Real channel" });
    });
    expect(store().meta?.title).toBe("Real title");
    const mini = q('[aria-label="Miniplayer"]') as HTMLElement;
    expect(mini.textContent).toContain("Real title");
    expect(mini.textContent).toContain("Real channel");
  });

  test("the wrapper NEVER unmounts across inline↔mini transitions (one player instance until close)", async () => {
    await renderApp(true);
    await attach("V1");
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        playerHost.setMini(true);
      });
      await act(async () => {
        playerHost.setMini(false);
      });
    }
    expect(MockYTPlayer.instances).toHaveLength(1);
    expect(MockYTPlayer.destroyed).toHaveLength(0);
    await act(async () => {
      playerHost.close();
    });
    expect(MockYTPlayer.destroyed).toHaveLength(1);
  });
});

describe("miniplayer persistence — the navigation survival matrix", () => {
  test("leaving the watch page (no slot) → the wrapper lands in the miniplayer after the frame check", async () => {
    await renderApp(true);
    await attach("V1");
    await rerenderApp(false); // navigate away (slot unmounts)
    await settleFrames(); // rAF mini decision
    expect(store().hostMode).toBe("mini");
    expect(playerHost.wrapper!.parentElement).toBe(playerHost.miniHost);
    const mini = q('[aria-label="Miniplayer"]') as HTMLElement;
    expect(mini.className).toContain("opacity-100");
    expect(mini.className).not.toContain("pointer-events-none");
  });

  const ROUTES = [
    "/", "/trending", "/explore", "/search", "/channel/@lofi",
    "/shorts", "/history", "/liked", "/playlists", "/playlist/PL1",
    "/subscriptions", "/studio", "/upload", "/watch/missing-error",
  ];
  test.each(ROUTES)("route %s without a slot keeps the mini (matrix)", async () => {
    await renderApp(true);
    await attach("V1");
    await rerenderApp(false);
    await settleFrames();
    expect(store().hostMode).toBe("mini");
    expect(store().videoId).toBe("V1");
    expect(playerHost.wrapper!.parentElement).toBe(playerHost.miniHost);
  });

  test("/watch re-registers its slot in the SAME commit → the player goes back inline with NO mini flash", async () => {
    await renderApp(true);
    await attach("V1");
    await rerenderApp(false);
    await settleFrames();
    expect(store().hostMode).toBe("mini");
    await rerenderApp(true); // arriving at /watch/{same id}
    // the slot registration moved the wrapper synchronously (pre-paint)
    expect(playerHost.wrapper!.parentElement).toBe(slotEl);
    await attach("V1"); // same videoId → expand, no reload
    await settleFrames();
    expect(store().hostMode).toBe("inline"); // the mini never flashed
    expect(MockYTPlayer.instances).toHaveLength(1);
    expect(MockYTPlayer.instances[0].loadedVideoId).toBeNull(); // no loadVideoById
  });

  test("stale release (an old page unmounting late) is ignored by identity", async () => {
    await renderApp(true);
    await attach("V1");
    const stale = win.document.createElement("div");
    playerHost.releaseSlot(stale as unknown as HTMLElement); // NOT the registered slot → ignored
    expect(playerHost.slot).toBe(slotEl);
    expect(playerHost.wrapper!.parentElement).toBe(slotEl);
    await settleFrames();
    expect(store().hostMode).toBe("inline");
  });
});

describe("miniplayer takeover — different video id (loadVideoById, no reload)", () => {
  test("watch→watch takeover: the new slot takes the wrapper in the same commit; attach swaps the video without remount or mini flash", async () => {
    await renderApp(true, "A");
    await attach("V1");
    const player = MockYTPlayer.instances[0];

    // simulate watch/V1 → watch/V2: the slot swap (unmount + mount) lands
    // in ONE commit — exactly what a route change does
    await rerenderApp(true, "B");
    expect(playerHost.wrapper!.parentElement).toBe(slotEl);
    await attach("V2");
    expect(store().videoId).toBe("V2");
    expect(MockYTPlayer.instances).toHaveLength(1); // no remount
    expect(player.loadedVideoId).toBe("V2"); // loadVideoById takeover
    await settleFrames();
    expect(store().hostMode).toBe("inline"); // the mini NEVER showed
    expect(MockYTPlayer.destroyed).toHaveLength(0);
  });

  test("attach with startSec latches the takeover start position (localStorage progress wins when no explicit start)", async () => {
    win.localStorage.clear();
    win.localStorage.setItem("webflix-progress:V2", JSON.stringify({ sec: 77 }));
    await renderApp(true);
    await attach("V1");
    await attach("V2");
    expect(store().startSec).toBe(77);
    // the portal re-rendered with the new videoId + latched start
    expect(MockYTPlayer.instances[0].loadedVideoId).toBe("V2");
    win.localStorage.clear();
  });
});

describe("miniplayer chrome (YouTube geometry)", () => {
  test("progress events drive the red progress bar width", async () => {
    await renderApp(true);
    await attach("V1", { durationSec: 100 });
    await act(async () => {
      playerHost.progress(42, 100);
    });
    expect(store().positionSec).toBe(42);
    const bar = q('[role="progressbar"]');
    expect(bar).not.toBeNull();
    const fill = (bar as HTMLElement).querySelector("div") as HTMLElement;
    expect(fill.style.width).toBe("42%");
  });

  test("live video (duration 0) hides the progress bar", async () => {
    await renderApp(true);
    await attach("LIVE1", { durationSec: 0 });
    expect(q('[role="progressbar"]')).toBeNull();
  });

  test("close + expand controls are focusable buttons with aria labels", async () => {
    await renderApp(true);
    await attach("V1");
    const expand = q('[aria-label="Expand miniplayer"]');
    const close = q('[aria-label="Close miniplayer"]');
    expect(expand?.tagName).toBe("BUTTON");
    expect(close?.tagName).toBe("BUTTON");
  });

  test("expand from a non-watch route navigates to the watch page", async () => {
    await renderApp(true);
    await attach("V1");
    await rerenderApp(false); // mini on a non-watch route
    await settleFrames();
    win.location.href = "http://localhost/";
    await act(async () => {
      (q('[aria-label="Expand miniplayer"]') as HTMLElement).click();
    });
    expect(navigations).toContain("/watch/V1");
  });

  test("expand while ON the watch page goes inline (no navigation), notifying expand listeners", async () => {
    await renderApp(true);
    await attach("V1");
    await act(async () => {
      playerHost.setMini(true); // scroll-docked mini on the watch page
    });
    let expanded = 0;
    playerHost.onExpand(() => {
      expanded += 1;
    });
    win.location.href = "http://localhost/watch/V1";
    await act(async () => {
      (q('[aria-label="Expand miniplayer"]') as HTMLElement).click();
    });
    expect(store().hostMode).toBe("inline");
    expect(expanded).toBe(1);
    expect(navigations).toHaveLength(0);
  });
});
