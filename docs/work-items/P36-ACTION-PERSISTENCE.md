# P36 — prove and fix YouTube action persistence per user

**Priority:** P0 / production correctness and account isolation  
**Status:** P36 implementation merged and deployed; live authenticated release acceptance remains OPEN pending secure Google OAuth configuration and the real-user round-trip  
**Reported:** 2026-10-21 — production actions such as Subscribe and Like do not reliably persist at youtube.com  
**Production alias:** https://webflix-2-0-one.vercel.app  
**Tracking issue:** see the repository issue titled “P36: Make YouTube actions persist on the intended user's account”

## Current status — verified 2026-10-22

- **P36 code is implemented:** merge commit [890b161](https://github.com/payswapdotorg/WebFlix-2.0/commit/890b161bd967b4c20595574fbc5d6990d2a8b61e) introduced the per-user Google OAuth spine, encrypted per-user token storage, official YouTube Data API mutation/read-back adapter, removal of shared operator-cookie/broker writes from the user-action path, honest unsupported/local capability handling, and the two-user isolation test battery.
- **Deployment:** Vercel reports the production alias `webflix-2-0-one.vercel.app` is READY on source SHA [132659d](https://github.com/payswapdotorg/WebFlix-2.0/commit/132659d6728c2c4c6abb4a1a106fb048cd0d437e), which includes P36 and the later P37–P39 merges. Deployment identity is independently checked; this review connection could not read Vercel environment values or runtime logs.
- **P38 truthfulness fix:** the current ledger reports that the deployment is missing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Therefore official-tier YouTube actions are intentionally blocked with a deployment-not-configured response, rather than falsely claiming success or using another user's/operator's identity.
- **P39 is separate:** its verified change fixes the titles/channel names in the WebFlix-local Watch-later list. The TL's production test of local saves does not prove that YouTube Like/Subscribe writes work.
- **Still OPEN:** no checked-in `evidence/wfx2p36/live-acceptance.md` was found in the work described so far, and the live acceptance runbook remains pending. The required proof is a real OAuth connection by a dedicated test user, Like + Subscribe/Unsubscribe via the deployed app, independent same-account YouTube read-back, then reload and verification. Do not close this task based on the fixture gate alone.
- **Credential safety:** never paste `GOOGLE_CLIENT_SECRET`, access tokens, refresh tokens, cookies, or OAuth client-secret files into this chat or a GitHub issue. Configure credentials directly in the Vercel project's Production environment variables, then redeploy and verify the deployment's status card. The non-secret Client ID should also be configured there so the whole setup is reproducible.
## Original review findings (before P36 landed)

1. The Vercel production alias currently resolves to a READY deployment of `payswapdotorg/WebFlix-2.0` at source SHA `b00ebf7c0b1e421b4033a54e3aa90f7340620d04` (P35-LIKE-STATE), rather than an older P33/P34 build. Deployment metadata is available; Vercel runtime logs/environment inspection returned 403, so this review could not independently inspect live action request logs or secret-variable presence.
2. `src/lib/youtube-direct.ts` reads `process.env.YT_COOKIES` as a singleton operator/session cookie. `docs/ops/vercel-env.md` explicitly describes this as the operator's YouTube session. `directAuthConfigured()` only tests whether the cookie string contains SAPISID; it does not prove the session is fresh, that a write changed state, or that it belongs to the current WebFlix user.
3. `src/app/api/videos/[id]/like/route.ts`, `src/app/api/subscribe/route.ts`, and `src/app/api/subscriptions/route.ts` gate requests with `getSessionUser(req)`, which is WebFlix application login. The write functions then act through the global `YT_COOKIES` or a separate CDP browser behind `youtube-broker`; there is no evidenced binding from the WebFlix user to their own Google/YouTube OAuth identity.
4. The direct Like path in `src/lib/youtube-direct.ts` treats an HTTP 2xx from the private `youtubei/v1/like/like` / `like/removelike` endpoint as success without independently verifying the authenticated rating read-back. Direct Subscribe similarly returns success on HTTP 2xx. `proxySubscribe` treats that result as authoritative; the proxy helper does not require broker `verified === true` before accepting a successful broker response.
5. `tests/action-routes.test.ts` mocks the direct client and broker; these tests verify route control flow but do not prove a real YouTube-side write. The P35 work log explicitly says its +25 tests are fixture-only/no live network, and notes broker-only mode (no `YT_COOKIES`) still reads a public response whose state is INDIFFERENT after a write. Therefore P35's passing test count is not a live persistence proof.
6. P35 did improve the Like read-back, cache invalidation, and cold-start retry behavior. Those are useful correctness fixes, but the reported production symptom remains unresolved until a real authenticated write and same-account re-read are evidenced.

## Required architectural decision

**Production mutations must not depend on one deployment-wide operator cookie or one shared logged-in broker tab.** Each WebFlix user must explicitly connect and authorize their own Google/YouTube account, with the provider identity bound to the WebFlix user who initiated the action.

Prefer the documented YouTube Data API OAuth flow for operations it supports. Initial candidates:
- Video rating: `videos.rate` with the user's authorized OAuth token and a supported scope.
- Rating read-back: `videos.getRating` to verify the authenticated user's state (not the aggregate like count).
- Subscribe/unsubscribe: `subscriptions.insert` / `subscriptions.delete`, with the subscription ID obtained from the authenticated user's `subscriptions.list` data where needed.

Official references:
- https://developers.google.com/youtube/data/guides/auth/server-side-web-apps
- https://developers.google.com/youtube/v3/docs/videos/rate
- https://developers.google.com/youtube/v3/docs/videos/getRating
- https://developers.google.com/youtube/v3/docs/subscriptions/insert
- https://developers.google.com/youtube/v3/docs/subscriptions/delete
- https://developers.google.com/youtube/v3/docs/subscriptions/list

The exact required scopes, quota impact, app verification, and operation availability must be checked against current official documentation before implementation. If an operation is not supported or authorized, surface that limitation and a clear handoff to YouTube; do not simulate success. Do not use reverse-engineered/private InnerTube endpoints, spoofed client details, shared browser cookies, or the operator broker as a production multi-user write mechanism. Current YouTube Terms restrict automated access except permitted cases, and Developer Policies prohibit recreating core YouTube UX without sufficient independent value; record a compliance assessment and obtain a compliance audit/guidance where needed before expanding the clone-like action surface.

## Work order

### P36-A — account/auth contract audit (TL2, read-only first)
- Trace app login, connected YouTube accounts, cookie/token storage, session lifetimes, OAuth callback/refresh/revoke paths, API routes and UI state.
- Prove whether any per-user Google OAuth/token/account binding exists today. Do not infer that app sign-in is YouTube authorization.
- Inventory every externally mutating action: Like/remove rating, Subscribe/unsubscribe, notification bell, comments/replies/likes, watch-later, playlists, history changes, feedback and creator/studio actions. Classify each as official-API supported, needs explicit policy/compliance review, or unsupported.
- Return a source-cited verdict and identify the smallest secure, policy-aligned path.

### P36-B — official per-user write/read-back lane
- Implement per-user OAuth with state/CSRF protection, narrowly required scopes and secure server-side token storage; refresh and revoke correctly; never send tokens to the browser or log them.
- Bind every write to the exact authenticated WebFlix user and their connected YouTube account. Reject missing/expired/revoked/mismatched account scopes; never fall back to another user's identity.
- Replace optimistic “HTTP 2xx means persisted” semantics with typed write outcome plus official authenticated read-back when the API provides it. Report success only when the operation returns a valid response and state can be confirmed; otherwise surface pending/unknown/failure honestly.
- The UI must either display confirmed state, show a pending verification status, or restore prior state with a useful error. Do not quietly claim success if the operation is blocked.
- Cache invalidation must be scoped to the relevant user/account and video/channel where appropriate. No shared cache can leak one user's private rating/subscription state to another.

### P36-C — regression and live acceptance
- Add unit/contract tests using the official API adapter seam, covering success, malformed 2xx bodies, 400/401/403/quota responses, timeout, token refresh/revocation, unknown read-back, duplicates, and idempotent retry.
- Add two-user isolation tests: actions and read-backs for account A must never be executed/read as account B; no global `YT_COOKIES` or broker session participates in the production mutation path.
- Use a dedicated authorized test account. From the deployed candidate, perform one harmless like/rating operation on a known video and a test subscribe/unsubscribe to a chosen public channel; independently verify them in that same account on youtube.com; reload WebFlix, re-read through the authorized path, verify state remains consistent, then clean up the test actions. Record timestamps, anonymized account identifier, provider response/status, read-back result and deployment SHA without exposing tokens/cookies or personal account data.
- Exercise the same failure states on production: no connected account, revoked consent, missing scope, expired token, quota/rate limit and unsupported operation. Each must fail honestly and must not silently act as the operator.
- Run the repository's full lint/typecheck/test and deployment acceptance gates on the exact merged SHA. Separate fixture-only results from live authenticated proof.

## Release acceptance (all required)

- [ ] The user-facing YouTube account is explicitly connected with OAuth; app login alone is not considered YouTube authorization.
- [ ] Like and Subscribe operations write to the initiating user's own account, verified with official supported APIs or an approved integration.
- [ ] Independent read-back confirms both operations after success and after a page/app reload.
- [ ] No production action path can use a shared operator `YT_COOKIES` or shared CDP broker tab for end-user writes.
- [ ] Success is never inferred from UI optimism or HTTP 2xx alone without validating the response contract; failures and unknown state are visible and recoverable.
- [ ] Two-account isolation, revocation, scope and quota tests pass.
- [ ] Deployment source SHA is known; live authenticated tests passed against that exact deployed SHA, with evidence checked into the repo.
- [ ] Current YouTube Terms / Developer Policies and sufficient-independent-value requirements are reviewed and the compliant supported scope recorded in an ADR/provider policy doc.
- [ ] Unsupported or policy-uncertain operations are disabled or handed off to YouTube; no private-endpoint/cookie-replay workaround is used.

## Honest current status

P35 is deployed and its fixture gate is reported as 2020/0 with a clean TypeScript check and one pre-existing lint warning. That does not prove production YouTube persistence. Per-user authorization, live authenticated confirmation of production Like/Subscribe, and runtime diagnosis remain **UNVERIFIED**. Do not close this task on unit tests alone.
