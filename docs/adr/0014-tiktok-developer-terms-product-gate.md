# ADR 0014 — TikTok Developer Terms product gate, LIVE provider boundary, and data policy for the main-interface wave

Date: 2026-11-08
Status: Accepted (this ADR records POLICY decisions; two provisions inside it are explicitly OPERATOR-GATED and stay closed until the operator acts — see D1 and D2)
Context: WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1 (docs/plans/work-orders/WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1.md, issue #5), base `81a853c`.
Supersedes: nothing. Extends ADR 0004 (TikTok embed policy), ADR 0012 (LIVE parity layer), ADR 0013 (Shorts source boundary) with the legal/product/cost gates the work order requires before any further capability work.

## Context

The product ambition is to make WebFlix a primary TikTok interface. Three external facts now bound that ambition:

1. **TikTok's Developer Terms contain a competition restriction.** The current TikTok Developer Terms of Service restrict using TikTok Developer Services or TikTok Information to "compete with or replicate" TikTok Services (with a stated exception for the Data Portability API). A Display-API-derived feed inside a product positioned as a primary TikTok interface is exactly the intersection this clause governs. This ADR records no legal conclusion — it records a LAUNCH GATE and who must clear it.
2. **The Display API is narrow.** Its documented `video.list` surface returns a consenting, authorized creator's own recent public videos. It is not a global For You/Following feed, and it requires developer-product approval plus per-user granted scopes.
3. **The LIVE lane's unofficial provider is dead AND unapproved.** The P103-measured outage (`403 platform-feature-disabled` — the provider account's monthly free credit exhausted) kills the status actor today, and the P100 research itself labels the Apify-actor paths unofficial/ToS-gray. TikTok publishes no official general LIVE status API.

## Decisions

**D1 — The product/legal launch gate (OPERATOR-GATED, closed).**
No Display-API-derived TikTok feed is enabled, and no surface markets WebFlix as a TikTok replacement, until the operator obtains a written interpretation or approval from TikTok (or a documented operator decision of equivalent weight) that this specific use is permitted. The record must capture: the exact clause relied on, the product use proposed, the approval/response verbatim or the operator's documented interpretation, and the date. If permission is NOT obtained, the API lane stays disabled and the existing experience continues under its accepted policy (D3). M3 code may be prepared behind a disabled feature flag, but production use stays OFF. This gate is separate from TikTok's app/scope approval: scope approval does NOT resolve this gate.

**D2 — The LIVE provider boundary (OPERATOR-GATED, closed).**
Until the operator explicitly approves the exact provider, actor, terms, data handling, budget and limits: no actor runs are launched or retried, no credit is purchased, no new provider is wired. Exhausted/disabled provider errors keep the live route's circuit open; the product answers "unavailable/disabled" (the honest human sentence), never "everyone offline", never a silent retry loop, never a stale badge presented as current. Reactivation is a separate operator-approved action with explicit budget controls (per-run/per-day caps, max handles, TTL floors, in-flight dedupe, operator-visible spend counters, kill switch, safe default-off).

**D3 — What remains permitted while the gates are closed (the standing lanes).**
The existing experience continues unchanged and is the wave's baseline to protect:
- the official TikTok Embed Player in-app (ADR 0004 — viewer-browser-side, no media-byte extraction/proxy/rewriting);
- keyless oEmbed metadata through the source-adapter seams;
- canonical-URL imports with DB persistence, dedupe and private-by-default owner visibility (the M2 curator rules);
- the manual profile-link lane, always labeled UNVERIFIED;
- WebFlix-native watch-party chat only where a real room context exists.
No TikTok-native likes/comments/follows/gifts/DMs/LIVE-chat writes are claimed or rendered.

**D4 — Identity semantics (frozen).**
`profile_link` (manual) is an UNVERIFIED user claim — never rendered as ownership. Only a successful TikTok OAuth grant (code exchange + token validation) sets `mode: "oauth"`, which is the provider-authorized state. Disconnect/revoke immediately disables token use and stops any scheduled sync.

**D5 — Content consent, provenance, retention (frozen principles).**
Content provenance is three-way separated: originally curated posts; user-pasted imports (owner/visibility rules per the M2 law); Display-API-authorized creator videos (bound to the authorizing user's grant). Newly synced authorized content defaults to the creator's PRIVATE WebFlix collection until the user explicitly chooses visibility. API-derived profile/video records are deleted or suppressed on disconnect per the recorded retention decision; expiring signed cover URLs are refreshed through documented endpoints, never stored as permanent assets.

**D6 — Cost policy.**
The money gate stays CLOSED. Zero Apify spend, zero paid-API spend, no gifts/payments/tips/creator-payout/wallet surfaces in this wave. Any future provider spend requires D2's explicit budget controls before the first paid call.

## Consequences

- M3 (OAuth + Display API) is BLOCKED, not shipped, until D1's record exists and TikTok approves the app/scopes; prepared code stays behind a disabled flag.
- M2's LIVE work is policy/honesty work (failure states, circuit breaker, stale labeling), not provider reactivation; reactivation is operator-gated.
- M1's deployment and playback proof proceed without any of these gates — they use only the standing lanes and operator-provisioned deploy credentials.
- The operator actions currently outstanding: re-seed `VERCEL_TOKEN` (deploy path — the in-sandbox vault loss of 2026-11-08), the D1 legal interpretation/approval, the D2 provider/budget decision.
