# WebFlix 2.0

A complete YouTube clone. **Interface baseline: ZTube** (the deployed reference at https://d1ezj447xe91-deploy.space-z.ai/). **Functionality: cloned feature-for-feature from youtube.com** — every feature visible on the interface gets its complete real-YouTube behavior plus a complete backend.

## Stack (binding)

- Next.js 16 (App Router) + TypeScript strict — single app in `src/`
- Tailwind CSS 4 + shadcn/ui (New York) + lucide-react
- Prisma ORM + SQLite (db file in `db/`, schema in `prisma/`)
- bun (install / lint / typecheck / test / dev)
- No mock data in code paths — the database is the truth; seed via `prisma/seed.ts`

## Merge protocol

Workers: one lane = one branch = one relay bundle (git bundle + evidence + RELAY-MANIFEST.txt at the workspace storage root). The lead harvests, runs the gates (lint / typecheck / test battery — zero regressions), merges `--no-ff`, pushes `main`. Claims live in `docs/plans/wave-claims.md` (claim-before-dispatch, push-order precedence, 4h binding).

## Roadmap

`docs/plans/2026-09-28-webflix2-roadmap.md` — Wave 1 (boot + youtube-bible + watch vertical), then account surfaces, studio, shorts, search/explore, channels/memberships, live, notifications, polish.

## Feature inventory (the interface contract)

From the ZTube reference (sidebar + topbar + views):

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
