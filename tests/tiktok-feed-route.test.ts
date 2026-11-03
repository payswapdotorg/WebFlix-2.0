/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — the /api/tiktok/feed route battery:
 * cursor pagination over the curated library in the `{ items, nextCursor }`
 * shape law, the page-1 deep-link splice, the invalid-param 400s, the limit
 * clamp, and the dedupe guarantee. The upstream seam is injected; no
 * network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";
import { setTikTokUpstream, type TikTokUpstreamFetch } from "@/lib/tiktok/upstream";

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

function feedReq(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/tiktok/feed${query}`);
}

describe("GET /api/tiktok/feed — the shape law", () => {
  test("page 1 answers `{ items, nextCursor }` with the curated order", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const res = await GET(feedReq("?limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(5);
    expect(body.items[0].postId).toBe(DOCS_ID); // TikTok's docs example leads
    // every row is a full honest DTO
    expect(body.items[0].embedUrl).toContain(`player/v1/${DOCS_ID}`);
    expect(body.items[0].deepLinkUrl).toContain("tiktok.com");
    expect(body.items[0].unavailable).toBe(false);
    // the cursor is the last served curated id
    expect(body.nextCursor).toBe(body.items[4].postId);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("cursor paging continues AFTER the cursor with no overlap", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const page1 = await (await GET(feedReq("?limit=5"))).json();
    const page2 = await (await GET(feedReq(`?cursor=${page1.nextCursor}&limit=5`))).json();
    const page1Ids = page1.items.map((v: { postId: string }) => v.postId);
    const page2Ids = page2.items.map((v: { postId: string }) => v.postId);
    expect(page2Ids).toHaveLength(5);
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id);
    }
    // the full universe walks in order to the honest end
    const page3 = await (await GET(feedReq(`?cursor=${page2.nextCursor}&limit=40`))).json();
    const page3Ids = page3.items.map((v: { postId: string }) => v.postId);
    for (const id of page2Ids) {
      expect(page3Ids).not.toContain(id);
    }
    expect(page3.nextCursor).toBeNull(); // the universe (17) is exhausted
  });

  test("an unknown cursor honestly restarts from the top", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const res = await GET(feedReq("?cursor=1111111111111111111&limit=3"));
    const body = await res.json();
    expect(body.items[0].postId).toBe(DOCS_ID);
  });

  test("the deep-link splice leads page 1 with the requested post (any valid id)", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    // a post NOT in the curated universe still leads (M2 import pending)
    const stranger = "7777777777777777777";
    const res = await GET(feedReq(`?post=${stranger}&limit=3`));
    const body = await res.json();
    expect(body.items[0].postId).toBe(stranger);
    expect(body.items).toHaveLength(3);
    // the stranger never re-appears in the curated flow (dedupe)
    const ids = body.items.map((v: { postId: string }) => v.postId);
    expect(new Set(ids).size).toBe(ids.length);
    // the next cursor walks the CURATED universe (the stranger is not one)
    expect(body.nextCursor).toBe(body.items[body.items.length - 1].postId);
  });

  test("the splice is page-1 behavior only (a cursor present = paging mode)", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const stranger = "7777777777777777777";
    const res = await GET(feedReq(`?cursor=${DOCS_ID}&post=${stranger}&limit=3`));
    const body = await res.json();
    const ids = body.items.map((v: { postId: string }) => v.postId);
    expect(ids).not.toContain(stranger);
  });

  test("invalid cursor / post answer 400 (the URL law holds at the route)", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    expect((await GET(feedReq("?cursor=bogus"))).status).toBe(400);
    expect((await GET(feedReq("?post=bogus"))).status).toBe(400);
    expect((await GET(feedReq("?post=<script>"))).status).toBe(400);
  });

  test("the limit clamps to the curated cap (bounded iframe volume)", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const res = await GET(feedReq("?limit=9999"));
    const body = await res.json();
    expect(body.items.length).toBeLessThanOrEqual(17); // the whole universe
    expect(body.nextCursor).toBeNull();
  });

  test("the whole universe walks to an honest null cursor", async () => {
    const { GET } = await import("@/app/api/tiktok/feed/route");
    const res = await GET(feedReq("?limit=40"));
    const body = await res.json();
    expect(body.items).toHaveLength(17);
    expect(body.nextCursor).toBeNull();
  });
});
