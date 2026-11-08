# WFX2 — TikTok Main-Interface Reliability & Authorized Content Wave

**Work-order ID:** WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1  
**Date:** 2026-11-08  
**Pinned base:** `main @ 81a853cb6a7e3aa42f0e5987ad2080a0dc683f6c`  
**Prior implementation:** M0/M1 `eb4b1f00`; M2 `2c6734f`; M3 `e88e78a`; P94 `0615239`; P96 `b632e77`; current P103-mini-6 head is the pinned base above.  
**Related issue:** #3 — WFX2 first-class Shorts integration  
**Status:** handoff only; implementation has not begun on this branch.

---

## 0. Mission and definition

Turn the already-landed TikTok experience into a **reliable, supportable, evidence-proven TikTok experience inside WebFlix**, without representing unsupported TikTok capabilities as working.

The previous waves have already delivered the shared Shorts feed, official TikTok Embed Player, URL imports, private/public collection rules, creator pages, source-aware local actions, home/search shelves, and an in-app LIVE product. Do not rebuild those foundations.

This wave closes the operational and capability gaps that remain:

1. Restore a controlled production release path and prove that deployed code is the code in `main`.
2. Prove real TikTok VOD playback in a viewer browser, not merely that an iframe mounted.
3. Resolve the LIVE provider outage and the compliance/cost policy for unofficial providers.
4. Finish the official TikTok Login Kit + Display API path **only to the extent that TikTok approval, user consent, and the product's permitted use allow it**.
5. Make verified OAuth ownership, manual profile linking, and imported/authorized video provenance unambiguous.

**Do not claim that WebFlix reproduces TikTok's global For You/Following experience.** The Display API's documented `video.list` surface is a consenting creator's own recent public videos; it is not global discovery or a For You feed. Do not promise TikTok likes, comments, follows, gifts, DMs, or TikTok LIVE chat writes/reads unless a documented, approved integration actually provides them.

### Important product/legal gate

The current TikTok Developer Terms include a restriction on using TikTok Developer Services or TikTok Information to "compete with or replicate" TikTok Services (with an exception stated for Data Portability API). Because the product ambition is to make WebFlix a primary TikTok interface, **do not enable a Display-API-derived TikTok feed or market it as a TikTok replacement until the operator obtains a written interpretation/approval that this use is permitted**. This is a launch gate, not a legal conclusion by the TL. Record the exact clause, the product use proposed, the approval/response, and the operator's decision in the repo. If permission is not obtained, keep the API lane disabled and retain the existing official-embed/import/creator-companion experience under its accepted policy.

Official terms: https://t.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en

---

## 1. Source-of-truth rules

- The repository is the only source of truth. Do not treat chat, agent recollections, green-check summaries, or a previous TL's claims as proof.
- Start from the pinned `main` SHA above. Verify `origin/main`, local HEAD, branch cleanliness, and the current contents of `docs/plans/wave-claims.md` before dispatch.
- Read the prior work orders, ADRs, research reports, current source, tests, CI, deploy metadata, and evidence. In particular:
  - `docs/adr/0004-tiktok-embed-policy.md`
  - `docs/adr/0012-live-tiktok-parity-layer.md`
  - `docs/adr/0013-shorts-source-boundary.md`
  - `docs/research/2026-11-04-tiktok-main-interface-gap-report.md`
  - `docs/research/2026-11-05-p95-remaining-gaps-closure-report.md`
  - `docs/research/2026-11-05-p96-profile-playback-and-the-dialog-eject-report.md`
  - `docs/research/2026-11-05-p98-signed-in-walk-report.md`
  - `docs/research/2026-11-07-p100-tiktok-live-in-app-report.md`
  - `docs/research/2026-11-07-p102-live-playback-navigation-report.md`
  - `evidence/wfx2-tiktok-shorts-experience/m1/EVIDENCE.md`
  - `evidence/wfx2-tiktok-shorts-experience/m3/EVIDENCE.md`
  - `evidence/wfx2-tiktok-shorts-experience/M5-production/README.md`
- Reconcile the latest `WORKLOG.md` and `docs/plans/wave-claims.md` with commits actually present on `origin/main`. Correct any inaccurate commit/SHA attribution; do not erase history.
- The latest head reports a lost/unrecoverable in-sandbox Vercel token vault and says deployments are blocked until the operator re-seeds `VERCEL_TOKEN`. Treat this as an observed blocker, re-check it; never search for, print, commit, or fabricate a secret. The latest reports also say the production deployment has not advanced with the newest `main` commits.
- The reported latest baseline is 3,129 passing tests, TypeScript 0, ESLint 0, and the walk self-test 16/16. These are **reported baseline figures**, not permission to skip a fresh clean-clone run. Capture the real baseline before changes.

---

## 2. Current state and known gaps

### Delivered foundations — preserve them

- ADR 0013 shared Shorts shell with separate YouTube/TikTok adapters.
- TikTok's official Embed Player in the active 9:16 slide lifecycle; cursor paging, deep-link splice, source selection, URL persistence, active-player pause/unmount and honest error states.
- M2 canonical URL import with DB persistence, dedupe, private-by-default saves, owner-only visibility changes and removal.
- M3 local save/hide/share/report, home/search shelves, creator-scoped playback and creator-page links.
- P94 derived TikTok creator pages, manual profile-link lane, OAuth routes/store, iframe sandboxing and inline guest gates.
- P96 creator-scoped feed and inline guest gate for import dialog.
- P100/P102 LIVE status, HLS playback ladder, live board/navigation, and WebFlix-native watch-party chat.
- P103-mini honest provider failure mapping, backoff/failure visibility and quota TTL control.

Do not regress YouTube. Keep TikTok/YouTube DTOs, API routes, player protocols and action semantics isolated.

### P0 — deployment and playback proof

The M1 evidence proves player mount, slide navigation, one-iframe behavior and timeout handling, but it explicitly says this sandbox was redirected to TikTok's `/hk/about` landing page and could not prove a successful playback. M5 later proves the deployed iframe and player switching, but the reviewed evidence does not show an actual TikTok `onPlayerReady` followed by `onStateChange=1` (playing) with visible frames.

The latest main commit records that a new deploy was deferred because the in-sandbox Vercel credential vault was unrecoverable. The previous M5 deployment notes name a different deployment/domain lineage from the stale canonical aliases. Verify the live truth; do not infer the active domain from README text.

### P0 — LIVE provider outage and policy

P103 reports the status actor now returns `403 platform-feature-disabled` after exhausting its $5 free credit; the recorded price was approximately $0.0042 per answered creator. Increasing the cache TTL reduces future spend but cannot restore a disabled/exhausted account. The product must not silently retry, hammer the actor, report everyone offline, or continue advertising live status as healthy.

P100/P102 depend on third-party Apify actors for unofficial status/stream data. The P100 report itself labels some paths unofficial/ToS-gray and records that TikTok has no official general LIVE API. The actor's data collection, actor creator, privacy handling, provider contract, TikTok policy and company spend must be reviewed before any renewed spend or production activation. No legal conclusion is presumed.

### P1 — official account and content integration

Current `src/lib/tiktok/oauth.ts` requests `user.info.basic,user.info.profile`, exchanges Login Kit authorization codes and reads user info. It does not request `video.list`, implement `POST /v2/video/list/`, paginate a creator's video list, or refresh/synchronize those videos. The manual profile link is explicitly unverified and must remain distinct from OAuth-authorized ownership.

TikTok's current Display API onboarding documentation says the developer needs approval for Login Kit and TikTok API products, the app needs `user.info.basic` and `video.list`, and each user must consent to the scopes. The API provides a creator's own recent public videos, not a global feed. TikTok also documents expiring `cover_image_url` values and refresh through `video/query`.

Official references (re-check before implementation; do not rely on stale snippets):
- Display API Get Started: https://developers.tiktok.com/docs/en/display-api-get-started
- Display API Overview: https://developers.tiktok.com/docs/en/display-api-overview
- Scope Overview: https://developers.tiktok.com/docs/en/scopes-overview
- Scope Reference: https://developers.tiktok.com/docs/en/tiktok-api-scopes
- Login Kit token lifecycle: https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens
- TikTok Developer Terms: https://t.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en
- Apify General Terms: https://docs.apify.com/legal/general-terms-and-conditions
- Apify Actor Terms: https://docs.apify.com/legal/actor-terms-and-conditions

---

## 3. Team model and disjoint ownership

**TL + 3 workers.** The TL owns M0, frozen contracts, ADR updates, integration, code review, deployment decision, acceptance and all final source-of-truth updates. Do not let workers edit the same file families.

| Owner | Lane | Exclusive primary ownership |
|---|---|---|
| TL | M0 contract/policy + integration/release | `docs/adr/*`, `docs/plans/wave-claims.md`, `WORKLOG.md`, integration points, final evidence review |
| Worker A | M1 deployment and VOD playback proof | `scripts/ops/*`, deployment runbook/evidence, TikTok player instrumentation/tests only if separately assigned by TL |
| Worker B | M3 OAuth + Display API | `src/lib/tiktok/oauth.ts`, TikTok OAuth route family, TikTok connection store/types/hooks/settings, Display API service/routes/tests, related Prisma changes |
| Worker C | M2 LIVE provider policy/resilience | `src/lib/tiktok/live*.ts`, LIVE API routes/hooks/views/tests, LIVE-specific ops evidence and provider documentation |

Before dispatch, TL must pin exact files and branch ownership in `docs/plans/wave-claims.md`. If a shared integration file is needed, TL alone edits it after workers deliver. No overlapping edits and no silent cherry-picks from unverified branches.

---

## 4. Milestones

### M0 — fresh audit, policy decisions, and freeze

1. Verify exact main SHA and clean checkout; enumerate unmerged branches/PRs and latest commits. The previous docs-only PR #4 is not implementation proof.
2. Run the clean-clone baseline: install per repo lockfile; typecheck; lint; TikTok-focused tests; full battery; production probes. Capture exact commands, exit codes and log paths.
3. Reconcile the production project/scope, deployed SHA, domain aliases, and credential status using authorized Vercel/GitHub surfaces. Do not use or disclose secret values.
4. Add a short ADR/addendum for:
   - the product/legal gate on using TikTok Developer Services to build a primary/replica TikTok interface;
   - the approved boundary for the Apify LIVE actors, if any;
   - what remains permitted when either gate is not approved;
   - user consent, provider provenance, retention/deletion and cost policy.
5. No new Apify actor runs, no credit purchase, no new API scopes, no deployment or domain reassignment without operator authorization. Existing read-only verification is allowed.
6. Freeze the following contracts before workers code:
   - player event telemetry required to prove actual playback;
   - LIVE provider disabled/degraded/circuit-open DTOs;
   - OAuth identity state: `profile_link` is unverified; `oauth` is provider-authorized;
   - exact required/optional scopes and per-scope feature availability;
   - Display API DTO and provenance model;
   - disconnect/revoke/delete semantics;
   - feed composition order and the existing M2 private/public curator rules.

**M0 exit:** source-verified gap register, explicit decision record for each operator/legal gate, fresh test baseline, worker claims and exact file ownership committed.

### M1 — deploy truth and actual VOD playback proof (P0)

**Deployment**
1. Re-establish the release path using an operator-provisioned Vercel credential. If the credential is still absent, mark the deployment task BLOCKED with the exact missing operator action; continue code/test work without pretending to deploy.
2. Verify the exact Vercel project/team/scope and target custom domain. Reconcile the stable deployment domain, aliases and legacy `webflix-2-0-one.vercel.app` / `webflix-2-0.vercel.app` lineage. Do not silently reassign a domain.
3. Deploy the reviewed main SHA only after build, DB migration/schema review and all gates. Record deployment ID, provider-reported Git SHA, READY status, URL, and domain mapping. Confirm the deployed commit equals the reviewed SHA.
4. Verify the previous deployment remains available for rollback. Do not include tokens or environment values in logs/evidence.

**Playback**
1. Instrument/verify the official player protocol so evidence distinguishes `iframe-mounted`, `onPlayerReady`, `onStateChange=1`, `onCurrentTime` advancement and a visible playing frame. Do not treat iframe count or HTTP 200 as playback.
2. Use at least two real public TikTok posts; prove first playback, next-post transition, previous-player pause/unmount, hidden-tab pause, mute behavior and error recovery.
3. Test from a TikTok-served viewer network, and from the known geo-walled network if available. Record browser, OS, region/network, viewport, deployed SHA, post IDs, player messages, frame/time progression, active iframe count and screenshots/video. Redact all cookies/tokens.
4. If TikTok still region-walls the available test network, record M1 as **BLOCKED on external network proof**, not passed. Arrange an operator/independent viewer test on a supported network; no video-byte extraction or proxy workaround.

**M1 exit:** deployment provenance proven for the intended domain and at least one real post reaches the official player's playing state with time/frame progression. Desktop and mobile navigation retain exactly one active TikTok iframe. If operator access or external network is missing, keep the blocker visible and do not call the release fully accepted.

### M2 — LIVE outage, cost controls and policy closure (P0)

1. Audit the current status and playback actor IDs, input contracts, actual provider responses, account quota/credit state, and current production environment flags. No test should spend live credits.
2. Write a provider decision table covering official TikTok APIs (no general LIVE status/chat API found in prior research), the existing Apify actors, alternatives, reliability, ToS/policy, privacy, data retention, latency and price per handle/run.
3. Review Apify General Terms, Actor Terms, the exact community actor's privacy policy/data handling and the TikTok terms/policies applicable to the observed collection. Do not assume Apify's platform terms authorize the actor's underlying source collection. Record evidence and obtain an operator/legal decision.
4. Until the provider and budget are explicitly approved:
   - do not launch or retry actor runs;
   - keep the live route's circuit breaker open for exhausted/disabled provider errors;
   - ensure one failed provider attempt cannot be scheduled repeatedly by concurrent requests or polling;
   - expose a clear unavailable/disabled state, not an offline result;
   - preserve the WebFlix-native watch-party chat only where a real room context exists;
   - do not show stale LIVE badges as current without a clearly labeled stale timestamp;
   - do not claim TikTok-native chat, gifts or comments.
5. If a provider is approved, implement explicit budget controls: per-run/per-day caps, max handles, TTL floors, in-flight dedupe, error backoff, circuit-open duration, operator-visible spend/usage counters, a kill switch and a safe default-off state. Never let a viewer request cause unbounded paid probes.
6. Add fixture-driven tests for 401/403/quota-exhausted, actor timeout, malformed/default-creator result, missing stream URL, provider recovery, concurrent requests, circuit break/re-open, budget cap and stale-data labeling. Preserve P103 human-readable error mapping and P103-mini board failure law.
7. If no approved provider is available, update UI/ADR/ops docs so LIVE is clearly unavailable or limited to a manually/consented known-creator lane; don't present it as a live discovery product.

**M2 exit:** policy/budget decision recorded; no accidental spend; all failure states honest and tested. Provider reactivation is a separate operator-approved action.

### M3 — official TikTok OAuth + Display API, gated (P1)

**Must not activate before M0's legal/product gate and TikTok app/scope approval.** Code and tests may be prepared behind a disabled feature flag only if the TL's recorded review determines that is appropriate. Production use remains OFF until approval and user consent.

1. Inspect the entire existing OAuth route, callback, token store, connection type, settings UI and tests. Treat the current manual `profile_link` as unverified; only a successful TikTok OAuth grant can set `mode: "oauth"` / verified connected identity.
2. Align the consent request to the minimum approved scopes required for the chosen features. Display API recent-video reads require `video.list` and `user.info.basic`; request `user.info.profile` only for fields actually needed and approved. Do not request `user.info.stats`, `video.publish`, `video.manage`, or other scopes unless a separate approved product requirement exists.
3. Read returned scopes and enable features only for scopes actually granted. Partial consent is a supported state: a connected identity without `video.list` must not be represented as having synced videos.
4. Implement documented `POST /v2/video/list/` with cursor pagination and defensive mapping of `id`, title/description, duration, cover URL and permitted embed/share metadata. Use the official TikTok player already in the feed; never download, extract, proxy or rewrite TikTok media bytes.
5. Implement `video.query` cover refresh because TikTok documents expiring cover URLs. Cache within documented/approved limits and avoid retaining stale signed cover URLs as permanent assets.
6. Implement token refresh using the documented refresh-token flow, expiry handling, refresh-token rotation, encrypted server-side persistence, revocation/needs-reauth and retry/backoff. Never expose tokens to browser bundles, client logs or reports.
7. Define a clear content-consent switch for a creator's imported videos. Default newly synced content to the creator's private WebFlix collection until the user explicitly makes a selection/public collection. Do not turn all posts into global WebFlix inventory by default.
8. Choose a persistence/provenance model that separates:
   - original curated posts;
   - user-pasted imports and their owner/visibility rules;
   - Display-API-authorized creator videos and the authorizing WebFlix user/grant.
   Do not overload the unique `TikTokImport.postId` row in a way that loses source, ownership, consent or revocation semantics. Keep SQLite/Postgres schemas in parity.
9. Disconnect/revoke must immediately disable token use and stop scheduled sync. Delete or suppress API-derived profile/video records in accordance with TikTok's terms, privacy policy and the recorded retention decision; do not imply manual profile-link rows are deleted/verified as OAuth.
10. Add a self-service "Sync my recent TikToks" journey on the linked creator page/settings. Show sync time, scope status, count of imported public videos, private/public WebFlix visibility, and a clear disconnect/delete action. Keep the global/For You feed limitation explicit.

**M3 exit:** approved app + scopes + test user grant, real token exchange, real user info, paginated real `video.list` response, refresh path, revoked/partial-scope path, private-by-default sync and delete/disconnect behavior all verified. Without operator credentials/app approval/legal clearance, M3 code stays gated and is reported BLOCKED, not shipped.

### M4 — library/onboarding and UX integration (P1)

1. Improve Add TikTok onboarding so the difference between paste-import, manual profile link and verified OAuth sync is obvious.
2. Make the TikTok creator page show the provenance of the content it aggregates; never fabricate follower counts, likes, badges, bio, sound metadata or recommendation ranking.
3. Make the source switch, creator scope, home/search shelf and profile CTA preserve the intended source/creator context and browser back/reload behavior.
4. Test guest, signed-in unverified-profile, signed-in OAuth-connected and revoked/partial-scope states separately.
5. Audit every TikTok action label. "Save", "hide", "share", "report on TikTok", "open on TikTok", "connected", "verified" must describe the real action/state. No inert buttons and no fake provider writes.

### M5 — release, regression and production verification

- Run typecheck, lint, TikTok-focused suite, full test battery and production audit from a clean checkout. Record exact values; no inferred test totals.
- Preserve the shared Shorts shell and YouTube behavior. Re-run YouTube feed, watch, channel, source switch and LIVE regression lanes.
- Browser matrix: 375x812 and 390x844 mobile; 1280x800 and 1440x900 desktop; Chromium plus a real iOS Safari/Android Chrome viewer run where available.
- Verify no horizontal overflow, no console/page errors, one active TikTok VOD iframe, keyboard/touch navigation, source/creator URL state, reconnect/disconnect, API timeout states and accurate UI provenance.
- Production checks must pin deployed SHA and use the intended domain. A Vercel READY deployment alone is not a successful TikTok playback proof.
- Update `docs/plans/wave-claims.md`, `WORKLOG.md`, ADRs and evidence. Every ledger-referenced commit must be an ancestor of `origin/main`; no local-only completion is called shipped.
- Keep the money gate closed. No gifts, payment, tips, creator payouts or wallet surfaces in this wave.

---

## 5. Tests and evidence contract

Required evidence location:

`evidence/wfx2-tiktok-main-interface-reliability/<milestone>/`

Each milestone must include an `EVIDENCE.md` containing:

- pinned base and tested commit SHA;
- exact command and exit code;
- exact test counts and lane names;
- browser/OS/viewport/network/region;
- exact production domain and deployed SHA (if applicable);
- routes and user journey exercised;
- player protocol states and frame/time progression for playback claims;
- provider request count and cost evidence for any approved LIVE provider;
- expected vs actual outcome, screenshots and sanitized logs;
- explicit blockers and operator actions still required.

**Evidence rules**
- Tests with mocked TikTok, Apify or DB responses prove mapping/state-machine behavior only; they do not prove provider availability.
- A mounted iframe does not prove video playback.
- A connected manual profile link does not prove account ownership.
- A green build does not prove production deploy.
- A production page 200 does not prove that the intended commit is deployed.
- A LIVE API 200 with `probing:true` does not prove a LIVE room exists.
- Never put credentials, cookies, authorization codes, access/refresh tokens, signed CDN URLs or personal test-account secrets into the repository.

---

## 6. Acceptance matrix

| Gate | Required proof | Failure answer |
|---|---|---|
| Base integrity | clean checkout, exact pinned SHA, work claims frozen | BLOCKED; do not dispatch overlapping work |
| Deployment | operator-provisioned credential, READY deployment, deployed SHA == reviewed SHA, intended domain verified | operator-gated; don't claim deployed |
| VOD playback | real official player ready + playing state + current-time/frame progression on two real posts | network/player blocker; no extraction/proxy workaround |
| Active-player lifecycle | one TikTok iframe only, previous player paused/unmounted after navigation | fail |
| YouTube regression | existing YouTube Shorts/feed/player/action tests and browser journey unchanged | fail |
| LIVE provider | legal/product decision + budget cap + circuit breaker + honest unavailable behavior | OFF by default |
| OAuth identity | real OAuth grant establishes verified link; manual link remains explicitly unverified | fail |
| Display API | approved `video.list` scope + user consent + paginated real response + refresh + expiry/revoke handling | feature stays disabled |
| Content privacy | authorized creator controls visibility; no automatic public exposure; provenance present | fail |
| Disconnect | tokens disabled/deleted; scheduled sync stops; retained data follows approved retention policy | fail |
| Mobile/desktop | specified viewport matrix, zero horizontal overflow, no console/page errors | fail |
| Repo truth | ADR/claims/worklog/evidence refer only to commits on origin/main | fail |

---

## 7. Non-goals and prohibited shortcuts

- Do not scrape TikTok HTML, reverse-engineer private endpoints, reuse TikTok cookies, call undocumented endpoints, download video bytes, remove watermarks, proxy media, or use "no watermark" services.
- Do not turn the Display API into a global For You feed. It is a consenting user's own public-video API.
- Do not invent follower/like counts, verified badges, sound pages, hashtags or algorithmic ranking from oEmbed/import rows.
- Do not enable Apify spend or a new provider before the operator approves the exact provider, actor, terms, data handling, budget and limits.
- Do not make OAuth scope approval imply the developer-terms product-use gate is resolved.
- Do not merge a code path that is presented as active while its required secrets, approval, provider credit, or external playback proof is absent.
- Do not modify YouTube feed behavior to make TikTok work.
- Do not touch the money gate.

---

## 8. TL completion report format

The final TL report must state, separately:

1. **Code landed:** commit SHA(s), files, PR, branch, actual changes.
2. **Tests:** commands, exit codes, actual counts, regression comparisons.
3. **Browser proof:** real vs mocked; browser/network/viewport; playback state and time progression.
4. **Production:** project/scope/domain/deployment ID/deployed SHA, or the precise operator blocker.
5. **Policy:** exact TikTok developer-terms interpretation/approval state and Apify/provider decision; link evidence, don't paraphrase approval.
6. **OAuth/API:** app approval, requested scopes, actually granted scopes, whether user authorized, real video-list proof, token refresh/revoke.
7. **LIVE:** actor runs and costs (zero unless approved), failure state, circuit breaker and fallback.
8. **Remaining gates:** operator action vs code defect vs unsupported-by-provider capability.
9. **Source-of-truth updates:** wave claims, WORKLOG, ADR, evidence, all pushed to `origin/main`.

A milestone is not SHIPPED merely because code and unit tests exist. Use BLOCKED / PARTIAL / SHIPPED / LIVE-VERIFIED precisely.
