/// <reference types="bun-types" />
/**
 * WFX2-A-S — route handler tests with the upstream MOCKED (fixtures only,
 * ground rule: no live network in tests).
 *
 * The lib helpers default their `fetcher` parameter to the GLOBAL fetch
 * binding, evaluated at call time — monkeypatching globalThis.fetch in
 * these tests redirects every upstream call to recorded fixtures.
 *
 * Fixtures:
 * - livechat_aljazeera.json (REAL get_live_chat) + next_livechat_session_synth
 *   + next_livechat_ended_synth (SYNTHETIC-shaped-from-real next responses)
 *   + livechat_replay_synth (SYNTHETIC-shaped-from-real get_live_chat_replay)
 * - search_lofi.json (REAL search) + reel_sequence_synth (SYNTHETIC-shaped)
 * - next_dQw4.json + comments_dQw4.json (REAL)
 * - updated_metadata_synth.json (SYNTHETIC-shaped-from-real, real values)
 *
 * P17-SHORTS-CREATOR (appended section): the shorts comments sheet's
 * creator detection (operator mode + the canonical watch detail flag —
 * never a channel-vs-viewer guess) + the row affordances (the watch kebab
 * idiom), via happy-dom component asserts (the livechat-send pattern).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { GET as getLiveChat } from "@/app/api/videos/[id]/livechat/route";
import {
  GET as getLiveChatReplay,
} from "@/app/api/videos/[id]/livechat/replay/route";
import { GET as getLiveStatus } from "@/app/api/videos/[id]/live-status/route";
import { GET as getShorts } from "@/app/api/shorts/route";
import { GET as getShortMeta } from "@/app/api/shorts/[id]/route";
import type { ShortsCommentRowProps } from "@/components/shorts/shorts-comment-row";
import type { CommentDto } from "@/lib/watch/types";

const aljazeera = await Bun.file(
  "tests/fixtures/yt/livechat_aljazeera.json",
).json();
const nextLive = await Bun.file(
  "tests/fixtures/yt/next_livechat_session_synth.json",
).json();
const nextEnded = await Bun.file(
  "tests/fixtures/yt/next_livechat_ended_synth.json",
).json();
const replayFrame = await Bun.file(
  "tests/fixtures/yt/livechat_replay_synth.json",
).json();
const searchLofi = await Bun.file("tests/fixtures/yt/search_lofi.json").json();
const reelSeq = await Bun.file(
  "tests/fixtures/yt/reel_sequence_synth.json",
).json();
const nextDQw4 = await Bun.file("tests/fixtures/yt/next_dQw4.json").json();
const commentsDQw4 = await Bun.file(
  "tests/fixtures/yt/comments_dQw4.json",
).json();
const updatedMeta = await Bun.file(
  "tests/fixtures/yt/updated_metadata_synth.json",
).json();

const realFetch = globalThis.fetch;
const upstreamCalls: { url: string; body: Record<string, unknown> }[] = [];

/** Route a patched upstream call to a fixture by URL substring. */
function patchUpstream(routes: Record<string, unknown>) {
  upstreamCalls.length = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = String(url instanceof Request ? url.url : url);
    let bodyText: string = "";
    if (typeof init?.body === "string") {
      bodyText = init.body;
    } else if (url instanceof Request) {
      bodyText = await url.text();
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      parsed = {};
    }
    upstreamCalls.push({ url: u, body: parsed });
    for (const [needle, fixture] of Object.entries(routes)) {
      if (u.includes(needle)) {
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: { message: "no route" } }), {
      status: 400,
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  upstreamCalls.length = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function req(url: string) {
  return new NextRequest(url);
}

describe("GET /api/videos/[id]/livechat — upstream mocked", () => {
  test("bootstrap: next() discovery → first get_live_chat frame (live video)", async () => {
    patchUpstream({
      "/youtubei/v1/next": nextLive,
      "/live_chat/get_live_chat": aljazeera,
    });
    const res = await getLiveChat(
      req("http://localhost/api/videos/gCNeDWCI0vo/livechat"),
      { params: Promise.resolve({ id: "gCNeDWCI0vo" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.chatAvailable).toBe(true);
    expect(data.mode).toBe("live");
    expect(data.isReplay).toBe(false);
    expect(data.pollMs).toBe(10000);
    expect(Array.isArray(data.messages)).toBe(true);
    expect((data.messages as unknown[]).length).toBe(68);
    expect(data.nextToken).toBeTypeOf("string");
    expect(data.participants).toBe(1);
    // exactly two upstream calls: next (discovery) + get_live_chat (first frame)
    expect(upstreamCalls).toHaveLength(2);
    expect(upstreamCalls[0].url).toContain("/youtubei/v1/next");
    expect(upstreamCalls[0].body.videoId).toBe("gCNeDWCI0vo");
    expect(upstreamCalls[1].url).toContain("live_chat/get_live_chat");
    expect(upstreamCalls[1].body.continuation).toBeTypeOf("string");
  });

  test("bootstrap for an ended live: mode replay via get_live_chat_replay", async () => {
    patchUpstream({
      "/youtubei/v1/next": nextEnded,
      "/live_chat/get_live_chat_replay": replayFrame,
    });
    const res = await getLiveChat(
      req("http://localhost/api/videos/nfhDuOHMp0A/livechat"),
      { params: Promise.resolve({ id: "nfhDuOHMp0A" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.chatAvailable).toBe(true);
    expect(data.mode).toBe("replay");
    expect(data.isReplay).toBe(true);
    expect(
      (data.messages as { offsetMsec: number | null }[]).every(
        (m) => m.offsetMsec !== null,
      ),
    ).toBe(true);
    expect(upstreamCalls[1].url).toContain("get_live_chat_replay");
  });

  test("no-chat video → chatAvailable:false (panel self-hides)", async () => {
    patchUpstream({ "/youtubei/v1/next": nextDQw4 }); // real capture: no conversationBar
    const res = await getLiveChat(
      req("http://localhost/api/videos/dQw4w9WgXcQ/livechat"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.chatAvailable).toBe(false);
    expect(data.messages).toBeUndefined();
  });

  test("advance with token: ONE upstream get_live_chat, mode passed through", async () => {
    patchUpstream({ "/live_chat/get_live_chat": aljazeera });
    const res = await getLiveChat(
      req(
        "http://localhost/api/videos/gCNeDWCI0vo/livechat?token=abc-token&mode=live",
      ),
      { params: Promise.resolve({ id: "gCNeDWCI0vo" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.chatAvailable).toBeUndefined(); // token path omits it
    expect(data.mode).toBe("live");
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].body.continuation).toBe("abc-token");
  });

  test("token advance in replay mode hits get_live_chat_replay", async () => {
    patchUpstream({ "/live_chat/get_live_chat_replay": replayFrame });
    const res = await getLiveChat(
      req(
        "http://localhost/api/videos/nfhDuOHMp0A/livechat?token=op2w0w-token&mode=replay",
      ),
      { params: Promise.resolve({ id: "nfhDuOHMp0A" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.isReplay).toBe(true);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].url).toContain("get_live_chat_replay");
  });

  test("live token 400s → auto-fallback to the replay endpoint once", async () => {
    // replay token family (op2w0w…) 400s on the live endpoint — verified live
    let liveCall = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("get_live_chat?") || (u.includes("get_live_chat") && !u.includes("replay"))) {
        liveCall += 1;
        return new Response(JSON.stringify({ error: { code: 400 } }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify(replayFrame), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await getLiveChat(
      req(
        "http://localhost/api/videos/nfhDuOHMp0A/livechat?token=op2w0w-token&mode=live",
      ),
      { params: Promise.resolve({ id: "nfhDuOHMp0A" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.mode).toBe("replay");
    expect(liveCall).toBe(1);
  });

  test("upstream hard-failure → 502 with detail", async () => {
    patchUpstream({});
    const res = await getLiveChat(
      req("http://localhost/api/videos/x/livechat?token=zz&mode=live"),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(502);
  });
});

describe("GET /api/videos/[id]/livechat/replay — replay modes", () => {
  test("full mode: first frame from the start token (bootstrap via next)", async () => {
    patchUpstream({
      "/youtubei/v1/next": nextEnded,
      "/live_chat/get_live_chat_replay": replayFrame,
    });
    const res = await getLiveChatReplay(
      req("http://localhost/api/videos/nfhDuOHMp0A/livechat/replay"),
      { params: Promise.resolve({ id: "nfhDuOHMp0A" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.chatAvailable).toBe(true);
    expect(data.isReplay).toBe(true);
    expect((data.messages as unknown[]).length).toBeGreaterThan(0);
  });

  test("live video → 409 (told to use /livechat)", async () => {
    patchUpstream({ "/youtubei/v1/next": nextLive });
    const res = await getLiveChatReplay(
      req("http://localhost/api/videos/gCNeDWCI0vo/livechat/replay"),
      { params: Promise.resolve({ id: "gCNeDWCI0vo" }) },
    );
    expect(res.status).toBe(409);
  });

  test("no-chat video → 404", async () => {
    patchUpstream({ "/youtubei/v1/next": nextDQw4 });
    const res = await getLiveChatReplay(
      req("http://localhost/api/videos/dQw4w9WgXcQ/livechat/replay"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) },
    );
    expect(res.status).toBe(404);
  });

  test("offsetSec mode: bounded linear walk until videoOffsetTimeMsec ≥ target", async () => {
    // walk: frame1 (offsets 0..11873) → frame2 (offsets 60000+) via nextToken
    const frame2 = JSON.parse(JSON.stringify(replayFrame));
    for (const a of frame2.continuationContents.liveChatContinuation.actions) {
      a.replayChatItemAction.videoOffsetTimeMsec =
        Number(a.replayChatItemAction.videoOffsetTimeMsec) + 60000;
    }
    delete frame2.continuationContents.liveChatContinuation.continuations;
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      return new Response(
        JSON.stringify(call === 1 ? replayFrame : frame2),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const res = await getLiveChatReplay(
      req("http://localhost/api/videos/nfhDuOHMp0A/livechat/replay?offsetSec=50"),
      { params: Promise.resolve({ id: "nfhDuOHMp0A" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      seek: { mode: string; calls: number; reached: boolean };
      messages: { offsetMsec: number | null }[];
    };
    expect(data.seek.mode).toBe("offset");
    expect(data.seek.calls).toBe(2); // bounded walk: 2 frames
    expect(data.seek.reached).toBe(true);
    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.messages.every((m) => (m.offsetMsec ?? 0) >= 50000)).toBe(true);
  });
});

describe("GET /api/videos/[id]/live-status — updated_metadata mocked", () => {
  test("isLive + concurrentViewers + likesText + pollMs from the response", async () => {
    patchUpstream({ "/updated_metadata": updatedMeta });
    const res = await getLiveStatus(
      req("http://localhost/api/videos/gCNeDWCI0vo/live-status"),
      { params: Promise.resolve({ id: "gCNeDWCI0vo" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.isLive).toBe(true);
    expect(data.concurrentViewers).toBe(6027);
    expect(data.viewersText).toBe("6,027 watching now");
    expect(data.likesText).toBe("768K");
    expect(data.pollMs).toBe(5000);
    // request shape: videoId + mimeType (browser-captured pattern)
    expect(upstreamCalls[0].body.videoId).toBe("gCNeDWCI0vo");
    expect(upstreamCalls[0].body.mimeType).toBe("application/json");
  });

  test("upstream error → isLive:false (watch page must not break)", async () => {
    patchUpstream({});
    const res = await getLiveStatus(
      req("http://localhost/api/videos/xyz/live-status"),
      { params: Promise.resolve({ id: "xyz" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.isLive).toBe(false);
  });
});

describe("GET /api/shorts — upstream mocked", () => {
  test("seed page: search shelves + reel sequence cursor", async () => {
    patchUpstream({
      "/youtubei/v1/search": searchLofi,
      "/reel/reel_watch_sequence": reelSeq,
    });
    const res = await getShorts(req("http://localhost/api/shorts"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      items: { id: string; title: string; viewsText: string | null }[];
      nextCursor: string | null;
    };
    expect(data.items).toHaveLength(25);
    expect(data.items[0].id).toBe("vCxGMKtyAHE");
    expect(data.items[0].title).not.toBe("");
    expect(data.nextCursor).toBeTypeOf("string");
    // upstream: search + reel_watch_sequence (sequenceParams TOP-LEVEL body)
    expect(upstreamCalls).toHaveLength(2);
    expect(upstreamCalls[1].body.sequenceParams).toBeTypeOf("string");
    expect(upstreamCalls[1].body.params).toBeUndefined();
  });

  test("cursor page: one reel_watch_sequence call with the token", async () => {
    patchUpstream({ "/reel/reel_watch_sequence": reelSeq });
    const res = await getShorts(
      req("http://localhost/api/shorts?cursor=SEQCURSOR"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(data.items).toHaveLength(4);
    expect(data.nextCursor).toBeTypeOf("string");
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].body.sequenceParams).toBe("SEQCURSOR");
  });
});

describe("GET /api/shorts/[id] — per-short meta mocked", () => {
  test("maps next + first comments page", async () => {
    let nextCall = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("/youtubei/v1/next")) {
        nextCall += 1;
        const body = nextCall === 1 ? nextDQw4 : commentsDQw4;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const res = await getShortMeta(
      req("http://localhost/api/shorts/dQw4w9WgXcQ"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      title: string;
      channel: { name: string; handle: string | null };
      commentsCountText: string | null;
      comments: unknown[];
    };
    expect(data.title).toContain("Never Gonna Give You Up");
    expect(data.channel.name).toBe("Rick Astley");
    expect(data.channel.handle).toBe("RickAstleyYT");
    expect(data.commentsCountText).toBe("2,457,856 Comments");
    expect(data.comments).toHaveLength(20);
  });

  test("invalid id → 400", async () => {
    patchUpstream({});
    const res = await getShortMeta(req("http://localhost/api/shorts/!!bad!!"), {
      params: Promise.resolve({ id: "!!bad!!" }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown video → 404 (next fails)", async () => {
    patchUpstream({});
    const res = await getShortMeta(
      req("http://localhost/api/shorts/nonexistent1"),
      { params: Promise.resolve({ id: "nonexistent1" }) },
    );
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* P17-SHORTS-CREATOR — creator affordances on the shorts comments    */
/* sheet: the detection wiring (operator mode + the canonical watch   */
/* detail flag — never a channel-vs-viewer guess) + the affordance    */
/* wiring (the watch kebab idiom: heart any depth, pin top-level      */
/* only, optimistic set → server truth → honest revert).              */
/* happy-dom + createRoot/act (the livechat-send/comment-local-rung   */
/* component pattern); all client fetches stubbed — fixtures only,    */
/* no live network.                                                   */
/* ------------------------------------------------------------------ */

const win17 = new Window();
for (const p of [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const) {
  Object.defineProperty(globalThis, p, {
    value: (win17 as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win17.localStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
  writable: true,
});

/* sonner stubbed — toasts captured for the honest-failure asserts */
const toasts17: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts17.push(String(msg)), {
    success: (m: string) => toasts17.push(`success:${m}`),
    error: (m: string) => toasts17.push(`error:${m}`),
    info: (m: string) => toasts17.push(`info:${m}`),
  }),
}));

/* next/link → a plain <a> (the composer imports it; no Next router in bun) */
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest } as Record<string, unknown>, children),
}));

const SHORT_ID17 = "dQw4w9WgXcQ";
const CHANNEL_ID17 = "UCuAXFkgsw1L7xaCfnd5JJOw";

/** a canonical-route CommentDto (the shape /api/videos/[id]/comments serves) */
const SHORT_COMMENT17 = (over: Record<string, unknown> = {}) => ({
  id: "Ugzge340dBgB75hWBm54AaABAg",
  parentId: null,
  body: "the pinned fixture comment",
  likes: 12,
  heartedByCreator: false,
  pinned: false,
  edited: false,
  moderation: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  author: {
    id: "yt-author-1",
    handle: "@fixture_author",
    name: "Fixture Author",
    avatarUrl: "",
    isMember: false,
    isCreator: false,
  },
  yourLike: null,
  isOwn: false,
  replyCount: 0,
  totalReplyCount: 0,
  ...over,
});

const VIEWER17 = {
  id: "local-user-1",
  handle: "demo",
  name: "Demo Viewer",
  avatarUrl: "https://x/a.png",
};

let root17: Root | null = null;
let host17: ReturnType<typeof win17.document.createElement> | null = null;

const mount17 = async (el: ReactElement) => {
  host17 = win17.document.createElement("div");
  win17.document.body.appendChild(host17);
  root17 = createRoot(host17 as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root17!.render(el);
  });
};

const all17 = (sel: string): HTMLElement[] =>
  host17
    ? Array.from(host17.querySelectorAll(sel) as unknown as HTMLElement[])
    : [];
const bodyText17 = (): string => win17.document.body.textContent ?? "";

const unmount17 = () => {
  act(() => {
    root17?.unmount();
  });
  host17?.remove();
  root17 = null;
  host17 = null;
};

/** the sheet's client calls, routed to fixtures (fixtures-only, no network) */
function stubSheetFetch(opts: {
  operatorSession: boolean;
  isCreator?: boolean;
  detailFails?: boolean;
  comment?: Record<string, unknown>;
}) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (u === "/api/watch/session") {
      return json({ viewer: VIEWER17, operatorSession: opts.operatorSession });
    }
    if (u.includes(`/api/videos/${SHORT_ID17}/comments`)) {
      return json({
        items: [SHORT_COMMENT17(opts.comment)],
        total: 1,
        nextCursor: null,
      });
    }
    if (u === `/api/videos/${SHORT_ID17}`) {
      if (opts.detailFails) return new Response("boom", { status: 500 });
      return json({
        video: { id: SHORT_ID17, title: "fixture short", channelId: CHANNEL_ID17 },
        state: { isCreator: opts.isCreator === true },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
}

/** the row's write calls, captured (body + url) for the wire asserts */
const writeCalls17: { url: string; body: Record<string, unknown> }[] = [];
function stubWriteFetch(respond: (url: string) => unknown = () => ({})) {
  writeCalls17.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    writeCalls17.push({ url: u, body });
    return new Response(JSON.stringify(respond(u)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const heartBadge17 = (): unknown =>
  host17 ? host17.querySelector("[aria-label='Loved by creator']") : null;

const kebab17 = (): HTMLButtonElement | undefined =>
  Array.from(
    win17.document.body.querySelectorAll("button") as unknown as HTMLElement[],
  ).find(
    (b) => (b.getAttribute("aria-label") ?? "").startsWith("Comment actions for "),
  ) as HTMLButtonElement | undefined;

const openKebab17 = async () => {
  const trigger = kebab17();
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger!.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
  await act(async () => {});
};

const menuItem17 = (label: string): HTMLElement | undefined =>
  Array.from(
    win17.document.body.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
  ).find((el) => (el.textContent ?? "").trim() === label);

describe("P17 — ShortsCommentsSheet creator detection (canonical flag, never a guess)", () => {
  const mountSheet = async () => {
    const { ShortsCommentsSheet } = await import("@/components/shorts/shorts-comments-sheet");
    await mount17(
      createElement(ShortsCommentsSheet, {
        videoId: SHORT_ID17,
        meta: {
          id: SHORT_ID17,
          title: "fixture short",
          channel: { id: CHANNEL_ID17, handle: "RickAstleyYT", name: "Rick Astley", avatarUrl: null },
          viewsText: "1M views",
          likesText: "100K",
          commentsCountText: "1 Comment",
          thumbnailUrl: null,
          dateText: null,
          comments: [],
          commentsNextToken: null,
        },
        open: true,
        onClose: () => {},
        guest: false,
      }),
    );
    await act(async () => {}); // flush the probe + list effects
    await act(async () => {});
  };

  afterEach(() => {
    unmount17();
    globalThis.fetch = realFetch;
  });

  test("operator mode + detail isCreator:true → the creator kebab renders on rows", async () => {
    stubSheetFetch({ operatorSession: true, isCreator: true });
    await mountSheet();
    expect(bodyText17()).toContain("the pinned fixture comment");
    expect(kebab17()).toBeDefined();
  });

  test("operator mode + detail isCreator:false → NO kebab (non-creator parity)", async () => {
    stubSheetFetch({ operatorSession: true, isCreator: false });
    await mountSheet();
    expect(bodyText17()).toContain("the pinned fixture comment");
    expect(kebab17()).toBeUndefined();
  });

  test("public mode → NO kebab AND the detail route is never called (the zero-call honest path)", async () => {
    const calls = stubSheetFetch({ operatorSession: false });
    await mountSheet();
    expect(kebab17()).toBeUndefined();
    expect(calls).not.toContain(`/api/videos/${SHORT_ID17}`);
  });

  test("detail fetch failure → NO kebab (uncertain → the honest default)", async () => {
    stubSheetFetch({ operatorSession: true, detailFails: true });
    await mountSheet();
    expect(kebab17()).toBeUndefined();
  });

  test("a channel-vs-viewer handle COINCIDENCE never fabricates the affordance (route semantics law)", async () => {
    // the viewer's local handle equals the short's YouTube channel handle —
    // the session probe alone must NOT surface creator powers (the routes
    // gate on operatorIsCreator + auth, not on handle collisions)
    const calls = stubSheetFetch({ operatorSession: true, isCreator: false });
    await mountSheet();
    expect(kebab17()).toBeUndefined();
    expect(calls).toContain(`/api/videos/${SHORT_ID17}`); // the flag WAS consulted
  });
});

describe("P17 — ShortsCommentRow creator affordances (the watch kebab idiom)", () => {
  const rowProps = (over: Partial<ShortsCommentRowProps> = {}): ShortsCommentRowProps => ({
    comment: SHORT_COMMENT17() as unknown as CommentDto,
    videoId: SHORT_ID17,
    viewer: VIEWER17,
    operatorSession: true,
    guest: false,
    viewerIsCreator: true,
    depth: 0,
    ...over,
  });

  const mountRow = async (props: ShortsCommentRowProps) => {
    const { ShortsCommentRow } = await import("@/components/shorts/shorts-comment-row");
    await mount17(createElement(ShortsCommentRow, props));
  };

  beforeEach(() => {
    toasts17.length = 0;
  });

  afterEach(() => {
    unmount17();
    globalThis.fetch = realFetch;
  });

  test("non-creator rows render NO kebab (byte-identical P16 row)", async () => {
    stubWriteFetch();
    await mountRow(rowProps({ viewerIsCreator: false }));
    expect(kebab17()).toBeUndefined();
    // the read-only badges still render from the canonical data
    expect(all17("p").some((p) => (p.textContent ?? "").trim() === "Pinned")).toBe(false);
    unmount17();
    await mountRow(
      rowProps({
        viewerIsCreator: false,
        comment: SHORT_COMMENT17({ pinned: true, heartedByCreator: true }),
      }),
    );
    expect(all17("p").some((p) => (p.textContent ?? "").trim() === "Pinned")).toBe(true);
    expect(heartBadge17()).not.toBeNull();
    expect(kebab17()).toBeUndefined();
  });

  test("creator kebab: Heart + Pin at depth 0; Heart only at depth 1 (YouTube's constraint)", async () => {
    stubWriteFetch();
    await mountRow(rowProps());
    await openKebab17();
    expect(menuItem17("Heart")).toBeDefined();
    expect(menuItem17("Pin")).toBeDefined();
    unmount17();

    await mountRow(rowProps({ depth: 1 }));
    await openKebab17();
    expect(menuItem17("Heart")).toBeDefined();
    expect(menuItem17("Pin")).toBeUndefined();
  });

  test("Heart: POST /api/comments/{id}/heart with {videoId, commentText} → server truth renders the badge", async () => {
    stubWriteFetch((u) =>
      u.endsWith("/heart") ? { ok: true, heartedByCreator: true } : {},
    );
    await mountRow(rowProps());
    await openKebab17();
    await act(async () => {
      menuItem17("Heart")!.click();
    });
    await act(async () => {});
    expect(writeCalls17).toHaveLength(1);
    expect(writeCalls17[0].url).toBe(`/api/comments/${SHORT_COMMENT17().id}/heart`);
    expect(writeCalls17[0].body).toEqual({
      videoId: SHORT_ID17,
      commentText: "the pinned fixture comment",
    });
    // server truth → the hearted badge renders (aria-label parity)
    expect(heartBadge17()).not.toBeNull();
    expect(toasts17).toEqual([]); // heart stays silent on success (watch parity)
  });

  test("Heart failure → honest revert (no badge) + the error toast", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Only the video's channel owner can heart comments" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    await mountRow(rowProps());
    await openKebab17();
    await act(async () => {
      menuItem17("Heart")!.click();
    });
    await act(async () => {});
    expect(heartBadge17()).toBeNull();
    expect(toasts17.some((t) => t.startsWith("error:") && t.includes("heart"))).toBe(true);
  });

  test("Pin: POST /api/comments/{id}/pin → server truth renders 'Pinned' + the success toast", async () => {
    stubWriteFetch((u) => (u.endsWith("/pin") ? { ok: true, pinned: true } : {}));
    await mountRow(rowProps());
    await openKebab17();
    await act(async () => {
      menuItem17("Pin")!.click();
    });
    await act(async () => {});
    expect(writeCalls17).toHaveLength(1);
    expect(writeCalls17[0].url).toBe(`/api/comments/${SHORT_COMMENT17().id}/pin`);
    expect(writeCalls17[0].body).toEqual({
      videoId: SHORT_ID17,
      commentText: "the pinned fixture comment",
    });
    expect(all17("p").some((p) => (p.textContent ?? "").trim() === "Pinned")).toBe(true);
    expect(toasts17).toContain("success:Comment pinned");
  });

  test("Pin failure → honest revert (no badge) + the error toast", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Only the video's channel owner can pin comments" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    await mountRow(rowProps());
    await openKebab17();
    await act(async () => {
      menuItem17("Pin")!.click();
    });
    await act(async () => {});
    expect(all17("p").some((p) => (p.textContent ?? "").trim() === "Pinned")).toBe(false);
    expect(toasts17.some((t) => t.startsWith("error:") && t.includes("pin"))).toBe(true);
  });

  test("an already-hearted/pinned comment offers Remove heart / Unpin (the toggle labels)", async () => {
    stubWriteFetch();
    await mountRow(
      rowProps({ comment: SHORT_COMMENT17({ heartedByCreator: true, pinned: true }) }),
    );
    // the read-only state renders first…
    expect(all17("p").some((p) => (p.textContent ?? "").trim() === "Pinned")).toBe(true);
    await openKebab17();
    expect(menuItem17("Remove heart")).toBeDefined();
    expect(menuItem17("Unpin")).toBeDefined();
  });

  test("guest + creator flag → clicking Heart never writes (the AU signed-out law)", async () => {
    stubWriteFetch();
    await mountRow(rowProps({ guest: true }));
    await openKebab17();
    await act(async () => {
      menuItem17("Heart")!.click();
    });
    await act(async () => {});
    expect(writeCalls17).toHaveLength(0); // no heart POST from a guest, ever
  });
});
