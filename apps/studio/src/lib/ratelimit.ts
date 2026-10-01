const hits = new Map<string, number[]>();

export interface RateLimitResult { ok: boolean; remaining: number; retryAfterSec: number }

export function rateLimit(key: string, max = 60, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true, remaining: max - arr.length, retryAfterSec: 0 };
}

export function clearRateLimitForTests(): void {
  hits.clear();
}
