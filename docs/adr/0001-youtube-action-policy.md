# ADR 0001 — YouTube action policy: per-user official OAuth, honest outcomes, no shared-operator writes

- **Status:** accepted (2026-10-21, lane WFX2-P36-ACTION-PERSISTENCE)
- **Context:** docs/work-items/P36-ACTION-PERSISTENCE.md (the reviewer's work order — the external TL progress review that found the action system "not yet accepted as working reliably")
- **Supersedes:** the P33-DIRECT-ACTIONS doctrine ("the app's own server-side session performs the everyday writes") and the P34 broker write tier, **for end-user mutations**

## 1. The decision

1. **Every externally-mutating user action acts on the signed-in WebFlix user's OWN YouTube account**, bound through the official Google OAuth 2.0 server-side flow (scope `youtube.force-ssl`, offline access, refresh-token rotation), with the connection stored per user (`wf:yt:conn:<userId>`, tokens AES-256-GCM-encrypted at rest, never logged, never sent to the browser).
2. **Writes go through the supported YouTube Data API v3 endpoints only** — `videos.rate`, `subscriptions.insert/delete`, `playlists.insert/update/delete`, `playlistItems.insert/delete` — each followed by its **authenticated read-back** (`videos.getRating`, `subscriptions.list(mine)`, `playlistItems.list`) whose result is reported as `verified`. A 2xx alone is never a success claim.
3. **No production action path uses the deployment-wide operator `YT_COOKIES` or the shared CDP broker tab for end-user writes.** `src/lib/watch/action-proxy.ts` imports neither `@/lib/broker` nor `@/lib/youtube-direct` — the isolation is structural, not configurational. The broker mini-service remains in-repo as operator tooling (its P34 capture pipeline); it is out of the user action path.
4. **Operations the official API does not support are honestly local or honestly unsupported, never simulated:**

| Operation | Lane | Why |
| --- | --- | --- |
| Like / dislike / remove rating | **official** (`videos.rate` + `videos.getRating` read-back) | supported |
| Subscribe / unsubscribe | **official** (`subscriptions.insert/delete` + `subscriptions.list` read-back) | supported |
| Save to own playlists, playlist create/rename/privacy/delete | **official** (`playlistItems.*`, `playlists.*` with membership read-back) | supported |
| Watch later (WL) | **WebFlix-local list** (disclosed `local:true`) | WL is a YouTube system playlist the Data API cannot write |
| Comments / replies on other channels' videos | **WebFlix-local store** (disclosed `local:true`) | `commentThreads.insert` only works on the channel's own videos |
| Not interested / don't-recommend-channel (+ undo) | **WebFlix-local signal** (disclosed) | no end-user API |
| Bell preferences, history writes, playlist reorder, community posts, live-chat send, comment like/edit/delete/heart/pin/report, uploads | **honest 501 unsupported + handoff to YouTube** | no end-user API; uploads' official `videos.insert` lane is future work |

5. **Per-user state (ratings, subscription state, watch-later, shorts yourLike) is read with the acting user's own token and overlaid per request.** The shared cached `next`/shorts payloads carry **no per-user state** — the pre-P36 design baked the operator session's like/subscribe state into shared caches and served it to every signed-in user (the cross-user leak the work order's isolation law closes).

## 2. The compliance assessment (the work order's required review)

- **YouTube API Terms of Service / Developer Policies:** WebFlix now performs user mutations only through the documented Data API with per-user OAuth — the supported integration path. The retired alternatives (reverse-engineered private InnerTube write endpoints driven by a replayed operator cookie; a shared logged-in browser tab driven over CDP) are exactly the "automated access outside permitted cases" class the Terms restrict; they are removed from every end-user path.
- **Sufficient independent value / "recreating core YouTube UX":** the reviewer's flag on the README's "feature-for-feature clone" positioning is accepted. The README now positions WebFlix as a **study/parity project with its own interface, its own local lanes (accounts, local comments, local watch-later, feed signals, local domain), and per-user authorized actions through the official API** — not a replacement for youtube.com. Where the official API offers no path, WebFlix **hands off to YouTube** instead of replicating the behavior by private means. A formal compliance audit/guidance pass (if the operator wishes to operate beyond personal/study use) remains an operator action item — this ADR records the engineering posture, not legal advice.
- **Scope minimization:** the OAuth request asks for exactly `https://www.googleapis.com/auth/youtube.force-ssl` — the narrowest scope covering rate/getRating/subscriptions/playlists.
- **Quota (honest limits, surfaced in-product):** default 10,000 units/day; a rate/subscribe/playlist write ≈ 50 units, each read-back 1. Quota exhaustion surfaces as the typed `youtube-quota` failure, never as fake success.

## 3. Security posture

- OAuth client secret + all tokens server-side only; the browser never sees a token.
- CSRF: signed `{uid, nonce, exp}` state, double-submit with a short-lived httpOnly cookie, session-bound at the callback.
- Tokens at rest: AES-256-GCM (`YT_TOKEN_SECRET`, falling back to the NextAuth secret so dev/tests run env-clean); rotating the secret honestly invalidates connections → the re-connect state.
- Revocation: disconnect revokes at Google first (best-effort) then deletes the record; a revoked/expired grant surfaces as `needs-reauth` (flipped on the first honest failure) and every write route refuses to act as anyone else.
- The five previously-ungated mutating routes (video comments, the community-post family) are gated; the browser-bundle broker call (live-chat send, which could never legitimately hold `BROKER_SECRET`) is replaced by the honest unsupported result.

## 4. Live acceptance status (honest)

The code lane is complete and deployed; **the live authenticated round-trip (a real like + subscribe from the deployed app, independently verified in the same YouTube account, surviving reload) requires the operator to provide Google Cloud OAuth credentials** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` + the registered redirect URI). Until that env is set, the settings card honestly renders the `not-configured` state with the exact setup steps, and every action route answers the typed `youtube-not-connected` envelope — never a silent failure and never the operator's identity. The step-by-step protocol: `docs/work-items/P36-ACCEPTANCE-RUNBOOK.md`.

## 5. Consequences

- The P33 "main interface" doctrine narrows honestly: WebFlix remains the interface for every action the official API supports, discloses the local lanes, and hands off the unsupported few to YouTube.
- Personal feed surfaces (subscriptions channels, playlists) are per-user official reads; history/liked/combined-feed surfaces render honest notices (no official API) instead of one operator's data served to everyone.
- Future lanes (candidates): the official `videos.insert` upload lane; comment moderation for one's own channel via the official endpoints.

## 6. Addendum — WFX2-P41: the user's own OAuth credential on the innertube `player` READ (2026-10-23)

**Context.** The playback chain (`src/lib/youtube/streams.ts`) has always read the innertube
`player` endpoint ANONYMOUSLY (the same read surface the app's search/feed/watch-metadata
reads already use — the ADR's sanctioned read family). Across 2026-10-20..23 YouTube's bot
wall hardened such that the protected content class answers `LOGIN_REQUIRED` to every
anonymous `player` client from datacenter egresses, and the remaining watch-page rung's URLs
carry the `n` parameter googlevideo now rejects untransformed — the anonymous native playback
lane died for the feed class (the operator's "embedding and preview broken" re-file;
measurements in the lane record and the runbook's known-issue entry).

**The lane.** When the acting user has a connected account, the chain additionally requests
`player` with `Authorization: Bearer <the user's own access token>` over the
ANDROID/ANDROID_VR/IOS client shapes (the wall's own "Sign in to confirm you're not a bot"
demand, answered with the credential the user themselves granted). The result is merged
per-user under `yt:playback:auth:<userId>:<videoId>` — never into any shared cache row.

**The policy reading.** This is a READ of the same endpoint the app already consumes
anonymously, performed with the user's own explicitly-consented OAuth credential, for the
user's own playback, scoped to `youtube.force-ssl` exactly as consented, with no write, no
scraping of third-party data, and no credential ever leaving the server. It is the same
"act as the user's own client" posture the official Data API actions already take — applied
to the read surface that must carry it when anonymous reads are walled. It is NOT the
retired cookie-replay/CDP-broker write lane class (no operator identity, no session replay,
no third user's data). If Google refuses the token on this surface (scope class), the rung
degrades honestly to the anonymous answer and a short-lived refusal sticky keeps the cost at
zero — the app never fabricates playback.

**The honest residual.** Whether Google's innertube surface accepts the `youtube.force-ssl`
token from production's egress (and whether authentication clears the datacenter wall for
protected content) is verifiable only with a real connected account on the deployed build —
the runbook §0 carries the operator verification steps. The station's fake-bearer probe
(2026-10-23) established only that the endpoint parses the header (Google's own 401
auth-layer rejection, distinct from the anonymous wall).
