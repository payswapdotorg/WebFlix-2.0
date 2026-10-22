# P36 — live acceptance runbook

**Purpose:** the step-by-step protocol for the LIVE authenticated round-trip the P36 work order
requires — the proof that separates "the button responds" and "the backend answered 200" from
"the write persisted on the INTENDED user's YouTube account."

**Status:** the code lane is complete on `wfx2/p36-action-persistence`; the live acceptance
below is **PENDING OPERATOR CREDENTIALS** (the one thing this station cannot supply).
Until it is executed and recorded, P36 stays open: no fixture count, no green CI run, and no
deployed SHA closes it. Per the work order: *"Do not close this task on unit tests alone."*

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

**Secret-handling rule:** enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` directly in Vercel → Project Settings → Environment Variables → Production. Do not paste the client secret, a downloaded client-secret JSON file, OAuth codes, refresh/access tokens, or YouTube cookies into chat, issues, worklogs, screenshots, or Git. Set `GOOGLE_OAUTH_REDIRECT_URI` explicitly to the callback above if you want to avoid origin-derived ambiguity. Redeploy after changing Production environment variables; then confirm the `/settings` card no longer says `not-configured`.

**OAuth Testing-mode caveat:** Google's official OAuth documentation says refresh tokens for an External consent screen left in `Testing` expire after 7 days when requesting scopes beyond the basic profile/email scopes. For a temporary proof, add the dedicated test Google account under Test users and expect to re-authorize after expiry. Before inviting general users or relying on long-lived connections, review Google's current publishing/verification requirements for the requested YouTube scope and move through the appropriate verification/release process. References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Sensitive/restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
**Sanity check after deploy:** open `https://webflix-2-0-one.vercel.app/settings` signed in —
the YouTube-account card must show the **not-connected** state with the Connect link (never
a broker/direct "operator session" claim). Record the deployment SHA from the Vercel
dashboard for the evidence file.

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
