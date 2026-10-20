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
  EMBED_RETRY_NO_READY_MS,
  EMBED_HOSTS,
  NATIVE_NO_PLAY_MS,
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
/**
 * P26-HPV — a playback payload whose streamFormats carry video-only adaptive
 * entries (the NATIVE lane's fuel — exactly what parsePlayback now surfaces
 * for embed-disabled videos). The 360p entry (itag 134) must win the preview
 * pick over the 1080p one (itag 137): pickPreviewStreamFormat's
 * nearest-360p law.
 */
const playbackWithNativeStream = (id: string) => ({
  streamFormats: [
    {
      itag: 137,
      url: `https://rr5.googlevideo.com/videoplayback?itag=137&id=${id}`,
      mimeType: 'video/mp4; codecs="avc1.640028"',
      qualityLabel: "1080p",
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: 2500000,
      contentLength: null,
      approxDurationMs: "213089",
      hasAudio: false,
    },
    {
      itag: 134,
      url: `https://rr5.googlevideo.com/videoplayback?itag=134&id=${id}`,
      mimeType: 'video/mp4; codecs="avc1.4d401e"',
      qualityLabel: "360p",
      width: 640,
      height: 360,
      fps: 30,
      bitrate: 600000,
      contentLength: null,
      approxDurationMs: "213089",
      hasAudio: false,
    },
  ],
  storyboards: [
    { ...storyboardLevel(id), level: 1, frameWidth: 80, frameHeight: 45, cols: 10, rows: 10, sheetCount: 2 },
    storyboardLevel(id),
  ],
  durationSec: 213,
  source: "player",
});
/**
 * P26-HPV2 — the walled-class DTO (the REAL 2026-10-18 capture shape for
 * kJQP7kiw5Fk's class from the sandbox egress: source watch-page, ZERO
 * streamFormats — the ciphered itag18 + the ABR-track adaptiveFormats are
 * honestly filtered — storyboards + duration survive). This is the exact
 * payload the widened client chain + the watch-page rung produce for the
 * Vevo/music class today: the storyboard lane is the honest floor.
 */
const playbackWalledClassWatch = (id: string) => ({
  streamFormats: [],
  storyboards: [
    { ...storyboardLevel(id), level: 1, frameWidth: 80, frameHeight: 45, cols: 10, rows: 10, sheetCount: 2 },
    storyboardLevel(id),
  ],
  durationSec: 213,
  source: "watch-page",
});

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
  if (id.startsWith("NATIVE")) {
    return new Response(JSON.stringify(playbackWithNativeStream(id)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (id.startsWith("VEVO")) {
    return new Response(JSON.stringify(playbackWalledClassWatch(id)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    // P28-HPV4 — the host ladder: the FIRST boot rides the no-cookie host
    // (webflix-steel's endorsed domain), and the var bundle is MINIMAL
    // (the measured matrix's boot shape — the old noisy bundle is gone).
    expect(player.options["host"]).toBe(EMBED_HOSTS[0]);
    const vars = player.options["playerVars"] as Record<string, number>;
    expect(vars).toMatchObject({ autoplay: 1, mute: 1, controls: 0, playsinline: 1 });
    expect(vars).not.toHaveProperty("modestbranding");
    expect(vars).not.toHaveProperty("iv_load_policy");
    expect(vars).not.toHaveProperty("disablekb");
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
    // 2026-10-16 operator pass (hover speed): the storyboard frame stays
    // mounted UNDER the live embed — the crossfade base (no thumbnail flash
    // mid-fade); the embed owns the card visually.
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
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
    // 2026-10-16 operator pass (hover speed): with storyboard data in hand
    // (prefetched at card mount), the frames ANIMATE while the embed boots —
    // instant motion at the dwell exactly like youtube.com; the spinner
    // "loading" phase only shows when there is genuinely no storyboard yet.
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
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

  test("P22-A — a never-ready iframe (the wall) burns BOTH host boots at their deadlines → the settled floor (P28: the animation STOPS, the pill says it)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    expect(MockYTPlayer.instances[0].options["host"]).toBe(EMBED_HOSTS[0]); // nocookie first
    // the walled signature: onReady NEVER fires on EITHER host (the wall
    // never initializes the player — the watch page's own no-ready law).
    // Boot 1 dies at EMBED_NO_READY_MS; the retry (host 2, the tightened
    // EMBED_RETRY_NO_READY_MS window) dies too — only THEN is the lane dead.
    // Two staged sleeps (each with its own margin) — one long sleep races
    // boot 2's death under file-load timer drift.
    await act(async () => {
      await sleep(EMBED_NO_READY_MS + 500);
    });
    // boot 1 is dead; the retry has booted on the second host
    expect(MockYTPlayer.instances).toHaveLength(2);
    expect(MockYTPlayer.instances[1].options["host"]).toBe(EMBED_HOSTS[1]); // the youtube.com retry
    expect(MockYTPlayer.destroyed).toHaveLength(1); // one death, one destroy
    await act(async () => {
      await sleep(EMBED_RETRY_NO_READY_MS + 700);
    });
    expect(MockYTPlayer.instances).toHaveLength(2);
    expect(MockYTPlayer.destroyed).toHaveLength(2); // both boots destroyed
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    // P28-HPV4 — youtube.com's own measured floor law: on the settled
    // walled floor the storyboard animation STOPS (the frame layer
    // unmounts — the card's own static thumbnail shows through) and the
    // honest pill says what happened. A cycling slideshow on a known-dead
    // floor is exactly what the operator filed as the bug.
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(q('[data-testid="hover-preview-unavailable"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-mute"]')).toBeNull(); // chrome gone with it
  }, 15_000);

  test("P22-A/P28 — onError (embed-disabled 101/150 included) on the first boot RETRIES on the second host — and a healthy retry SAVES the preview", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.(); // the nocookie boot dies hard
    });
    expect(MockYTPlayer.destroyed).toHaveLength(1); // destroyed at once
    // the retry boot exists, on the OTHER host
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(2);
    const retry = livePlayer()!;
    expect(retry.options["host"]).toBe(EMBED_HOSTS[1]);
    // the retry comes ready and PLAYS → the preview is saved, phase embed
    await act(async () => {
      playerEvents(retry).onReady?.();
      playerEvents(retry).onStateChange({ data: 1 });
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull(); // the crossfade base
    expect(MockYTPlayer.destroyed).toHaveLength(1); // the retry lives
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

// ---- P26-HPV: the native lane — embed death plays the real video ----------

describe("P26-HPV — the native lane: embed death plays the real video (the operator's fix)", () => {
  const nativeVideoA = {
    id: "NATIVE00001",
    title: "Native lane A",
    thumbnailUrl: "https://i.ytimg.com/vi/NATIVE00001/hqdefault.jpg",
  };
  /** the format the preview picker must choose (nearest-360p beats 1080p) */
  const nativeFmtUrl = "https://rr5.googlevideo.com/videoplayback?itag=134&id=NATIVE00001";

  const previewVideoEl = () =>
    q('[data-testid="hover-preview-video"]') as unknown as HTMLVideoElement | null;

  /** Show in embed mode, then kill the embed ladder — BOTH host boots
   *  (P28-HPV4: the nocookie boot dies → the youtube.com retry boots →
   *  dies too → the lane is dead and the native lane arms). */
  async function embedToNative(video = nativeVideoA) {
    const { card, anchor } = await renderApp(video);
    await show(video, card, anchor);
    await act(async () => {
      await sleep(30); // the player + the playback fetch settle
    });
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.(); // boot 1 (nocookie) dies
    });
    await act(async () => {
      await sleep(30); // the retry constructs
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.(); // the retry (youtube.com) dies — the lane is dead
    });
    return { card, anchor };
  }

  test("embed onError → the native lane boots: the real stream through /api/stream, muted, playsInline, NO controls", async () => {
    await embedToNative();
    const video = previewVideoEl();
    expect(video).not.toBeNull();
    // P29-STREAM-REGEN — the src carries the video id + the picked itag so
    // the proxy can heal an IP-bound 403 from its own egress
    expect(video!.getAttribute("src")).toBe(
      `/api/stream?url=${encodeURIComponent(nativeFmtUrl)}&video=NATIVE00001&itag=134`
    );
    expect(video!.muted).toBe(true);
    expect(video!.hasAttribute("playsinline")).toBe(true);
    expect(video!.hasAttribute("autoplay")).toBe(true);
    expect(video!.hasAttribute("controls")).toBe(false); // OUR chrome drives it
    expect(video!.getAttribute("aria-hidden")).toBe("true"); // the layer carries the aria
    // the nearest-360p format won — NOT the 1080p one (the tiny preview box)
    expect(video!.getAttribute("src")).not.toContain("itag=137");
    // the embed ladder is gone; BOTH host boots destroyed (never two players)
    expect(q('[data-testid="hover-preview-embed"]')).toBeNull();
    expect(MockYTPlayer.destroyed).toHaveLength(2);
  });

  test("while the native video buffers (no events fired): phase storyboard + the video opacity-0 (the companion law)", async () => {
    await embedToNative();
    const video = previewVideoEl()!;
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(video.className).toContain("opacity-0");
    expect(video.className).not.toContain("opacity-100");
    // the frames animate underneath; no chrome yet (nothing proved playback)
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-mute"]')).toBeNull();
    expect(q('[data-testid="hover-preview-seek"]')).toBeNull();
  });

  test("playing → the native phase: the chrome present + the video visible (the frames stay as companion)", async () => {
    await embedToNative();
    const video = previewVideoEl()!;
    await act(() => {
      video.dispatchEvent(new win.Event("playing") as unknown as Event);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("native");
    expect(video.className).toContain("opacity-100");
    // youtube.com's preview chrome — the pill, the mute toggle, the timeline
    expect(q('[data-testid="hover-preview-mute"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-seek"]')).not.toBeNull();
    expect(q("[data-preview-phase]")!.textContent).toContain("Preview");
    // the storyboard frames stay mounted UNDER the playing video (crossfade base)
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
  });

  test("the chrome drives the element: mute toggle flips video.muted; a scrub sets currentTime; a timeupdate advances the fill", async () => {
    await embedToNative();
    const video = previewVideoEl()!;
    await act(() => {
      video.dispatchEvent(new win.Event("playing") as unknown as Event);
    });
    // happy-dom leaves duration a getter-only NaN — supply what the media
    // stack would have (the scrub needs a real duration to seek against)
    Object.defineProperty(video, "duration", { value: 213, configurable: true });
    // the mute toggle rides the element (the ops adapter's native lane)
    const mute = q('[data-testid="hover-preview-mute"]')!;
    expect(video.muted).toBe(true);
    await act(() => {
      mute.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    expect(video.muted).toBe(false);
    expect(q('[data-testid="hover-preview-mute"]')!.getAttribute("aria-label")).toBe("Mute preview");
    // a pointer scrub on the seek bar seeks the element itself
    const seek = q('[data-testid="hover-preview-seek"]')!;
    stubRect(seek, { left: 0, top: 0, width: 200, height: 16 });
    await act(() => {
      seek.dispatchEvent(
        new win.PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 1 }) as unknown as Event
      );
    });
    expect(video.currentTime).toBeCloseTo(106.5, 1); // 0.5 × 213
    const fill = q('[data-testid="hover-preview-seek-fill"]') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0); // the bar follows the pointer at once
    await act(() => {
      seek.dispatchEvent(
        new win.PointerEvent("pointerup", { bubbles: true, pointerId: 1 }) as unknown as Event
      );
    });
    // a timeupdate moves the fill through the same progress state the poll feeds
    video.currentTime = 60;
    await act(() => {
      video.dispatchEvent(new win.Event("timeupdate") as unknown as Event);
    });
    expect(parseFloat(fill.style.width)).toBeCloseTo((60 / 213) * 100, 1);
  });

  test("native onError → phase returns to storyboard (the settled floor: the animation stops, the pill says it) with the video gone", async () => {
    await embedToNative();
    const video = previewVideoEl()!;
    await act(() => {
      video.dispatchEvent(new win.Event("playing") as unknown as Event);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("native");
    await act(() => {
      video.dispatchEvent(new win.Event("error") as unknown as Event);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(previewVideoEl()).toBeNull(); // the dead lane unmounts its video
    // P28-HPV4 — the floor is final now: the frame layer unmounts (the
    // static thumbnail shows through) and the honest pill appears.
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(q('[data-testid="hover-preview-unavailable"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-mute"]')).toBeNull(); // chrome gone with the lane
  });

  test("embed death + NO streamFormats (walled payload) → storyboard-only — the pre-fix floor preserved (P28: settled, not animating)", async () => {
    // a plain storyboard payload (no formats): the fix raised the ladder
    // ABOVE the floor, it did not move the floor itself
    const slideVideo = {
      id: "SLIDES00001",
      title: "Storyboard only",
      thumbnailUrl: "https://i.ytimg.com/vi/SLIDES00001/hqdefault.jpg",
    };
    const { card, anchor } = await renderApp(slideVideo);
    await show(slideVideo, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    // P28-HPV4 — kill BOTH host boots (the ladder, not just the first boot)
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    await act(async () => {
      await sleep(30);
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    expect(previewVideoEl()).toBeNull(); // no formats → the native lane never arms
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    // the settled floor: the animation stopped, the pill honest
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(q('[data-testid="hover-preview-unavailable"]')).not.toBeNull();
  });

  test("P26-HPV2 — the walled Vevo class's REAL 2026-10-18 DTO (watch-page, cipher-filtered) → the settled storyboard floor, never a broken native lane", async () => {
    // the exact payload shape the widened chain + watch-page rung serve for
    // kJQP7kiw5Fk's class from the sandbox egress: storyboards + duration
    // survive, ZERO streamFormats (the ciphered formats honestly dropped —
    // no decipher exists in the current player world). The native lane never
    // arms on an empty surface — the storyboard floor is honest.
    const vevoVideo = {
      id: "VEVO0000001",
      title: "Walled Vevo class",
      thumbnailUrl: "https://i.ytimg.com/vi/VEVO0000001/hqdefault.jpg",
    };
    const { card, anchor } = await renderApp(vevoVideo);
    await show(vevoVideo, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    // P28-HPV4 — the host ladder: both boots die before the floor is final
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.(); // embed death on the walled class
    });
    await act(async () => {
      await sleep(30);
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    expect(previewVideoEl()).toBeNull(); // no plain formats → no native lane
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    // the SETTLED floor: static thumbnail + the honest pill (P28 — the
    // cycling companion is the loading lane's, not the floor's)
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(q('[data-testid="hover-preview-unavailable"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-mute"]')).toBeNull(); // no chrome without a video
  });

  test("NATIVE_NO_PLAY_MS zombie guard: a never-playing, never-erroring video goes dead after the window → the settled floor", async () => {
    await embedToNative();
    expect(previewVideoEl()).not.toBeNull();
    // no events fired, readyState stays 0 (< 2) — a hanging proxy fetch must
    // not keep a dead lane armed (the real-clock proof, EMBED_*_MS pattern)
    await act(async () => {
      await sleep(NATIVE_NO_PLAY_MS + 400);
    });
    expect(previewVideoEl()).toBeNull(); // the zombie was disarmed
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    // the floor settled — the animation stopped, the pill says it
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(q('[data-testid="hover-preview-unavailable"]')).not.toBeNull();
  }, 15_000);

  test("reduced motion (storyboard lane): no video element ever renders — the device policy is unchanged", async () => {
    const real = (win as unknown as Record<string, unknown>).matchMedia;
    setMatchMedia((query) => query.includes("prefers-reduced-motion"));
    const nativeVideoB = {
      id: "NATIVE00002",
      title: "Native lane B",
      thumbnailUrl: "https://i.ytimg.com/vi/NATIVE00002/hqdefault.jpg",
    };
    const { card, anchor } = await renderApp(nativeVideoB);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await enter(card);
    await act(async () => {
      await sleep(850); // past the dwell — the storyboard lane shows
    });
    await act(async () => {
      await sleep(30); // the fetch settles (formats ARE available for this id)
    });
    expect(previewStore().snapshot.mode).toBe("storyboard");
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(previewVideoEl()).toBeNull(); // never a <video> on the frames-only lane
    expect(q("video")).toBeNull();
    (win as unknown as Record<string, unknown>).matchMedia = real;
  });
});

describe("P26B-HPV3 — the walled-floor pill (the operator's 2026-10-19 re-file: a silent slideshow reads as a broken preview)", () => {
  const pill = () => q('[data-testid="hover-preview-unavailable"]');
  const previewVideoEl = () =>
    q('[data-testid="hover-preview-video"]') as unknown as HTMLVideoElement | null;

  /** Show in embed mode, then kill the embed LADDER (both host boots —
   *  P28-HPV4: onError on boot 1, then onError on the retry) so the
   *  floor is genuinely final. */
  async function embedDeathFloor(video: { id: string; title: string; thumbnailUrl?: string | null }) {
    const { card, anchor } = await renderApp(video);
    await show(video, card, anchor);
    await act(async () => {
      await sleep(30); // the player + the playback fetch settle
    });
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    await act(async () => {
      await sleep(30); // the retry constructs
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
  }

  test("the walled Vevo class floor SAYS what it is: the pill over the STATIC thumbnail (P28 — the animation stops on the settled floor)", async () => {
    // the operator's exact symptom class: embed death + a cipher-filtered
    // payload (storyboards, zero formats) — the floor is final, and a silent
    // cycling slideshow is how they read it as "the preview is not working".
    // The pill is the honest degrade the house law demands; P28 adds
    // youtube.com's own law — the floor never ANIMATES either.
    const vevoVideo = {
      id: "VEVO0000002",
      title: "Walled Vevo floor",
      thumbnailUrl: "https://i.ytimg.com/vi/VEVO0000002/hqdefault.jpg",
    };
    await embedDeathFloor(vevoVideo);
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    // the frame layer is GONE (the card's static thumbnail shows through
    // the preview layer) — never a cycling slideshow on a known-dead floor
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
    expect(pill()).not.toBeNull();
    expect(pill()!.textContent).toContain("Preview unavailable");
    expect(pill()!.getAttribute("title")).toContain("blocked");
  });

  test("the no-storyboard degrade (fetch settled, nothing usable at all) shows the pill too — the ken-burns floor is equally final", async () => {
    const walledVideo = {
      id: "WALL0000002",
      title: "Fully walled",
      thumbnailUrl: "https://i.ytimg.com/vi/WALL0000002/hqdefault.jpg",
    };
    await embedDeathFloor(walledVideo);
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("degraded");
    expect(pill()).not.toBeNull();
  });

  test("NEVER during a lane's boot: a healthy-but-slow embed keeps the pill off (the storyboard companion is loading state, not the floor)", async () => {
    const { card, anchor } = await renderApp(videoA);
    await show(videoA, card, anchor);
    await act(async () => {
      await sleep(30); // embed booting, storyboard data in hand → companion
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(pill()).toBeNull(); // the embed lane is still live — no floor yet
    const player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onReady?.();
      playerEvents(player).onStateChange({ data: 1 }); // PLAYING
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    expect(pill()).toBeNull();
  });

  test("NEVER on the native lane — not while it buffers (companion), not while it plays", async () => {
    const nativeVideoC = {
      id: "NATIVE00003",
      title: "Native lane C",
      thumbnailUrl: "https://i.ytimg.com/vi/NATIVE00003/hqdefault.jpg",
    };
    const { card, anchor } = await renderApp(nativeVideoC);
    await show(nativeVideoC, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    // P28-HPV4 — the full ladder dies (both host boots) before the native
    // lane arms
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    await act(async () => {
      await sleep(30);
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    expect(previewVideoEl()).not.toBeNull();
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard"); // companion
    expect(pill()).toBeNull(); // a lane is armed — the floor is NOT final
    const video = previewVideoEl()!;
    await act(() => {
      video.dispatchEvent(new win.Event("playing") as unknown as Event);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("native");
    expect(pill()).toBeNull();
  });

  test("native death (the stream itself fails) returns to the floor AND arms the pill", async () => {
    const nativeVideoD = {
      id: "NATIVE00004",
      title: "Native lane D",
      thumbnailUrl: "https://i.ytimg.com/vi/NATIVE00004/hqdefault.jpg",
    };
    const { card, anchor } = await renderApp(nativeVideoD);
    await show(nativeVideoD, card, anchor);
    await act(async () => {
      await sleep(30);
    });
    // P28-HPV4 — the full ladder dies (both host boots) first
    let player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    await act(async () => {
      await sleep(30);
    });
    player = livePlayer()!;
    await act(async () => {
      playerEvents(player).onError?.();
    });
    const video = previewVideoEl()!;
    expect(pill()).toBeNull(); // still armed
    await act(() => {
      video.dispatchEvent(new win.Event("error") as unknown as Event); // the proxy stream dies
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(pill()).not.toBeNull(); // the floor is final now
  });

  test("NEVER on the reduced-motion lane — storyboard-only is that lane's DESIGN, not a degrade", async () => {
    const real = (win as unknown as Record<string, unknown>).matchMedia;
    setMatchMedia((query) => query.includes("prefers-reduced-motion"));
    const { card, anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await enter(card);
    await act(async () => {
      await sleep(850); // past the dwell
    });
    await act(async () => {
      await sleep(30); // the storyboard fetch settles
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(pill()).toBeNull(); // the designed lane, never the walled floor
    (win as unknown as Record<string, unknown>).matchMedia = real;
  });
});
