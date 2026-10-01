import { beforeEach, expect, test } from "bun:test";
import { clearRateLimitForTests, rateLimit } from "@/lib/ratelimit";

beforeEach(() => clearRateLimitForTests());

test("allows under the limit, blocks at/over it", () => {
  expect(rateLimit("k", 2, 60_000).ok).toBe(true);
  expect(rateLimit("k", 2, 60_000).ok).toBe(true);
  const third = rateLimit("k", 2, 60_000);
  expect(third.ok).toBe(false);
  expect(third.retryAfterSec).toBeGreaterThan(0);
});

test("keys are independent (per ip+route)", () => {
  expect(rateLimit("a", 1, 60_000).ok).toBe(true);
  expect(rateLimit("a", 1, 60_000).ok).toBe(false);
  expect(rateLimit("b", 1, 60_000).ok).toBe(true);
});
