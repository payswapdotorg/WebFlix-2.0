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
- **C-W `wfx2/waveC-cutover`**: Vercel build green (env: DATABASE_URL Neon, UPSTASH_*, BROKER_*), performance pass (Upstash caching on all read routes, ISR where safe), demo-data purge sweep (grep for seed remnants), the full end-to-end acceptance script (per the dispatch spec: 12 page routes + 16+ live-data API checks + honest-degradation checks, `scripts/acceptance.mjs`), README/docs final state.

#### Wave C completion checklist (workers mark DELIVERED; the lead marks MERGED at acceptance)

| Lane | Scope delivered (relay bundle) | Worker status | Lead: merged |
| --- | --- | --- | --- |
| C-B `wfx2/waveC-studio` | studio + upload surfaces, operator channel resolution, Studio SSR analytics | delivered @ 23e8a8d (r44w1c relay) | ☐ |
| C-S `wfx2/waveC-replay-polish` | per dispatch | ☐ | ☐ |
| C-W `wfx2/waveC-cutover` | Upstash cache adapter (L1+L2+SWR+last-good, poisoning guard), all read routes wired, videos?q= prod fix, rate limits behind the adapter, ISR shells, demo-data purge, acceptance harness + selftest, warm-cache runbook, README/env docs | delivered (webflix-wfx2cw bundle) | ☐ |
| Wave C acceptance | `bun scripts/acceptance.mjs` green against the live deployment + full gate battery | ☐ | ☐ |

## Merge order within a wave

A-B (spine) merges first if ready; A-S and A-W merge after (they touch watch-page shell edges around the spine). Conflicts resolved by the lead at merge time (union-merge law from Wave 1).

## Standing laws (unchanged)

- GitHub is the single source of truth; workers relay bundles; lead gates (lint/typecheck/test) + merges --no-ff + pushes.
- No `player` endpoint. Fixtures-only tests. Live calls only in running routes (rate-limited + cached).
- YouTube is the user-data source of truth; WebFlix stores UI prefs only.
- Every action on WebFlix = same exact effect on youtube.com (verify via the broker browser).
- UI contract: the ZTube-derived shell (now branded WebFlix), dark default + light, responsive, sticky footer law, semantic HTML.

---

# PHASE 2 — 2026-10-01 (operator directive: social completion, authentication, standalone studio)

Phase 1 is COMPLETE (38/38 acceptance @ 4f88a4a, 672 tests, production live).
Phase 2 opens three parallel lanes on base 4f88a4a:

### P2-SO `wfx2/waveP2-social` — Community posts + social completion

- Channel Community ("Posts") tab surfaced end-to-end: text/image/poll posts,
  like/dislike + comments on posts (broker writes), share. The mapper exists
  (`mapBackstagePost` in `channel-tabs.ts`) but renders nowhere today.
- THE WALL: community-tab browse answers `{"tab":"community","walled":true}` in
  production (the same IP-class browse wall as home). Ladder: browse-fresh →
  Tier-2 broker-read (navigate the logged-in browser to the channel posts tab,
  extract `ytInitialData`, map through the existing mapper) → Upstash last-good
  (24h) → honest-empty.
- Creator post composer (text/image/poll) via broker backstage create,
  reachable from own-channel Community tab + deep-linked from Studio.
- Broker kinds are additive: `community-read`, `post-like`, `post-comment-*`,
  `post-create` follow the established executor pattern.

### P2-AU `wfx2/waveP2-auth` — The WebFlix authentication system

- NextAuth v4 (already a dependency): credentials provider, JWT sessions,
  scrypt password hashing (node:crypto), user store in the Upstash adapter
  (`wf:auth:user:<email>` key schema) with in-memory fallback for dev/tests.
- Sign-in/sign-up pages in Google-account visual parity; header avatar menu
  (account / sign out) vs guest "Sign in" button.
- Gating parity with youtube.com signed-out: personal surfaces
  (history/liked/playlists/subscriptions/notifications/account/studio) show
  YouTube-style signed-out screens; comment composer gates "Sign in to
  comment"; like/subscribe/save prompt sign-in. Signed-in = current behavior
  (WebFlix identity fronts the single operator YouTube broker session — the
  single-tenant law stays; UI copy states it honestly).

### P2-ST `wfx2/waveP2-studio-app` — Standalone Creator Studio

- `apps/studio` — its own Next.js 16 app in this repo (own package.json,
  src/, tests). The lead pre-created the Vercel project `studio-webflix`
  (rootDirectory `apps/studio`, deploys main) with MAIN_APP_URL + UPSTASH_* +
  NEON_DATABASE_URL env seeded → https://studio-webflix.vercel.app
- studio.youtube.com parity shell: left nav (Dashboard/Content/Analytics/
  Community/Subtitles/Copyright/Earn/Customization/Audio library/Settings),
  topbar (channel picker, Create → Upload/Go live/New post deep links,
  notifications, account).
- Real surfaces: Dashboard (latest video + recents + channel analytics
  summary), Content table (videos/shorts/live/posts + filters + row menus),
  Analytics (overview/content/audience tabs, charts, ranges), Comments
  moderation (published/held/spam + approve/delete/heart), Customization.
  Honest degradation: Revenue (no YPP), Audio library, Subtitles, Copyright.
- Data: server-side proxy to the main app's APIs (MAIN_APP_URL, Upstash-cached
  where hot). Auth: WebFlix sign-in required (same `wf:auth:user:` key schema
  as P2-AU — per-domain session cookies accepted parity). The lane does NOT
  touch `src/` (the lead adds the main-app /studio redirect at merge).

### Phase 2 merge order

P2-SO → P2-AU → P2-ST (lead resolves conflicts; lanes are file-disjoint by
design: SO = channel/watch components + broker kinds, AU = auth lib/account/
gating, ST = apps/studio only).

# PHASE 3 — 2026-10-01 (the executable-actions close-out: upload, live chat, search depth)

Base: main @ ebcb6af (phase-2 complete: 754 root + 25 studio tests green;
both deployments live). Three parallel lanes, file-disjoint by design:

### P3-UP `wfx2/waveP3-upload` — Real upload execution

- Today /upload honestly hands off (metadata → YouTube Studio deep-link).
  Phase 3 makes the upload itself EXECUTE through the Tier-2 broker: the
  `upload-execute` broker kind (a staged CDP drive of youtube.com/upload:
  file select → metadata → Next×3 → visibility → publish, with a progress
  journal and honest intermediate states: uploading → processing → published).
- The /upload page gains the real flow: file picker (accept video/*),
  metadata form (title/description/visibility), staged progress UI, the
  published result deep-links to the real video. Honest degradation when
  the broker is offline (the current hand-off remains the fallback rung).
- The broker kind ships in its own module (`kinds/upload.ts`) — the lead
  pre-seeds the kind registry (types + executor routing + stub) so this
  lane touches ONLY its own module file. A tiny valid MP4 ships with the
  tests (synthetic, provenance-marked).

### P3-LC `wfx2/waveP3-livechat-send` — Live chat participation

- The live chat input is explicitly disabled today ("ships with the
  sign-in broker lane"). Phase 3 ships it: the `live-chat-send` broker kind
  (type into the real live chat composer on youtube.com and send), the
  panel input enabled post-auth (guest gate = the AU signed-out law),
  optimistic echo with server-truth reconciliation, honest error states
  (member-only chat, slow mode, chat disabled), report action on chat
  messages (creator + viewer parity).
- Owns `kinds/livechat.ts` (pre-seeded stub), live-chat-panel/message
  components, the send lib + tests.

### P3-SG `wfx2/waveP3-search-suggest` — Search suggestions + depth

- The topbar search gains youtube.com's autocomplete: a suggestions
  dropdown while typing (the suggest API), keyboard navigation (arrows +
  enter + esc), recent searches (local storage, honest), and the
  zero-results / "did you mean" parity states on the search page.
- Owns the topbar (additive), the new suggest component + lib + API route,
  search-page zero-state, tests.

### Phase 3 merge order

P3-UP → P3-LC → P3-SG (broker-module lanes first; the lead pre-seeds the
shared broker registry on main BEFORE dispatch so lanes stay file-disjoint).
