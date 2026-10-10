/// <reference types="bun-types" />
/**
 * Hover preview tests — WFX2-P6-HP (storyboard lane) + P12-UX Task 4 (the
 * embed lane) + P22-A (the mini player that PLAYS: the fair health gate +
 * youtube.com's preview chrome).
 *
 * What must hold:
 *  - the 600ms dwell gate (arm → wait → show; leave before the delay cancels);
 *  - storyboard mode / reduced motion: NO YT player is created on this lane
 *    (asserted with a stubbed window.YT at zero instances) and the sprite
 *    frames animate (sheet URL with $N → M<k>, background-position stepping);
 *  - P22-A embed health (the fix for the operator's zoom bug): the embed
 *    gets a FAIR window — onReady belt-and-braces mutes + plays, a
 *    not-yet-playing embed is still ALIVE well past P12's old 1.5s
 *    construction deadline, BUFFERING extends the playing deadline once,
 *    onError and a never-ready iframe (EMBED_NO_READY_MS) destroy it and
 *    the storyboard takes over — never a walled iframe, never a murdered
 *    healthy one;
 *  - P22-A the preview chrome: PLAYING → the embed phase carries the mute
 *    toggle (aria-label flips, unMute/mute ride the live player) and the
 *    scrubbable timeline (role=slider, progress fill from the polled
 *    getCurrentTime/getDuration, pointer scrub → seekTo, keyboard step);
 *  - P22-A riding the controls keeps the preview: the card's mouseleave
 *    onto the layer's controls is ignored, the controls' mouseleave onto
 *    the hovered card is ignored, and only a real exit hides;
 *  - coarse pointer (touch): the dwell never shows a preview at all;
 *  - show → positioned over the anchor rect (fixed geometry, the card's
 *    own bounds — zero layout shift);
 *  - no storyboard (walled egress / fetch error) → the subtle zoom/pan
 *    degrade on the thumbnail (never a broken box);
 *  - scroll-to-hide; hide and retarget destroy the previous player
 *    (never two).
 *
 * happy-dom + createRoot/act (the youtube-player.test.tsx pattern) with a
 * stubbed global fetch serving PlaybackDto payloads per video id. bun 1.3
 * has no fake timers API, so the dwell boundary, the frame tick and the
 * health deadlines are proven with the real clock (a setTimeout can never
 * fire early).
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  useHoverPreview,
  VideoHoverPreviewLayer,
  EMBED_NO_READY_MS,
  EMBED_PLAYING_MS,
} from "@/components/video/video-hover-preview";

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

// ---- YT iframe API stub — the mock the component drives by hand ----------
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  el: Element;
  options: Record<string, unknown>;
  /** the live player state the controls read (tests mutate freely) */
  mutedState = true;
  time = 0;
  duration = 0;
  calls = { mute: 0, unMute: 0, playVideo: 0, seekTo: [] as Array<[number, boolean]> };
  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
  /** Passive stub: never reports playback by itself (tests fire events). */
  getPlayerState(): number {
    return -1;
  }
  mute(): void {
    this.calls.mute += 1;
    this.mutedState = true;
  }
  unMute(): void {
    this.calls.unMute += 1;
    this.mutedState = false;
  }
  isMuted(): boolean {
    return this.mutedState;
  }
  playVideo(): void {
    this.calls.playVideo += 1;
  }
  seekTo(seconds: number, allowSeekAhead: boolean): void {
    this.calls.seekTo.push([seconds, allowSeekAhead]);
    this.time = seconds;
  }
  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return this.duration;
  }
}
(win as unknown as Record<string, unknown>).YT = { Player: MockYTPlayer, PlayerState: {} };

// ---- fetch stub: /api/videos/<id>/playback per video id ----
const realFetch = globalThis.fetch;
const fetchedUrls: string[] = [];
/** Every playback fetch across the WHOLE file session (never reset — the
 *  fetchPlayback client cache means one request per video per session, a
 *  cross-test property the per-test fetchedUrls view cannot express). */
const totalPlaybackFetches: string[] = [];
/** Real numbers from the dQw4 storyboard spec (L2): 160x90 frames, 5x5 per sheet, 108 frames. */
const storyboardLevel = (id: string) => ({
  level: 2,
  templateUrl: `https://i.ytimg.com/sb/${id}/storyboard3_L2/$N.jpg?sqp=test&level2sig`,
  frameWidth: 160,
  frameHeight: 90,
  cols: 5,
  rows: 5,
  intervalMs: 2000,
  frameCount: 108,
  sheetCount: 5,
});
const playbackWithStoryboard = (id: string) => ({
  streamFormats: [],
  storyboards: [
    { ...storyboardLevel(id), level: 1, frameWidth: 80, frameHeight: 45, cols: 10, rows: 10, sheetCount: 2 },
    storyboardLevel(id),
  ],
  durationSec: 213,
  source: "watch-page",
});
const playbackWalled = {
  streamFormats: [],
  storyboards: [],
  durationSec: null,
  source: "",
};
/** (Re)install the stub — afterEach restores the REAL fetch, so every test
 *  must re-install it or fetchPlayback falls through to the network. */
const installFetchStub = () => {
  globalThis.fetch = stubbedFetch;
};
const stubbedFetch: typeof fetch = (async (url: string | URL | Request) => {
  const href = String(url);
  fetchedUrls.push(href);
  const m = /\/api\/videos\/([^/]+)\/playback/.exec(href);
  if (m) totalPlaybackFetches.push(href);
  if (!m) return new Response("{}", { status: 200 });
  const id = decodeURIComponent(m[1]);
  if (id.startsWith("WALL")) {
    return new Response(JSON.stringify(playbackWalled), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (id.startsWith("FAIL")) {
    return new Response("nope", { status: 500 });
  }
  return new Response(JSON.stringify(playbackWithStoryboard(id)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- the shared globalThis preview store (the component's own lane) ----
interface TestStore {
  snapshot: {
    video: { id: string; title: string; thumbnailUrl?: string | null } | null;
    rect: DOMRect | null;
    mode: "embed" | "storyboard";
    card: HTMLElement | null;
  };
  listeners: Set<() => void>;
  show: (
    video: { id: string; title: string; thumbnailUrl?: string | null },
    card: HTMLElement,
    anchor: HTMLElement,
    mode?: "embed" | "storyboard"
  ) => void;
  hide: () => void;
}
const previewStore = (): TestStore => {
  const s = (globalThis as unknown as { __wfxPreviewStore?: TestStore }).__wfxPreviewStore;
  if (!s) throw new Error("preview store missing on globalThis");
  return s;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const videoA = { id: "AAAAAAAAAAA", title: "Preview A", thumbnailUrl: "https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg" };
const videoB = { id: "BBBBBBBBBBB", title: "Preview B", thumbnailUrl: "https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg" };

// ---- harness: a card with the dwell hook + the real shared layer ----------

function PreviewCard({ video }: { video: { id: string; title: string } }) {
  const hover = useHoverPreview(video);
  return (
    <article
      data-card={video.id}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <div data-thumb-anchor="">thumbnail</div>
    </article>
  );
}

function App({ video }: { video: { id: string; title: string } }) {
  return (
    <div>
      <PreviewCard video={video} />
      <VideoHoverPreviewLayer />
    </div>
  );
}

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

/** Query the rendered tree (cast through unknown: happy-dom element tree). */
const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

async function renderApp(video: { id: string; title: string }) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<App video={video} />);
  });
  await sleep(10); // mount effects settle
  return {
    card: q("[data-card]") as HTMLElement,
    anchor: q("[data-thumb-anchor]") as HTMLElement,
  };
}

/** Stub the anchor rect (happy-dom's getBoundingClientRect is all zeros). */
function stubRect(
  el: HTMLElement,
  r: { left: number; top: number; width: number; height: number }
) {
  el.getBoundingClientRect = () =>
    ({
      x: r.left,
      y: r.top,
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      width: r.width,
      height: r.height,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
}

/** Direct store paths (the layer + hook are the same store's consumers). */
const show = (
  video: { id: string; title: string; thumbnailUrl?: string | null },
  card: HTMLElement,
  anchor: HTMLElement
) =>
  act(async () => {
    previewStore().show(video, card, anchor, "embed");
  });
const hide = () =>
  act(async () => {
    previewStore().hide();
  });

/** React synthesizes mouseenter/mouseleave from over/out (delegated). */
const enter = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
  });
/** happy-dom's MouseEvent init types its own EventTarget — cast through
 *  unknown (the runtime accepts any node; only the types disagree). */
const mouseOutInit = (relatedTarget?: Node) =>
  ({
    bubbles: true,
    ...(relatedTarget ? { relatedTarget } : {}),
  }) as unknown as ConstructorParameters<typeof win.MouseEvent>[1];
const leave = (el: HTMLElement, relatedTarget?: Node) =>
  act(() => {
    el.dispatchEvent(new win.MouseEvent("mouseout", mouseOutInit(relatedTarget)) as unknown as Event);
  });

/** The last created (still alive) mock player. */
const livePlayer = () => MockYTPlayer.instances.filter((p) => !MockYTPlayer.destroyed.includes(p)).at(-1);
const playerEvents = (p: MockYTPlayer) => p.options["events"] as {
  onReady?: () => void;
  onStateChange: (e: { data: number }) => void;
  onError?: () => void;
};

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  fetchedUrls.length = 0;
  installFetchStub();
  const s = previewStore();
  s.snapshot = { video: null, rect: null, mode: "storyboard", card: null };
  for (const l of s.listeners) l();
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

describe("hover preview — dwell gate (600ms before store.show)", () => {
  test("the preview shows only after the 600ms hover delay", async () => {
    const { card } = await renderApp(videoA);
    // dormant: the always-mounted layer shell exists, nothing visible
    expect(q("[data-hover-preview-layer]")).not.toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    await enter(card);
    await act(async () => {
      await sleep(250); // < 600ms: the dwell has not elapsed
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    await act(async () => {
      await sleep(600); // 850ms total: well past the dwell
    });
    expect(previewStore().snapshot.video?.id).toBe("AAAAAAAAAAA");
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
  });

  test("leaving before the dwell cancels the preview (no show, no fetch)", async () => {
    const { card } = await renderApp(videoA);
    await enter(card);
    await act(async () => {
      await sleep(250);
    });
    await leave(card);
    await act(async () => {
      await sleep(600); // past the dwell — the cancelled timer never fires
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    expect(fetchedUrls).toHaveLength(0); // nothing fetched without a show
  });

  test("P22-A — the card rides the snapshot (the controls' leave logic needs it)", async () => {
    const { card } = await renderApp(videoA);
    await enter(card);
    await act(async () => {
      await sleep(650);
    });
    expect(previewStore().snapshot.card).toBe(card);
  });
});

describe("hover preview — the storyboard lane (primary in storyboard mode, fallback for the embed lane)", () => {
  test("show → positioned over the anchor + the storyboard frame renders sheet M0 at frame 0", async () => {
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await act(async () => {
      previewStore().show(videoA, card, anchor); // storyboard mode (default)
    });
    await act(async () => {
      await sleep(30); // the fetch + pick settle
    });
    const layer = q('[data-testid="hover-preview"]');
    expect(layer).not.toBeNull();
    // P22-A: the layer is a LABELED region now (it carries real controls in
    // the embed phase — focusable content may never hide in aria-hidden);
    // the parked state is excluded from the tree by visibility:hidden.
    expect(layer!.getAttribute("aria-hidden")).toBeNull();
    expect(layer!.getAttribute("aria-label")).toBe("Video preview");
    // fixed over the anchor rect
    expect(layer!.style.left).toBe("10px");
    expect(layer!.style.top).toBe("20px");
    expect(layer!.style.width).toBe("300px");
    expect(layer!.style.height).toBe("169px");
    // the storyboard phase — level 2 (160x90 frames, fewest sheets)
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    const frame = q('[data-testid="storyboard-frame"]') as HTMLElement;
    expect(frame).not.toBeNull();
    // frame 0 → sheet M0, grid origin
    expect(frame.style.backgroundImage).toContain(
      "https://i.ytimg.com/sb/AAAAAAAAAAA/storyboard3_L2/M0.jpg?sqp=test&level2sig"
    );
    expect(frame.style.backgroundSize).toBe("800px 450px"); // 5×160 × 5×90
    expect(frame.style.backgroundPosition).toBe("0px 0px");
    // storyboard-mode property: this lane creates no YT player at all
    expect(MockYTPlayer.instances).toHaveLength(0);
  });

  test("the frame cursor advances on the tick (background-position steps through the grid)", async () => {
    const { anchor } = await renderApp(videoB);
    await act(async () => {
      previewStore().show(videoB, host as unknown as HTMLElement, anchor);
    });
    await act(async () => {
      await sleep(30);
    });
    const frame = q('[data-testid="storyboard-frame"]') as HTMLElement;
    expect(frame.style.backgroundPosition).toBe("0px 0px");
    await act(async () => {
      await sleep(1150); // one 1000ms tick
    });
    // frame 1 → col 1 of row 0
    expect(frame.style.backgroundPosition).toBe("-160px 0px");
    // still ONE sheet image (M0) — no new iframe, no player
    expect(MockYTPlayer.instances).toHaveLength(0);
  });

  test("no storyboard (walled egress) → the zoom/pan degrade on the thumbnail, never a broken iframe", async () => {
    const wallVideo = { id: "WALL0000001", title: "Walled", thumbnailUrl: "https://i.ytimg.com/vi/WALL0000001/hqdefault.jpg" };
    const { anchor } = await renderApp(wallVideo);
    await act(async () => {
      previewStore().show(wallVideo, host as unknown as HTMLElement, anchor);
    });
    await act(async () => {
      await sleep(30);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("degraded");
    // the thumbnail carries the ken-burns zoom/pan class
    const img = q("[data-preview-phase] img") as HTMLElement;
    expect(img).not.toBeNull();
    expect(img.className).toContain("wfx-kenburns");
    // no storyboard frames, and still zero YT players (no wall can appear)
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(MockYTPlayer.instances).toHaveLength(0);
  });

  test("a fetch failure degrades to zoom/pan too (honest, quiet)", async () => {
    const failVideo = { id: "FAIL0000001", title: "Fetch fails", thumbnailUrl: "https://i.ytimg.com/vi/FAIL0000001/hqdefault.jpg" };
    const { anchor } = await renderApp(failVideo);
    await act(async () => {
      previewStore().show(failVideo, host as unknown as HTMLElement, anchor);
    });
    await act(async () => {
      await sleep(30);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("degraded");
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
  });

  test("scrolling hides the preview (the anchor rect goes stale)", async () => {
    const { anchor } = await renderApp(videoA);
    await act(async () => {
      previewStore().show(videoA, host as unknown as HTMLElement, anchor);
    });
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
    await act(() => {
      win.dispatchEvent(new win.Event("scroll"));
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });

  test("hide → re-show restarts the animation at frame 0 on the cached storyboard", async () => {
    const { anchor } = await renderApp(videoA);
    await act(async () => {
      previewStore().show(videoA, host as unknown as HTMLElement, anchor);
    });
    await act(async () => {
      await sleep(30);
    });
    await act(async () => {
      await sleep(1150); // advance one frame
    });
    let frame = q('[data-testid="storyboard-frame"]') as HTMLElement;
    expect(frame.style.backgroundPosition).toBe("-160px 0px");
    await hide();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    await act(async () => {
      previewStore().show(videoA, host as unknown as HTMLElement, anchor);
    });
    await act(async () => {
      await sleep(30);
    });
    frame = q('[data-testid="storyboard-frame"]') as HTMLElement;
    expect(frame.style.backgroundPosition).toBe("0px 0px"); // frame 0 again
    // the client cache means the playback endpoint was hit exactly ONCE for A
    // across the whole file session (test 1's fetch) — the re-show never refetches
    expect(totalPlaybackFetches.filter((u) => u.includes("AAAAAAAAAAA"))).toHaveLength(1);
  });
});

// ---- P22-A: the embed lane — the fair health gate + the preview chrome ----

/** Override happy-dom's matchMedia for a device-policy test (restored by the caller). */
const setMatchMedia = (matches: (query: string) => boolean) => {
  (win as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
};

describe("P22-A — the embed lane: the fair health gate (the zoom bug's fix)", () => {
  test("embed mode: ONE muted autoplaying player created; PLAYING → embed phase with the chrome", async () => {
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30); // the api microtask creates the player
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    const player = MockYTPlayer.instances[0];
    expect(player.options["videoId"]).toBe("AAAAAAAAAAA");
    const vars = player.options["playerVars"] as Record<string, number>;
    expect(vars).toMatchObject({ autoplay: 1, mute: 1, controls: 0, playsinline: 1 });
    // the embed reports PLAYING → the embed phase with youtube.com's chrome
    await act(async () => {
      playerEvents(player).onStateChange({ data: 1 });
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    // the mute toggle + the timeline (the old "Muted" pill is gone — the
    // button IS the affordance now, exactly like youtube.com's preview)
    expect(q('[data-testid="hover-preview-muted"]')).toBeNull();
    const mute = q('[data-testid="hover-preview-mute"]');
    expect(mute).not.toBeNull();
    expect(mute!.getAttribute("aria-label")).toBe("Unmute preview");
    const seek = q('[data-testid="hover-preview-seek"]');
    expect(seek).not.toBeNull();
    expect(seek!.getAttribute("role")).toBe("slider");
    expect(q('[data-testid="storyboard-frame"]')).toBeNull(); // storyboard waits its turn
  });

  test("P22-A — a ready-but-slow embed SURVIVES past P12's 1.5s construction deadline (the regression pin)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    expect(player).toBeDefined();
    // onReady arrives; the player belt-and-braces mutes + plays…
    await act(async () => {
      playerEvents(player).onReady?.();
    });
    expect(player.calls.mute).toBeGreaterThanOrEqual(1);
    expect(player.calls.playVideo).toBeGreaterThanOrEqual(1);
    // …but playback itself is slow (cold first buffer). P12's flat
    // EMBED_HEALTH_MS=1500 deadline destroyed exactly here — the bug the
    // operator reported. The P22 gate keeps the embed alive.
    await act(async () => {
      await sleep(1700); // > 1500 (old deadline), < EMBED_PLAYING_MS (4000)
    });
    expect(MockYTPlayer.destroyed).toHaveLength(0); // STILL ALIVE
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("loading");
    // and when playback finally starts, the embed wins the card
    await act(async () => {
      playerEvents(player).onStateChange({ data: 1 });
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    expect(MockYTPlayer.destroyed).toHaveLength(0);
  }, 10_000);

  test("P22-A — BUFFERING extends the playing deadline once (slow-but-working embeds pass)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 3 }); // BUFFERING
    });
    // BUFFERING crossfades the embed in immediately…
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    // …and extends the deadline: alive well past the base EMBED_PLAYING_MS
    await act(async () => {
      await sleep(EMBED_PLAYING_MS + 400); // past the base window, inside the 2× extension
    });
    expect(MockYTPlayer.destroyed).toHaveLength(0); // the extension held
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    await act(async () => {
      playerEvents(player).onStateChange({ data: 1 }); // PLAYING arrives
    });
    expect(MockYTPlayer.destroyed).toHaveLength(0);
  }, 12_000);

  test("P22-A — a never-ready iframe (the wall) is destroyed at the no-ready deadline → storyboard takes over", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    // the walled signature: onReady NEVER fires (the wall never initializes
    // the player — the watch page's own no-ready law)
    await act(async () => {
      await sleep(EMBED_NO_READY_MS + 400); // past the no-ready deadline
    });
    expect(MockYTPlayer.destroyed).toHaveLength(1); // the embed was destroyed
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-mute"]')).toBeNull(); // chrome gone with it
  }, 15_000);

  test("P22-A — onError (embed-disabled 101/150 included) destroys the embed immediately → storyboard", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 }); // healthy…
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    await act(async () => {
      playerEvents(player).onError?.(); // …then the video errors mid-flight
    });
    expect(MockYTPlayer.destroyed).toHaveLength(1); // destroyed at once
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
  });

  test("hide destroys the embed (the single-instance law, exit side)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    await hide();
    expect(MockYTPlayer.destroyed).toHaveLength(1);
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });

  test("retarget A → B: the previous embed is destroyed (never two players)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const first = MockYTPlayer.instances[0];
    await act(async () => {
      previewStore().show(videoB, card, anchor, "embed");
    });
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(2); // created twice in total
    expect(MockYTPlayer.destroyed).toContain(first); // …but the first was retired
    const alive = MockYTPlayer.instances.filter((p) => !MockYTPlayer.destroyed.includes(p));
    expect(alive).toHaveLength(1); // exactly ONE live preview player
  });

  test("coarse pointer (touch): the dwell never shows a preview at all (youtube.com shows none)", async () => {
    const real = (win as unknown as Record<string, unknown>).matchMedia;
    setMatchMedia((query) => query.includes("coarse"));
    const { card } = await renderApp(videoA);
    await enter(card);
    await act(async () => {
      await sleep(850); // past the dwell
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    expect(fetchedUrls).toHaveLength(0); // nothing fetched, nothing armed
    expect(MockYTPlayer.instances).toHaveLength(0);
    (win as unknown as Record<string, unknown>).matchMedia = real;
  });

  test("reduced motion: the dwell shows the STORYBOARD lane only (no embed player)", async () => {
    const real = (win as unknown as Record<string, unknown>).matchMedia;
    setMatchMedia((query) => query.includes("prefers-reduced-motion"));
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await enter(card);
    await act(async () => {
      await sleep(850); // past the dwell
    });
    expect(previewStore().snapshot.video?.id).toBe("AAAAAAAAAAA");
    await act(async () => {
      await sleep(30); // the storyboard fetch settles
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(MockYTPlayer.instances).toHaveLength(0); // storyboard-only, no embed
    (win as unknown as Record<string, unknown>).matchMedia = real;
  });
});

describe("P22-A — the preview chrome (youtube.com's timeline + mute toggle)", () => {
  /** Show + drive one player to PLAYING with the given playback state. */
  async function embedWithProgress(time: number, duration: number) {
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 0, top: 0, width: 300, height: 169 });
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    player.time = time;
    player.duration = duration;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 });
    });
    return { player, card };
  }

  test("the timeline tracks the polled playback position (fill width, aria values)", async () => {
    await embedWithProgress(10.5, 213);
    await act(async () => {
      await sleep(400); // one 250ms poll tick
    });
    const seek = q('[data-testid="hover-preview-seek"]')!;
    expect(seek.getAttribute("role")).toBe("slider");
    expect(seek.getAttribute("aria-label")).toBe("Seek preview");
    expect(seek.getAttribute("aria-valuemin")).toBe("0");
    expect(seek.getAttribute("aria-valuemax")).toBe("213");
    expect(seek.getAttribute("aria-valuenow")).toBe("11"); // Math.round(10.5)
    expect(seek.getAttribute("aria-valuetext")).toBe("0:10 of 3:33");
    const fill = q('[data-testid="hover-preview-seek-fill"]') as HTMLElement;
    const pct = parseFloat(fill.style.width);
    expect(pct).toBeCloseTo((10.5 / 213) * 100, 1);
  });

  test("pointer scrub seeks the live player (pointerdown → seekTo at the fraction)", async () => {
    const { player } = await embedWithProgress(0, 213);
    await act(async () => {
      await sleep(400); // poll settles
    });
    const seek = q('[data-testid="hover-preview-seek"]')!;
    stubRect(seek, { left: 0, top: 0, width: 200, height: 16 });
    await act(() => {
      seek.dispatchEvent(
        new win.PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 1 }) as unknown as Event
      );
    });
    // 100/200 = 0.5 → seekTo(213 × 0.5) — the drag begins
    expect(player.calls.seekTo).toContainEqual([106.5, true]);
    const fill = q('[data-testid="hover-preview-seek-fill"]') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0); // the bar follows the pointer at once
    await act(() => {
      seek.dispatchEvent(
        new win.PointerEvent("pointerup", { bubbles: true, pointerId: 1 }) as unknown as Event
      );
    });
  });

  test("keyboard steps the timeline (ArrowRight +5s, ArrowLeft −5s)", async () => {
    const { player } = await embedWithProgress(10, 213);
    await act(async () => {
      await sleep(400); // poll settles at 10s
    });
    const seek = q('[data-testid="hover-preview-seek"]')!;
    await act(() => {
      seek.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event
      );
    });
    expect(player.calls.seekTo).toContainEqual([15, true]);
    await act(() => {
      seek.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }) as unknown as Event
      );
    });
    expect(player.calls.seekTo).toContainEqual([10, true]); // 15 − 5
  });

  test("the mute toggle rides the live player (unMute → label flips → mute back)", async () => {
    await embedWithProgress(0, 213);
    const mute = q('[data-testid="hover-preview-mute"]')!;
    expect(mute.getAttribute("aria-label")).toBe("Unmute preview"); // starts muted
    await act(() => {
      mute.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    const player = livePlayer()!;
    expect(player.calls.unMute).toBe(1);
    expect(q('[data-testid="hover-preview-mute"]')!.getAttribute("aria-label")).toBe("Mute preview");
    await act(() => {
      q('[data-testid="hover-preview-mute"]')!.dispatchEvent(
        new win.MouseEvent("click", { bubbles: true }) as unknown as Event
      );
    });
    expect(player.calls.mute).toBeGreaterThanOrEqual(1); // the ready belt-and-braces mute + this one
    expect(q('[data-testid="hover-preview-mute"]')!.getAttribute("aria-label")).toBe("Unmute preview");
  });
});

describe("P22-A — riding the controls keeps the preview (the layer is a fixed sibling, not a card child)", () => {
  test("leaving the card ONTO the controls does not hide the preview", async () => {
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 0, top: 0, width: 300, height: 169 });
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 });
    });
    const mute = q('[data-testid="hover-preview-mute"]')!;
    await leave(card, mute); // card → the layer's control
    expect(previewStore().snapshot.video?.id).toBe("AAAAAAAAAAA"); // still showing
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
  });

  test("leaving the controls BACK ONTO the card does not hide the preview", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 });
    });
    const mute = q('[data-testid="hover-preview-mute"]')!;
    await act(() => {
      mute.dispatchEvent(
        new win.MouseEvent("mouseout", mouseOutInit(card)) as unknown as Event
      );
    });
    expect(previewStore().snapshot.video?.id).toBe("AAAAAAAAAAA"); // still showing
  });

  test("leaving the controls for anywhere else hides the preview", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 });
    });
    const mute = q('[data-testid="hover-preview-mute"]')!;
    await act(() => {
      mute.dispatchEvent(
        new win.MouseEvent("mouseout", mouseOutInit(win.document.body as unknown as Node)) as unknown as Event
      );
    });
    expect(previewStore().snapshot.video).toBeNull(); // hidden — a real exit
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });
});
