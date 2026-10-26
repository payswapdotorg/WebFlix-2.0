/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the route's honest 502 ladder, in its own file so the
 * library module can be replaced wholesale via mock.module (file-scoped):
 * when the COMPOSITION itself explodes, the route answers 502 and logs —
 * the same catch wrapper its Netflix siblings ride.
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/tiktok/library", () => ({
  curatedPostIds: () => [],
  getTikTokVideo: () => Promise.reject(new Error("boom")),
  getTikTokRail: () => Promise.reject(new Error("boom")),
  searchTikTokLibrary: () => Promise.reject(new Error("boom")),
  TIKTOK_SEED: [],
  TIKTOK_CURATED_CAP: 40,
}));
mock.module("@/lib/youtube/cache", () => ({
  rateLimit: async () => true,
  clearRateLimits: () => {},
  clearCache: () => {},
}));

describe("GET /api/tiktok/rail — the 502 ladder", () => {
  test("a composition explosion answers 502 (never a partial fake)", async () => {
    const { GET } = await import("@/app/api/tiktok/rail/route");
    const res = await GET(new Request("http://localhost:3000/api/tiktok/rail"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Failed");
  });

  test("the same law on /api/tiktok/video/[id]", async () => {
    const { GET } = await import("@/app/api/tiktok/video/[id]/route");
    const res = await GET(new Request("http://localhost:3000/api/tiktok/video/6718335390845095173"), {
      params: Promise.resolve({ id: "6718335390845095173" }),
    });
    expect(res.status).toBe(502);
  });
});
