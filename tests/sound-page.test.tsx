/// <reference types="bun-types" />
/**
 * WFX2-P23-C tests — the /sound/[key] view (youtube.com's measured sound
 * surface: the sound card — 2:3 image + title + the owner channel row —
 * above the shorts grid, "N shorts" counting the LOADED grid honestly, the
 * browse-continuation Show more, and the honest 404/502 families).
 * happy-dom + createRoot/act (the clip-page pattern) with a stubbed fetch.
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
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLSelectElement",
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
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- stubs: sonner + fetch (the view's /api/sound read) ----
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const fetched: string[] = [];
let soundResponse: Record<string, unknown> = {};
let responseQueue: Array<Record<string, unknown> | undefined> = [];
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  fetched.push(u);
  // the FIRST read (the view's own /api/sound/<key>) uses soundResponse;
  // later reads (Show more) shift the queued pages
  const isFirst = u.includes(`/api/sound/${KEY}`);
  const payload = isFirst || responseQueue.length === 0 ? soundResponse : responseQueue.shift();
  const status =
    typeof payload?.status === "number"
      ? (payload.status as number)
      : typeof (payload as { httpStatus?: number })?.httpStatus === "number"
        ? (payload as { httpStatus: number }).httpStatus
        : 200;
  return new Response(JSON.stringify(payload ?? {}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

const { SoundPageView } = await import("@/app/sound/[key]/view");

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
  fetched.length = 0;
  responseQueue = [];
});

async function render(soundKey: string) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<SoundPageView soundKey={soundKey} />);
  });
}

const TOKEN = "abc%3D%3Dkey";
const KEY = encodeURIComponent(TOKEN);

const SHORT = (id: string, title: string) => ({
  id,
  title,
  channel: { id: "", handle: null, name: null, avatarUrl: null },
  viewsText: "1.2K views",
  likesText: null,
  commentsCountText: null,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
});

const HAPPY: Record<string, unknown> = {
  title: "Chill Lofi Coffee Vibes | Relaxing Lofi Hip Hop Beats",
  imageUrl: "https://i.ytimg.com/vi/H3ONg7SPSWU/hq720.jpg",
  channel: {
    id: "UCS0BLnvAbBuAhM3RC1mZ6Ew",
    handle: "LofiCafeChillMRelax",
    avatarUrl: "https://yt3.ggpht.com/avatar48.jpg",
  },
  items: [
    SHORT("vzpP7orCbxQ", "18 th\u00e1ng 9, 2026"),
    SHORT("caKi2YFwMCk", "Second short"),
    SHORT("9LQYuXKPPTQ", "Third short"),
  ],
  nextCursor: null,
  totalLoaded: 3,
};

describe("the sound page — the resolved state (youtube.com's measured sound surface)", () => {
  test("the sound card: 2:3 image + the sound title + the owner channel row", async () => {
    soundResponse = { ...HAPPY };
    await render(TOKEN);
    expect(q("h1")?.textContent).toBe(
      "Chill Lofi Coffee Vibes | Relaxing Lofi Hip Hop Beats",
    );
    const img = q('header img[src*="hq720"]');
    expect(img).toBeTruthy();
    const channelLink = qa("a").find((a) =>
      (a.getAttribute("href") ?? "").includes("/channel/LofiCafeChillMRelax"),
    );
    expect(channelLink?.textContent).toContain("@LofiCafeChillMRelax");
  });

  test("'N shorts' counts the LOADED grid (no upstream total fabricated)", async () => {
    soundResponse = { ...HAPPY };
    await render(TOKEN);
    expect(host!.textContent).toContain("3 shorts");
    // the honest count never claims a total the payload does not carry
    expect(host!.textContent).not.toContain("showing what loaded");
  });

  test("the shorts grid renders the 9:16 tiles + views; tiles link /shorts", async () => {
    soundResponse = { ...HAPPY };
    await render(TOKEN);
    const links = qa("a").filter((a) => a.getAttribute("href") === "/shorts");
    expect(links.length).toBe(3);
    expect(host!.textContent).toContain("1.2K views");
    expect(host!.textContent).toContain("Second short");
  });

  test("Show more appends the next browse page and the count grows", async () => {
    soundResponse = { ...HAPPY, nextCursor: "NEXTTOKEN" };
    responseQueue = [
      {
        ...HAPPY,
        items: [SHORT("newshort01x", "Paged short")],
        nextCursor: null,
        totalLoaded: 4,
      },
    ];
    await render(TOKEN);
    const more = qa("button").find((b) => /Show more/.test(b.textContent ?? ""));
    expect(more).toBeTruthy();
    await act(async () => {
      more!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // the next page's fetch carried the NEXT token as the key (encoded once)
    expect(fetched.some((u) => u.includes(encodeURIComponent("NEXTTOKEN")))).toBe(
      true,
    );
    expect(host!.textContent).toContain("4 shorts");
    expect(host!.textContent).toContain("Paged short");
    // no more pages → the button is gone
    expect(qa("button").some((b) => /Show more/.test(b.textContent ?? ""))).toBe(
      false,
    );
  });

  test("Show more failure surfaces the honest error + retry (never a fake page)", async () => {
    soundResponse = { ...HAPPY, nextCursor: "NEXTTOKEN" };
    responseQueue = [{ httpStatus: 502, error: "The sound page could not be read" }];
    await render(TOKEN);
    const more = qa("button").find((b) => /Show more/.test(b.textContent ?? ""));
    await act(async () => {
      more!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(q('[role="alert"]')?.textContent).toContain("Could not load more");
    // the button stays (retryable)
    expect(qa("button").some((b) => /Show more/.test(b.textContent ?? ""))).toBe(
      true,
    );
  });
});

describe("the sound page — the honest families", () => {
  test("404 (not served) → the unavailable family, never a fake grid", async () => {
    soundResponse = {
      httpStatus: 404,
      error: "This sound is not available right now.",
    };
    await render(TOKEN);
    expect(host!.textContent).toContain(
      "This sound is not available right now",
    );
    expect(host!.textContent).toContain("Open it on youtube.com to check");
  });

  test("502 (read failed) → the could-not-be-read family", async () => {
    soundResponse = {
      httpStatus: 502,
      error: "The sound page could not be read",
    };
    await render(TOKEN);
    expect(host!.textContent).toContain(
      "The sound page could not be read",
    );
    expect(host!.textContent).toContain("Try again in a moment");
  });

  test("no shorts served → the honest empty grid line", async () => {
    soundResponse = {
      title: "Some Sound",
      imageUrl: null,
      channel: null,
      items: [],
      nextCursor: null,
      totalLoaded: 0,
    };
    await render(TOKEN);
    expect(host!.textContent).toContain(
      "No shorts using this sound are served right now.",
    );
  });
});
