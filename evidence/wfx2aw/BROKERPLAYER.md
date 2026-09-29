# WFX2-A-W — Session Broker + Real YouTube Player (BROKER + PLAYER lane)

**Branch:** `wfx2/waveA-broker-player` (base: `main` @ 601489f) · **Worker:** WFX2-A-W
**Scope:** Tier 2 WRITE (the Session Broker) + Tier 3 PLAYBACK (the IFrame player) + the action-route wiring.

---

## 1. What was built

### `mini-services/youtube-broker/` — the Session Broker (bun, port 3055, `bun --hot`)

An independent bun project (no dependencies — Bun.serve + native WebSocket + node:crypto) that
executes authenticated YouTube actions with **the same exact effect as if performed on
youtube.com** by driving the logged-in YouTube tab over CDP.

- `GET /healthz` → `{ok, tabFound, tabUrl, lastActionAt}` (no auth; honest `cdp` field when the
  DevTools endpoint is unreachable — `tabFound:false` is an honest PASS of the health contract).
- `POST /broker/action` (header `x-broker-secret`): `{kind, target:{videoId|channelId|commentId|playlistId}, payload?}`.
  Kinds implemented (unknown → 400): `like`, `dislike`, `remove-rating`, `subscribe`,
  `unsubscribe`, `bell {pref}`, `comment-create {text, videoId}`, `comment-reply {text,
  commentId}`, `comment-like {commentId}`, `playlist-add {playlistId, videoId}`,
  `watch-later {videoId}`, `not-interested {videoId}`.
- Executor (`executor.ts`): finds the youtube.com tab (creates one on youtube.com if none),
  navigates via `Page.navigate` when the action needs a different page, then evaluates a page
  script. **UI-click is the primary path** (the real control: `like-button-view-model button`,
  `ytd-subscribe-button-renderer button` + unsubscribe confirm, the bell menu with a re-open
  check verification, the comment simplebox → `#contenteditable-root` →
  `execCommand('insertText')` → `#submit-button`, the Save-dialog rows with checked-state
  verification, the home-feed kebab for not-interested). **Page-context InnerTube fetch is the
  fallback** (`credentials:'include'` + `window.ytcfg.get('INNERTUBE_CONTEXT')` as the real
  client context; the like params protobuf is videoId-templated from the captured fixture with
  a refreshed timestamp). Every action **verifies its effect in the DOM** (aria-pressed flip /
  label change / checked row / comment visible / card removed) and returns
  `{ok, verified, already?, path: "ui"|"fetch"|"none", detail, dom?}` — on verification failure
  the DOM state seen is returned honestly.
- Idempotency: current state is read BEFORE acting (`already:true` + no click when the desired
  state already holds).
- Action journal: append-only `actions.jsonl` (gitignored runtime artifact;
  `{"ts","kind","target","result"}` per line).
- Shared-secret auth on every `/broker/*` route, constant-time (sha256 digest →
  `timingSafeEqual`); **fail-closed** when `BROKER_SECRET` is unconfigured (503, healthz stays
  up). `README.md` in the service dir: run instructions, the full API table, the security model
  (localhost-only by default; the Vercel app reaches it through the lead's gateway).
- Own `bun test` suite: **20 pass** (auth, request validation per kind, journal round-trip,
  health contract against a dead CDP port, action guards 401/400/502, fail-closed 503,
  like-params templating byte-level).

### `src/lib/broker.ts` — the app-side typed client

`brokerAction(kind, target, payload?)` → POST `${BROKER_URL}/broker/action` with the
`x-broker-secret` header; 15s timeout (`BROKER_TIMEOUT_MS` override); every failure maps to a
typed `BrokerError` (`offline` / `unauthorized` / `bad-request` / `action-failed`) which the
routes turn into honest 502s — offline answers exactly
`"action backend offline — the lead's broker must be running"`.

### `src/lib/youtube-direct.ts` — the direct write path (subscribe)

`POST /youtubei/v1/subscription/subscribe|unsubscribe` with cookie auth + the classic
**SAPISIDHASH** header (`<time>_<sha1(time + ' ' + SAPISID + ' ' + 'https://www.youtube.com')>`,
SAPISID from `YT_COOKIES` — env only) — the path VERIFIED server-side (log §16/§17). Also
`getSubscribedState` (SSR channel-page truth) for the toggle path. The lead dedupes this
against A-B's `innertube.ts` at merge.

### `src/lib/watch/action-proxy.ts` — the UI-semantics → broker mapping

Keeps every UI request/response contract while proxying to live effects: legacy toggle
semantics for `{value}` bodies (the same value unsets — implemented as broker `already` →
`remove-rating` second call), canonical `{action: like|dislike|none}` set semantics, baseline
counts for honest numbers (DOM-observed `likesLabel` wins when parseable), the subscribe state
machine (bell `off` → unsubscribe), synthesized CommentDto for the composer, playlist
`containsVideo`/`added` toggles, and `{ok, effect}` on every response.

### Action routes rewritten (broker/direct proxying)

| Route | Maps to |
|---|---|
| `POST /api/videos/[id]/like` `{value\|action, baseline?}` | broker like / dislike / remove-rating |
| `POST /api/subscribe` `{channelId, on?}` | direct-first (SAPISIDHASH), broker fallback; `on` omitted → toggle |
| `POST /api/subscribe/bell` `{channelId, pref}` | broker bell (pref `off` → unsubscribe) |
| `POST /api/subscriptions` `{channelId, bell, subscriberCount?}` | the watch-page state machine → direct-first + broker bell; keeps SubscriptionResultDto |
| `POST /api/videos/[id]/comments` `{body, parentId?, parentText?}` | broker comment-create / comment-reply (201 + CommentDto) |
| `POST /api/comments/[id]` `{text, videoId?, parentText?}` | broker comment-reply (canonical route; PATCH/DELETE kept seed-backed for the B-S lane) |
| `POST /api/comments/[id]/like` `{value\|action, baseline?, commentText?, videoId?}` | broker comment-like (toggle/set) |
| `POST /api/playlists/items` `{playlistId, videoId, title?}` | broker playlist-add (ensure) |
| `POST /api/playlists/[id]/items` `{videoId}` | broker playlist-add (toggle) → `{containsVideo}` |
| `POST /api/playlists/watch-later` `{videoId, add?}` | broker watch-later (YouTube's WL) |
| `POST /api/videos/[id]/not-interested` + `POST /api/not-interested` | broker not-interested (the real home-feed action) |

All return `{ok, effect}` (merged into the legacy shapes) and honest 502s when the broker is
unreachable. Small additive UI wiring: `action-row` sends the baseline counts,
`comment-row`/`comment-composer` send `commentText`/`parentText` (the DOM locator that enables
the comment-like/reply UI paths), `subscribe-button` passes the displayed count as baseline and
ignores `-1` (unknown).

### `src/components/watch/youtube-player.tsx` — the REAL player

IFrame Player API (`https://www.youtube.com/iframe_api`, loaded once; `new YT.Player` with
`playerVars {playsinline: 1, rel: 0, modestbranding: 1}`). Props:
`{videoId, startSec?, onProgress?(sec, durationSec), onEnded?, onStateChange?, className?}`.
`loadVideoById` on videoId change (no iframe reload), `destroy()` on unmount, LIVE support
(duration 0 → no seek/persist), shorts slot via `className="shorts"` (9:16 — A-S reuses this),
default + named exports. `onProgress` throttled ~1/sec; position persisted to localStorage
`webflix-progress:<videoId>` (~5s + on pause/unmount); one view ping per session to the existing
`/api/view` contract `{videoId, watchedSec}`. Captions/quality/speed/keyboard/fullscreen come
from the native YouTube player UI — the same experience as youtube.com by construction.

### Watch page swap (`src/components/watch/watch-page.tsx`)

The demo `<video>` player is replaced by `YoutubePlayer` (mount verified in-browser: the
region "YouTube video player" + the YT iframe; `<video>` count 0). Autoplay-next on ENDED →
`router.push(/watch/<nextVideo.id>)` when the Wave-1 `wfx2-autoplay` pref is on (next video
from the related rail — the same DTO A-B's autoplay set will fill); a "Play next" button and
an Autoplay switch sit in the control row. Theater toggle (CSS width, the same layout block).
**Miniplayer-on-scroll**: the app shell scrolls an inner container — the listener attaches to
the player's real scroll parent; when the player's bottom passes 80px the SAME DOM node docks
`fixed bottom-4 right-4 w-80` (the iframe never remounts — playback continues); the expand
button undocks and scrolls back. Sticky mobile player preserved. The edit is compact and
structured to union-merge with A-S's LiveChatPanel addition.

---

## 2. Verification (this sandbox — no CDP browser, which is the lead's infrastructure)

- **Broker service live on :3055** — `evidence/wfx2aw/healthz.json`:
  `{"ok":true,"tabFound":false,...,"cdp":"Unable to connect..."}` — an honest PASS of the
  health contract (the sandbox has no logged-in browser; `tabFound:false` + the `cdp` field).
- **Action guards** (`action-guards.json`): 401 without/with wrong secret · 400 unknown kind ·
  valid action → honest 502 `cdp-execution-failed` + journal entry (`journal-sample.jsonl`).
- **App→broker e2e, no mocks** (`e2e-app-routes.txt`): webflix dev server with
  `BROKER_URL`/`BROKER_SECRET` → every rewritten action route answers with the broker's honest
  error; **broker killed → the exact offline message** `"action backend offline — the lead's
  broker must be running"`; bad body → 400.
- **Watch page in the browser** (agent-browser, screenshots
  `watch-page-player.png` / `watch-miniplayer-docked.png`): player iframe mounts, theater
  toggle, autoplay switch, play-next button, miniplayer dock + undock, like-button honest-502
  toast, comment POST 502 in the dev log, zero page/hydration errors.
- **Tests** (`test-counts.txt`): app suite `bun run test` → **40 + 106 = 146 pass, 0 fail**
  (47 new: broker-client contract 12, youtube-direct 14, player lifecycle 6, action routes 17);
  broker service suite → **20 pass**. `bun run lint` + `bun run typecheck` clean.

## 3. START-GUIDE — bring the broker live on the lead sandbox

0. **Prerequisites (lead sandbox):** a Chrome/Chromium with a profile **logged in to
   youtube.com** (the operator session, yaslencatty@gmail.com), started with
   `--remote-debugging-port=9222` and `--user-data-dir=<the persistent profile>`. Verify:
   `curl http://127.0.0.1:9222/json/version` → JSON with `webSocketDebuggerUrl`.
   Keep at least one tab open on youtube.com (or let the broker create it — it must be the
   logged-in profile's default context).

1. **Start the broker:**
   ```bash
   cd mini-services/youtube-broker
   bun install
   BROKER_SECRET=<the shared secret> CDP_HTTP=http://127.0.0.1:9222 bun run dev
   ```
   Expect: `[youtube-broker] listening on http://127.0.0.1:3055`, `secret: configured`.

2. **Health check (the tab must be found):**
   ```bash
   curl http://127.0.0.1:3055/healthz
   # expect {"ok":true,"tabFound":true,"tabUrl":"https://www.youtube.com/…","lastActionAt":null}
   ```

3. **Two live sanity actions (the evidence the lead captures for the acceptance script):**
   ```bash
   # like dQw4w9WgXcQ then remove the rating
   curl -s -X POST http://127.0.0.1:3055/broker/action \
     -H 'Content-Type: application/json' -H "x-broker-secret: <secret>" \
     -d '{"kind":"like","target":{"videoId":"dQw4w9WgXcQ"}}'
   # expect {"ok":true,"verified":true,"path":"ui", ...} and the LIKE on youtube.com/dQw4w9WgXcQ
   curl -s -X POST http://127.0.0.1:3055/broker/action \
     -H 'Content-Type: application/json' -H "x-broker-secret: <secret>" \
     -d '{"kind":"remove-rating","target":{"videoId":"dQw4w9WgXcQ"}}'
   # expect {"ok":true,"verified":true,"rating":null,...} — the like is gone

   # subscribe then unsubscribe a channel (direct-first also works with cookies)
   curl -s -X POST http://127.0.0.1:3055/broker/action \
     -H 'Content-Type: application/json' -H "x-broker-secret: <secret>" \
     -d '{"kind":"subscribe","target":{"channelId":"UCuAXFkgsw1L7xaCfnd5JJOw"}}'
   # expect {"ok":true,"verified":true,"subscribed":true,...}
   curl -s -X POST http://127.0.0.1:3055/broker/action \
     -H 'Content-Type: application/json' -H "x-broker-secret: <secret>" \
     -d '{"kind":"unsubscribe","target":{"channelId":"UCuAXFkgsw1L7xaCfnd5JJOw"}}'
   ```
   Watch the browser tab while you run these — the like button / subscribe button click FOR
   REAL (it is the same interaction a user performs). The journal
   (`mini-services/youtube-broker/actions.jsonl`) records each attempt. Capture the journal +
   the two responses as `evidence/wfx2aw/` JSON files.

4. **Wire the app** (Vercel env or the lead's gateway): `BROKER_URL` (the gateway path to
   :3055), `BROKER_SECRET` (matching), and — for the direct subscribe path — `YT_COOKIES` (the
   operator's youtube.com cookie header, must contain `SAPISID`; rotates with `__Secure-3PSIDTS`
   are fine — the broker path never needs them). Then:
   ```bash
   curl -s -X POST <app>/api/videos/dQw4w9WgXcQ/like -H 'Content-Type: application/json' \
     -d '{"value":"like","baseline":{"likes":0,"dislikes":0,"yourLike":null}}'
   # expect {"ok":true,"effect":"liked","likes":0,"dislikes":0,"yourLike":"like",...}
   ```

5. **What to look for in the browser:** the broker's clicks happen in the visible tab — the
   like button fills red (aria-pressed=true), the subscribe button flips to "Subscribed" (+ the
   unsubscribe confirm dialog when removing), the bell menu opens and the preference item
   carries the check after selection, comments appear at the top of the list. If verification
   fails, the broker's response carries the DOM state it saw (`dom` field) — paste that into
   the lane report; the selectors to check are at the top of each script in
   `mini-services/youtube-broker/executor.ts`.

6. **Tuning knobs:** the UI-selectors live at the top of each script in `executor.ts`
   (YouTube A/B variants are handled with comma-separated selector lists — add a variant there
   if one drifts); the comment-like/comment-reply page-fetch fallback bodies
   (`comment/perform_comment_action`, `create_comment`) are best-known shapes — if they 4xx on
   the lead sandbox, capture the real body from the browser DevTools Network tab and patch the
   one `post(...)` call; the UI path (commentText locator) needs no endpoints.

## 4. Deviations & notes for the lead

- **Execution path that "worked"**: verifiable only on the lead sandbox (no CDP browser here).
  Both paths are implemented in the exploration order the lane specified — **UI-click primary**
  (per verification §19, broker like via page-context click works with 100% fidelity),
  **page-context InnerTube fetch fallback** (like/removelike params templated from the §20
  fixture; `ytcfg` INNERTUBE_CONTEXT + `credentials:'include'`). Every response reports which
  path ran (`path: "ui" | "fetch"`) and whether the effect was DOM-verified.
- `subscriberCount` in SubscriptionResultDto: live YouTube's post-action count is not readable
  without a channel browse; the route echoes the UI's baseline ± 1 (the UI now sends it), and
  `-1` (unknown) makes the UI leave the count alone. A-B/B-W's channel reads will supply real
  counts.
- `dislike` has **no fetch-fallback template** (only like/removelike were captured) — the UI
  click path handles it; honest error if the click fails.
- `comment-reply`/`comment-like` need `commentText` for the verified UI path (the routes now
  send it); without it they fall back to the best-known page-fetch shapes and report honestly.
- `not-interested` is the real home-feed action — if the video isn't currently surfaced in the
  feed, the broker returns `video-not-in-feed` (YouTube itself only offers NI on feed items).
- Comment PATCH/DELETE (edit/soft-delete) stay seed-backed — comment moderation writes are the
  B-S wave's lane; they were left untouched to union-merge.
- Watch page is shared with A-S (they add the conditional LiveChatPanel below the player) —
  the swap is compact; the player block, control row, and scroll-dock are self-contained.
- The `player` endpoint is untouched (nowhere in app code or tests — grep-verifiable);
  tests use fixtures/mocks only; no live CDP actions from tests; secrets only via env
  (`.env.example` updated; `actions.jsonl` + `broker.log` gitignored).
- `bun add -d happy-dom` (new devDependency) powers the jsdom-safe player lifecycle test.

## 5. Files

Service: `mini-services/youtube-broker/` (index.ts, server.ts, executor.ts, cdp.ts, auth.ts,
journal.ts, options.ts, types.ts, broker.test.ts, README.md, .gitignore) ·
App: `src/lib/broker.ts`, `src/lib/youtube-direct.ts`, `src/lib/watch/action-proxy.ts`,
`src/components/watch/youtube-player.tsx`, the 11 rewritten routes,
watch-page/comment/action-row/subscribe-button/composer/comment-row wiring, `.env.example`,
4 new test files + package.json test scripts.
