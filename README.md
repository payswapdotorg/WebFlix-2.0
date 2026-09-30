# WebFlix 2.0

A complete YouTube clone. **Interface baseline: WebFlix** (the deployed reference at https://d1ezj447xe91-deploy.space-z.ai/). **Functionality: cloned feature-for-feature from youtube.com** — every feature visible on the interface gets its complete real-YouTube behavior plus a complete backend.

## Live architecture (production: webflix-2-0-3l2mqi5ti.vercel.app)

Every read surface is **live youtube.com data** — InnerTube (search / browse / next / updated_metadata) and SSR page parses, never seeded rows:

- **Tier 0 — direct reads** (public, unauthenticated): home feed, videos list, search (+filters), trending (SSR category pages), watch metadata, comments, related, shorts, channel pages, autocomplete, live status.
- **Tier 1 — operator session reads** (`YT_COOKIES`): trending grids, history/continue-watching, subscribe state, notifications, studio analytics. Public mode degrades honestly (`loginRequired: true`, zero fake rows).
- **Tier 2 — authenticated writes** (the `youtube-broker` mini-service, CDP-driven logged-in tab): comments, likes, subscriptions, playlists, history management.

**Cutover hardening (WFX2-C-W)** — youtube.com walls the InnerTube `browse` endpoint for datacenter egress (Vercel answers 200-but-empty). The fix stack:

- `src/lib/youtube/upstash-cache.ts` — the **Upstash Redis REST adapter**: L1 per-instance memory + L2 Upstash (REST pipelines), stale-while-revalidate past the soft TTL, **last-good** serving on upstream failure or walled 200s (an empty browse answer is never cached — poisoning guard), in-flight dedupe, no-op offline fallback (dev/tests unchanged).
- All read routes cache through it (`cached(key, ttl, fn)` — same seam, same DTO shapes): home, `videos?q=` (now search-backed — the prod fix), search, trending, channel tabs, video meta, comments, related, shorts, autocomplete, live-status.
- Rate limits moved behind the same adapter (fixed-window INCR/PEXPIRE on Upstash, local fallback offline, fail-open on REST errors).
- `scripts/warm-cache.mjs` — the colder-side warmer (run every 10 min from an unwalled egress against a local instance sharing the Upstash env) keeps browse-backed keys fresh so Vercel always has a last-good payload. Runbook: `docs/ops/vercel-env.md`.
- `scripts/acceptance.mjs` — the 38-check end-to-end acceptance harness (14 page routes + titles, 19 live-data API checks, 5 honest-degradation checks; `--selftest` runs it hermetically against an in-process mock server).
- ISR: the twelve page shells (sidebar nav, category chips) revalidate hourly; all `/api/*` routes stay `force-dynamic`.

## Stack (binding)

- Next.js 16 (App Router) + TypeScript strict — single app in `src/`
- Tailwind CSS 4 + shadcn/ui (New York) + lucide-react
- Prisma ORM + SQLite locally / **Neon Postgres in production** (`DATABASE_URL`)
- **Upstash Redis (REST)** — shared cache + rate limiting in production
- bun (install / lint / typecheck / test / dev)
- No mock data in code paths — live YouTube reads; the DB backs the write lane; seed via `prisma/seed.ts` is a dev tool only

## Environment (names only — see docs/ops/vercel-env.md)

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres (production) / SQLite file (dev) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | the shared cache + rate-limit adapter (absent → in-memory fallback) |
| `YT_COOKIES` | the operator's youtube.com session (personalized surfaces; public mode without it) |
| `BROKER_URL` / `BROKER_SECRET` | the Tier-2 write broker |
| `INNERTUBE_API_KEY` | optional InnerTube key override |

## Gates

```bash
bun run lint        # eslint — 0 errors
bun run typecheck   # tsc --noEmit — 0 errors
bun run test        # boot + watch + liveshorts + cutover phases — all green
bun scripts/acceptance.mjs --selftest   # hermetic acceptance dry-run
ACCEPT_URL=… bun scripts/acceptance.mjs # live acceptance (merge gate)
```

## Merge protocol

Workers: one lane = one branch = one relay bundle (git bundle + evidence + RELAY-MANIFEST.txt at the workspace storage root). The lead harvests, runs the gates (lint / typecheck / test battery — zero regressions), merges `--no-ff`, pushes `main`. Claims live in `docs/plans/wave-claims.md` (claim-before-dispatch, push-order precedence, 4h binding).

## Roadmap

`docs/plans/2026-09-29-live-roadmap.md` — the live-YouTube waves (A: live core, B: personal surfaces + discovery, C: studio + cutover hardening) with the lane table + completion checklist. Original interface roadmap: `docs/plans/2026-09-28-webflix2-roadmap.md`.

## Feature inventory (the interface contract)

From the WebFlix reference (sidebar + topbar + views):

1. App shell — collapsible sidebar; topbar (search, voice search, upload, trending, notifications bell, theme toggle, account menu); category chips
2. Home feed — trending hero #1, Trending now rail, Continue watching, Because-you-watched, Shorts shelf, Recommended grid, infinite scroll, hover previews
3. Shorts — vertical feed, loop, interactions
4. Trending — ranked list, category tabs
5. Subscriptions — feed from subscribed channels, layout toggle
6. You area — History, Playlists, Liked videos, Watch later
7. Watch page — player (play/pause, seek, volume, speed, quality, theater, fullscreen, autoplay-next, miniplayer, progress resume), like/dislike, share, save, channel row + subscribe + bell, description expand + chapters + transcript, comments (sort, replies, likes, creator heart, pin, report, member badges), related rail
8. Upload — video + thumbnail (+ AI generator), title/description (+ AI), tags, visibility, member-only toggle
9. Creator Studio — Dashboard, Content, Experiments (A/B thumbnails), Analytics, Revenue, Comments, Moderation
10. Channel pages — banner, avatar, tabs (Videos / Shorts / Playlists / About), customize dialog, subscribe gradient
11. Search — results, filters, sort
12. Explore — Music, Gaming, Live, News, Sports, Coding, Tech, Education, Travel, Cooking, Fitness, Comedy, Mixes, Podcasts
13. Live — live browse + live chat + premieres
14. Notifications — bell menu, per-channel prefs, read states
15. Memberships — tiers, join, member-only videos, badges
16. Settings, Premium, Report history, Help, Send feedback
