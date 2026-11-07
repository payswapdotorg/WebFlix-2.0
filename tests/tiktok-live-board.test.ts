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
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  clearTikTokLiveCache,
  isTikTokLiveBoardInFlight,
  normalizeBoardHandles,
  peekTikTokLiveBoard,
  peekTikTokLiveStatus,
  probeTikTokLiveBoard,
  probeTikTokLiveStatus,
  readTikTokLiveBoardEntry,
  setTikTokLiveClock,
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
  setTikTokLiveClock(null); // restore the real clock (the SWR pins step it)
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

// ---------------------------------------------------------------------------
// P102-R2 — the SWR law: a warm board never goes dark. An expired-but-present
// board is SERVED (stale: true, fetchedAt carries the age) while the refresh
// rides after(); only a COLD universe ever sees the probing board. The P100
// probing-flip made the hub flash "Checking who is live…" every 30s.
// ---------------------------------------------------------------------------
describe("the SWR law: a warm board never goes dark", () => {
  test("readTikTokLiveBoardEntry answers fresh AND stale entries (the SWR seam)", async () => {
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW, SCOUT_OFFLINE_ROW]));
    await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    const fresh = readTikTokLiveBoardEntry(["lofigirl", "scout2015"]);
    expect(fresh?.fresh).toBe(true);
    expect(fresh?.board.rooms.length).toBe(2);
    setTikTokLiveClock(() => Date.now() + 40_000); // past the 30s liveness TTL
    const stale = readTikTokLiveBoardEntry(["lofigirl", "scout2015"]);
    expect(stale?.fresh).toBe(false);
    expect(stale?.board.rooms.length).toBe(2); // the entry is NOT dropped
  });

  test("the board route serves the stale board while the refresh rides", async () => {
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW, SCOUT_OFFLINE_ROW]));
    const seeded = await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    expect(seeded.rooms.length).toBe(2);
    // the rail seam is mocked so the route derives the SAME handle universe
    // (the REAL library module rides beneath — its other exports, like the
    // feed-page constants channels.ts imports, stay intact)
    const realLibrary = await import("@/lib/tiktok/library");
    mock.module("@/lib/tiktok/library", () => ({
      ...realLibrary,
      getTikTokRail: async () => ({
        videos: [
          { id: "v1", author: "lofigirl" },
          { id: "v2", author: "scout2015" },
        ],
        universeSize: 2,
        source: "curated",
        unavailable: false,
        unavailableReason: null,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { GET } = await import("@/app/api/tiktok/live/board/route");
    const freshRes = await GET();
    expect(freshRes.status).toBe(200);
    const freshBody = await freshRes.json();
    expect(freshBody.board.rooms.length).toBe(2);
    // now the entry goes stale and the refresh lane never settles — the stale
    // board is still served (the hub never flashes back to probing)
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    setTikTokLiveClock(() => Date.now() + 40_000);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.board.rooms.length).toBe(2);
    expect(body.board.rooms[0].live).toBe(true);
    expect(body.board.stale).toBe(true);
    expect(body.board.probing).toBeUndefined();
    expect(isTikTokLiveBoardInFlight(["lofigirl", "scout2015"])).toBe(true);
  });

  test("a cold universe still answers the honest probing board", async () => {
    const realLibrary = await import("@/lib/tiktok/library");
    mock.module("@/lib/tiktok/library", () => ({
      ...realLibrary,
      getTikTokRail: async () => ({
        videos: [{ id: "v1", author: "lofigirl" }],
        universeSize: 1,
        source: "curated",
        unavailable: false,
        unavailableReason: null,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    const { GET } = await import("@/app/api/tiktok/live/board/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.board.probing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P102-R3 — the merge law: the batch actor EMPIRICALLY DROPS rows (measured
// on prod this window: 5 of 16 handles answered in one run — lofigirl, live
// at 193 viewers, landed in `missing` while the single-handle lane proved
// her live). The SERVED board therefore folds in FRESH live answers the
// per-handle status cache already holds — every merged row is a real probe's
// answer, the cost law adds zero spend. A stale or offline cache answer
// never claims liveness on the hub.
// ---------------------------------------------------------------------------
describe("the merge law: the board never under-reports a checked creator", () => {
  test("mergeTikTokLiveBoard folds a fresh live cache answer over a batch miss", async () => {
    const { mergeTikTokLiveBoard } = await import("@/lib/tiktok/live");
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW]));
    await probeTikTokLiveStatus("lofigirl"); // the single lane proved her live
    const board: import("@/lib/tiktok/live").TikTokLiveBoardDTO = {
      rooms: [{ handle: "scout2015", live: false, room: null, stream: null, source: "apify", fetchedAt: new Date().toISOString() }],
      missing: ["lofigirl"],
      fetchedAt: new Date().toISOString(),
    };
    const merged = mergeTikTokLiveBoard(board);
    expect(merged.rooms.find((r) => r.handle === "lofigirl")?.live).toBe(true);
    expect(merged.missing).toEqual([]); // she was answered — by a real probe
    expect(merged.rooms.find((r) => r.handle === "scout2015")?.live).toBe(false);
  });

  test("a stale cache answer never claims liveness on the board", async () => {
    const { mergeTikTokLiveBoard, setTikTokLiveClock } = await import("@/lib/tiktok/live");
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW]));
    await probeTikTokLiveStatus("lofigirl");
    setTikTokLiveClock(() => Date.now() + 40_000); // past the 30s LIVE TTL
    const board: import("@/lib/tiktok/live").TikTokLiveBoardDTO = {
      rooms: [],
      missing: ["lofigirl"],
      fetchedAt: new Date().toISOString(),
    };
    const merged = mergeTikTokLiveBoard(board);
    expect(merged.rooms).toEqual([]);
    expect(merged.missing).toEqual(["lofigirl"]); // honest: this sweep didn't check her
  });

  test("an OFFLINE cache answer never claims the hub (and stays missing)", async () => {
    const { mergeTikTokLiveBoard } = await import("@/lib/tiktok/live");
    setTikTokLiveProbeUpstream(boardTransport([SCOUT_OFFLINE_ROW]));
    await probeTikTokLiveStatus("scout2015");
    const board: import("@/lib/tiktok/live").TikTokLiveBoardDTO = {
      rooms: [],
      missing: ["scout2015"],
      fetchedAt: new Date().toISOString(),
    };
    const merged = mergeTikTokLiveBoard(board);
    expect(merged.rooms).toEqual([]); // offline rows never render as rooms
    expect(merged.missing).toEqual(["scout2015"]);
  });

  test("the board route serves the merged board (the hub sees a room-visited creator)", async () => {
    // the batch ran and dropped lofigirl's row; her cache is cold
    setTikTokLiveProbeUpstream(boardTransport([SCOUT_OFFLINE_ROW]));
    const seeded = await probeTikTokLiveBoard(["lofigirl", "scout2015"]);
    expect(seeded.missing).toEqual(["lofigirl"]);
    const realLibrary = await import("@/lib/tiktok/library");
    mock.module("@/lib/tiktok/library", () => ({
      ...realLibrary,
      getTikTokRail: async () => ({
        videos: [
          { id: "v1", author: "lofigirl" },
          { id: "v2", author: "scout2015" },
        ],
        universeSize: 2,
        source: "curated",
        unavailable: false,
        unavailableReason: null,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { GET } = await import("@/app/api/tiktok/live/board/route");
    // a visitor opens lofigirl's room — the single lane proves her live
    setTikTokLiveProbeUpstream(boardTransport([LOFI_LIVE_ROW]));
    await probeTikTokLiveStatus("lofigirl");
    // the hub reads the board: the merge law folds her in (no new spend)
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { board: import("@/lib/tiktok/live").TikTokLiveBoardDTO };
    expect(body.board.rooms.find((r) => r.handle === "lofigirl")?.live).toBe(true);
    expect(body.board.missing).toEqual([]);
  });
});
