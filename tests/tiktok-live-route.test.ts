/// <reference types="bun-types" />
/**
 * P100 — the /api/tiktok/live route battery: the status contracts
 * (cached status / honest probing / disabled lane / upstream failure /
 * invalid handle) against the injected probe transport. No network anywhere
 * (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";
import {
  clearTikTokLiveCache,
  isTikTokLivePlaybackInFlight,
  isTikTokLiveProbeBackedOff,
  isTikTokLiveProbeInFlight,
  peekTikTokLiveStatus,
  probeTikTokLivePlayback,
  probeTikTokLiveStatus,
  setTikTokLiveClock,
  TikTokLiveUnavailableError,
} from "@/lib/tiktok/live";
import { setTikTokLiveProbeUpstream } from "@/lib/tiktok/live-upstream";
import { setTikTokLiveProbePolling } from "@/lib/tiktok/live";

const LIVE_ROW = {
  handle: "lofigirl",
  unique_id: "lofigirl",
  is_live: true,
  room_title: "christmas lofi radio 🎄",
  viewer_count: 278,
  started_at: "2026-11-07T00:12:00.000Z",
  room_url: "https://www.tiktok.com/@lofigirl/live",
  stream_urls: null,
  _metadata: { fetched_at: "2026-11-07T07:45:00.000Z" },
};

function happyTransport(): Parameters<typeof setTikTokLiveProbeUpstream>[0] {
  return ((url: string) => {
    if (url.includes("/acts/") && url.includes("/runs")) {
      return Promise.resolve(
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
    return Promise.resolve(new Response(JSON.stringify([LIVE_ROW]), { status: 200 }));
  }) as Parameters<typeof setTikTokLiveProbeUpstream>[0];
}

beforeEach(() => {
  process.env.APIFY_API_KEY = "test-key";
  delete process.env.APIFY_LIVE_ACTOR_ID;
  setTikTokLiveProbePolling({ intervalMs: 1, maxAttempts: 3 });
  clearCache();
  clearRateLimits();
  clearTikTokLiveCache();
  setTikTokLiveProbeUpstream(null);
});
afterEach(() => {
  setTikTokLiveProbeUpstream(null);
  setTikTokLiveProbePolling(null);
  clearTikTokLiveCache();
  setTikTokLiveClock(null); // restore the real clock (the SWR pins step it)
  delete process.env.APIFY_API_KEY;
  delete process.env.APIFY_LIVE_ACTOR_ID;
  delete process.env.APIFY_LIVE_STREAM_ACTOR_ID;
});

function liveReq(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/tiktok/live${query}`);
}

async function importRoute() {
  return import("@/app/api/tiktok/live/route");
}

describe("GET /api/tiktok/live — the status contracts", () => {
  test("a cached status answers 200 with the composed DTO and no-store", async () => {
    setTikTokLiveProbeUpstream(happyTransport());
    const cached = (await probeTikTokLiveStatus("lofigirl"))!;
    expect(cached.live).toBe(true);
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // P102 — the composition law: a cached LIVE room with no cached stream
    // answers `streamProbing: true` (the playback probe rides after(); the
    // view shows "resolving the stream…", never a fake answer, never the
    // fallback rung while the resolution is in flight).
    expect(body.status).toEqual({ ...cached, streamProbing: true });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("an uncached handle with a configured lane answers the honest probing DTO", async () => {
    // a transport that never settles: the probe stays in flight for the probe
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toMatchObject({
      handle: "lofigirl",
      live: null,
      probing: true,
      room: null,
      stream: null,
    });
  });

  test("invalid handles answer 400 (the G20 law: only truly-invalid strings)", async () => {
    const { GET } = await importRoute();
    expect((await GET(liveReq("?handle=bad%20handle!"))).status).toBe(400);
    expect((await GET(liveReq("?handle=b@d"))).status).toBe(400);
    expect((await GET(liveReq(""))).status).toBe(400);
    // sigil soup is fine — the G20 law normalizes it to the same identity
    expect((await GET(liveReq("?handle=%40%40LoFiGirl"))).status).toBe(200);
  });

  test("a disabled lane (no APIFY_API_KEY) answers 503 naming the enable path", async () => {
    delete process.env.APIFY_API_KEY;
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("APIFY_API_KEY");
  });

  test("a failed probe surfaces as 502 on the next peek (failure backoff)", async () => {
    setTikTokLiveProbeUpstream(() => Promise.resolve(new Response("down", { status: 500 })));
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toBeInstanceOf(
      TikTokLiveUnavailableError
    );
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("TikTok");
  });

  test("the second probing GET does not double-probe (in-flight coalescing)", async () => {
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    const { GET } = await importRoute();
    await GET(liveReq("?handle=lofigirl"));
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    expect((await res.json()).status.probing).toBe(true);
    // a distinct handle probes independently
    const other = await GET(liveReq("?handle=nowthispolitics"));
    expect(other.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// P102-R2 — the SWR law: a warm room NEVER goes dark. The P100 TTL law made
// every 30s-expiry answer `probing` for the whole refresh window, so a live
// room (and its playing video) unmounted and remounted every cycle — the
// operator's "I can't view tiktok lives" flapping, measured live on prod.
// The honest fix: a stale-but-present answer is SERVED (fetchedAt carries
// the age; `stale: true` marks it) while the refresh probe rides after();
// only a COLD handle (no entry at all) ever sees the probing DTO.
// ---------------------------------------------------------------------------

const PLAYBACK_ROW = {
  username: "lofigirl",
  isLive: true,
  roomId: "7704607314401184534",
  streamUrls: [
    { format: "hls", url: "https://pull-hls-f16-tt04.tiktokcdn.com/lofi/index.m3u8?signed=1" },
    { format: "flv", url: "https://pull-flv-f16-tt04.tiktokcdn.com/lofi.flv?signed=1" },
  ],
};

function playbackHappyTransport(): Parameters<typeof setTikTokLiveProbeUpstream>[0] {
  // the dataset answer is keyed PER ACTOR: the status actor's dataset carries
  // the `unique_id` rows; the playback actor's carries `username`/streamUrls.
  return ((url: string) => {
    if (url.includes("/acts/") && url.includes("/runs")) {
      const playbackRun = url.includes(encodeURIComponent("automation-lab~tiktok-live-room-stream-urls")) || url.includes("automation-lab~tiktok-live-room-stream-urls");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              id: "r",
              status: "SUCCEEDED",
              defaultDatasetId: playbackRun ? "d-playback" : "d-status",
            },
          }),
          { status: 200 }
        )
      );
    }
    if (url.includes("/actor-runs/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d-status" } }), {
          status: 200,
        })
      );
    }
    if (url.includes("/datasets/d-playback")) {
      return Promise.resolve(new Response(JSON.stringify([PLAYBACK_ROW]), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify([LIVE_ROW]), { status: 200 }));
  }) as Parameters<typeof setTikTokLiveProbeUpstream>[0];
}

describe("GET /api/tiktok/live — the SWR law (a warm room never goes dark)", () => {
  test("an expired-but-present LIVE status answers stale (live stays true) while the refresh rides", async () => {
    setTikTokLiveProbeUpstream(happyTransport());
    const seeded = (await probeTikTokLiveStatus("lofigirl"))!;
    expect(seeded.live).toBe(true);
    // the refresh lane never settles in this test — the stale window is
    // deterministic (the refresh is in flight for the whole assertion)
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    setTikTokLiveClock(() => Date.now() + 40_000); // past the 30s LIVE TTL
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.live).toBe(true); // the room stays mounted
    expect(body.status.stale).toBe(true); // the honest age marker
    expect(body.status.probing).toBeUndefined(); // NEVER the cold answer
    expect(isTikTokLiveProbeInFlight("lofigirl")).toBe(true); // the refresh rides
    const again = await GET(liveReq("?handle=lofigirl"));
    expect((await again.json()).status.stale).toBe(true); // no dark window
  });

  test("a stale-but-present stream keeps the video mounted (streamProbing stays false)", async () => {
    setTikTokLiveProbeUpstream(playbackHappyTransport());
    process.env.APIFY_LIVE_STREAM_ACTOR_ID = "automation-lab~tiktok-live-room-stream-urls";
    const seededStatus = (await probeTikTokLiveStatus("lofigirl"))!;
    expect(seededStatus.live).toBe(true);
    const seededStream = (await probeTikTokLivePlayback("lofigirl"))!;
    expect(seededStream.hlsUrl).toBeTruthy();
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    setTikTokLiveClock(() => Date.now() + 140_000); // past the 30s status + 120s playback TTLs
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.live).toBe(true);
    expect(body.status.stream.hlsUrl).toBe(seededStream.hlsUrl); // the video stays
    expect(body.status.streamProbing).toBeFalsy(); // never "Resolving…" mid-watch
    expect(body.status.stale).toBe(true);
    expect(isTikTokLivePlaybackInFlight("lofigirl")).toBe(true); // the stream refresh rides
  });

  test("a warm handle survives a lane failure: last-known data over a mid-watch error", async () => {
    setTikTokLiveProbeUpstream(happyTransport());
    const seeded = (await probeTikTokLiveStatus("lofigirl"))!;
    expect(seeded.live).toBe(true);
    // the lane fails and earns its 60s backoff
    setTikTokLiveProbeUpstream(() => Promise.resolve(new Response("down", { status: 500 })));
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toBeInstanceOf(
      TikTokLiveUnavailableError
    );
    setTikTokLiveClock(() => Date.now() + 40_000); // the entry goes stale under the backoff
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200); // NOT 502 — the room stays
    const body = await res.json();
    expect(body.status.live).toBe(true);
    expect(body.status.stale).toBe(true);
    // and the resting lane does not hammer: no refresh is scheduled mid-backoff
    expect(isTikTokLiveProbeInFlight("lofigirl")).toBe(false);
    expect(isTikTokLiveProbeBackedOff("lofigirl")).toBe(true);
  });

  test("a cold handle still answers the honest probing DTO (SWR never fakes a first answer)", async () => {
    setTikTokLiveProbeUpstream(() => new Promise<Response>(() => {}));
    const { GET } = await importRoute();
    const res = await GET(liveReq("?handle=lofigirl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.probing).toBe(true);
    expect(body.status.live).toBeNull();
  });
});
