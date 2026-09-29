# WebFlix Live Roadmap — 2026-09-29 (the YouTube pivot)

**Source of truth: this file + the architecture doc.** The previous roadmap (2026-09-28, seed-data clone) is superseded: the interface Wave 1 built remains the shell; the data layer pivots from local seed data to LIVE youtube.com.

- Architecture (verified): `docs/architecture/2026-09-29-live-youtube-architecture.md`
- Verification log: `docs/research/2026-09-29-verifications.md`
- Fixtures: `tests/fixtures/yt/` (sanitized recordings of real responses)
- Claims ledger: `docs/plans/wave-claims.md`

## Goal states (in order)

- **G1 — Live watch**: any YouTube video opens on WebFlix's watch page and plays (IFrame embed) with real metadata, real comments, real related rail.
- **G2 — Live discovery**: home, trending, search, shorts, subscriptions, channels — all real YouTube data, zero demo rows.
- **G3 — Live actions**: like/dislike, subscribe/bell, comment (post/reply/like), save-to-playlist / watch-later — same exact effect as youtube.com.
- **G4 — Live streams + live chat**: live videos play, live chat streams in real time (incl. Super Chat display); live-chat-replay on ended streams.
- **G5 — Personal surfaces**: history, playlists, liked, notifications, watch-later — read from the operator's real YouTube account; studio deep-link + analytics.
- **G6 — Cutover**: the git-built real app serves production on Vercel; every demo asset replaced by real live YouTube videos.

## Worker lanes and waves (3 workers in parallel, B/S/W)

Rules: one branch per lane (`wfx2/waveX-<lane>`), base = main at dispatch time. Relay-bundle transport (no push creds; the lead gates + merges + pushes). Completion marker per lane. No `player` endpoint. Fixtures-only tests.

### WAVE A — Live core (3 parallel lanes)

**A-B `wfx2/waveA-core` — InnerTube read layer + data swap (the spine)**
- `src/lib/youtube/` library: `innertube.ts` (client: search/browse/next/reel/live_chat/autocomplete with gzip-safe JSON, timeout+retry, UA + client headers), `ssr.ts` (ytInitialData extraction with cookie auth), `session.ts` (cookie/env provider — `YT_COOKIES` env, never committed), `mappers.ts` (videoRenderer/richItem/lockupViewModel → the app's VideoCard DTO: id, title, channel{id,name,avatar}, views, age, durationSec, thumbnail, isShort/isLive, badges), `comments.ts` (continuation walking: top-level, replies, sort), `related.ts` (secondaryResults), `autoplay.ts`.
- Rewrite these routes to live data (keep response shapes the UI already consumes, minus demo fields): `/api/videos` (search/browse-backed), `/api/search` (+autocomplete endpoint `/api/search/suggest`), `/api/home` (browse FEwhat_to_watch + mappers; hero/trending/shorts-shelf rails from the real response shelves), `/api/trending` (SSR parse), `/api/channel/[handle]` (browse UC + tabs), `/api/videos/[id]` (next()-backed metadata), `/api/videos/[id]/comments`, `/api/videos/[id]/related`, `/api/watch/[id]`.
- Search filters (sort/date/duration/type) via `params` builder.
- Tests: mapper + continuation-walking + route tests against `tests/fixtures/yt/` (search_lofi, next_dQw4, comments_dQw4, home_feed, ssr_trending, ssr_subscriptions, channel_rickastley). No live network in tests.
- Delete/retire seed-only paths where they conflict (keep Prisma schema for later local-state use; seed no longer powers these routes).

**A-S `wfx2/waveA-live-shorts` — Shorts + live chat (the new surfaces)**
- `/api/shorts` (reel/reel_watch_sequence + reel_item_watch; seed the sequence from a shorts search then page continuations; response: vertical video rail DTOs).
- Shorts page rebuild: full-screen vertical player (IFrame embed per short), swipe/arrow navigation, engagement rail (likes/comments counts from next(), comments drawer), channel chip + subscribe.
- `/api/videos/[id]/livechat` (GET poll: continuation from the watch next() conversationBar → get_live_chat; returns new messages + next continuation + timeoutMs; NO server-side polling loop — the client polls this route which makes one upstream call).
- Live-chat panel component on watch page: message list (author badges/verified/moderator, member streaks, Super Chat stamps with amount + highlighted background), auto-scroll + "pause on hover", participant count, "Top chat" vs "Live chat" toggle (client-side filter), slow-mode indicator.
- Live-chat REPLAY mode: when the video is a finished live stream (liveStreamOfflineSlate / isLive false + liveChatReplay), fetch replay continuations with time-offset params seeking to player time.
- Live badge handling + live view-count via `updated_metadata` (route `/api/videos/[id]/live-status`).
- Tests: continuation parsing + message mapping against `livechat_aljazeera` fixture + shorts fixtures.

**A-W `wfx2/waveA-broker-player` — Session broker + embed player + action wiring**
- `mini-services/youtube-broker/` (bun project, own port e.g. 3055, hot-reload): shared-secret HTTP API — `POST /broker/action` {kind: like|dislike|remove-like|subscribe|unsubscribe|bell|comment-create|comment-reply|comment-like|playlist-add|watch-later|not-interested, target, payload}; executes via CDP page-context in the logged-in YouTube tab (evaluate a fetch/click in the tab — tab is provided by the lead sandbox, `BROKER_TAB_WS` env or auto-discover youtube.com tab); returns {ok, detail}. Idempotency + action journal (append-only JSONL). Health endpoint.
- App-side: `src/lib/broker.ts` (typed client, BROKER_URL + BROKER_SECRET env) + rewrite `/api/videos/[id]/like`, `/api/subscribe`, `/api/comments/[id]/*` writes, `/api/playlists/*` writes, `/api/videos/[id]/not-interested` to broker proxying (subscribe may call InnerTube direct with SAPISIDHASH — implement direct-first with broker fallback).
- Player: `src/components/watch/youtube-player.tsx` (IFrame API; props: videoId, startSec, onProgress, onStateChange; quality/speed/captions native UI; theater/miniplayer CSS modes) — replaces the demo player on `/watch/[id]`; watch-next autoplay chain fires on ENDED (queue from related/A-B route).
- Progress: client-side position memory (localStorage) for continue-watching UX.
- Tests: broker client contract (mock fetch), player mount/lifecycle (jsdom-safe stub), like-route proxy behavior.

**Wave A exit gates (all three lanes)**: lint clean, typecheck clean, `bun test` green (fixtures only), no demo/seed data reachable from any swapped route, watch page plays a REAL video from a clean build (`bun run dev` + open /watch/dQw4w9WgXcQ), shorts page serves real shorts, like+subscribe work end-to-end through broker/direct.

### WAVE B — Personal surfaces + comment writes (3 parallel lanes, after A merges)

- **B-B `wfx2/waveB-personal`**: history (SSR + pause/resume via broker), watch-later + playlists (SSR read of VL… lists incl. WL; broker add/remove/create/reorder), liked videos (SSR of the Liked playlist `VLPLL…`/my-list), notifications (menu + unseen + mark-read via broker/endpoint), subscriptions page (SSR feed + manage panel).
- **B-S `wfx2/waveB-comments-write`**: comment posting (broker), replies, edits, deletes, comment likes, hearts/pins (creator actions), sort orders UI, report flow; channel page deep parity (tabs: home/videos/shorts/live/playlists/community/about, join button for memberships).
- **B-W `wfx2/waveB-search-filters`**: search filter UI (sort/date/duration/type chips — real YouTube filter semantics), channel-search within channel, trending category pages (SSR category params), membership tier display on channel, channel banner/avatar parity.

### WAVE C — Studio + replay + polish (3 parallel lanes, after B)

- **C-B `wfx2/waveC-studio`**: Studio deep-link + real channel analytics (Studio SSR with session), upload flow → YouTube Studio deep-link with metadata hand-off, channel customization read.
- **C-S `wfx2/waveC-replay-polish`**: live-chat replay seeking perfection, miniplayer persistence across navigation, ambient-mode (page glow from player), watch-next chain UX.
- **C-W `wfx2/waveC-cutover`**: Vercel build green (env: DATABASE_URL Neon, UPSTASH_*, BROKER_*), performance pass (Upstash caching on all read routes, ISR where safe), demo-data purge sweep (grep for seed remnants), the full end-to-end acceptance script (search 5 random real videos → watch each → like → subscribe → comment → verify on youtube.com in the broker browser), README/docs final state.

## Merge order within a wave

A-B (spine) merges first if ready; A-S and A-W merge after (they touch watch-page shell edges around the spine). Conflicts resolved by the lead at merge time (union-merge law from Wave 1).

## Standing laws (unchanged)

- GitHub is the single source of truth; workers relay bundles; lead gates (lint/typecheck/test) + merges --no-ff + pushes.
- No `player` endpoint. Fixtures-only tests. Live calls only in running routes (rate-limited + cached).
- YouTube is the user-data source of truth; WebFlix stores UI prefs only.
- Every action on WebFlix = same exact effect on youtube.com (verify via the broker browser).
- UI contract: the ZTube-derived shell (now branded WebFlix), dark default + light, responsive, sticky footer law, semantic HTML.
