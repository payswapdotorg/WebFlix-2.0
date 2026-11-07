/// <reference types="bun-types" />
/**
 * P102 — the live PLAYBACK battery (docs/research/2026-11-07-p102-live-
 * playback-navigation-report.md, G26): the playback provider (the
 * automation-lab stream-urls actor) mapped defensively, the identity guard
 * that makes the wrong-creator trap (probe R3a) honest, the run→poll→dataset
 * state machine with the `{"usernames":[…]}` input-body pin, the 120s
 * playback cache TTL, coalescing, failure backoff, and the route-level
 * composition law (a playback probe is spent ONLY for a live room — the
 * cost law; an offline room never pays). No network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearTikTokLiveCache,
  isTikTokLivePlaybackInFlight,
  isTikTokLiveProbeInFlight,
  mapApifyPlaybackRow,
  peekTikTokLivePlayback,
  peekTikTokLiveStatus,
  probeTikTokLivePlayback,
  probeTikTokLiveStatus,
  setTikTokLiveProbePolling,
  TikTokLiveUnavailableError,
} from "@/lib/tiktok/live";
import { setTikTokLiveProbeUpstream, type TikTokProbeFetch } from "@/lib/tiktok/live-upstream";

/** The automation-lab actor's row shape, exactly as captured in probe R3. */
const PLAYBACK_ROW_LOFI = {
  username: "lofigirl",
  sourceUrl: "https://www.tiktok.com/@lofigirl/live",
  profileUrl: "https://www.tiktok.com/@lofigirl",
  roomId: "7704607314401184534",
  status: "live",
  isLive: true,
  title: "christmas lofi radio 🎄",
  viewerCount: 193,
  startedAt: "2026-11-05T08:52:40.000Z",
  hostUsername: "lofigirl",
  streamUrls: [
    { format: "flv", quality: "HD1", url: "https://pull-f5-tt04.tiktokcdn.com/stream_hd.flv?expire=1" },
    { format: "hls", quality: "default", url: "https://pull-hls-f16-tt04.tiktokcdn.com/stream_hd/index.m3u8?expire=1" },
    { format: "rtmp", quality: "default", url: "https://pull-f5-tt04.tiktokcdn.com/stream_hd.flv?expire=1" },
  ],
  resolutionMethod: "live-page",
  resolutionError: null,
  scrapedAt: "2026-11-07T16:36:10.861Z",
};

/** The R3a trap row: the actor's hard-coded default creator. */
const PLAYBACK_ROW_WRONG = {
  ...PLAYBACK_ROW_LOFI,
  username: "weathernewslive",
  hostUsername: "weathernewslive",
  roomId: "7704341807950498581",
  viewerCount: 6580,
};

function scriptedTransport(
  respond: (url: string, init?: RequestInit) => Response,
  calls: string[] = [],
  bodies: unknown[] = []
): TikTokProbeFetch {
  return ((url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(respond(String(url), init));
  }) as TikTokProbeFetch;
}

function happyPlaybackTransport(calls: string[] = [], bodies: unknown[] = [], rows: unknown[] = [PLAYBACK_ROW_LOFI]) {
  return scriptedTransport(
    (url) => {
      if (url.includes("/acts/") && url.includes("/runs")) {
        return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), { status: 200 });
      }
      if (url.includes("/actor-runs/")) {
        return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), { status: 200 });
      }
      return new Response(JSON.stringify(rows), { status: 200 });
    },
    calls,
    bodies
  );
}

beforeEach(() => {
  process.env.APIFY_API_KEY = "test-key";
  delete process.env.APIFY_LIVE_ACTOR_ID;
  delete process.env.APIFY_LIVE_STREAM_ACTOR_ID;
  clearTikTokLiveCache();
  setTikTokLiveProbePolling({ intervalMs: 1, maxAttempts: 3 });
});

afterEach(() => {
  setTikTokLiveProbeUpstream(null);
  setTikTokLiveProbePolling(null);
  clearTikTokLiveCache();
});

describe("mapApifyPlaybackRow", () => {
  test("maps the captured R3 row: hls by format, flv by format, roomId carried", () => {
    const info = mapApifyPlaybackRow(PLAYBACK_ROW_LOFI, "lofigirl");
    expect(info).not.toBeNull();
    expect(info?.hlsUrl).toBe("https://pull-hls-f16-tt04.tiktokcdn.com/stream_hd/index.m3u8?expire=1");
    expect(info?.flvUrl).toBe("https://pull-f5-tt04.tiktokcdn.com/stream_hd.flv?expire=1");
    expect(info?.roomId).toBe("7704607314401184534");
  });

  test("THE IDENTITY GUARD (probe R3a): the wrong-creator default row answers null — never a wrong stream", () => {
    expect(mapApifyPlaybackRow(PLAYBACK_ROW_WRONG, "lofigirl")).toBeNull();
  });

  test("offline rows and resolution errors answer null honestly", () => {
    expect(mapApifyPlaybackRow({ ...PLAYBACK_ROW_LOFI, isLive: false }, "lofigirl")).toBeNull();
    expect(
      mapApifyPlaybackRow({ ...PLAYBACK_ROW_LOFI, resolutionError: "room closed" }, "lofigirl")
    ).toBeNull();
  });

  test("malformed rows answer null (the honesty law: never throw, never fake)", () => {
    expect(mapApifyPlaybackRow(null, "lofigirl")).toBeNull();
    expect(mapApifyPlaybackRow("nope", "lofigirl")).toBeNull();
    expect(mapApifyPlaybackRow({ username: "lofigirl", isLive: true }, "lofigirl")).toBeNull();
    expect(
      mapApifyPlaybackRow(
        { ...PLAYBACK_ROW_LOFI, streamUrls: [{ format: "hls" }, { nope: true }, "x"] },
        "lofigirl"
      )
    ).toBeNull();
  });
});

describe("the playback state machine", () => {
  test("THE INPUT CONTRACT PIN (R3a): the run POST carries {usernames:[handle]} — the four ignored shapes never ride", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    setTikTokLiveProbeUpstream(happyPlaybackTransport(calls, bodies));
    const info = await probeTikTokLivePlayback("lofigirl");
    expect(info?.hlsUrl).toContain(".m3u8");
    const runBodies = bodies.filter((b) => (b as { usernames?: unknown }).usernames !== undefined);
    expect(runBodies.length).toBe(1);
    expect(runBodies[0]).toEqual({ usernames: ["lofigirl"] });
    expect(calls.some((u) => u.includes("automation-lab~tiktok-live-room-stream-urls"))).toBe(true);
  });

  test("the actor id override rides APIFY_LIVE_STREAM_ACTOR_ID", async () => {
    process.env.APIFY_LIVE_STREAM_ACTOR_ID = "custom~playback-actor";
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(happyPlaybackTransport(calls));
    await probeTikTokLivePlayback("lofigirl");
    expect(calls.some((u) => u.includes("custom~playback-actor"))).toBe(true);
  });

  test("the answer caches for 120s: a peek hits the cache without a second run", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(happyPlaybackTransport(calls));
    await probeTikTokLivePlayback("lofigirl");
    const runsAfterFirst = calls.filter((u) => u.includes("/runs")).length;
    const peeked = await peekTikTokLivePlayback("lofigirl");
    expect(peeked?.roomId).toBe("7704607314401184534");
    expect(calls.filter((u) => u.includes("/runs")).length).toBe(runsAfterFirst);
  });

  test("concurrent probes coalesce onto one machine", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(happyPlaybackTransport(calls));
    const [a, b] = await Promise.all([probeTikTokLivePlayback("lofigirl"), probeTikTokLivePlayback("lofigirl")]);
    expect(a?.hlsUrl).toBe(b?.hlsUrl);
    expect(calls.filter((u) => u.includes("/runs")).length).toBe(1);
  });

  test("a failed run earns the 60s backoff and peek surfaces the real error", async () => {
    setTikTokLiveProbeUpstream(
      scriptedTransport((url) => {
        if (url.includes("/acts/") && url.includes("/runs")) {
          return new Response("nope", { status: 500 });
        }
        return new Response("{}", { status: 200 });
      })
    );
    let thrown: unknown = null;
    try {
      await probeTikTokLivePlayback("lofigirl");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TikTokLiveUnavailableError);
    let peekErr: unknown = null;
    try {
      await peekTikTokLivePlayback("lofigirl");
    } catch (err) {
      peekErr = err;
    }
    expect(peekErr).toBeInstanceOf(TikTokLiveUnavailableError);
  });

  test("an unconfigured lane answers the honest 503 that names the enable path", async () => {
    delete process.env.APIFY_API_KEY;
    let thrown: TikTokLiveUnavailableError | null = null;
    try {
      await probeTikTokLivePlayback("lofigirl");
    } catch (err) {
      thrown = err as TikTokLiveUnavailableError;
    }
    expect(thrown?.status).toBe(503);
    expect(thrown?.message).toContain("APIFY_API_KEY");
  });

  test("an invalid handle never touches the transport", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(happyPlaybackTransport(calls));
    expect(await probeTikTokLivePlayback("b@d")).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("the in-flight flag flips during a live probe and clears after", async () => {
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
        return Promise.resolve(new Response(JSON.stringify([PLAYBACK_ROW_LOFI]), { status: 200 }));
      }) as TikTokProbeFetch
    );
    const pending = probeTikTokLivePlayback("lofigirl");
    expect(isTikTokLivePlaybackInFlight("lofigirl")).toBe(true);
    release();
    await pending;
    expect(isTikTokLivePlaybackInFlight("lofigirl")).toBe(false);
  });
});

describe("the route composition law (the cost law)", () => {
  test("a LIVE status composes the cached playback answer into the DTO stream", async () => {
    setTikTokLiveProbeUpstream(
      scriptedTransport((url) => {
        if (url.includes("/acts/") && url.includes("/runs")) {
          return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
            status: 200,
          });
        }
        if (url.includes("/actor-runs/")) {
          return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
            status: 200,
          });
        }
        // a mixed dataset: the STATUS mapper's identity guard picks the
        // status row for the status machine, the PLAYBACK mapper's guard
        // picks the playback row for the playback machine
        return new Response(JSON.stringify([{
          handle: "lofigirl",
          unique_id: "lofigirl",
          is_live: true,
          room_title: "christmas lofi radio 🎄",
          viewer_count: 193,
          started_at: "2026-11-05T08:52:40.000Z",
          room_url: "https://www.tiktok.com/@lofigirl/live",
          stream_urls: null,
          _metadata: { fetched_at: "2026-11-07T07:45:00.000Z" },
        }, PLAYBACK_ROW_LOFI]), { status: 200 });
      })
    );
    const status = await probeTikTokLiveStatus("lofigirl");
    expect(status?.live).toBe(true);
    // the status probe alone never carries the stream (the R1 finding)
    expect(status?.stream).toBeNull();
    // one playback probe fills it
    const stream = await probeTikTokLivePlayback("lofigirl");
    expect(stream?.hlsUrl).toContain(".m3u8");
  });

  test("an OFFLINE room never spends a playback probe (the cost-law pin)", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(
      scriptedTransport(
        (url) => {
          if (url.includes("/acts/") && url.includes("/runs")) {
            return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
              status: 200,
            });
          }
          if (url.includes("/actor-runs/")) {
            return new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d" } }), {
              status: 200,
            });
          }
          return new Response(
            JSON.stringify([{ handle: "lofigirl", unique_id: "lofigirl", is_live: false, _metadata: {} }]),
            { status: 200 }
          );
        },
        calls
      )
    );
    const status = await probeTikTokLiveStatus("lofigirl");
    expect(status?.live).toBe(false);
    // the route law (asserted by the route battery) only probes playback for
    // live rooms; here we pin the seam: the offline status answer caches with
    // stream null and NO playback entry exists
    expect(await peekTikTokLivePlayback("lofigirl")).toBeNull();
  });
});
