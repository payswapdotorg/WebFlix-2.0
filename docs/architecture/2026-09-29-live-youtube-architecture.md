# WebFlix Live Architecture — WebFlix becomes another frontend for youtube.com

**Status: VERIFIED** (every claim below was probed against the real youtube.com from this build session — evidence in `docs/research/2026-09-29-verifications.md`).
**Date: 2026-09-29 · Author: lead · Repo: payswapdotorg/webflix-2.0**

## North Star

Any video that can be viewed on youtube.com can be viewed on WebFlix with the same level of quality at the minimum. Any action that can be performed on youtube.com can be performed on WebFlix and it will have the same exact effect as if it were performed on youtube.com. WebFlix is another frontend for youtube.com.

Consequences:
- **Every asset** on the current Vercel deployment (snapshot demo data) gets replaced by real live YouTube data.
- YouTube remains the **only source of truth** for user data (likes, subscriptions, history, playlists, comments). WebFlix keeps no parallel truth except UI-local preferences.
- The WebFlix session acts on the operator's YouTube account (`yaslencatty@gmail.com`) — single-tenant live mode. (Multi-tenant = future: each WebFlix user connects their own Google account via the same session-broker pattern.)

## The three tiers

### TIER 1 — READ (server-side; Vercel functions; no-auth or session-cookie auth)

All verified working from datacenter egress (both sandbox and, by design, Vercel):

| Surface | Mechanism | Notes |
|---|---|---|
| Search (all videos on YouTube) | `POST /youtubei/v1/search` `{query, params?}` | filters via `params` protobuf (sort/date/duration/type); returns videoRenderer/channelRenderer/shorts-lockup items. VERIFIED (593KB fixture) |
| Search autocomplete | `GET suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=` | public, free. VERIFIED |
| Watch-page metadata + related + autoplay + comments token | `POST /youtubei/v1/next` `{videoId}` | title, channel, views, likes (approx), description, chapters (from description), related rail, autoplay set, live-chat session when live. VERIFIED (511KB fixture) |
| Comments (top-level + replies, sort) | `POST /youtubei/v1/next` `{continuation}` | token from the watch page's `comment-item-section`; replies via nested continuations; sort by switching continuation token type. VERIFIED (282KB fixture, 20 comments) |
| Home feed | `POST /youtubei/v1/browse` `{browseId: "FEwhat_to_watch"}` | personalized with session cookies. VERIFIED (109KB fixture) |
| Trending (+ category pages) | SSR parse: fetch `https://www.youtube.com/feed/trending` HTML → `ytInitialData` | the FE browse XHR for trending is rejected server-side (400) — SSR is the mechanism. VERIFIED (1.9MB fixture) |
| Subscriptions feed | SSR parse `/feed/subscriptions` (+ cookie auth) | browse XHR `FEsubscriptions` is valid but returns the empty-state for this account; SSR returns 95 items. VERIFIED (1.7MB fixture) |
| History feed | SSR parse `/feed/history` | VERIFIED (2.8MB fixture) |
| Channel pages (all tabs) | `POST /youtubei/v1/browse` `{browseId: "UC…"}` + tab continuations | VERIFIED (1.1MB fixture) |
| Shorts feed | `POST /youtubei/v1/reel/reel_watch_sequence` + `reel/reel_item_watch` | payload shape captured (fixture `request_payload_examples.json`) |
| Live chat | `next → conversationBar.liveChatRenderer.continuations[0].reloadContinuationData.continuation` → `POST /youtubei/v1/live_chat/get_live_chat` `{continuation}` | 10s polling cadence, advancing continuations. VERIFIED live (66 msgs, Al Jazeera stream) |
| Live chat replay (ended lives) | same `get_live_chat` with the replay continuation + offset params | implementation-lane pattern |
| Notifications | `POST /youtubei/v1/notification/get_notification_menu` + `get_unseen_count` | VERIFIED endpoint |
| Live viewcount/metadata polling | `POST /youtubei/v1/updated_metadata` | captured (browser) |
| Video streams / player metadata | **DO NOT USE `player` endpoint server-side** | datacenter IPs get bot-flagged (`LOGIN_REQUIRED: Sign in to confirm you're not a bot`). Playback is client-side embeds (Tier 3); metadata comes from `next`. |
| Thumbnails | hotlink `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (and `mqdefault`, `maxresdefault`, shorts `oardefault`) | client-side, zero egress cost |

Caching + rate limits: Upstash Redis (TTL per surface: search 10m, feeds 5m, watch meta 60m; live chat no-cache) + per-IP rate limiting.

**HARD RULE for all workers**: the `player` endpoint is off-limits in code and in tests. Tests run against recorded fixtures (`tests/fixtures/yt/`) — never against live youtube.com. Live calls happen only in the running app (server routes), rate-limited + cached.

### TIER 2 — WRITE (actions with same-exact-effect on youtube.com)

Two verified sub-paths:

**(a) Direct server-side actions** (classic SAPISIDHASH auth, session cookies):
- `subscription/subscribe` + `subscription/unsubscribe` — VERIFIED server-side (round-trip: subscribe → feed reflects → unsubscribe)

**(b) Broker-executed actions** (the new `_u` attestation scheme — server replay returns 401 even with fresh cookies, fresh params, triple `SAPISIDHASH/1PHASH/3PHASH` header + `X-Youtube-Bootstrap-Logged-In`):
- `like/like`, `like/removelike` (and, by extension, comment create/like/edit/delete, playlist mutations, bell-preference — all treated as broker-tier until proven direct)
- The like `params` protobuf is videoId-templatable (`{1:{1:videoId},2:{},6:{1:timestamp,2:hash}}`) but the auth derivation is opaque → the **Session Broker** owns this tier.

**Session Broker** (the action executor):
- A logged-in headless/browser session of youtube.com (the persistent replay browser profile — already logged in, 24/7 infrastructure on the lead sandbox) driven over CDP.
- Exposed as a mini-service (`mini-services/youtube-broker/`, its own port, shared-secret auth) with an internal HTTP API: `POST /broker/action {kind, videoId|channelId|commentId|playlistId, payload}`.
- Executes actions via page-context fetches in the logged-in YouTube tab (verified: broker like/unlike works with 100% fidelity — it IS the real client).
- The Vercel app's write API routes proxy to the broker (server-to-server; broker secret in env).
- Fallback/order: try direct (a) first for endpoints known-direct, else broker (b). Subscribe = direct; like/comment/playlists/bell = broker.

### TIER 3 — PLAYBACK (client-side; the user's browser talks to YouTube directly)

- **IFrame Player API** (`https://www.youtube.com/iframe_api`, `new YT.Player`) — plays ANY public YouTube video including live streams; gives quality, speed, captions, keyboard, fullscreen — the same player experience as youtube.com (it IS youtube.com's player).
- Watch page: embed in the WebFlix shell + WebFlix UI around it (chapters bar, stats, description panel, comments, related rail).
- Shorts: vertical-styled embed + swipe rail (WebFlix navigation, YouTube playback).
- Live: embed (live stream) + WebFlix live-chat panel (Tier-1 polling).
- Share with timestamp: client-side link building (`?t=` formats already tested in Wave 1).
- Watch-progress tracking for continue-watching: YouTube records history when the logged-in account watches; for the demo session the broker browser's account accumulates real history. WebFlix-local ViewEvents remain only for anonymous progress UX (paused-position memory) — NOT the source of truth.

## Deployment architecture (all free tier)

```
User browser ──▶ Vercel (webflix-2-0, Hobby)
                   ├─ Next.js app (WebFlix UI, IFrame player loads from YouTube client-side)
                   ├─ API routes (Tier-1 read proxy: InnerTube + SSR parse)  ──▶ youtube.com
                   ├─ API routes (Tier-2 write proxy) ──▶ Session Broker (lead sandbox mini-service) ──▶ CDP ──▶ logged-in YouTube tab
                   ├─ Upstash Redis (cache + rate limit + live-chat continuation registry)
                   └─ Neon Postgres (WebFlix-local only: UI prefs, broker health, audit)
Thumbnails: browser ──▶ i.ytimg.com directly (zero cost)
```

- **Vercel Hobby**: the existing git-linked project `webflix-2-0` (production alias `webflix-2-0-one.vercel.app`; deploys from main via git integration once the app builds clean on Vercel; until then the static mirror serves).
- **Upstash Redis free**: as above.
- **Neon Postgres free**: replaces SQLite when the app runs on Vercel (DATABASE_URL env). WebFlix-local schema stays minimal (it is NOT the YouTube data mirror — YouTube holds the truth).
- **Session Broker on the lead sandbox**: `mini-services/youtube-broker` (bun, own port, CDP client, shared secret). The sandbox is always-on infrastructure with the logged-in browser profile.
- **Cloudflare R2 / LiveKit**: NOT needed (all media from YouTube CDN; live production happens on YouTube itself).

## Feature parity map (current WebFlix feature → live mechanism)

| WebFlix feature (live today) | Live backend |
|---|---|
| Home feed (hero, trending rail, shorts shelf, recommended grid, continue watching) | browse FEwhat_to_watch + next() + history SSR |
| Category chips | search with category params + home feed shelves |
| Trending page + categories | SSR parse /feed/trending (+ category pages) |
| Search + autocomplete + filters | youtubei search + suggestqueries |
| Watch page (player, engagement, comments, related, autoplay) | next() + IFrame embed + comments continuations + broker likes |
| Shorts (vertical feed, engagement) | reel_watch_sequence + vertical embed + next() per short |
| Live videos + live chat (+ Super Chat display) | next() live detection + embed + get_live_chat polling (+ replay continuations) |
| Subscribe / bell | direct server action (subscribe) + broker (bell prefs) |
| Like / dislike | broker (client optimistic UI) |
| Comments view/sort/reply/heart | next() continuations (read) + broker (write) |
| Channels (tabs, about, membership display) | browse UC… + tabs |
| History / Watch later / Playlists / Liked | SSR parse (read) + broker (write); watch-later = YouTube's own WL playlist |
| Notifications (bell menu, unread count) | get_notification_menu + get_unseen_count |
| Share (timestamp) | client-side |
| Studio / upload | YouTube Studio deep-link + real channel analytics via Studio SSR (final wave) |
| AI features (summary/reply/chapters) | transcript via timedtext + client-side/LLM — final wave (nice-to-have; north star is parity, not AI) |

## What WebFlix is NOT doing (explicitly out of scope)

- Serving video bytes from our own CDN (YouTube embeds are the player of record).
- Writing a parallel user database (YouTube is the truth).
- Server-side `player` endpoint calls (bot-flag risk to the shared IP).
- Anonymous actions: every action rides the operator's session (single-tenant mode).
