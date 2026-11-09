# WFX2 — G2 Supported-Network TikTok VOD Playback Proof

**Work-order ID:** WFX2-G2-SUPPORTED-NETWORK-PLAYBACK-PROOF-1  
**Date:** 2026-11-09  
**Pinned repository base:** `main @ e0c8c63efb5d58214a0c89d5697cd1a1fd7ed89c`  
**Pinned production build:** `1dda689106b6013153d68d3e81bc601f7e661848` (recorded READY deployment in the `tepa` team project)  
**Related work order:** [WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1](./WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1.md), §4 M1  
**Status:** handoff only; this document does not claim that playback has been demonstrated.

---

## 0. Mission

Close exactly one gate: **G2 — prove that real public TikTok VOD posts play in WebFlix through TikTok's official Embed Player from a viewer network on which TikTok serves the player.**

The current standing record proves production deployment, route health, browser layout and honest degradation. It does not prove successful TikTok playback. In particular:

- `POST /api/tiktok/player-events → 400` proves that the telemetry route exists and rejects an invalid event; it is not a playback result.
- An iframe mount, an HTTP 200, a player shell, or an `onPlayerReady` event alone is not successful playback.
- A browser walk that reaches an honest unavailable/error state is useful reliability evidence, not VOD playback proof.

This task is a **measurement and evidence wave**, not a TikTok feature expansion. Do not modify product behavior merely to make this test appear green. If the measurement exposes a code defect, preserve the failing evidence and ask the TL to create a separately scoped, red-first fix.

## 1. Frozen boundaries

1. Use the existing official TikTok Embed Player. Do not use unofficial stream actors, Apify, scraped endpoints, private APIs, browser cookies, proxying, DNS tricks, video-byte extraction, media downloads, or watermark-removal paths.
2. Do not enable or call the TikTok LIVE provider. D2 remains CLOSED / operator-gated. Zero actor runs and zero TikTok-lane spend remain mandatory.
3. Do not request new TikTok OAuth scopes, activate Display API `video.list`, change creator authorization, or alter user/account data.
4. Do not deploy, reassign domains, or rotate/change production environment values in this task. The tested production build is the recorded `1dda689` deployment. A docs commit or route response is not a deployment.
5. Do not start general feature development. Keep the feature-expansion freeze in place.
6. Never record cookies, authorization headers, tokens, signed URLs, account identifiers, viewer IP addresses, or other secrets/personal network identifiers in committed evidence.

## 2. Fresh preflight — TL owns

Before sending the browser runs:

1. Verify `origin/main` is still `e0c8c63efb5d58214a0c89d5697cd1a1fd7ed89c` or record the new exact SHA and explain the delta. Check a clean checkout and `docs/plans/wave-claims.md`.
2. Verify through the authorized Vercel project/deployment API that the target production project is the `tepa` team's `webflix-2-0`, and that the deployment under test is READY at the pinned SHA `1dda689`. Record deployment ID, deployment URL, production alias mapping and query time; do not trust the repository homepage field or old `webflix-2-0-one` alias without independently proving the mapping.
3. The recorded deployment hostname is `webflix-2-0-8m3rhrp2k-tepa.vercel.app`. Re-check it at test time rather than assuming the alias has not changed. Do not deploy this docs branch. The Vercel status on the current docs commit reported `Account is blocked`; do not treat that status as a reason to alter the current production deployment or to claim this evidence branch is deployed.
4. Inspect the existing player implementation, the M1 player-event route, the event schema, and current tests. Record exact file/line references and confirm which existing messages identify iframe mount, player ready, playing state and current-time progression.
5. Select two real public TikTok VOD post URLs. Record their public post IDs and creator handles in evidence. Do not use private, age-restricted, deleted, or region-restricted test content if a suitable public sample is available.

**Preflight stop:** if the production deployment is no longer the pinned build, or the correct project/domain cannot be established, stop and record BLOCKED. Do not silently switch to a personal Vercel project, preview URL or stale alias.

## 3. Supported-network execution

The previous runs were region-walled in their available sandbox: TikTok redirected the player to an `/hk/about` landing page. G2 requires a real viewer run from a network where TikTok actually serves the official embed player.

1. Use an operator-provided or independently operated viewer device/network known to load TikTok's official public embed. Do not attempt to defeat a network or regional restriction with proxies, scraped routes, private endpoints, or media extraction.
2. Record only the country/region at a coarse level, network class (for example residential broadband or mobile), browser and OS versions, and whether the official TikTok site/embed is reachable. Do not record the viewer's IP address, exact location, subscriber details or account credentials.
3. Open the exact production domain verified in §2. Test at least:
   - desktop: current Chromium-based browser, 1280×800 or 1440×900;
   - mobile: real iOS Safari or Android Chrome device at a documented viewport.
   Browser emulation may supplement a real mobile device but does not replace it.
4. Use the two selected public TikTok posts. For each post, record the event sequence:
   - official iframe mounted, with the expected TikTok embed origin;
   - official player ready;
   - player reports playing state (`onStateChange = 1`, or the exact documented equivalent found in source);
   - current-time values advance over at least five seconds;
   - visible video frames change during that interval (capture a short screen recording or timestamped screenshots).
5. Navigate from post A to post B and verify:
   - post A is paused or unmounted before post B becomes active;
   - no more than one active TikTok iframe exists at any point;
   - post B independently reaches ready + playing + time/frame progression;
   - the prior slide cannot continue audible playback.
6. Test the hidden-tab pause/resume lifecycle and mute behavior using ordinary user interaction. Record actual outcomes; do not infer success from UI state alone.
7. Repeat the essential two-post playback and single-active-player checks on mobile. Record any platform-specific limitation as a result, not as a pass.

### Minimum proof per post

A post is PASS only when all of the following are captured:

- real public post ID and exact deployed SHA;
- official embed iframe origin and mounted state;
- player-ready event;
- playing-state event;
- monotonically advancing current-time samples over at least five seconds;
- visible frames changing over the same interval;
- no second active iframe or competing playback.

If the embed exposes no usable current-time event, do not silently weaken the standard. TL must document the exact protocol limitation and get an explicit operator acceptance of an alternate independent frame-progression measurement before calling G2 passed.

## 4. Failure classification

Use only these terminal outcomes:

- **PASS:** every minimum proof item succeeds for both real posts on desktop and mobile, and the active-player lifecycle passes.
- **PARTIAL:** playback is proven on one platform or one post, but the full matrix is incomplete. State exactly what passed and what remains.
- **BLOCKED — NETWORK:** TikTok does not serve the official player on the available network, including a redirect to an informational/about page or a region-wall response. Record sanitized evidence and the exact external action needed: an operator/independent viewer must run this same test from a supported network.
- **BLOCKED — DEPLOYMENT:** intended project, production alias or deployed SHA cannot be verified.
- **FAIL — PLAYER:** the official player is served, but it does not reach playing state, time/frame progression fails, player switching leaves concurrent playback, or an uncaught application error occurs.
- **FAIL — INSTRUMENTATION:** code cannot distinguish mount, ready, playing and progression reliably. Preserve the failure; do not fabricate player events.

A failure/blocked result is a valid work-order completion. Do not call a blocked run a success and do not conceal a failure behind a green route probe.

## 5. Team and file ownership

Use TL + three workers where available. The TL freezes claims before dispatch and owns final classification.

| Owner | Assignment | Exclusive evidence ownership |
|---|---|---|
| TL | Pin baseline/deployment, freeze test contract, review source and evidence, integrate final result and update WORKLOG/wave claims | `WORKLOG.md`, `docs/plans/wave-claims.md`, final `evidence/.../g2/EVIDENCE.md` |
| Worker A | Execute the two-post desktop playback run on the supported viewer network | `evidence/wfx2-tiktok-main-interface-reliability/g2/desktop/` |
| Worker B | Source-audit the player event protocol and independently classify the telemetry evidence; read-only unless TL authorizes a separate fix | `evidence/wfx2-tiktok-main-interface-reliability/g2/protocol/` |
| Worker C | Execute/coordinate the real mobile browser run and verify player switching, hidden-tab and mute lifecycle | `evidence/wfx2-tiktok-main-interface-reliability/g2/mobile/` |

Do not give workers overlapping source-file ownership. If code changes become necessary, stop this evidence wave, record the failing assertion and ask TL to create a separate issue/branch with explicit file ownership.

## 6. Evidence contract

Required final file:

`evidence/wfx2-tiktok-main-interface-reliability/g2/EVIDENCE.md`

Include:

- pinned main SHA, tested production SHA, deployment ID, exact deployment URL and verified production alias;
- test date/time (UTC), coarse region/network class, browser/OS/device and viewport;
- two public post IDs and handles (no private account details);
- exact event sequence with timestamps and current-time samples;
- visible-frame proof (sanitized short recording or timestamped screenshots);
- active iframe counts before/after navigation and hidden-tab behavior;
- exact commands, automation/scripts, exit codes, logs and hashes where applicable;
- PASS/PARTIAL/BLOCKED/FAIL classification for every platform and post;
- all deviations, errors and remaining operator action.

Never commit cookies, HAR files containing credentials, full browser profiles, session storage, authorization headers, private user data or raw network identifiers. Sanitize traces before commit. If raw recordings are too large or privacy-sensitive, store only a redacted short clip or timestamped stills and document how the operator can inspect the original locally.

Update `docs/plans/wave-claims.md` and `WORKLOG.md` only after the evidence exists. Every PASS claim must point to the evidence file and tested commit. A local-only result is not a production claim.

## 7. Acceptance and exit

G2 is CLOSED only when:

1. the intended production project/domain and deployed SHA are independently verified;
2. two real public TikTok VOD posts play through the official Embed Player on desktop and a real mobile browser;
3. each post reaches player-ready and playing state with at least five seconds of current-time and visible-frame progression;
4. switching posts never leaves more than one active TikTok iframe or audible playback;
5. the result and sanitized evidence are committed on `origin/main`.

If a supported-network viewer cannot be arranged, G2 remains BLOCKED — NETWORK, and the evidence must name the exact operator action required. **Do not proceed to M3 or unfreeze feature expansion because this work order exists.** D2, G4/D1, the money gate and all prior operator/legal restrictions remain unchanged.

---

## 8. Explicit non-goals

- No TikTok LIVE provider recovery or actor spend.
- No unofficial TikTok stream player or stream URL handling.
- No OAuth/Display API activation or new scopes.
- No global FYP, Following feed, hashtag/sound discovery or TikTok write actions.
- No YouTube changes.
- No deployment, domain change or production environment mutation.
- No product-feature expansion.
