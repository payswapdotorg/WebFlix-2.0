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
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as getLiveChat } from "@/app/api/videos/[id]/livechat/route";
import {
  GET as getLiveChatReplay,
} from "@/app/api/videos/[id]/livechat/replay/route";
import { GET as getLiveStatus } from "@/app/api/videos/[id]/live-status/route";
import { GET as getShorts } from "@/app/api/shorts/route";
import { GET as getShortMeta } from "@/app/api/shorts/[id]/route";

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
