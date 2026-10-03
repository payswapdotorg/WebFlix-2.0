/// <reference types="bun-types" />
/**
 * WFX2-P6-HP tests — the hover preview layer (REAL YouTube playback on
 * hover, youtube.com-parity): the 600ms dwell gate (arm → wait → show; leave
 * before the delay cancels), ONE shared YT player for the whole session
 * (created on the first show with the hovered video id + muted/chromeless
 * playerVars, loadVideoById per subsequent hover — never a new iframe),
 * onError (unembeddable) → hidden for THAT video while a different video
 * still previews, scroll-to-hide, and pause-not-destroy on hide (instant
 * re-show on the same player; only final unmount destroys).
 *
 * happy-dom + createRoot/act (the youtube-player.test.tsx pattern) with a
 * stubbed YT iframe API (window.YT.Player present → loadYouTubeIframeApi
 * resolves via its fast path, no script injected). bun 1.3 has no fake
 * timers API, so the dwell boundary is proven with the real clock
 * (250ms < 600ms < 850ms — a setTimeout can never fire early).
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  useHoverPreview,
  VideoHoverPreviewLayer,
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

// ---- YT iframe API stub (loadYouTubeIframeApi fast-path: window.YT.Player) ----
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  el: Element;
  options: Record<string, unknown>;
  loadedVideoId: string | null = null;
  pauseCalls = 0;

  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  playVideo(): void {}
  pauseVideo(): void {
    this.pauseCalls += 1;
  }
  loadVideoById(opts: { videoId: string }): void {
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

// ---- the shared globalThis preview store (the component's own lane) ----
interface TestStore {
  snapshot: { video: { id: string; title: string } | null; rect: DOMRect | null };
  listeners: Set<() => void>;
  show: (video: { id: string; title: string }, anchor: HTMLElement) => void;
  hide: () => void;
}
const previewStore = (): TestStore => {
  const s = (globalThis as unknown as { __wfxPreviewStore?: TestStore }).__wfxPreviewStore;
  if (!s) throw new Error("preview store missing on globalThis");
  return s;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const videoA = { id: "AAAAAAAAAAA", title: "Preview A" };
const videoB = { id: "BBBBBBBBBBB", title: "Preview B" };

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
const show = (video: { id: string; title: string }, anchor: HTMLElement) =>
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
  const s = previewStore();
  s.snapshot = { video: null, rect: null };
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

  test("leaving before the dwell cancels the preview (no show, no player)", async () => {
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
    expect(MockYTPlayer.instances).toHaveLength(0); // player only on first SHOW
  });
});

describe("hover preview — the shared YT player layer", () => {
  test("show → positioned over the anchor + ONE muted chromeless player with the video id", async () => {
    const { anchor } = await renderApp(videoA);
    stubRect(anchor, { left: 10, top: 20, width: 300, height: 169 });
    await show(videoA, anchor);
    await act(async () => {
      await sleep(10); // API-ready microtask creates the player
    });
    const layer = q('[data-testid="hover-preview"]');
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute("aria-hidden")).toBe("true"); // decorative
    // fixed over the anchor rect
    expect(layer!.style.left).toBe("10px");
    expect(layer!.style.top).toBe("20px");
    expect(layer!.style.width).toBe("300px");
    expect(layer!.style.height).toBe("169px");
    // the muted badge
    expect(layer!.textContent).toContain("Muted preview");
    // ONE player created INSIDE the layer with the hovered video id
    expect(MockYTPlayer.instances).toHaveLength(1);
    const player = MockYTPlayer.instances[0];
    expect(player.options["videoId"]).toBe("AAAAAAAAAAA");
    expect((player.el as HTMLElement).closest('[data-testid="hover-preview"]')).not.toBeNull();
    // youtube.com's preview playerVars: autoplay + muted + chromeless
    const vars = player.options["playerVars"] as Record<string, number>;
    expect(vars).toMatchObject({
      autoplay: 1,
      mute: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
      fs: 0,
      disablekb: 1,
    });
  });

  test("a different hover switches videos on the SAME player (loadVideoById, no new iframe)", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
    const player = MockYTPlayer.instances[0];
    await hide();
    await show(videoB, anchor);
    expect(MockYTPlayer.instances).toHaveLength(1); // still ONE player
    expect(player.loadedVideoId).toBe("BBBBBBBBBBB"); // switched, not recreated
    expect(MockYTPlayer.destroyed).toHaveLength(0);
  });

  test("onError (unembeddable) hides the preview for THAT video — a different video still previews", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
    const player = MockYTPlayer.instances[0];
    const events = player.options["events"] as {
      onError: (e: { data: number }) => void;
    };
    await act(async () => {
      events.onError({ data: 101 }); // embedding disallowed
    });
    // hidden for A — but the always-mounted layer div survives (reuse host)
    expect(q('[data-testid="hover-preview"]')).toBeNull();
    expect(q("[data-hover-preview-layer]")).not.toBeNull();
    // a different video starts fresh
    await show(videoB, anchor);
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
    expect(player.loadedVideoId).toBe("BBBBBBBBBBB");
  });

  test("scrolling hides the preview (the anchor rect goes stale)", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
    expect(q('[data-testid="hover-preview"]')).not.toBeNull();
    await act(async () => {
      win.dispatchEvent(new win.Event("scroll"));
    });
    expect(previewStore().snapshot.video).toBeNull();
    expect(q('[data-testid="hover-preview"]')).toBeNull();
  });

  test("hide pauses the player (never destroys) — re-show reuses it via loadVideoById", async () => {
    const { anchor } = await renderApp(videoA);
    await show(videoA, anchor);
    const player = MockYTPlayer.instances[0];
    expect(player.pauseCalls).toBe(0);
    await hide();
    expect(player.pauseCalls).toBe(1); // paused
    expect(MockYTPlayer.destroyed).toHaveLength(0); // NOT destroyed
    expect(MockYTPlayer.instances).toHaveLength(1);
    // instant re-show on the same player: loadVideoById restarts from 0
    await show(videoA, anchor);
    expect(MockYTPlayer.instances).toHaveLength(1);
    expect(player.pauseCalls).toBe(1); // no extra pause on show
    expect(player.loadedVideoId).toBe("AAAAAAAAAAA");
    // final unmount (app teardown) is the only destroy path
    await act(async () => {
      root!.unmount();
    });
    root = null;
    expect(MockYTPlayer.destroyed).toContain(player);
  });
});
