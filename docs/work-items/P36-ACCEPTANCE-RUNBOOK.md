# P36 — live acceptance runbook

**Purpose:** the step-by-step protocol for the LIVE authenticated round-trip the P36 work order
requires — the proof that separates "the button responds" and "the backend answered 200" from
"the write persisted on the INTENDED user's YouTube account."

**Status:** the code lane is complete on `wfx2/p36-action-persistence`; the OAuth credentials
are delivered, registered on the production env, and live-verified (2026-10-22 — see §0's
registration + verification record) — the live acceptance below is **PENDING THE OPERATOR'S §1
ROUND-TRIP** (the human Google login no station credential can or should replace).
Until it is executed and recorded, P36 stays open: no fixture count, no green CI run, and no
deployed SHA closes it. Per the work order: *"Do not close this task on unit tests alone."*

**Progress record (2026-10-23):** subscriptions + video likes are **VERIFIED WORKING by the
operator through the connected account** (the tester-gate fix below landed); the same-day
re-files (comment actions, reply reflection + reload ordering, embedding/preview) were
root-caused and fixed as P40-COMMENT-ACTIONS-EMBED (`f7cd13c`, deployed
`dpl_GhxsHtTqvq25PHcddz9qhjWmcybw`) and P41-PLAYER-AUTH-RUNG (the wall-hardening re-file — see
the second known-issue record in §0). What §1 still needs: the independent youtube.com-side
verification (§1.4) + unsubscribe + cleanup + the evidence file.

---

## 0. Prerequisites (operator, one-time)

1. A **Google Cloud project** with the YouTube Data API v3 enabled.
2. An **OAuth consent screen** configured for external/testing use with exactly the scope
   `https://www.googleapis.com/auth/youtube.force-ssl` (the ADR's scope-minimization law).
3. An **OAuth client** (Web application) whose authorized redirect URI is exactly:
   `https://webflix-2-0-one.vercel.app/api/connection/youtube/oauth/callback`
   (or set `GOOGLE_OAUTH_REDIRECT_URI` to override — the settings card shows the exact URI
   the app derives when it is not configured).
4. A **dedicated authorized test account** — a Google account that is NOT the operator's
   daily account and holds nothing of value. It will perform a real like and a real
   subscribe/unsubscribe. Do not use an account with a personal watch history you care about.
5. Set the Vercel env vars on the production project:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI` (only if not derivable from the request origin)
   - (`YT_TOKEN_SECRET` optional — a dedicated token-encryption secret; when unset the
   NextAuth secret is used. Rotating either secret honestly invalidates stored connections
   → the needs-reauth state.)

**Credential-type note (verified live 2026-10-22):** an *API key* (`AIzaSy…`) is NOT the OAuth client this setup needs — API keys cannot act as a user, and Google's OAuth token endpoint rejects one used as a client ID with `invalid_client`. The station live-tests any delivered credential before declaring anything. When creating the client, choose **"OAuth client ID"** — not "API key" (the latter is the default first option in the Create Credentials menu). The two values that belong in the Vercel env look like: Client ID ending in `.apps.googleusercontent.com`, Client Secret starting with `GOCSPX-`. Independently: the **YouTube Data API v3 must be enabled on the project** or every official-tier call answers `SERVICE_DISABLED` (403) even with a valid OAuth client and a connected user — if a key or call returns 403 with an activation URL, open that URL, enable the API, wait a few minutes, and retry.

**Follow-up (same day, live-verified):** the operator then delivered the actual OAuth client pair for project `165888892453` — Client ID `165888892453-tmhdi7nivgh34gucjiq4jv1e3tg7gpkv.apps.googleusercontent.com` (secret shape `GOCSPX-…`; the value lives only in the station vault and the Vercel env, never in this repo). Station live-tests, all green on Google's side: (a) the token endpoint called with the pair and a deliberately bogus authorization code answered `invalid_grant` — **not** `invalid_client` — proving BOTH the client ID and the secret authenticate (Google passed client auth and rejected only the code); (b) the authorize endpoint, called with the exact production redirect URI above, returned **HTTP 200 rendering Google's sign-in page** — the redirect URI is registered on the client (an unregistered one answers `Error 400: redirect_uri_mismatch`); (c) the YouTube Data API v3 is now **enabled** in the project — the earlier diagnostic API key's `SERVICE_DISABLED` answer changed to `API_KEY_SERVICE_BLOCKED`, a key-scoped restriction that does not gate the OAuth Bearer lane.

**§1 progress (operator-reported 2026-10-23, after the tester-gate fix):** subscriptions and video likes now WORK through the connected account — the §1 happy path's core rungs (connect → like → read-back → subscribe) are passing live. The operator's same-day re-files (comment actions, reply reflection + reload ordering, embedding) were root-caused and fixed as lane **P40-COMMENT-ACTIONS-EMBED** (merged `f7cd13c`, deployed `dpl_GhxsHtTqvq25PHcddz9qhjWmcybw`, live-verified on production): (1) like/edit/delete/restore on one's OWN WebFlix-stored comments are now store-backed (`local:true`, honest counts, ownership law) — liking YOUTUBE comments stays the honest 501 (no official API; the toast says so); (2) the reply-to-a-reply silent client-side drop is fixed and local replies stay reachable after reload via the parentId child merge; (3) the playback chain is MUXED-FIRST (an audioless IOS answer no longer captures it — ANDROID's muxed itag-18 is the measured winning cell), so an embed-walled browser gets an AUDIBLE native fallback whenever any muxed-bearing cell answers its egress; (4) the comments cache soft TTL is 15 min for reload-order stability. What §1 still needs: the independent youtube.com-side verification of the like/subscribe state + the unsubscribe + cleanup rungs (§1 steps 4–8) and the evidence file.

**Registration + verification record (station-executed, 2026-10-22T22:31–22:34Z):** the operator re-delivered a Vercel API token (the one lost in the sandbox rollback — vault re-stocked), and the station completed the last env step itself: `GOOGLE_CLIENT_ID` (plain), `GOOGLE_CLIENT_SECRET` (encrypted), and `GOOGLE_OAUTH_REDIRECT_URI` (plain, pinned to the callback above) were created on the `webflix-2-0` project's **Production** target via the Vercel API (project env 15 → 18 vars), then a production deployment was created from `main` @ `22ad85b` (deployment `dpl_Cdh1RpoUFiGSPfRPKeNwy99efpxS`, READY 2026-10-22T22:33:24Z, no alias error). Live verification on the production alias, with a signed-in probe WebFlix account: (1) `GET /api/connection/youtube` → `status:"not-connected"`, `oauth.configured:true`, `missingEnv:[]`, the correct redirectUri — the not-configured state is GONE; (2) `GET /api/connection/youtube/oauth/start` (browser accept) → **303 to accounts.google.com** carrying the exact client_id, the registered redirect_uri, `scope=youtube.force-ssl`, `access_type=offline`, `prompt=consent`, a signed state param, and the `wf_yt_oauth_state` httpOnly cookie — and following it, **Google answers HTTP 200** with its sign-in page; (3) the action-tier ladder flipped exactly as P38 specified: `POST /api/videos/{id}/like` → `403 {"kind":"youtube-not-connected"}` (the connect ask — now a *possible* errand), `GET /api/subscriptions` + `GET /api/playlists` → `oauthConfigured:true` with the honest connect notices. **What remains is §1 only:** the live authenticated round-trip with the operator's dedicated test Google account (connect → like → read-back → subscribe/unsubscribe → cleanup) — the one step that requires the operator's human Google login, which no station credential can or should replace.

**Secret-handling rule:** enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` directly in Vercel → Project Settings → Environment Variables → Production. Do not paste the client secret, a downloaded client-secret JSON file, OAuth codes, refresh/access tokens, or YouTube cookies into chat, issues, worklogs, screenshots, or Git. Set `GOOGLE_OAUTH_REDIRECT_URI` explicitly to the callback above if you want to avoid origin-derived ambiguity. Redeploy after changing Production environment variables; then confirm the `/settings` card no longer says `not-configured`.

**OAuth Testing-mode caveat:** Google's official OAuth documentation says refresh tokens for an External consent screen left in `Testing` expire after 7 days when requesting scopes beyond the basic profile/email scopes. For a temporary proof, add the dedicated test Google account under Test users and expect to re-authorize after expiry. Before inviting general users or relying on long-lived connections, review Google's current publishing/verification requirements for the requested YouTube scope and move through the appropriate verification/release process. References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Sensitive/restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

**Known-issue record — the Google tester gate ("Access blocked… Error 403: access_denied", first live §1 connect attempt, 2026-10-23, operator-reported):** the operator reached Google's consent screen — proof the app-side handoff is exactly right (the request carried this runbook's verified client ID, the registered redirect URI, `scope=youtube.force-ssl`, `access_type=offline`, `prompt=consent`, and the signed state) — and Google refused with *"…has not completed the Google verification process. The app is currently being tested, and can only be accessed by developer-approved testers."* Root cause: the consent screen's publishing status is **Testing** and the Google account signed in during consent is **not on the project's Test users list** — Google-side account gating, not an app defect (station re-probed production the same day: both `/api/connection/youtube` endpoints still answer the honest `401 unauthenticated` to anonymous callers, exactly as the per-user auth design requires; nothing regressed app-side). **Fix (operator, Google Cloud Console, ~2 minutes):** sign in as the project owner → select project `165888892453` → *APIs & Services → OAuth consent screen* (newer console: *Google Auth Platform → Audience*) → **Test users → + Add users** → add the exact email of the Google account used in the Connect flow (the dedicated test account; the owner's own account must be added too if it is also used — project ownership does NOT imply tester access) → Save → allow a few minutes for propagation → retry Settings → YouTube → Connect. The testing-mode consent screen then shows the "unverified app" notices — the honest Testing-status presentation, not a new failure. Publishing to production (removing the tester gate and the 7-day refresh-token law for the general public) requires the verification/brand review for the sensitive YouTube scope per the caveat above; the right posture for §1 remains Testing + the dedicated test account.

**Sanity check after deploy:** open `https://webflix-2-0-one.vercel.app/settings` signed in —
the YouTube-account card must show the **not-connected** state with the Connect link (never
a broker/direct "operator session" claim). Record the deployment SHA from the Vercel
dashboard for the evidence file.

**Known-issue record — the wall-hardening regression ("video embedding and preview… have been broken", operator-reported 2026-10-23 after the P40 deploy):** the operator's report was NOT caused by the actions work — the player/preview client code is byte-unchanged across the whole P36..P40 window (git-proven). YouTube's bot wall hardened across 2026-10-20..23 on BOTH axes (station-measured 2026-10-23): (1) the protected/trending class now answers `LOGIN_REQUIRED` to **every anonymous innertube client** (WEB/IOS/ANDROID/ANDROID_VR/MWEB/TVHTML5) from datacenter egresses — 10/10 home-feed videos, from BOTH the station and production's Vercel egress (only the watch-page HTML rung still answers OK from Vercel); (2) the watch-page rung's plain itag-18 URLs carry the WEB client's scrambled `n` query param, and googlevideo now answers **403 to the untransformed `n` even from the same invocation** that minted the URL (the stream route 502'd 10/10 feed videos; P31's 2026-10-20 era streamed these same URLs 4/4 — the enforcement hardened from throttle to hard 403). Net effect: the anonymous native playback lane (hover previews + the watch-page fallback player) died for the whole feed class, coincident with the actions window. **Fix (P41-PLAYER-AUTH-RUNG, station-executed 2026-10-23):** (a) **the per-user OAuth player rung** — the wall's own "Sign in to confirm you're not a bot" demand now answered through the P36 spine: when the acting user has a connected YouTube account, the playback chain runs an authenticated ANDROID/ANDROID_VR/IOS `player` ladder with `Authorization: Bearer <their token>` and merges the user's own n-free formats on top of the anonymous answer under a per-user cache key (the shared anonymous row never carries authed fuel — the isolation law, test-pinned); anonymous callers are byte-identical to before; (b) **the n-scrambled URL filter** — watch-page/broker URLs carrying a standalone `n` param are presumptively-dead fuel and are dropped honestly (storyboards survive; a doomed native boot never arms). **Operator verification steps (2 minutes, on the deployed build, signed in + connected):** hover a video box on the home grid ~2s → the box should PLAY the video (the muted preview, youtube.com-style); open a trending watch page → if the embed is walled the native fallback should now play with audio. If a box shows the honest "Preview unavailable" pill instead, note the video title — that is the residual per-video lottery class, not the regression.

## 1. The happy-path round-trip (the core proof)

Perform on the deployed production app, signed in as a WebFlix user with the test account
connected:

1. **Connect:** Settings → YouTube account → Connect → complete Google consent as the test
   account. Expected: back on `/settings?ytc=connected`, the card shows the test account's
   own channel identity.
2. **Like:** open a known, harmless, high-traffic video (e.g. a Blender Foundation open
   movie), click Like. Expected: no error toast; the like holds.
3. **Reload the watch page.** Expected: the like button still shows liked — this is the
   acting user's own `videos.getRating` state, not a cached count and not the operator's.
4. **Independent verification (the step that makes it proof):** in a separate browser/incognito
   where the test account is signed in at youtube.com, open the same video and confirm the
   Like control shows **liked for that account**. (Or call
   `GET https://www.googleapis.com/youtube/v3/videos/getRating?id=<videoId>` with the test
   account's OAuth token — the same call the app makes.)
5. **Subscribe:** subscribe to the chosen test channel from its page. Reload the page → still
   subscribed. Verify at youtube.com in the same account (or `subscriptions.list?mine=true`).
6. **Unsubscribe:** unsubscribe, reload → unsubscribed. Verify the channel is gone from the
   account's subscriptions at youtube.com.
7. **Second device/session check:** sign the SAME test YouTube account into a different
   WebFlix user (or just re-read from an incognito WebFlix session after reconnecting) —
   not required for acceptance; the two-user isolation is pinned by the test battery.
8. **Cleanup:** remove the like (toggle to unliked), leave the account unsubscribed; confirm
   both reversals independently the same way.

**Record per step (the evidence file, no tokens/cookies/personal data):** UTC timestamp,
anonymized account label (e.g. `wfx2-test-account-01`), the provider response class
(e.g. `videos.rate 204`, `getRating → like`, `subscriptions.insert 200`), the read-back
result the app reported (`verified:true`), the reload outcome, and the deployment SHA.

## 2. The failure-state ladder (production, each must fail HONESTLY)

| State | How to produce | Expected (all on the deployed SHA) |
|---|---|---|
| No connected account | signed-in WebFlix user, never connected | 403 `{error, kind:"youtube-not-connected"}`; the UI shows the connect prompt; **zero YouTube-side calls** |
| Revoked consent | disconnect in Settings, or revoke at myaccount.google.com/permissions | 403 `youtube-needs-reauth` after the first honest failure; the card flips to needs-reauth; re-connect works |
| Expired/invalid grant | wait out the access token with a deleted refresh token (or rotate `YT_TOKEN_SECRET`) | the honest needs-reauth state — never another user's identity, never a silent success |
| Quota / rate limit | (naturally, on a shared project) | 502 `youtube-quota` with the honest message — never fake success |
| Unsupported operation | any bell preference, history write, playlist reorder, community post, live-chat send, comment moderation, upload execute | 501 `youtube-unsupported` with the handoff copy — no write attempted |

Also confirm the **unconfigured** state (before step 0.5 is applied): the settings card shows
not-configured with the exact missing env names and the redirect URI to register; every write
route answers `youtube-not-connected`.

## 3. The gates on the exact merged SHA

- `bun run lint` → 0 errors (1 pre-existing tolerated warning).
- `bun run typecheck` → 0 errors.
- `bun run test` → the full 8-suite battery **0 fail** (boot 857 / watch 675 / liveshorts 150 /
  cutover 111 / auth 133 / community 35 / notifications 41 / p36 129 at the time of writing).
- These are **fixture gates** — they prove contracts and isolation, NOT live persistence.
  The release acceptance for P36 is complete only when §1's evidence file exists alongside
  them, per the work order's law: separate fixture-only results from live authenticated proof.

## 4. Evidence file

Check the record into the repo as `evidence/wfx2p36/live-acceptance.md` (or the operator's
chosen equivalent), containing the §1 table + the §2 ladder results + the deployment SHA +
the date. Anonymize: no tokens, no cookies, no refresh tokens, no personal channel data
beyond the anonymized label. The ADR (§4) and this runbook then close together.
