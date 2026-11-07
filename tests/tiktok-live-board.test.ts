/// <reference types="bun-types" />
/**
 * P102 — the live BOARD battery (G27, the honest navigation closure): the
 * batch probe answers the whole tracked universe for the cost of ONE actor
 * run (the status actor's native `{"handles":[…]}` mode), rows are matched
 * to handles by identity (the mapper's guard), missing rows are answered
 * honestly, invalid handles are dropped before the run, the board caches
 * with the liveness-dependent TTL, and concurrent boards coalesce. No
 * network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearTikTokLiveCache,
  isTikTokLiveBoardInFlight,
  normalizeBoardHandles,
  peekTikTokLiveBoard,
  peekTikTokLiveStatus,
  probeTikTokLiveBoard,
  setTikTokLiveProbePolling,
  TikTokLiveUnavailableError,
} from "@/lib/tiktok/live";
import { setTikTokLiveProbeUpstream, type TikTokProbeFetch } from "@/lib/tiktok/live-upstream";

const LOFI_LIVE_ROW = {
  handle: "lofigirl",
  unique_id: "lofigirl",
  is_live: true,
  room_title: "christmas lofi radio 🎄",
  viewer_count: 193,
  started_at: "2026-11-05T08:52:40.000Z",
  room_url: "https://www.tiktok.com/@lofigirl/live",
  stream_urls: null,
  _metadata: { fetched_at: "2026-11-07T07:45:00.000Z" },
};

const SCOUT_OFFLINE_ROW = {
  handle: "scout2015",
  unique_id: "scout2015",
  is_live: false,
  _metadata: { fetched_at: "2026-11-07T07:45:00.000Z" },
};

function boardTransport(rows: unknown[], calls: string[] = [], bodies: unknown[] = []): TikTokProbeFetch {
  return ((url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (url.includes("/acts/") && url.includes("/runs")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), { status: 200 })
      );
    }
    if (url.includes("/actor-runs/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), { status: 200 })
      );
    }
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  }) as TikTokProbeFetch;
}

beforeEach(() => {
  process.env.APIFY_API_KEY = "test-key";
  delete process.env.APIFY_LIVE_ACTOR_ID;
  clearTikTokLiveCache();
  setTikTokLiveProbePolling({ intervalMs: 1, maxAttempts: 3 });
});

afterEach(() => {
  setTikTokLiveProbeUpstream(null);
  setTikTokLiveProbePolling(null);
  clearTikTokLiveCache();
});

describe("normalizeBoardHandles", () => {
  test("normalizes sigils, drops invalid handles, dedupes, keeps order", () => {
    expect(normalizeBoardHandles(["@@lofigirl", "b@d", "", "scout2015", "lofigirl"])).toEqual([
      "lofigirl",
      "scout2015",
    ]);
  });
});

describe("the board probe", () => {
  test("ONE run carries every requested handle in the body (the batch pin)", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW, SCOUT_OFFLINE_ROW], calls, bodies));
    const board = await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    const runBodies = bodies.filter((b) => (b as { handles?: unknown }).handles !== undefined);
    expect(runBodies.length).toBe(1);
    expect(runBodies[0]).toEqual({ handles: ["lofigirl", "scout2015"] });
    expect(board.rooms.length).toBe(2);
    expect(board.missing).toEqual([]);
  });

  test("rows are matched by identity; a live row carries the full room; offline is a real answer", async () => {
    setTikTokLiveProbeUpstream(boardTransport([SCOUT_OFFLINE_ROW, LOFI_LIVE_ROW]));
    const board = await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    const lofi = board.rooms.find((r) => r.handle === "lofigirl");
    const scout = board.rooms.find((r) => r.handle === "scout2015");
    expect(lofi?.live).toBe(true);
    expect(lofi?.room?.title).toBe("christmas lofi radio 🎄");
    expect(scout?.live).toBe(false);
    expect(scout?.room).toBeNull();
  });

  test("missing rows are answered honestly (no fabrication)", async () => {
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW]));
    const board = await probeTikTokLiveBoard(["lofigirl", "ghostcreator"]);
    expect(board.rooms.length).toBe(1);
    expect(board.missing).toEqual(["ghostcreator"]);
  });

  test("invalid handles are dropped BEFORE the run (no cents spent on garbage)", async () => {
    const bodies: unknown[] = [];
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW], [], bodies));
    const board = await probeTikTokLiveBoard(["b@d", "", "@@lofigirl"]);
    const runBodies = bodies.filter((b) => (b as { handles?: unknown }).handles !== undefined);
    expect(runBodies[0]).toEqual({ handles: ["lofigirl"] });
    expect(board.rooms.length).toBe(1);
    expect(board.missing).toEqual([]);
  });

  test("the per-handle answers ride the SAME status cache the single-handle lane reads", async () => {
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW, SCOUT_OFFLINE_ROW]));
    await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    const lofi = await peekTikTokLiveStatus("lofigirl");
    expect(lofi?.live).toBe(true);
  });

  test("the board TTL is liveness-dependent: any live room → 30s, all offline → 300s", async () => {
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW, SCOUT_OFFLINE_ROW]));
    await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    const liveBoard = await peekTikTokLiveBoard(["lofigirl", "scout2015"]);
    expect(liveBoard?.probing).toBeFalsy();
    // peek twice — no throw, the cache holds
    expect((await peekTikTokLiveBoard(["lofigirl", "scout2015"]))?.rooms.length).toBe(2);
    setTikTokLiveProbeUpstream(boardTransport([SCOUT_OFFLINE_ROW]));
    await probeTikTokLiveBoard(["scout2015"]);
    const offlineBoard = await peekTikTokLiveBoard(["scout2015"]);
    expect(offlineBoard?.rooms[0]?.live).toBe(false);
  });

  test("concurrent boards for the same universe coalesce onto one run", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW], calls));
    const [a, b] = await Promise.all([probeTikTokLiveBoard(["lofigirl"]), probeTikTokLiveBoard(["lofigirl"])]);
    expect(a.rooms.length).toBe(b.rooms.length);
    expect(calls.filter((u) => u.includes("/runs")).length).toBe(1);
  });

  test("a failed board run earns the backoff and peek surfaces it", async () => {
    setTikTokLiveProbeUpstream(
      boardTransport(null as unknown as unknown[]) && ((() => {
        const t: TikTokProbeFetch = (url) => {
          if (url.includes("/acts/") && url.includes("/runs")) {
            return Promise.resolve(new Response("boom", { status: 500 }));
          }
          return Promise.resolve(new Response("{}", { status: 200 }));
        };
        return t;
      })())
    );
    let thrown: unknown = null;
    try {
      await probeTikTokLiveBoard(["lofigirl"]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TikTokLiveUnavailableError);
  });

  test("an unconfigured lane answers the honest 503", async () => {
    delete process.env.APIFY_API_KEY;
    let thrown: TikTokLiveUnavailableError | null = null;
    try {
      await probeTikTokLiveBoard(["lofigirl"]);
    } catch (err) {
      thrown = err as TikTokLiveUnavailableError;
    }
    expect(thrown?.status).toBe(503);
  });

  test("the in-flight flag flips during the board probe and clears after", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setTikTokLiveProbeUpstream(
      ((url: string) => {
        if (url.includes("/acts/") && url.includes("/runs")) {
          return gate.then(
            () =>
              new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
                status: 200,
              })
          );
        }
        if (url.includes("/actor-runs/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
              status: 200,
            })
          );
        }
        return Promise.resolve(new Response(JSON.stringify([LOFI_LIVE_ROW]), { status: 200 }));
      }) as TikTokProbeFetch
    );
    const pending = probeTikTokLiveBoard(["lofigirl"]);
    expect(isTikTokLiveBoardInFlight(["lofigirl"])).toBe(true);
    release();
    await pending;
    expect(isTikTokLiveBoardInFlight(["lofigirl"])).toBe(false);
  });
});
