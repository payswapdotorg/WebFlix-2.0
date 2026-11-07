/// <reference types="bun-types" />
/**
 * P100 — the live-surface UI battery: the in-app live page's honest states
 * (probing → live → offline → degraded), the playback ladder (hls rung →
 * fallback rung), the watch-party chat panel (guest inline gate, optimistic
 * send), the outbound TikTok write links, and the channel-page badge. No
 * network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";

// ---- the fetch stub (the lane law: NO network from tests) ------------------
type Route = { match: (url: string) => boolean; respond: (url: string, init?: RequestInit) => Response };
let routes: Route[] = [];
const postedChats: Array<{ url: string; body: unknown }> = [];
const deletedChats: Array<{ url: string }> = [];
let deleteAnswer: { status: number; body: unknown } = { status: 200, body: { deleted: true } };
const statusCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  routes = [];
  postedChats.length = 0;
  deletedChats.length = 0;
  deleteAnswer = { status: 200, body: { deleted: true } };
  statusCalls.length = 0;
  navigationPushes.length = 0;
  // the default session is a guest; the authed tests prepend their own route
  routes.push({
    match: (u) => u.includes("/api/auth/session"),
    respond: () => new Response(JSON.stringify({ user: null }), { status: 200 }),
  });
  (globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/tiktok/live/chat") && init?.method === "POST") {
      postedChats.push({ url: u, body: JSON.parse(String(init.body ?? "{}")) });
      return new Response(
        JSON.stringify({
          message: {
            id: "m-new",
            body: JSON.parse(String(init.body ?? "{}")).body ?? "posted",
            deleted: false,
            createdAt: new Date().toISOString(),
            sender: { handle: "pip", name: "Pip" },
          },
        }),
        { status: 200 }
      );
    }
    if (u.includes("/api/tiktok/live/chat") && init?.method === "DELETE") {
      deletedChats.push({ url: u });
      return new Response(JSON.stringify(deleteAnswer.body), { status: deleteAnswer.status });
    }
    const hit = routes.find((r) => r.match(u));
    if (!hit) return new Response("{}", { status: 200 });
    return hit.respond(u, init);
  };
});
afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

// ---- happy-dom as the global DOM (the house idiom) --------------------------
const dom = await import("happy-dom");
const win = new dom.Window({ url: "http://localhost:3000" }) as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
for (const key of [
  "window", "document", "HTMLElement", "HTMLIFrameElement", "HTMLVideoElement", "Element", "Node",
  "navigator", "CustomEvent", "MessageEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame",
  "localStorage", "MutationObserver", "IntersectionObserver",
]) {
  (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
}

// the hls.js seam is mocked at the module boundary (the player codes against
// exactly this contract: Events + isSupported + loadSource/attachMedia/destroy)
mock.module("hls.js", () => ({
  default: class FakeHls {
    static Events = { ERROR: "hlsError" };
    static isSupported(): boolean {
      return true;
    }
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

// P102 — the room-to-room navigation law: the live view's keyboard arrows
// push the next/prev live room through the router (the desktop adaptation of
// tiktok.com's swipe). The router is mocked here so the pushes are
// observable; nothing else in this file's tree consumes navigation hooks.
const navigationPushes: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      navigationPushes.push(href);
    },
    replace: () => {},
    back: () => {},
    refresh: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/tiktok/lofigirl/live",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
}));

const LIVE_STATUS = {
  handle: "lofigirl",
  live: true,
  probing: false,
  room: {
    title: "christmas lofi radio 🎄",
    viewers: 278,
    startedAt: "2026-11-07T00:12:00.000Z",
    coverUrl: null,
    liveUrl: "https://www.tiktok.com/@lofigirl/live",
  },
  stream: null,
  source: "apify",
  fetchedAt: "2026-11-07T07:45:00.000Z",
};

const LIVE_WITH_HLS = {
  ...LIVE_STATUS,
  stream: {
    hlsUrl: "https://pull-f5-va01.ttlivecdn.com/live/lofi.m3u8",
    flvUrl: null,
  },
};

const OFFLINE_STATUS = { ...LIVE_STATUS, live: false, room: null };

const PROBING_STATUS = {
  handle: "lofigirl",
  live: null,
  probing: true,
  room: null,
  stream: null,
  source: "",
  fetchedAt: "2026-11-07T07:45:00.000Z",
};

const CHAT_PAGE = {
  items: [
    { id: "m1", body: "welcome to the party", deleted: false, createdAt: "2026-11-07T08:00:00.000Z", sender: { handle: "pip", name: "Pip" } },
  ],
  nextCursor: "m1",
};

function routeStatusOnce(bodies: unknown[]): void {
  let i = 0;
  routes.push({
    match: (u) => {
      if (u.includes("/api/tiktok/live?") || u.endsWith("/api/tiktok/live")) {
        statusCalls.push(u);
        return true;
      }
      return false;
    },
    respond: () => {
      const body = bodies[Math.min(i, bodies.length - 1)];
      i += 1;
      return new Response(JSON.stringify({ status: body }), { status: 200 });
    },
  });
}
function routeStatusError(status: number, body: unknown): void {
  routes.push({
    match: (u) => u.includes("/api/tiktok/live?") || u.endsWith("/api/tiktok/live"),
    respond: () => new Response(JSON.stringify(body), { status }),
  });
}
function routeChat(): void {
  routes.push({
    match: (u) => u.includes("/api/tiktok/live/chat/"),
    respond: () => new Response(JSON.stringify(CHAT_PAGE), { status: 200 }),
  });
}

/** P102 — the board stub: the currently-live list the nav + hub consume. */
function boardRoom(handle: string, viewers = 10): Record<string, unknown> {
  return {
    handle,
    live: true,
    probing: false,
    room: {
      title: `${handle} is live`,
      viewers,
      startedAt: "2026-11-07T00:12:00.000Z",
      coverUrl: null,
      liveUrl: `https://www.tiktok.com/@${handle}/live`,
    },
    stream: null,
    source: "apify",
    fetchedAt: "2026-11-07T07:45:00.000Z",
  };
}
function routeBoard(sequences: Array<{ status: number; body: unknown }>): void {
  let i = 0;
  routes.push({
    match: (u) => u.includes("/api/tiktok/live/board"),
    respond: () => {
      const s = sequences[Math.min(i, sequences.length - 1)];
      i += 1;
      return new Response(JSON.stringify(s.body), { status: s.status });
    },
  });
}

async function mountHub(boardPollMs = 5): Promise<HTMLElement> {
  const { TikTokLivesBoardView } = await import("@/app/tiktok/lives/view");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(TikTokLivesBoardView, { boardPollMs }));
  });
  return host!;
}
function routeSessionAuthed(): void {
  routes.unshift({
    match: (u) => u.includes("/api/auth/session"),
    respond: () =>
      new Response(
        JSON.stringify({ user: { id: "u_pip", name: "Pip", email: "pip@webflix.test", avatarSeed: 3 } }),
        { status: 200 }
      ),
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
async function mountLive(rawHandle: string, extra: Record<string, unknown> = {}): Promise<HTMLElement> {
  const { TikTokLiveView } = await import("@/app/tiktok/[handle]/live/view");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(TikTokLiveView, { rawHandle, pollIntervalMs: 5, chatPollMs: 5, ...extra }));
  });
  return host!;
}

/** Flush pending effects (status poll / session fetch / chat poll) into renders. */
async function flushLive(ms = 8): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function q(el: HTMLElement, sel: string): Element | null {
  return el.querySelector(sel);
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

describe("TikTokLiveView — the honest states", () => {
  test("LIVE renders the panel: badge, title, viewers, outbound links, chat, marker", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeChat();
    const el = await mountLive("@lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-in-app"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-live-badge"]')).not.toBeNull();
    expect(el.textContent).toContain("christmas lofi radio");
    expect(el.textContent).toContain("278");
    // the outbound deep link is real and labeled as leaving
    const out = el.querySelector<HTMLAnchorElement>('a[href="https://www.tiktok.com/@lofigirl/live"]');
    expect(out).not.toBeNull();
    expect(el.textContent).toMatch(/TikTok/i);
    // the watch-party chat is mounted with its composer
    expect(q(el, '[data-testid="tiktok-live-chat-panel"]')).not.toBeNull();
    expect(el.textContent).toContain("welcome to the party");
  });

  test("probing renders the honest checking state, then flips to LIVE on the next poll", async () => {
    routeStatusOnce([PROBING_STATUS, LIVE_STATUS]);
    routeChat();
    const el = await mountLive("@lofigirl");
    expect(q(el, '[data-testid="tiktok-live-probing"]')).not.toBeNull();
    await flushLive(30);
    expect(q(el, '[data-testid="tiktok-live-badge"]')).not.toBeNull();
    expect(statusCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("offline renders the honest not-live panel (no fake room data)", async () => {
    routeStatusOnce([OFFLINE_STATUS]);
    const el = await mountLive("lofigirl");
    expect(q(el, '[data-testid="tiktok-live-offline"]')).not.toBeNull();
    expect(el.textContent).toMatch(/not live right now/i);
    // the outbound deep link remains the honest affordance
    expect(el.querySelector('a[href="https://www.tiktok.com/@lofigirl/live"]')).not.toBeNull();
  });

  test("a 502/503 surfaces its real reason, never a fake offline", async () => {
    routeStatusError(503, { error: "The live probe lane is not configured — set APIFY_API_KEY." });
    const el = await mountLive("lofigirl");
    expect(q(el, '[data-testid="tiktok-live-degraded"]')).not.toBeNull();
    expect(el.textContent).toContain("APIFY_API_KEY");
  });

  test("the playback ladder: an hls URL mounts the native video rung", async () => {
    routeStatusOnce([LIVE_WITH_HLS]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-video"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-live-fallback"]')).toBeNull();
  });

  test("the playback ladder: no stream URL keeps the honest fallback rung", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-fallback"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-live-video"]')).toBeNull();
  });

  test("the SWR UX law: a stale live answer keeps the room (and the video) mounted", async () => {
    // P102-R2 — the backend serves stale:true while the refresh probe rides;
    // the view's law is that a stale answer is NOT a probing flip and NOT an
    // unmount: the video keeps playing, the badge stays, nothing flashes.
    routeStatusOnce([
      LIVE_WITH_HLS,
      { ...LIVE_WITH_HLS, stale: true, fetchedAt: "2026-11-07T07:45:30.000Z" },
    ]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-video"]')).not.toBeNull();
    await flushLive(30); // the next poll answers stale — the room must not flip
    expect(q(el, '[data-testid="tiktok-live-probing"]')).toBeNull();
    expect(q(el, '[data-testid="tiktok-live-video"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-live-badge"]')).not.toBeNull();
  });
});

describe("TikTokLiveView — the watch-party chat", () => {
  test("a guest sees the inline sign-in gate, never a hard eject", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    const gate = q(el, '[data-testid="tiktok-live-chat-signin"]');
    expect(gate).not.toBeNull();
    expect(el.textContent).toMatch(/sign in/i);
    // no posted chats while gated
    expect(postedChats).toHaveLength(0);
  });

  test("the composer posts to the room endpoint and appends optimistically", async () => {
    routeSessionAuthed();
    routeStatusOnce([LIVE_STATUS]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    const input = el.querySelector<HTMLInputElement>('[data-testid="tiktok-live-chat-input"]');
    expect(input).not.toBeNull();
    // the controlled-input value-tracker sequence: write through the node's
    // own property (React's tracker intercepts it), then fire the input event
    await act(async () => {
      input!.value = "hi from pip";
      input!.dispatchEvent(new win.Event("input", { bubbles: true }));
      input!.dispatchEvent(new win.Event("keyup", { bubbles: true }));
    });
    const form = el.querySelector<HTMLFormElement>('[data-testid="tiktok-live-chat-form"]');
    expect(form).not.toBeNull();
    await act(async () => {
      form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(postedChats).toHaveLength(1);
    expect(postedChats[0].url).toContain("/api/tiktok/live/chat/lofigirl");
    expect(postedChats[0].body).toMatchObject({ body: "hi from pip" });
    expect(el.textContent).toContain("hi from pip");
  });

  test("the TikTok-side write affordances are outbound links, honestly labeled", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(el.textContent).toMatch(/comment on tiktok/i);
  });

  test("P101/G25 — an own row carries the delete affordance; a stranger's row carries none", async () => {
    routeSessionAuthed();
    routeStatusOnce([LIVE_STATUS]);
    routes.push({
      match: (u) => u.includes("/api/tiktok/live/chat/"),
      respond: () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "m-own", body: "my own words", deleted: false, createdAt: "2026-11-07T08:00:00.000Z", sender: { id: "wf-u_pip", handle: "pip", name: "Pip" } },
              { id: "m-stranger", body: "not mine", deleted: false, createdAt: "2026-11-07T08:01:00.000Z", sender: { id: "u_other", handle: "other", name: "Other" } },
            ],
            nextCursor: "m-stranger",
          }),
          { status: 200 },
        ),
    });
    const el = await mountLive("lofigirl");
    await flushLive();
    const dels = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="tiktok-live-chat-delete"]'));
    expect(dels.length).toBe(1);
    expect(dels[0].getAttribute("data-message-id")).toBe("m-own");
    expect(dels[0].getAttribute("aria-label")).toBe("Delete message");
    // both rows still render; nothing is tombstoned yet
    expect(el.textContent).toContain("my own words");
    expect(el.textContent).toContain("not mine");
    expect(el.textContent).not.toContain("message removed");
  });

  test("P101/G25 — clicking delete rides the route contract and renders the tombstone, not a hole", async () => {
    routeSessionAuthed();
    routeStatusOnce([LIVE_STATUS]);
    // the stateful server fixture: after the DELETE lands, the room's truth is
    // the tombstone — exactly what the durable row answers on prod
    routes.push({
      match: (u) => u.includes("/api/tiktok/live/chat/"),
      respond: () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "m-own", body: "my own words", deleted: deletedChats.length > 0, createdAt: "2026-11-07T08:00:00.000Z", sender: { id: "wf-u_pip", handle: "pip", name: "Pip" } },
            ],
            nextCursor: "m-own",
          }),
          { status: 200 },
        ),
    });
    const el = await mountLive("lofigirl");
    await flushLive();
    const del = el.querySelector<HTMLButtonElement>('[data-testid="tiktok-live-chat-delete"]');
    expect(del).not.toBeNull();
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(deletedChats).toHaveLength(1);
    expect(deletedChats[0].url).toContain("/api/tiktok/live/chat/lofigirl?messageId=m-own");
    // the tombstone law: the row stays as "message removed", the body leaves
    expect(el.textContent).toContain("message removed");
    expect(el.textContent).not.toContain("my own words");
  });

  test("P101/G25 — a failed delete keeps the row and surfaces the honest error", async () => {
    routeSessionAuthed();
    routeStatusOnce([LIVE_STATUS]);
    routes.push({
      match: (u) => u.includes("/api/tiktok/live/chat/"),
      respond: () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "m-own", body: "my own words", deleted: false, createdAt: "2026-11-07T08:00:00.000Z", sender: { id: "wf-u_pip", handle: "pip", name: "Pip" } },
            ],
            nextCursor: "m-own",
          }),
          { status: 200 },
        ),
    });
    deleteAnswer = { status: 500, body: { error: "boom" } };
    const el = await mountLive("lofigirl");
    await flushLive();
    const del = el.querySelector<HTMLButtonElement>('[data-testid="tiktok-live-chat-delete"]');
    expect(del).not.toBeNull();
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(deletedChats).toHaveLength(1);
    // the row survives and the alert copy is the panel's own honest voice
    expect(el.textContent).toContain("my own words");
    expect(el.textContent).not.toContain("message removed");
    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toMatch(/could not be removed/i);
  });
});

describe("TikTokLiveBadge — the channel-page badge", () => {
  test("renders the badge + watch CTA only for a LIVE status", async () => {
    const { TikTokLiveBadge } = await import("@/components/tiktok/tiktok-live-badge");
    const live = document.createElement("div");
    document.body.appendChild(live);
    root = createRoot(live);
    await act(async () => {
      root!.render(createElement(TikTokLiveBadge, { status: LIVE_STATUS as never }));
    });
    expect(q(live, '[data-testid="tiktok-live-badge"]')).not.toBeNull();
    const cta = live.querySelector<HTMLAnchorElement>('a[data-testid="tiktok-live-watch-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/tiktok/lofigirl/live");
    act(() => root!.unmount());

    const off = document.createElement("div");
    document.body.appendChild(off);
    root = createRoot(off);
    await act(async () => {
      root!.render(createElement(TikTokLiveBadge, { status: OFFLINE_STATUS as never }));
    });
    expect(q(off, '[data-testid="tiktok-live-badge"]')).toBeNull();
    host = off;
  });
});

describe("the channel view wires the badge (the source-scan law)", () => {
  test("the channel view imports the badge and the live status hook", () => {
    const src = readFileSync("src/app/tiktok/[handle]/view.tsx", "utf8");
    expect(src).toContain("TikTokLiveBadge");
    expect(src).toContain("useTikTokLiveStatus");
  });
});

// ---------------------------------------------------------------------------
// P102 — the room-to-room navigation (the honest swipe adaptation)
// ---------------------------------------------------------------------------

describe("TikTokLiveView — the live-room navigation (P102)", () => {
  test("with >= 2 live rooms the nav bar renders: position, prev, next — the deterministic handle-asc order, wrap-around", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeBoard([{ status: 200, body: { board: { rooms: [boardRoom("lofigirl"), boardRoom("aaa"), boardRoom("zzz")], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    const nav = q(el, '[data-testid="tiktok-live-nav"]');
    expect(nav).not.toBeNull();
    // handle-asc: aaa < lofigirl < zzz — current is 2 of 3
    expect(el.textContent).toContain("2 / 3");
    const prev = el.querySelector<HTMLAnchorElement>('[data-testid="tiktok-live-nav-prev"]');
    const next = el.querySelector<HTMLAnchorElement>('[data-testid="tiktok-live-nav-next"]');
    expect(prev?.getAttribute("href")).toBe("/tiktok/aaa/live");
    expect(next?.getAttribute("href")).toBe("/tiktok/zzz/live");
  });

  test("the wrap-around: the FIRST room's prev is the LAST room", async () => {
    routeStatusOnce([{ ...LIVE_STATUS, handle: "aaa" }]);
    routeBoard([{ status: 200, body: { board: { rooms: [boardRoom("aaa"), boardRoom("zzz")], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    routeChat();
    const el = await mountLive("aaa");
    await flushLive();
    const prev = el.querySelector<HTMLAnchorElement>('[data-testid="tiktok-live-nav-prev"]');
    const next = el.querySelector<HTMLAnchorElement>('[data-testid="tiktok-live-nav-next"]');
    expect(prev?.getAttribute("href")).toBe("/tiktok/zzz/live");
    expect(next?.getAttribute("href")).toBe("/tiktok/zzz/live");
  });

  test("a single live room renders NO nav bar (honest absence)", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeBoard([{ status: 200, body: { board: { rooms: [boardRoom("lofigirl")], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-nav"]')).toBeNull();
  });

  test("the keyboard arrows ride the router: ArrowRight → next, ArrowLeft → prev", async () => {
    routeStatusOnce([LIVE_STATUS]);
    routeBoard([{ status: 200, body: { board: { rooms: [boardRoom("lofigirl"), boardRoom("aaa"), boardRoom("zzz")], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    routeChat();
    await mountLive("lofigirl");
    await flushLive();
    await act(async () => {
      window.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      window.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(navigationPushes).toEqual(["/tiktok/zzz/live", "/tiktok/aaa/live"]);
  });

  test("streamProbing renders the resolving note, never the fallback rung", async () => {
    routeStatusOnce([{ ...LIVE_STATUS, stream: null, streamProbing: true }]);
    routeChat();
    const el = await mountLive("lofigirl");
    await flushLive();
    expect(q(el, '[data-testid="tiktok-live-stream-probing"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-live-fallback"]')).toBeNull();
    expect(el.textContent).toMatch(/resolving the stream/i);
  });
});

// ---------------------------------------------------------------------------
// P102 — the /tiktok/lives board (the honest navigation hub)
// ---------------------------------------------------------------------------

describe("TikTokLivesBoardView — the honest live board (P102)", () => {
  test("live rooms render as cards linking the room pages; the scope statement is visible", async () => {
    routeBoard([{ status: 200, body: { board: { rooms: [boardRoom("lofigirl", 193), boardRoom("scout2015", 12)], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    const el = await mountHub();
    await flushLive();
    expect(q(el, '[data-testid="tiktok-lives-board"]')).not.toBeNull();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-testid="tiktok-lives-room"]'));
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/tiktok/lofigirl/live");
    expect(el.textContent).toContain("193");
    expect(el.textContent).toMatch(/creators in the WebFlix universe/i);
  });

  test("an all-offline universe answers the honest empty, never a fake room", async () => {
    routeBoard([{ status: 200, body: { board: { rooms: [], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } }]);
    const el = await mountHub();
    await flushLive();
    expect(q(el, '[data-testid="tiktok-lives-empty"]')).not.toBeNull();
    expect(q(el, '[data-testid="tiktok-lives-room"]')).toBeNull();
  });

  test("the probing board renders the checking state, then the rooms", async () => {
    routeBoard([
      { status: 200, body: { board: { rooms: [], missing: [], probing: true, fetchedAt: "2026-11-07T07:45:00.000Z" } } },
      { status: 200, body: { board: { rooms: [boardRoom("lofigirl")], missing: [], fetchedAt: "2026-11-07T07:45:00.000Z" } } },
    ]);
    const el = await mountHub();
    expect(q(el, '[data-testid="tiktok-lives-probing"]')).not.toBeNull();
    await flushLive(30);
    expect(q(el, '[data-testid="tiktok-lives-room"]')).not.toBeNull();
  });

  test("a 503 renders the real enable-path copy, never a fake empty", async () => {
    routeBoard([{ status: 503, body: { error: "The TikTok live probe lane is not configured — set APIFY_API_KEY (see .env.example)." } }]);
    const el = await mountHub();
    await flushLive();
    expect(q(el, '[data-testid="tiktok-lives-degraded"]')).not.toBeNull();
    expect(el.textContent).toContain("APIFY_API_KEY");
  });
});
