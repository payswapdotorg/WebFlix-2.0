/// <reference types="bun-types" />
/**
 * P59-R3 — POST /api/tiktok/player-events: the death-report route. Only the
 * lethal 1001-family lands in the ledger; 2001/3xxx answer `recorded: null`
 * (the poison guard); malformed input answers 4xx. The shared rate limiter
 * and cache are cleared per test (the routes idiom). No network anywhere.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";

const ID = "7212953186724842795"; // a cited universe post (HN harvest #5)

beforeEach(() => {
  clearCache();
  clearRateLimits();
});
afterEach(() => clearCache());

function post(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }): Request {
  return new Request("http://localhost:3000/api/tiktok/player-events", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/tiktok/player-events", () => {
  test("a lethal 1001 report is recorded", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post({ postId: ID, code: 1001, type: "INVALID_VIDEO" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    // The ledger holds it (the shared adapter's memory fallback in tests).
    const { getDeadPost } = await import("@/lib/tiktok/dead");
    expect((await getDeadPost(ID))?.code).toBe(1001);
  });

  test("a non-lethal code is poison-guarded to recorded:null (never written)", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    for (const code of [2001, 3001, 3002, 999]) {
      const res = await POST(post({ postId: ID, code, type: "X" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ recorded: null });
    }
    const { getDeadPost } = await import("@/lib/tiktok/dead");
    expect(await getDeadPost(ID)).toBeNull();
  });

  test("the READINESS_TIMEOUT shape (code:null) answers recorded:null, never 400", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post({ postId: ID, code: null, type: "READINESS_TIMEOUT" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: null });
    const { getDeadPost } = await import("@/lib/tiktok/dead");
    expect(await getDeadPost(ID)).toBeNull();
  });

  test("a non-post-id answers 400 without touching the ledger", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post({ postId: "bogus", code: 1001, type: "INVALID_VIDEO" }));
    expect(res.status).toBe(400);
  });

  test("a non-integer code answers 400", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post({ postId: ID, code: "1001", type: "X" }));
    expect(res.status).toBe(400);
  });

  test("invalid JSON answers 400", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
  });

  test("a body past the 1KiB cap answers 413", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const big = JSON.stringify({ postId: ID, code: 1001, type: "X".repeat(2048) });
    const res = await POST(post(big));
    expect(res.status).toBe(413);
  });

  test("the answer is never cached (no-store)", async () => {
    const { POST } = await import("@/app/api/tiktok/player-events/route");
    const res = await POST(post({ postId: ID, code: 1001, type: "INVALID_VIDEO" }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
