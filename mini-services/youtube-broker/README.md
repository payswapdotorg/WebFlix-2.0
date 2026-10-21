# WebFlix Session Broker (youtube-broker)

Executes **authenticated YouTube actions with the same exact effect as if
performed on youtube.com** by driving the logged-in YouTube browser tab over
CDP. The operator's YouTube session lives in a logged-in browser on the lead
sandbox (24/7 replay infrastructure); this broker is the Tier-2 WRITE
executor for the WebFlix app.

## Run

```bash
cd mini-services/youtube-broker
bun install            # no dependencies — just bun
BROKER_SECRET=<shared-secret> \
CDP_HTTP=http://127.0.0.1:9222 \
bun run dev            # bun --hot (auto restart on change), port 3055
```

Environment (secrets from env ONLY — never committed):

| var              | default                        | meaning                                        |
| ---------------- | ------------------------------ | ---------------------------------------------- |
| `BROKER_SECRET`  | *(none — fail-closed)*         | shared secret required on every `/broker/*`    |
| `CDP_HTTP`       | `http://127.0.0.1:9222`        | DevTools HTTP endpoint of the logged-in browser |
| `BROKER_JOURNAL` | `./actions.jsonl`              | append-only action journal                     |
| `BROKER_CAPTURES`| `./captures.jsonl`             | P34 — captured-wire journal                    |

The browser must be started with `--remote-debugging-port=9222` and a
profile that is **logged in to youtube.com**. When no youtube.com tab
exists, the broker creates one (it must be logged in for actions to work).

## API

### `GET /healthz` (no auth — health contract)

```json
{ "ok": true, "tabFound": true, "tabUrl": "https://www.youtube.com/…", "lastActionAt": "2026-09-29T…" }
```

`tabFound: false` + a `cdp` field means the DevTools endpoint was reachable
but held no youtube.com tab (or is unreachable) — an honest state, not an error.

### `GET /broker/captures` (header `x-broker-secret`) — P34

The tail of the **captured-wire journal** (default `./captures.jsonl`):

```json
{ "ok": true, "total": 12, "returned": 2, "captures": [ { "ts": "…", "kind": "dislike", "target": { "videoId": "…" }, "endpoint": "like/like", "url": "…", "method": "POST", "postData": "{\"context\":…,\"params\":\"Cg0K…\"}", "truncated": false, "status": 200, "requestId": "…" } ] }
```

Query: `?tail=N` (1–200, default 20) and `&endpoint=<substr>` (e.g.
`like`, `subscription`, `comment`).

### `POST /broker/action` (header `x-broker-secret`)

```json
{
  "kind": "like",
  "target": { "videoId": "dQw4w9WgXcQ" },
  "payload": { "mode": "set" }
}
```

Kinds (anything else → `400`):

| kind              | target                    | payload                                                        |
| ----------------- | ------------------------- | -------------------------------------------------------------- |
| `like`            | `videoId`                 | `mode: set\|toggle`                                            |
| `dislike`         | `videoId`                 | `mode: set\|toggle`                                            |
| `remove-rating`   | `videoId`                 | —                                                              |
| `subscribe`       | `channelId`               | `mode: on\|off\|toggle` (default `on` = ensure subscribed)     |
| `unsubscribe`     | `channelId`               | —                                                              |
| `bell`            | `channelId`               | `pref: all\|personalized\|none\|off` (`off` unsubscribes)      |
| `comment-create`  | `videoId`                 | `text` (required)                                              |
| `comment-reply`   | `commentId` (+ `videoId`) | `text` (required), `commentText?` (parent text → UI path)      |
| `comment-like`    | `commentId` (+ `videoId`) | `commentText?`, `mode: set\|toggle`                            |
| `comment-edit`    | `commentId` (+ `videoId`) | `text` (required, the NEW body), `commentText?` (CURRENT text — the DOM locator) |
| `comment-delete`  | `commentId` (+ `videoId`) | `commentText?` (DOM locator; ⋮ → Delete → confirm dialog)      |
| `comment-heart`   | `commentId` (+ `videoId`) | `commentText?` (creator heart toggle — ⋮ → Heart)              |
| `comment-pin`     | `commentId` (+ `videoId`) | `commentText?` (creator pin toggle — ⋮ → Pin/Unpin)            |
| `comment-report`  | `commentId` (+ `videoId`) | `commentText?`, `reason?` (report-dialog row label substring)  |
| `playlist-add`    | `playlistId` (+ `videoId`)| `title?` (row label for the UI path)                           |
| `watch-later`     | `videoId`                 | `mode: add\|remove\|toggle` (default toggle), `add: bool`      |
| `not-interested`  | `videoId`                 | — (home-feed action)                                           |

WFX2-B-S note: the five comment-menu kinds locate the comment in the watch
page's DOM by `payload.commentText` (the CURRENT text) — that is the only
locator tier for edit/delete/heart/pin/report (the read layer carries no
edit tokens; the `browse {editCommentParams}` wire form is unverified and
unreachable from public reads). YouTube itself enforces ownership: Edit /
Delete appear only on the operator's own comments, Heart / Pin only in
creator mode.

Response:

```json
{ "ok": true, "verified": true, "already": false, "path": "ui", "detail": { … } }
```

- `verified: true` — the effect was **re-read from the DOM** after acting
  (aria-pressed / subscribed label / checked row / comment visible). `false`
  → `dom` carries the state seen (honest failure).
- `already: true` — idempotency: desired state already held, nothing clicked.
- `path` — `"ui"` (real DOM click, preferred), `"fetch"` (page-context
  InnerTube POST fallback), `"none"`.
- Non-ok → HTTP `502` + `{ ok: false, error, dom? }`.

### Execution model

1. **Find the tab**: the target whose URL contains `youtube.com`; create one
   navigating to `https://www.youtube.com/` when none exists.
2. **Navigate when needed** (`Page.navigate` over CDP, never in-page
   `location.assign` — that would destroy the evaluation context).
3. **UI path (preferred)**: evaluate an async page script that clicks the
   REAL control — `like-button-view-model button` (segmented like control),
   `ytd-subscribe-button-renderer button`, the bell menu, the comment
   simplebox (`#placeholder-area` → `#contenteditable-root` →
   `document.execCommand('insertText')` → `#submit-button`), the Save dialog
   rows, the home-feed kebab for not-interested — then **verifies the effect
   in the DOM** (aria-pressed flip, label change, checked row, card removal).
4. **Fetch fallback**: page-context
   `fetch('/youtubei/v1/…', {method:'POST', credentials:'include'})` with
   `window.ytcfg.get('INNERTUBE_CONTEXT')` as the real client context. The
   like params protobuf is videoId-templated from the captured fixture
   (`{1:{1:videoId},4:0,6:{1:timestamp,2:hash}}` for like; field3/field5
   variant for removelike) — timestamp refreshed, byte-level id swap.

### Journal

Every action appends one JSONL line to `actions.jsonl`:
`{"ts","kind","target","result":{ok,verified,already,path,error,captures}}`.
`GET /healthz` reports the last action's timestamp; `result.captures`
counts the wires the P34 recorder kept during that action's window.

## P34 — the wire-capture loop (the self-upgrading action ladder)

The house law (P33): a direct action lane ships only with a CAPTURED wire
template — never a guessed protobuf. Dislike, bell preferences,
comment-like and the feedback family still ride this broker because their
wires were never captured. P34 closes that gap with a loop:

1. **Every action window is recorded.** While any `/broker/action`
   executes, a CDP `Network` listener keeps every youtubei ACTION POST the
   page fires (the `like/`, `subscription/`, `notification/`, `comment/`,
   `feedback`, `browse/edit_playlist`, `history/`, `live_chat/` families;
   POSTs only; read noise like `next`/`player`/`browse` page loads is
   excluded by construction). Bodies the event didn't carry are fetched
   via `Network.getRequestPostData`. Captures land in `captures.jsonl`
   (one JSONL line per wire — endpoint, params body, response status, the
   action's kind/target as context). The recorder NEVER fails the action
   it observes.
2. **The operator's next natural action captures its own upgrade path.**
   The next dislike / bell / comment-like executed through WebFlix (or by
   hand in the logged-in tab while the broker is connected) writes the
   real wire into the journal.
3. **The promotion tool reads the wire — never guesses it.**
   `bun run promote [--endpoint like] [--index -1] [--json]` walks the
   captured params protobuf byte-by-byte (a generic walk), locates the
   embedded id and the unix-sec timestamp slot, and emits the `_TPL`
   fixture constant plus — when the layout matches the like family — a
   proposed `buildXxxParams` following the P33 like law (fixed-offset id
   swap + refreshed timestamp varint). The tool NEVER edits source files;
   the scaffolding goes through a reviewed lane before it joins
   `src/lib/youtube-direct.ts`, and the verification plan is stated on
   every report: the deterministic-401 wire-validity probe first, then ONE
   authenticated round-trip observed live before the direct lane ships.

## Security model

- **Shared secret** on every `/broker/*` route, compared constant-time
  (sha256 digest → `timingSafeEqual`). Missing `BROKER_SECRET` → the broker
  **refuses all actions** (fail-closed, 503) while `/healthz` stays up.
- **Localhost-only by default.** The Vercel app never talks to this port
  directly; the lead's gateway forwards server-to-server requests
  (`/api/…` routes on the app call `BROKER_URL` with `BROKER_SECRET`).
- The broker executes actions on the operator's real YouTube account — the
  account is the single-tenant "user" of live WebFlix (architecture doc).
- No secrets are ever committed: `BROKER_SECRET`, `YT_COOKIES` come from env.
