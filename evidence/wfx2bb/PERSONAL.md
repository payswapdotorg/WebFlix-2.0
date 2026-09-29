# WFX2-B-B — Personal Surfaces (history · playlists · liked · notifications · subscriptions)

**Lane**: `wfx2/waveB-personal` (base: `main` @ 7b72d70) · **Worker**: WFX2-B-B · **Repo**: payswapdotorg/webflix-2.0

## What this lane delivers

All five personal surfaces read from the operator's REAL YouTube account, with
honest public-mode degradation everywhere (this sandbox has no browser → no
operator cookies could be harvested; public mode is the verified path here,
personal mode is fixture-backed and lead-re-capturable):

| Surface | Read mechanism | Write mechanism (Tier-2) |
|---|---|---|
| **History** | SSR `/feed/history` (ytInitialData; day-grouped itemSectionRenderers → lockupViewModel/videoRenderer) + `browse {continuation}` pagination | broker `history-remove`, `history-clear-all`, `history-pause`, `search-history-pause` |
| **Playlists** (list) | SSR `/feed/playlists` | broker `playlist-create {title, visibility}`, `playlist-delete` |
| **Playlist items** (incl. Watch Later) | `browse {browseId: "VL<id>"}` + continuations (WL = `VLWL`) | broker `playlist-remove-item` (`playlist-add`/`watch-later` existed from A-W) |
| **Liked videos** | `browse {browseId: "VLLL"}` (YouTube's own LL list) — auth-gated | (likes themselves ride the existing like lane) |
| **Notifications** | `notification/get_notification_menu` (INBOX) + `get_unseen_count` (both research-log §12 verified) | broker `notifications-mark-read` |
| **Subscriptions** | SSR `/feed/subscriptions` (95-item real capture) + `browse {continuation}` | (subscribe/bell lanes unchanged — existing routes) |
| **Sidebar channel list** | `/api/me` subscriptions section now derives the REAL subscribed channels from the feed's own byline data | — |

## Routes (owned lane)

- `GET /api/history?cursor=` → `{groups, nextCursor, loginRequired, watchHistoryPaused, searchHistoryPaused, total, session}`
- `DELETE /api/history?videoId=` (one video → `history-remove`) / `DELETE /api/history` (clear all → `history-clear-all`)
- `PATCH /api/history {paused, type: "watch"|"search"}` → `history-pause` / `search-history-pause`
- `GET /api/playlists` → `{playlists, loginRequired, session}` (live list; the `?videoId=` save-dialog shape is unchanged — see Merge notes)
- `POST /api/playlists {name|title, visibility}` → broker `playlist-create`; honest local-mirror fallback ONLY when the broker is offline (toast says so)
- `GET /api/playlists/[id]?cursor=` → `{playlist, videos, nextCursor, loginRequired, special}` (browse VL; 404 for genuinely-unknown ids; `loginRequired:true` for WL/LL without a session)
- `DELETE /api/playlists/[id]` → broker `playlist-delete` (WL/LL → honest 400: YouTube's own lists)
- `GET /api/liked?cursor=` → `{videos, playlist, nextCursor, loginRequired, session}` (browse VLLL)
- `GET /api/notifications` → `{unread, items, pollIntervalMs, loginRequired, session}` (bell contract kept, additive fields)
- `POST /api/notifications/read` → broker `notifications-mark-read`
- `GET /api/subscriptions?cursor=` → `{channels, videos, nextCursor, loginRequired, session}`; POST unchanged (A-W's subscribe state machine)
- `GET /api/me` → subscriptions section = live channels (session-gated); user profile unchanged (WebFlix-local, UI-prefs lane)

## New library files (additive — no core file touched)

- `src/lib/youtube/history.ts` — SSR parse + continuation (both `appendContinuationItemsCommand` and `appendContinuationItemsAction` wire variants — the Action variant is live-verified this session), watched-progress % → watchedSec, day-header → watchedAt, pause-state reader, login-required detection
- `src/lib/youtube/subscriptions.ts` — feed mapping, distinct-channel derivation (byline browseEndpoints + avatars + verified icons), continuation token, login-required detection
- `src/lib/youtube/playlists.ts` — list mapping (playlist lockups → PlaylistDTO with visibility badges + counts), items via browse VL (+ continuation), special-list (WL/LL) honest handling, SSR `/playlist?list=` path
- `src/lib/youtube/notifications.ts` — menu + unseen mappers, kind inference, relative sentTime → ISO

## Broker additions (additive edits ONLY)

- `mini-services/youtube-broker/types.ts` — 8 new ACTION_KINDS + payload docs
- `mini-services/youtube-broker/executor.ts` — new scripts: `history-remove` (card kebab → "Remove from watch history"), `history-clear-all` (control button + confirm), `history-pause` (Pause/Resume control, confirm-on-pause, label-flip verification), `search-history-pause` (kebab menu, honest unverified note — myactivity owns the state), `playlist-remove-item` (row kebab, `browse/edit_playlist` ACTION_REMOVE_VIDEO fetch fallback), `playlist-create` ("New playlist" dialog + `playlist/create` fetch fallback), `playlist-delete` (⋮ menu + `browse/delete_playlist` fetch fallback), `notifications-mark-read` (bell open + `get_unseen_count` re-read)
- `src/lib/broker.ts` — BrokerKind extended additively + `visibility`/`paused` payload fields

## LIVE vs FIXTURE verification matrix

The B-B sandbox CAN reach youtube.com (public, no cookies). Live curls ran at
runtime (never in tests). Personal-mode reads are fixture-backed.

| Path | Verified how | Result |
|---|---|---|
| `/api/history` public | **LIVE** curl (`evidence/wfx2bb/curls/history.json`) | honest `loginRequired:true`, empty groups |
| `/api/subscriptions` public | **LIVE** curl | honest `loginRequired:true` |
| `/api/playlists` public | **LIVE** curl | honest `loginRequired:true` (the public page answers a 640-byte skeleton — fixture `ssr_playlists_public.json`) |
| `/api/liked` public | **LIVE** curl | honest `loginRequired:true` — the real upstream `browse VLLL` answers alert ERROR "The playlist does not exist." (captured → `browse_vl_ll_public.json`) |
| `/api/notifications` public | **LIVE** curl | `unread:0`, **`pollIntervalMs:1800000` (the real upstream cadence)**, honest `loginRequired:true` |
| `/api/playlists/PLfvAqoENo7...` (public list) | **LIVE** curl (`playlist_items_public.json`) | **REAL DATA**: title "💕Lofi Hip Hop💕 Bart 2021", 492-video header count, 25 items, first video `oHaGR0shnvA` "Chill Drive - Lofi hip hop mix" (channel "chilli music", 2:55:21) |
| Playlist continuation (`?cursor=`) | **LIVE** curl (`playlist_items_page2.json`) | **REAL DATA**: 2-item trickle page (`IYLDF2-PvFg`, `hl1reTcMDko`) + next token — this is how the current wire form pages; the `appendContinuationItemsAction` variant was discovered and supported here |
| `/api/me` public | **LIVE** curl | `subscriptions: []` (honest) |
| `DELETE /api/history?videoId=` (broker offline) | **LIVE** curl | honest 502 "action backend offline — the lead's broker must be running" |
| `POST /api/notifications/read` (broker offline) | **LIVE** curl | honest 502 |
| History personal mapping | **FIXTURE** `ssr_history.json` (REAL capture by lead) | 100+ items, "Today" group first, dQw4w9WgXcQ with watchedSec 214 (startPercent 100 × 3:34), cursor present, pause-state false |
| Subscriptions personal mapping | **FIXTURE** `ssr_subscriptions.json` (REAL capture) | 95 videos, 2 distinct channels (UCICYIUduSnJCb1bB_6iJBAQ YogaDaily verified, @mbavumbilibrand1318), cursor |
| Playlist items mapping | **FIXTURES** `browse_vl_public.json` + `ssr_playlist_public.json` (REAL) + `browse_vl_continuation_live.json` (REAL LIVE capture this session) | 25 items + header + cursor; continuation 2 items + token |
| Operator playlist list | **FIXTURE** `ssr_playlists_synth.json` — **MARKED SYNTHETIC** (the B-B sandbox has no operator session; built on the structural pattern of the real subscriptions grid + real playlist lockups; **the lead re-captures `/feed/playlists` on merge**) | 3 lists, visibility badges, counts |
| Notifications items mapping | **FIXTURE** `notification_menu_items_synth.json` — **MARKED SYNTHETIC** (public capture has no items; **the lead re-captures a logged-in menu on merge**) | 3 items, 2 unread, kinds, videoIds |
| Broker scripts (all 8 kinds) | **FIXTURE-FREE unit tests** (requiredUrl + buildScript contract; no CDP) | all build; history-remove targets the videoId; pause honors `paused:false` |

UI verification (agent-browser, screenshots in `evidence/wfx2bb/screens/`):
`/history`, `/subscriptions`, `/liked`, `/playlists` all render the honest
login-required states; the playlists create flow shows the honest
"created on the WebFlix mirror — the YouTube broker is offline" toast; the
bell dropdown shows the honest personal-notifications note; the home page
renders unregressed. NOTE: the app has a pre-existing React hydration
attribute warning (theme/app-shell related) — verified present on pristine
`main` too; NOT introduced by this lane.

## Tests (fixtures-only; NO live network in tests)

- `tests/personal-mappers.test.ts` — 24 tests (mappers vs fixtures)
- `tests/personal-routes.test.ts` — 21 tests (route handlers vs the `setUpstream()` seam; session mode via `YT_COOKIES` env, public mode via its absence; broker-offline honesty)
- Root suite: **350 pass / 0 fail** (was 305 → +45). Groups: boot 186, watch 106, liveshorts 58.
- `mini-services/youtube-broker/personal-executor.test.ts` — 13 tests (broker suite: 33 pass / 0 fail)
- **Total new: 58 tests.**

Fixtures added (12): `ssr_playlist_public`, `browse_vl_public`,
`browse_vl_ll_public`, `browse_vl_continuation_live` (REAL LIVE),
`notification_menu_public`, `notification_unseen_public`,
`ssr_history_public`, `ssr_subscriptions_public`, `ssr_playlists_public`
(REAL public captures; `visitorData` sanitized per repo convention) +
`ssr_playlists_synth`, `notification_menu_items_synth`,
`browse_vl_continuation_synth` (MARKED SYNTHETIC-shaped).

## Pre-existing issue FIXED by this lane

`bun`'s `mock.module()` is process-wide and is not restored between test
files; `tests/action-routes.test.ts` (alphabetically first) leaked its
broker/direct mocks into `broker-client.test.ts` + `youtube-direct.test.ts`
→ **17 spurious failures** in the `test:watch` group on pristine main (bun
1.3.14). Fixed additively: snapshot the real modules before mocking,
re-install them in `afterAll` (commit f85de51). All three groups now green.

## Merge notes for the lead

1. **Re-capture two synthetics on merge** (with the operator session):
   `/feed/playlists` (→ `ssr_playlists.json`) and a logged-in
   `get_notification_menu` (→ `notification_menu_items.json`) — the parsers
   already map those shapes; swap the fixtures and drop the `_synth` ones (or
   keep them as shape-shims, tests reference them by name).
2. **`YT_COOKIES` in `.env`** flips every personal route to live mode; nothing
   else changes (the routes read `hasSession()` per call).
3. **Broker deployment**: the 8 new kinds ride the existing executor contract
   (no server/auth/cdp changes); `requiredUrl` navigation + page scripts are
   additive. `search-history-pause` verification is honestly unverified (the
   state lives on myactivity.google.com, not readable from the history page)
   — the executor reports `verified:false` with a note by design.
4. **`/api/playlists?videoId=` is intentionally unchanged** (the watch-page
   SaveDialog's local containsVideo contract — A-W's surface; the dialog swap
   to broker-side state is a later-wave item). The bare GET (the playlists
   page + video kebab save dialog) is live.
5. `record_web_notifications_seen` was probed live: **404** — mark-read is
   broker-tier, honestly.
6. `src/lib/youtube/{feeds,innertube,ssr,mappers,comments}.ts` were NOT
   touched (lane law); all new code is in the four new files + routes.
