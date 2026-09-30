# WebFlix 2.0 — Vercel production environment (WFX2-C-W ops runbook)

The deployment is `webflix-2-0-3l2mqi5ti.vercel.app` (Vercel project
`webflix-2-0`). This document is the **env wiring + ops contract** for it.
Secret VALUES never live in the repo — only names (checked into
`.env.example` for local reference).

## Environment variables (Vercel Project → Settings → Environment Variables)

| Name | Scope | Required | What it powers |
| --- | --- | --- | --- |
| `DATABASE_URL` | Production | yes | Neon Postgres connection string (Prisma). Local mirrors for the write lane (`ViewEvent`, local playlist mirror, notifications read-state). Run `bun run db:push` against Neon after schema changes. |
| `UPSTASH_REDIS_REST_URL` | Production | yes (cutover) | The Upstash Redis REST endpoint (`https://…​.upstash.io`). The shared cache + rate-limit adapter (`src/lib/youtube/upstash-cache.ts`). **Absent → the app degrades to per-instance in-memory caching** (dev/tests), and the walled-browse last-good fix does not survive cold starts. |
| `UPSTASH_REDIS_REST_TOKEN` | Production | yes (cutover) | The Upstash REST token (Bearer). Pair with the URL above. |
| `YT_COOKIES` | Production | optional | The operator's `youtube.com` session cookie header (raw `k=v; …`). Powers personalized surfaces (trending grid, history/continue-watching, subscribe state, notifications). Without it the app runs in **public mode** — every surface still works, personal feeds answer YouTube's own logged-out responses (`loginRequired: true`, never fake rows). Rotate by signing into youtube.com in a browser and copying the Cookie header. NEVER commit it. |
| `INNERTUBE_API_KEY` | all | optional | Overrides the InnerTube WEB public key (defaults are fine). |
| `BROKER_URL` | Production | for writes | The Tier-2 youtube-broker base URL (`mini-services/youtube-broker`, CDP-driven logged-in tab). Powers authenticated writes: comments, likes, subscriptions, playlists. |
| `BROKER_SECRET` | Production | for writes | Shared secret for broker requests. NEVER commit it. |

## Session cookie strategy

- **YouTube side** — there is no YouTube login in WebFlix; the operator
  session is the `YT_COOKIES` env var, sent upstream on SSR + InnerTube calls
  (`src/lib/youtube/session.ts`). No user-visible cookie is set for it.
- **WebFlix side** — the watch lane issues a first-party viewer cookie
  (`wfx2_uid`, `src/lib/watch/session.ts`) that resolves the local viewer for
  writes; the boot-lane identity (`@you` / `@demo` fallback chain) backs it
  when no cookie is present. These are `httpOnly`, same-site lax, and hold a
  random id — never a YouTube credential.

## The walled-browse behavior (why Upstash is required)

Verified live 2026-09-30: youtube.com answers the InnerTube `browse`
(`FEwhat_to_watch`) call with **200 + a body that maps to zero content** when
the request egresses from Vercel's datacenter IPs. Search and the trending SSR
pages are NOT walled. Consequences:

1. `/api/home` (browse-backed) and the default `/api/videos` page rely on the
   **last-good** payload in Upstash when the live fetch comes back empty.
2. `/api/videos?q=…` and `/api/home?category=…` are **search-backed** and work
   from Vercel directly (the cutover routes `q=` to search — the production
   fix for the empty `videos?q=music` finding).
3. An empty/unhealthy browse answer is **never cached** (poisoning guard), and
   with no last-good available the honest empty response is returned — no fake
   data, ever.

## Keeping the cache warm (the colder-side runbook)

The Vercel egress cannot refresh browse-backed keys, so a machine with an
**unwalled egress** (laptop / residential / non-Vercel CI) runs the warmer
against a local instance that shares the Upstash env:

```bash
# on the operator machine (unwalled egress)
export UPSTASH_REDIS_REST_URL=…    # same values as the Vercel project
export UPSTASH_REDIS_REST_TOKEN=…
bun run dev                         # local app, port 3000
WARM_URL=http://localhost:3000 bun scripts/warm-cache.mjs
```

- **Cadence: every 10 minutes** (cron). The home entry's hard (last-good)
  window is 2 hours — twelve missed warmer runs of headroom.
- The warmer walks the browse-critical routes (`/api/home`, `/api/videos`,
  trending categories, shorts seed, live surface, a search set) so the real
  routes compute into the real cache keys.
- If the warmer stops AND Vercel's egress stays walled, home degrades honestly
  (empty rails, 200) once the hard window lapses — the documented
  **cache-only fallback**. Search-backed surfaces keep working throughout.

## Acceptance (the merge gate)

```bash
ACCEPT_URL=https://webflix-2-0-3l2mqi5ti.vercel.app bun scripts/acceptance.mjs
bun scripts/acceptance.mjs --selftest   # hermetic dry-run (mock server)
```

38 checks: 14 page routes (200 + exact titles), 19 live-data API checks
(home rails, `videos?q=`, trending, search, watch meta, comments, related,
shorts, live, autocomplete, channel tabs, live-status), 5 honest-degradation
checks (personal surfaces without a session must answer `loginRequired: true`
with zero rows — or carry real rows when the operator session is configured).
Exits non-zero on any failure with a failure table.

## Rate limits (adapter-backed, fixed window)

- `src/lib/youtube/cache.ts` — per-route budgets (default 120/60s per IP;
  suggest/comments/related/replies 240; studio 30; upload 60 GET / 30 POST).
- `src/lib/youtube/livechat.ts` — live-route budgets (live-status/shorts-meta
  120/60s ceiling, livechat 90/60s, replay 38/60s).
- Counters live on Upstash (`wfx2:rl:<route:ip>:<windowIndex>`, INCR+PEXPIRE)
  when configured — shared across instances; local-memory fallback otherwise.
  REST failure **fails open** (a cache outage must not 429 the site).

## ISR

Page shells (sidebar nav, category chips, topbar skeleton) revalidate hourly
(`export const revalidate = 3600` on the twelve shell pages). All feed data
stays client-fetched from `/api/*`, which keep `force-dynamic` by law.
