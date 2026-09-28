# WebFlix 2.0 — Roadmap (started 2026-09-28, operator directive 21:54Z)

Mission: clone the ZTube interface (https://d1ezj447xe91-deploy.space-z.ai/) and give EVERY feature on it its complete functionality from youtube.com, each with a complete backend. Fresh repo — webflix-1.0 is superseded (its in-flight lanes wind down at completion).

## Wave 1 (tonight) — 3 parallel lanes

| Lane | Branch | Delivers |
|---|---|---|
| WFX2-B boot | `wfx2/boot-shell` | Scaffold + full Prisma schema + ZTube app shell + home feed + seed + gates |
| WFX2-S study | `wfx2/youtube-bible` | `docs/specs/*.md` — per-feature complete YouTube functionality bible (behavior + data model + API + acceptance) |
| WFX2-W watch | `wfx2/watch-vertical` | Complete watch experience: player, engagement, comments, related — full backend |

## Wave 2 — account + creator surfaces

- WFX2-A account: History / Playlists CRUD / Liked / Watch later / playlists picker + notifications bell menu (real events, read states, per-channel prefs)
- WFX2-U upload + studio: upload flow (+ AI helpers), Studio (Dashboard/Content/Analytics/Revenue/Comments/Moderation/Experiments)

## Wave 3 — discovery + social

- WFX2-D discovery: Shorts vertical feed, Trending (+ tabs), Search (+ filters/sort), Explore categories, Subscriptions feed
- WFX2-C channels: channel tabs, customize dialog, memberships (tiers + member-only enforcement), community posts

## Wave 4 — live + polish

- WFX2-L live: live browse, live chat (socket.io mini-service), premieres
- WFX2-P polish: settings, premium page, help/feedback, report history, voice search, PWA, parity audit vs the bible

## Laws

- The bible (WFX2-S docs) is the functionality contract — later lanes implement to it; gaps found in the field get recorded as addenda.
- One lane one branch; allowed-paths discipline; escalations (shared-file edits) recorded in the relay manifest.
- Complete backend = Prisma model + API route(s) + client hook/component + tests; no feature is UI-only.
- Honest data: counts/states always reflect the database; typed empty states otherwise.
