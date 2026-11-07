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
  peekTikTokLiveStatus,
  probeTikTokLiveStatus,
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
  delete process.env.APIFY_API_KEY;
  delete process.env.APIFY_LIVE_ACTOR_ID;
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
