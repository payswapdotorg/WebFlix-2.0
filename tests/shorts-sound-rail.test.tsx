/// <reference types="bun-types" />
/**
 * WFX2-P23-C tests — the shorts engagement rail's P23-C additions:
 *  - the SOUND DISC (G5): renders ONLY when the DTO carries a sound token
 *    (honest absence — never a dead link), links /sound/<encoded-key>,
 *    rotates while the slide plays (the data-paused gate), carries
 *    youtube.com's own contentDescription ("See more videos using this
 *    sound") and the disc artwork.
 *  - REMIX (G6): youtube.com's own rail slot between Share and the disc,
 *    rendered in youtube.com's own DISABLED honest form (aria-disabled) —
 *    the click surfaces the honest note ("Shorts creation is not available
 *    in WebFlix"), never a fake flow.
 * happy-dom + createRoot/act (the clip-page pattern).
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
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
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeList",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
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

// ---- stubs: sonner + fetch (the rail's write seams) ----
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const posts: { url: string; body: unknown }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  posts.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response(JSON.stringify({ added: true, yourLike: "like", likes: 5 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

const { ShortsEngagementRail } = await import(
  "@/components/shorts/shorts-engagement-rail"
);

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qa = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  toasts.length = 0;
  posts.length = 0;
});

async function renderRail(opts: {
  meta: Record<string, unknown> | null;
  playing?: boolean;
}) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <ShortsEngagementRail
        videoId="H3ONg7SPSWU"
        meta={opts.meta as never}
        metaLoading={false}
        guest={true}
        playing={opts.playing ?? true}
        onOpenComments={() => {}}
        onShare={() => {}}
        onReport={() => {}}
      />,
    );
  });
}

const META_NO_SOUND = {
  id: "H3ONg7SPSWU",
  title: "A short",
  channel: { id: "", handle: null, name: null, avatarUrl: null },
  viewsText: "1.2K views",
  likesText: "100 likes",
  commentsCountText: "30 comments",
  thumbnailUrl: null,
  isLive: false,
};

const META_WITH_SOUND = {
  ...META_NO_SOUND,
  soundId: "abc%3D%3Dtoken",
  soundTitle: "Original Sound",
  soundImageUrl: "https://yt3.ggpht.com/disc176.jpg",
};

describe("the sound disc (P23-C G5 — youtube.com's rail-end pivot)", () => {
  test("renders when the DTO carries the sound; links /sound/<encoded-key>", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const disc = q('[data-testid="shorts-sound-disc"]');
    expect(disc).toBeTruthy();
    const link = disc!.closest("a");
    expect(link?.getAttribute("href")).toBe(
      `/sound/${encodeURIComponent("abc%3D%3Dtoken")}`,
    );
    // youtube.com's own contentDescription (measured)
    expect(link?.getAttribute("aria-label")).toBe(
      "See more videos using this sound: Original Sound",
    );
    // the disc artwork (the pivot thumbnail's largest source)
    expect(disc!.querySelector("img")?.getAttribute("src")).toBe(
      "https://yt3.ggpht.com/disc176.jpg",
    );
  });

  test("NO sound on the DTO → the disc hides entirely (honest absence)", async () => {
    await renderRail({ meta: META_NO_SOUND });
    expect(q('[data-testid="shorts-sound-disc"]')).toBeNull();
  });

  test("the rotation gate: data-paused flips with the playing prop", async () => {
    await renderRail({ meta: META_WITH_SOUND, playing: true });
    expect(q('[data-testid="shorts-sound-disc"]')?.getAttribute("data-paused")).toBe(
      null,
    );
    await renderRail({ meta: META_WITH_SOUND, playing: false });
    expect(q('[data-testid="shorts-sound-disc"]')?.getAttribute("data-paused")).toBe(
      "true",
    );
  });

  test("the sound title renders under the disc (the pivot's attribution)", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    expect(host!.textContent).toContain("Original Sound");
  });

  test("no artwork → the disc still links (the Disc3 icon fallback, never a dead image link)", async () => {
    await renderRail({
      meta: { ...META_WITH_SOUND, soundImageUrl: null },
    });
    const disc = q('[data-testid="shorts-sound-disc"]');
    expect(disc).toBeTruthy();
    expect(disc!.querySelector("img")).toBeNull();
    expect(disc!.closest("a")?.getAttribute("href")).toContain("/sound/");
  });
});

describe("Remix (P23-C G6 — youtube.com's own disabled honest form)", () => {
  test("the entry rides between Share and the disc with aria-disabled", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    expect(remix).toBeTruthy();
    expect(remix!.getAttribute("aria-disabled")).toBe("true");
    // youtube.com's slot: Share < Remix < disc (the DOM order, measured)
    const labels = qa("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter(Boolean);
    const shareIdx = labels.findIndex((l) => l.includes("Share"));
    const remixIdx = labels.indexOf("Remix");
    expect(remixIdx).toBeGreaterThan(shareIdx);
    // the label under the button (youtube.com: the word "Remix")
    expect(host!.textContent).toContain("Remix");
  });

  test("the click surfaces the honest note — never a fake flow (no navigation, no fetch)", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    await act(async () => {
      remix!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toasts).toContain("info:Shorts creation is not available in WebFlix");
    // no write seam fired (the affordance cannot work — it never pretends)
    expect(posts).toHaveLength(0);
  });

  test("Remix renders even without sound data (youtube.com's rail always carries it)", async () => {
    await renderRail({ meta: META_NO_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    expect(remix).toBeTruthy();
  });
});
