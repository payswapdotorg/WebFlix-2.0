#!/usr/bin/env node
/**
 * WFX2-C-W — cold-start cache warmer.
 *
 * WHY: youtube.com walls the InnerTube `browse` endpoint for Vercel's
 * datacenter IPs (200 + maps-to-empty). The Upstash adapter keeps serving the
 * LAST-GOOD payload from the shared cache — but something with an unwalled
 * egress (a laptop, CI runner, residential box) must keep that cache fresh.
 * This script is that something: run the app locally (`bun run dev`) with the
 * SAME UPSTASH_REDIS_REST_URL + _TOKEN env, then run this warmer against it.
 * Every hit goes through the real routes → the real cache keys → Upstash,
 * which the Vercel deployment then reads.
 *
 * Usage:
 *   WARM_URL=http://localhost:3000 bun scripts/warm-cache.mjs
 *
 * Recommended cadence: every 10 minutes (cron), matching the 2-hour
 * last-good window (12 missed runs of headroom). See docs/ops/vercel-env.md.
 */

const WARM_URL = (process.env.WARM_URL || "http://localhost:3000").replace(/\/+$/, "");
const TIMEOUT_MS = 30_000;

/** The surfaces whose cache keys the warmer refreshes (browse-critical first). */
const WARM_PATHS = [
  "/api/home", // yt:home:feed (the walled-browse fix) + continue-watching
  "/api/videos", // yt:home:feed first page
  "/api/videos?q=music", // yt:searchpage:music (the q= fix)
  "/api/videos?q=lofi",
  "/api/trending", // yt:trending:/feed/trending
  "/api/trending?category=Music",
  "/api/trending?category=Gaming",
  "/api/trending?category=Movies",
  "/api/shorts", // shorts:seed
  "/api/live", // the 4 live-scoped search keys
  "/api/search?q=lofi", // yt:search:*
  "/api/search?q=music",
  "/api/search/suggest?q=music", // yt:suggest:music
  "/api/videos/dQw4w9WgXcQ", // yt:watch:dQw4w9WgXcQ (meta + related)
  "/api/videos/dQw4w9WgXcQ/comments", // comments tokens + first page
];

async function warm(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(WARM_URL + path, { signal: ctrl.signal });
    const ms = Date.now() - started;
    if (!res.ok) return { path, ok: false, detail: `HTTP ${res.status} in ${ms}ms` };
    const json = await res.json().catch(() => ({}));
    const rails =
      json.hero !== undefined
        ? `hero=${json.hero ? "y" : "n"} rec=${json.recommended?.length ?? 0} shorts=${json.shorts?.length ?? 0}`
        : json.videos !== undefined
          ? `videos=${json.videos.length}`
          : json.items !== undefined
            ? `items=${json.items.length}`
            : json.suggestions !== undefined
              ? `suggestions=${json.suggestions.length}`
              : "ok";
    return { path, ok: true, detail: `${rails} (${ms}ms)` };
  } catch (err) {
    return { path, ok: false, detail: `${err.name === "AbortError" ? "timeout" : err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`WFX2-C-W cache warmer — target: ${WARM_URL}`);
let failed = 0;
for (const path of WARM_PATHS) {
  const r = await warm(path);
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? "✓" : "✗"}  ${r.path.padEnd(38)} ${r.detail}`);
}
console.log(`──────────────────────────────────────────────`);
console.log(`${WARM_PATHS.length - failed}/${WARM_PATHS.length} warm targets refreshed${failed ? ` · ${failed} FAILED` : ""}`);
process.exit(failed > 0 ? 1 : 0);
