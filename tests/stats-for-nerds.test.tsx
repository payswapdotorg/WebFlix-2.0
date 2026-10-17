/// <reference types="bun-types" />
/**
 * WFX2-P23-A tests (G2) — the "Stats for nerds" overlay in youtube.com's
 * measured shape: the field set + order (Video ID / sCPN · Viewport /
 * Frames · Current / Optimal Res · Volume / Normalized · Codecs · Shader
 * Info · Color · Connection Speed · Network Activity · Buffer Health ·
 * Mystery Text · Date), the REAL IFrame API signals rendering, the honest
 * "–" for everything the embed cannot supply (NEVER a fabricated number),
 * the [X] close rung, and the player context menu's measured rungs
 * (Copy video URL / Copy video URL at current time / Stats for nerds).
 * happy-dom + createRoot/act; the player host's getStats is monkey-patched.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
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
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- stubs: sonner + clipboard ----
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));
const copied: string[] = [];
Object.defineProperty(win.navigator, "clipboard", {
  value: {
    writeText: (t: string) => {
      copied.push(t);
      return Promise.resolve();
    },
  },
  configurable: true,
  writable: true,
});

const { buildStatsRows, StatsForNerds } = await import("@/components/watch/stats-for-nerds");
const { PlayerContextMenu } = await import("@/components/watch/player-context-menu");
const { playerHost, resetPlayerHostForTests } = await import("@/lib/player/player-host");

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  win.document.querySelector(sel) as unknown as HTMLElement | null;
const qa = (sel: string): HTMLElement[] =>
  Array.from(win.document.querySelectorAll(sel) as unknown as HTMLElement[]);
const buttons = (): HTMLElement[] => qa("button");

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  resetPlayerHostForTests();
  copied.length = 0;
});

async function renderOverlay(onClose = () => {}) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<StatsForNerds onClose={onClose} />);
  });
  // let the poll's first tick land
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}

const FULL_SNAP = {
  videoId: "dQw4w9WgXcQ",
  title: "Rick Astley - Never Gonna Give You Up",
  author: "Rick Astley",
  state: "playing" as const,
  currentTimeSec: 121.4,
  durationSec: 213,
  loadedFraction: 0.41,
  playbackQuality: "medium",
  availableQualityLevels: ["medium", "hd720", "hd1080"],
  playbackRate: 1,
  volume: 85,
  muted: false,
};

describe("buildStatsRows — the measured field set, the honest dashes", () => {
  test("the field set + order is youtube.com's measured list", () => {
    const rows = buildStatsRows(FULL_SNAP, { w: 1280, h: 720 }, new Date("2026-10-17T09:27:14Z"));
    expect(rows.map((r) => r.label)).toEqual([
      "Video ID / sCPN",
      "Viewport / Frames",
      "Current / Optimal Res",
      "Volume / Normalized",
      "Codecs",
      "Shader Info",
      "Color",
      "Connection Speed",
      "Network Activity",
      "Buffer Health",
      "Mystery Text",
      "Date",
    ]);
  });

  test("the REAL signals render: videoId, viewport, quality, volume, buffer-health math, date", () => {
    const now = new Date("2026-10-17T09:27:14Z");
    const rows = buildStatsRows(FULL_SNAP, { w: 1280, h: 720 }, now);
    const by = (label: string) => rows.find((r) => r.label === label)!.value;
    // videoId real; sCPN honestly absent (the embed API has no nonce)
    expect(by("Video ID / sCPN")).toBe("dQw4w9WgXcQ / –");
    // viewport is a real page-side fact; dropped frames honestly absent
    expect(by("Viewport / Frames")).toBe("1280x720 / –");
    // the API's own quality label; optimal honestly absent
    expect(by("Current / Optimal Res")).toBe("medium / –");
    // volume real (the muted suffix when muted)
    expect(by("Volume / Normalized")).toBe("85% / –");
    // buffer health = REAL derived math: 0.41 × 213 − 121.4 = -34.07 → clamped 0
    expect(by("Buffer Health")).toBe("0.00 s");
    // the date is the measured Date#toString format
    expect(by("Date")).toBe(now.toString());
  });

  test("buffer health is the real loaded-ahead math (not a fabrication)", () => {
    const snap = { ...FULL_SNAP, currentTimeSec: 100, loadedFraction: 0.8, durationSec: 200 };
    // 0.8 × 200 − 100 = 60s buffered ahead
    expect(buildStatsRows(snap, null, new Date()).find((r) => r.label === "Buffer Health")!.value).toBe(
      "60.00 s"
    );
  });

  test("muted volume renders the honest suffix", () => {
    const snap = { ...FULL_SNAP, muted: true, volume: 0 };
    expect(buildStatsRows(snap, null, new Date()).find((r) => r.label === "Volume / Normalized")!.value).toBe(
      "0% (muted) / –"
    );
  });

  test("a null snapshot (player gone) → every field honestly dashed except Date", () => {
    const rows = buildStatsRows(null, null, new Date());
    for (const r of rows) {
      if (r.label === "Date") continue;
      expect(r.value).toBe("–");
    }
  });

  test("partial snapshot (an old embed build lacking methods) → only the absent fields dash", () => {
    const snap = {
      ...FULL_SNAP,
      videoId: null,
      playbackQuality: null,
      volume: null,
      muted: null,
      loadedFraction: null,
    };
    const by = (label: string) => buildStatsRows(snap, null, new Date()).find((r) => r.label === label)!.value;
    expect(by("Video ID / sCPN")).toBe("–");
    expect(by("Current / Optimal Res")).toBe("–");
    expect(by("Volume / Normalized")).toBe("–");
    expect(by("Buffer Health")).toBe("–");
  });
});

describe("the overlay render (the measured ytp-sfn chrome)", () => {
  test("renders over the player, polls the host's snapshot, [X] closes", async () => {
    playerHost.getStats = () => FULL_SNAP;
    let closed = 0;
    await renderOverlay(() => {
      closed += 1;
    });
    const panel = q('[data-testid="stats-for-nerds"]');
    expect(panel).toBeTruthy();
    // the panel is absolutely positioned at the player's top-left (z 64)
    expect(panel!.className).toContain("left-2");
    expect(panel!.className).toContain("top-2");
    expect(panel!.style.backgroundColor).toBe("rgba(28, 28, 28, 0.8)");
    // the real values from the host snapshot render
    expect(panel!.textContent).toContain("dQw4w9WgXcQ / –");
    expect(panel!.textContent).toContain("medium / –");
    // the honest dashes are VISIBLE (never fabricated numbers) — label+value
    // spans concatenate without whitespace in textContent
    expect(panel!.textContent).toContain("Codecs–");
    // the [X] close rung
    const close = q('[data-testid="stats-close"]');
    expect(close?.textContent).toContain("[X]");
    await act(async () => {
      close!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  test("a null snapshot still renders the full field set with dashes", async () => {
    playerHost.getStats = () => null;
    await renderOverlay();
    const panel = q('[data-testid="stats-for-nerds"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Video ID / sCPN–");
    expect(panel!.textContent).toContain("Codecs–");
  });
});

describe("the player context menu (the measured entry rungs)", () => {
  async function renderMenu(onStats = () => {}) {
    const h = win.document.createElement("div");
    win.document.body.appendChild(h);
    host = h;
    root = createRoot(h as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <PlayerContextMenu
          state={{ x: 100, y: 100 }}
          onClose={() => {}}
          onStatsForNerds={onStats}
          videoId="dQw4w9WgXcQ"
        />
      );
    });
  }

  test("the served rungs are exactly the measured youtube.com ones WebFlix can honestly serve", async () => {
    await renderMenu();
    const menu = q('[data-testid="player-context-menu"]');
    expect(menu).toBeTruthy();
    expect(q('[data-testid="context-copy-video-url"]')?.textContent).toContain("Copy video URL");
    expect(q('[data-testid="context-copy-video-url-at"]')?.textContent).toContain(
      "Copy video URL at current time"
    );
    expect(q('[data-testid="context-stats-for-nerds"]')?.textContent).toContain("Stats for nerds");
  });

  test("Copy video URL copies the watch link (the house clipboard + toast family)", async () => {
    await renderMenu();
    await act(async () => {
      q('[data-testid="context-copy-video-url"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(copied).toContain(`${win.location.origin}/watch/dQw4w9WgXcQ`);
    expect(toasts.some((t) => t.includes("Video URL copied"))).toBe(true);
  });

  test("the at-current-time rung carries the ?t= param from the playhead", async () => {
    playerHost.handleRef.current = {
      play: () => {},
      pause: () => {},
      togglePlay: () => {},
      seekTo: () => {},
      getCurrentTime: () => 90,
      getDuration: () => 213,
      getStats: () => null,
    };
    await renderMenu();
    await act(async () => {
      q('[data-testid="context-copy-video-url-at"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(copied).toContain(`${win.location.origin}/watch/dQw4w9WgXcQ?t=1m30s`);
  });

  test("Stats for nerds rung opens the overlay entry", async () => {
    let opened = 0;
    await renderMenu(() => {
      opened += 1;
    });
    await act(async () => {
      q('[data-testid="context-stats-for-nerds"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(opened).toBe(1);
  });
});
