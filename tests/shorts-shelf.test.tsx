/// <reference types="bun-types" />
/**
 * P22-A — the home Shorts shelf: youtube.com-parity sizing + hover previews.
 *
 * What must hold:
 *  - the tiles render at the MEASURED youtube.com ladder (live 2026-10-10:
 *    youtube's own shorts lockups run 160→232px across viewports, scale
 *    WITH the page; P12's flat 208px was smaller than youtube.com at every
 *    desktop width) — 160 base → 192 sm → 216 lg → 232 xl → 256 2xl, and
 *    the thumb box stays 9:16 (the home-shelf proportion, 160×284);
 *  - the [data-no-preview] policy is GONE (youtube.com plays shorts on
 *    hover now — muted autoplay, verified live) — every tile rides the
 *    SAME useHoverPreview pipeline as the 16:9 cards: dwell 600ms →
 *    store.show (embed mode on fine pointers), leave cancels, coarse
 *    pointers never preview;
 *  - each tile carries [data-thumb-anchor] (the preview layer's geometry
 *    anchor) and links to /shorts with the title in its aria-label;
 *  - an empty shelf renders nothing.
 *
 * happy-dom + createRoot/act (the hover-preview.test.tsx harness pattern);
 * the preview store is the component's OWN globalThis singleton.
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ShortsShelf } from "@/components/home/shorts-shelf";
import type { VideoDTO } from "@/lib/types";

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

// ---- the shared globalThis preview store (the hook's own lane) ----
interface TestStore {
  snapshot: {
    video: { id: string; title: string } | null;
    rect: DOMRect | null;
    mode: "embed" | "storyboard";
    card: HTMLElement | null;
  };
  listeners: Set<() => void>;
  show: (video: unknown, card: HTMLElement, anchor: HTMLElement, mode?: string) => void;
  hide: () => void;
}
const previewStore = (): TestStore => {
  const s = (globalThis as unknown as { __wfxPreviewStore?: TestStore }).__wfxPreviewStore;
  if (!s) throw new Error("preview store missing on globalThis");
  return s;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal honest VideoDTO shorts (the shelf renders only id/title/thumb/views). */
const short = (id: string, title: string): VideoDTO => ({
  id,
  title,
  description: "",
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  durationSec: null,
  views: 1_234_567,
  viewsText: "1.2M views",
  likes: 0,
  dislikes: 0,
  visibility: "public",
  isMembersOnly: false,
  membersTier: null,
  category: "All",
  isShort: true,
  isLive: false,
  premieredAt: null,
  createdAt: null,
  channel: { id: "c1", name: "Shorts Channel", handle: "@shorts", avatarUrl: "", verified: false, subscriberCount: 0, subscriberCountText: null },
});

const shorts = [
  short("r8DgYBNF6DM", "She Roasted Him After He Helped Her"),
  short("3kiY2-ojuq4", "Wait For The Last Screaming Chicken"),
  short("qiXMm-nP6bs", "WILD Broken Chair Prank!"),
];

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qAll = (sel: string): HTMLElement[] =>
  host ? ([...host.querySelectorAll(sel)] as unknown as HTMLElement[]) : [];

async function renderShelf(items: VideoDTO[] = shorts) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<ShortsShelf shorts={items} />);
  });
  await sleep(10);
}

beforeEach(() => {
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

describe("P22-A — the shorts shelf: youtube.com-parity sizing", () => {
  test("renders the shelf with tiles at the measured responsive ladder (9:16, no flat 208px)", async () => {
    await renderShelf();
    const section = q('[aria-label="Shorts shelf"]');
    expect(section).not.toBeNull();
    expect(qAll('[aria-label^="Open Shorts: "]')).toHaveLength(3);
    const tile = q('[aria-label^="Open Shorts: "]')!;
    // the measured ladder — every class, in the tile's own className
    expect(tile.className).toContain("w-[160px]");
    expect(tile.className).toContain("sm:w-[192px]");
    expect(tile.className).toContain("lg:w-[216px]");
    expect(tile.className).toContain("xl:w-[232px]");
    expect(tile.className).toContain("2xl:w-[256px]");
    // P12's flat 208px is gone (youtube.com outgrew it at every desktop width)
    expect(tile.className).not.toContain("w-[208px]");
    // the thumb box stays 9:16 (the home-shelf proportion, 160×284)
    const thumb = tile.querySelector("[data-thumb-anchor]") as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.className).toContain("aspect-[9/16]");
  });

  test("every tile links to /shorts with the short's title in its aria-label", async () => {
    await renderShelf();
    const tiles = qAll('[aria-label^="Open Shorts: "]');
    expect(tiles[0].getAttribute("href")).toBe("/shorts");
    expect(tiles[0].getAttribute("aria-label")).toBe("Open Shorts: She Roasted Him After He Helped Her");
    // the honest meta line (the live passthrough text)
    expect(tiles[1].innerText).toContain("1.2M views");
  });

  test("an empty shelf renders nothing", async () => {
    await renderShelf([]);
    expect(q('[aria-label="Shorts shelf"]')).toBeNull();
    expect(host?.innerHTML).toBe("");
  });
});

describe("P22-A — shorts tiles preview on hover (the [data-no-preview] policy is gone)", () => {
  test("no [data-no-preview] opt-out exists anywhere in the shelf", async () => {
    await renderShelf();
    expect(q("[data-no-preview]")).toBeNull();
    expect(host!.getAttribute("data-no-preview")).toBeNull();
  });

  test("hovering a tile for the dwell shows the preview (embed mode, fine pointer)", async () => {
    await renderShelf();
    const tile = q('[aria-label^="Open Shorts: "]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(250); // < 600ms: no preview yet
    });
    expect(previewStore().snapshot.video).toBeNull();
    await act(async () => {
      await sleep(600); // 850ms total: past the dwell
    });
    const snap = previewStore().snapshot;
    expect(snap.video?.id).toBe("r8DgYBNF6DM");
    expect(snap.mode).toBe("embed"); // fine pointer → the embed mini player
    expect(snap.card).toBe(tile); // the tile itself (the controls' leave logic)
  });

  test("leaving before the dwell cancels the preview", async () => {
    await renderShelf();
    const tile = q('[aria-label^="Open Shorts: "]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(250);
    });
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(600); // past the dwell — the cancelled timer never fires
    });
    expect(previewStore().snapshot.video).toBeNull();
  });

  test("coarse pointers never preview shorts (hover does not exist there)", async () => {
    const real = (win as unknown as Record<string, unknown>).matchMedia;
    (win as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: query.includes("coarse"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    await renderShelf();
    const tile = q('[aria-label^="Open Shorts: "]')!;
    await act(() => {
      tile.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      await sleep(850); // past the dwell
    });
    expect(previewStore().snapshot.video).toBeNull();
    (win as unknown as Record<string, unknown>).matchMedia = real;
  });
});
