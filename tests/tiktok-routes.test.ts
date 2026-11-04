/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the route battery: /api/tiktok/rail, /api/tiktok/video/
 * [id], /api/tiktok/search — additive handlers mirroring their Netflix
 * siblings (rate limit → compose → honest degrade). The upstream seam is
 * injected; no network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";
import { setTikTokUpstream, type TikTokUpstreamFetch } from "@/lib/tiktok/upstream";

// The import seam is MOCKED DB-FREE here (the lane law): these files pin
// the route mechanics, not the persistence layer — the DB-backed import
// battery lives in tiktok-imports.test.ts. Mocked public/extra segments
// keep the universe exactly the curated list regardless of db state.
mock.module("@/lib/tiktok/imports", () => ({
  publicImportIds: async () => [],
  composedFeedExtraIds: async () => ({ extraIds: [], hintByPostId: new Map(), ownPostIds: new Set() }),
  decorateFeedPage: async (items: unknown) => items,
  importUserId: async (u: { id: string }) => u.id,
  TIKTOK_IMPORT_CAP: 40,
}));


const FIXTURE = JSON.parse(readFileSync("tests/fixtures/tiktok/oembed.json", "utf8"));
const DOCS_ID = "6718335390845095173";

function jsonUpstream(payload: unknown, status = 200): TikTokUpstreamFetch {
  return () => Promise.resolve(new Response(JSON.stringify(payload), { status }));
}

beforeEach(() => {
  clearCache();
  clearRateLimits();
  setTikTokUpstream(jsonUpstream(FIXTURE));
  delete process.env.TIKTOK_CURATED_IDS;
});
afterEach(() => setTikTokUpstream(null));

describe("GET /api/tiktok/rail", () => {
  test("answers the composed rail with the shared-cache headers", async () => {
    const { GET } = await import("@/app/api/tiktok/rail/route");
    const res = await GET(new Request("http://localhost:3000/api/tiktok/rail"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.universeSize).toBe(17);
    expect(body.videos[0].postId).toBe(DOCS_ID);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

});

describe("GET /api/tiktok/video/[id]", () => {
  test("answers the fixture DTO", async () => {
    const { GET } = await import("@/app/api/tiktok/video/[id]/route");
    const res = await GET(new Request(`http://localhost:3000/api/tiktok/video/${DOCS_ID}`), {
      params: Promise.resolve({ id: DOCS_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postId).toBe(DOCS_ID);
    expect(body.author).toBe("scout2015");
    expect(body.embedUrl).toContain(`player/v1/${DOCS_ID}`);
  });

  test("400 on a non-post-id", async () => {
    const { GET } = await import("@/app/api/tiktok/video/[id]/route");
    const res = await GET(new Request("http://localhost:3000/api/tiktok/video/bogus"), {
      params: Promise.resolve({ id: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  test("a walled oEmbed answers 200 with the cited fallback DTO (the embed lane is viewer-side)", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("walled", { status: 302 })));
    const { GET } = await import("@/app/api/tiktok/video/[id]/route");
    const res = await GET(new Request(`http://localhost:3000/api/tiktok/video/${DOCS_ID}`), {
      params: Promise.resolve({ id: DOCS_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toBeFalse();
    expect(body.source).toBe("tiktok-curated");
    expect(body.author).toBe("scout2015");
    expect(body.embedUrl).toContain(`player/v1/${DOCS_ID}`);
  });
});

describe("GET /api/tiktok/search", () => {
  test("answers curated-library matches only", async () => {
    const { GET } = await import("@/app/api/tiktok/search/route");
    const res = await GET(new Request(`http://localhost:3000/api/tiktok/search?q=${encodeURIComponent("cute couch")}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videos.length).toBe(1);
    expect(body.universeSize).toBe(17);
  });

  test("an empty needle answers an honest empty set", async () => {
    const { GET } = await import("@/app/api/tiktok/search/route");
    const res = await GET(new Request("http://localhost:3000/api/tiktok/search?q="));
    const body = await res.json();
    expect(body.videos).toEqual([]);
    expect(body.note).toBeNull();
  });
});
