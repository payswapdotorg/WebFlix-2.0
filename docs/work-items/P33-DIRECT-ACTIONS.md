# P33-DIRECT-ACTIONS — the main-interface doctrine (the app's own session performs the everyday writes)

**Date:** 2026-10-21
**Branch:** `wfx2/p33-direct-actions`
**Dispatch (verbatim):** "my youtube sessions are read only which means I can't perform any action / remember, if we aim to become the main interface for youtube.com, we can't require users to go back to youtube.com before they can like, comment, etc. / currently my settings in webflix are showing, the message below, let's find a way to fix this: Disconnected — actions are unavailable / …The WebFlix connected session isn't reachable right now — either its browser isn't running or the YouTube tab isn't open."

## The problem

Every everyday write (like, dislike, subscribe, comment, watch-later,
playlist-add) executed through the **Session Broker** — a CDP-driven
logged-in youtube.com tab in a separate browser (port 3055). With the broker
down (the operator's exact settings card), the app was read-only. The
doctrine the operator stated is correct: a main interface cannot require the
old interface to be open in another tab.

## The measured way out (already in the codebase)

- `subscription/subscribe` + `unsubscribe` were VERIFIED server-side in the
  §16/§17 era: cookie auth + the classic SAPISIDHASH Authorization header.
- `comment/create_comment` (+ the reply params) joined as the direct rung of
  the WFX2-P6-CR three-rung chain.
- The broker's own executor carried the verified page-context fetch wires:
  the like/removelike params templates (the captured fixture bytes) and the
  browse/edit_playlist action shapes.

## The deliverables

1. **`src/lib/youtube-direct.ts`** (additive):
   - `buildLikeParams(videoId, remove, now?)` — the captured templates,
     byte-exact port of the broker's `buildLikeParams` (videoId at offset 4,
     ts varint refreshed at bytes 20-24, base64 with URL-encoded padding).
   - `rateVideo(videoId, "like" | "none")` — POST `like/like` |
     `like/removelike`, the subscribe-lane header law (SAPISIDHASH + Cookie +
     X-Goog-AuthUser + the WEB client context). Honest `direct-not-configured`
     / `direct-like-unavailable` failures (the caller's fallback signals).
   - `editPlaylistMembership(playlistId, videoId, want)` — POST
     `browse/edit_playlist` with `ACTION_ADD_VIDEO`/`ACTION_REMOVE_VIDEO`
     (the broker's verified wire: addedVideoId/removedVideoId + videoId).
   - `playlistContains(playlistId, videoId)` — the fresh UNCACHED membership
     read (browse VL…, ≤4 continuation pages, honest null on failure/depth).
   - **The honest gap:** `like/dislike` has no captured wire template — NOT
     implemented (never a guessed protobuf); dislike stays broker-tier.

2. **`src/lib/watch/action-proxy.ts`** (re-pointed):
   - `proxyVideoLike`: like/remove-rating DIRECT-FIRST (the legacy
     toggle-off resolves from the UI's own baseline — one direct `none`
     call, no second trip); dislike → broker (documented); direct failure →
     the honest broker fallback.
   - `proxyWatchLater`: ensure-modes direct-first; toggle inverts the fresh
     membership read; unresolved membership → broker honestly.
   - `proxyPlaylistAdd`: the same law for real playlist ids.
   - Subscribe/comment already direct-first — untouched.

3. **The connection surface** (direct-first truth):
   - `GET /api/connection/youtube` answers `mode: "direct"|"broker"|"none"`.
     Direct mode's `sessionServed` is the LIVE verdict of an
     `account/account_menu` probe through the P22-B served-detection (the
     public variant carries zero account rows) — a configured session
     YouTube won't serve is the honest "needs attention" state. The broker
     sub-probe (`broker: {connected, tabFound}`) rides along for the card's
     honest note about the few broker-tier actions left.
   - `connection-client.ts` carries `mode`/`sessionServed`/`broker` through
     the normalizer (a pre-P33 answer degrades to its old truth).
   - The settings card: the doctrine copy ("actions run through WebFlix's
     server-side YouTube session — …you never have to go back to
     youtube.com to act"), the direct/broker/none/needs-attention states,
     and the no-session copy that says what actually restores actions.

## The gates

- **1995/0** (base 1965 + 30):
  - action-routes: the like family re-pinned direct-first (+8 — the
    ZERO-broker-call pin, the direct-fail fallback, the unconfigured
    fallback, the baseline toggle-off, the dislike no-wire pin, the
    both-down honest 502, the re-pinned broker-tier pins), the watch-later
    battery (+6 — ensure add/remove, both toggles, the edit-fail fallback).
  - youtube-direct: +19 — the template bytes (the like/remove markers, the
    videoId swap, the ts decode), the rateVideo/editPlaylistMembership wire
    shapes (endpoint, SAPISIDHASH, Cookie, body), the honest failures, the
    membership page-walking (contains/miss/continuation/budget/failure).
  - settings-system: the four card states re-pinned (+ the route's 3
    direct-tier pins: served / public-variant / probe-failure).
- lint 0 errors / 1 pre-existing warning; tsc clean.

## The live verification matrix (honest)

- **The wire probe** (real egress, unauthenticated — zero side effects):
  like/like with the templated params → deterministic **401 "You must be
  signed in to perform this operation"** (the wire is VALID; only the
  session is missing); the videoId swap proven on a second id; the
  broker-era ts-refresh accepted; edit_playlist's ACTION_ADD_VIDEO shape →
  200; the first-round 400s were a cold-client transient. See
  `evidence/wfx2p33/wire-probe.txt`.
- **The dev ladder** (:3105, PUBLIC MODE): the honest mode:"none" envelope;
  the honest 502s on like/watch-later; the settings card renders the
  doctrine copy live; Retry re-probes; zero console/page errors. See
  `evidence/wfx2p33/ladder-smoke.txt` + `ladder-connection-card.png`.
- **The station's honest limit:** no YT_COOKIES material exists on this
  sandbox (the session lives in the production env) — the auth'd proof of
  the direct tier is the operator's own next like/comment/subscribe on the
  deployed build, riding the exact SAPISIDHASH law the subscribe lane
  verified live (§16/§17).

## The follow-ups (honest, non-blocking)

- A live capture of the `like/dislike` params template closes the dislike
  gap (the field-2-varint hypothesis stays UNVERIFIED until then).
- Bell preferences (`subscription/subscription_preference`) and comment-like
  (`comment/perform_comment_action`) need their captured wires before they
  can leave the broker tier.
- A production re-probe of the settings card (public mode + the operator's
  authenticated view) is the standing post-merge step.
