/// <reference types="bun-types" />
/**
 * Hover preview tests — WFX2-P6-HP (storyboard lane) + P12-UX Task 4 (the
 * embed lane: each hovered card is a MINI VIDEO PLAYER).
 *
 * What must hold:
 *  - the 600ms dwell gate (arm → wait → show; leave before the delay cancels);
 *  - storyboard mode / reduced motion: NO YT player is created on this lane
 *    (asserted with a stubbed window.YT at zero instances) and the sprite
 *    frames animate (sheet URL with $N → M<k>, background-position stepping);
 *  - P12-UX embed mode: ONE muted autoplaying player created per show with
 *    autoplay+mute+controls:0 vars; PLAYING → "embed" phase + the muted
 *    pill, no storyboard frame; a walled embed (never plays) is DESTROYED
 *    at the EMBED_HEALTH_MS deadline and the storyboard takes over; hide
 *    and retarget destroy the previous player (never two);
 *  - coarse pointer (touch): the dwell never shows a preview at all;
 *  - show → positioned over the anchor rect (fixed geometry, the card's
 *    own bounds — zero layout shift);
 *  - no storyboard (walled egress / fetch error) → the subtle zoom/pan
 *    degrade on the thumbnail (never a broken box);
 *  - scroll-to-hide.
 *
 * happy-dom + createRoot/act (the youtube-player.test.tsx pattern) with a
 * stubbed global fetch serving PlaybackDto payloads per video id. bun 1.3
 * has no fake timers API, so the dwell boundary and the 1s frame tick are
 * proven with the real clock (a setTimeout can never fire early).
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  useHoverPreview,
  VideoHoverPreviewLayer,
  EMBED_HEALTH_MS,
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

// ---- YT iframe API stub — MUST stay unused (the anti-wall property) ----
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
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
  /** Passive stub: never reports playback (drives the fallback path). */
  getPlayerState(): number {
    return -1;
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
  };
  listeners: Set<() => void>;
  show: (
    video: { id: string; title: string; thumbnailUrl?: string | null },
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
  anchor: HTMLElement
) =>
  act(async () => {
    previewStore().show(video, anchor);
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
const leave = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
  });

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  fetchedUrls.length = 0;
  installFetchStub();
  const s = previewStore();
  s.snapshot = { video: null, rect: null, mode: "storyboard" };
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
});

describe("hover preview — the storyboard lane (primary in storyboard mode, fallback for the embed lane)", () => {
  test("show → positioned over the anchor + the storyboard frame renders sheet M0 at frame 0", async () => {
    const { anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await show(videoA, anchor);
    await act(async () => {
      await sleep(30); // the fetch + pick settle
    });
    const layer = q('[data-testid="hover-preview"]');
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute("aria-hidden")).toBe("true"); // decorative
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
    await show(videoB, anchor);
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
    await show(wallVideo, anchor);
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
    await show(failVideo, anchor);
    await act(async () => {
      await sleep(30);
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("degraded");
    expect(q('[data-testid="storyboard-frame"]')).toBeNull();
  });

  test("scrolling hides the preview (the anchor rect goes stale)", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
    await act(() => {
      win.dispatchEvent(new win.Event("scroll"));
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });

  test("hide → re-show restarts the animation at frame 0 on the cached storyboard", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
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
    await show(videoA, anchor);
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

// ---- P12-UX Task 4: the embed lane (mini video player on hover) ----------

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

describe("P12-UX — the embed lane (muted autoplay mini player)", () => {
  test("embed mode: ONE muted autoplaying player created; PLAYING → embed phase + muted pill, no storyboard frame", async () => {
    const { anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await act(async () => {
      previewStore().show(videoA, anchor, "embed");
    });
    await act(async () => {
      await sleep(30); // the api microtask creates the player
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    const player = MockYTPlayer.instances[0];
    expect(player.options["videoId"]).toBe("AAAAAAAAAAA");
    const vars = player.options["playerVars"] as Record<string, number>;
    expect(vars).toMatchObject({ autoplay: 1, mute: 1, controls: 0, playsinline: 1 });
    // the embed reports PLAYING → the embed phase with the muted indicator
    const events = player.options["events"] as { onStateChange: (e: { data: number }) => void };
    await act(async () => {
      events.onStateChange({ data: 1 });
    });
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("embed");
    expect(q('[data-testid="hover-preview-muted"]')).not.toBeNull();
    expect(q('[data-testid="storyboard-frame"]')).toBeNull(); // storyboard waits its turn
  });

  test("walled embed (never reports playback) → destroyed at the health deadline → the storyboard fallback takes over", async () => {
    const { anchor } = await renderApp(videoA);
    await act(async () => {
      previewStore().show(videoA, anchor, "embed");
    });
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    await act(async () => {
      await sleep(EMBED_HEALTH_MS + 400); // past the health deadline
    });
    expect(MockYTPlayer.destroyed).toHaveLength(1); // the embed was destroyed
    expect(q("[data-preview-phase]")!.getAttribute("data-preview-phase")).toBe("storyboard");
    expect(q('[data-testid="storyboard-frame"]')).not.toBeNull();
    expect(q('[data-testid="hover-preview-muted"]')).toBeNull();
  });

  test("hide destroys the embed (the single-instance law, exit side)", async () => {
    const { anchor } = await renderApp(videoA);
    await act(async () => {
      previewStore().show(videoA, anchor, "embed");
    });
    await act(async () => {
      await sleep(30);
    });
    expect(MockYTPlayer.instances).toHaveLength(1);
    await hide();
    expect(MockYTPlayer.destroyed).toHaveLength(1);
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });

  test("retarget A → B: the previous embed is destroyed (never two players)", async () => {
    const { anchor } = await renderApp(videoA);
    await act(async () => {
      previewStore().show(videoA, anchor, "embed");
    });
    await act(async () => {
      await sleep(30);
    });
    const first = MockYTPlayer.instances[0];
    await act(async () => {
      previewStore().show(videoB, anchor, "embed");
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
