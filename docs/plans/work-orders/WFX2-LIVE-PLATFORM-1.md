# Final TL Handoff — WFX2-LIVE-PLATFORM-1: Build WebFlix LIVE

**Status:** READY FOR IMPLEMENTATION  
**Date:** 2026-10-29  
**Owner:** WebFlix 2.0 TL  
**Repository:** https://github.com/payswapdotorg/WebFlix-2.0  
**Research/report:** [TikTok LIVE system and WebFlix implementation strategy](../../research/2026-10-29-tiktok-live-system-research.md)  
**GitHub tracking issue:** [WFX2: Build a complete first-party WebFlix LIVE system](https://github.com/payswapdotorg/WebFlix-2.0/issues/66)  
**Existing policy decision:** [ADR 0004 — TikTok source policy](../../adr/0004-tiktok-embed-policy.md)

## 1. The assignment

Build a complete **first-party WebFlix LIVE platform**, designed around the user journeys and feature categories available in TikTok LIVE: browse and join streams, go live quickly, chat and tap to react, invite guests, run one-on-one/team matches, send original WebFlix gifts, build fan communities, manage live events, moderate rooms, produce replays and understand creator analytics.

The requirement is to implement working application behavior inside the existing WebFlix 2.0 web app—not merely write a proposal, ship a static mock, or add a TikTok link.

The existing WebFlix site and integration must remain intact:
- YouTube discovery, watch, live chat, replay and account flows must not regress.
- TikTok's existing `/tiktok` hub and official post Embed Player remain a separate connector. They are not the backend for WebFlix-owned rooms.
- Netflix's deep-link/remote-browser boundary and existing source-policy ADRs remain unchanged.
- All additions use the current app's style, routing, auth, deployment and tests unless a reviewed architecture decision says otherwise.

### The critical distinction

There are two separate outcomes:

1. **WebFlix LIVE:** a first-party live media and creator-community system. WebFlix owns the rooms, broadcast session, messages, reactions, guests, matches, its own gift items, ledger, moderation, events and analytics. This is the platform to build.
2. **TikTok-native LIVE connection:** the documented public TikTok developer products do not currently expose a general API to create/control TikTok LIVE sessions, send TikTok Gifts, tap-Like a TikTok LIVE, manage TikTok co-hosts, or run its Matches. Until TikTok explicitly approves a corresponding partner capability, the TikTok connector may present allowed TikTok posts/profiles using the existing official player and deep-link users to TikTok for its own LIVE interactions. Do not pretend a WebFlix action affected TikTok.

See the full feature inventory and cited research at `docs/research/2026-10-29-tiktok-live-system-research.md`. That report is part of the source of truth; this work order is the implementation contract.

## 2. Current WebFlix starting point (verify actual HEAD before changing anything)

Source review has established:
- `src/app/explore/live/page.tsx`, `src/app/explore/live/view.tsx` and `src/app/api/live/route.ts` form the current **YouTube LIVE discovery** surface. `src/lib/youtube/live-surface.ts` composes YouTube results; it is not a WebFlix live-broadcast service.
- `src/components/watch/live-chat-panel.tsx`, `src/hooks/use-live-chat.ts`, `src/app/api/videos/[id]/livechat/*` and `src/lib/youtube/livechat.ts` implement YouTube live chat / replay behavior. Do not re-purpose YouTube-specific DTOs, broker or InnerTube code as the WebFlix LIVE backend.
- TikTok has a distinct integration at `src/app/tiktok`, `src/app/api/tiktok/*`, `src/components/tiktok/*`, `src/lib/tiktok/*`, documented in [ADR 0004](../../adr/0004-tiktok-embed-policy.md). It displays a capped, curated public post universe via TikTok's official Embed Player. It does not have a TikTok LIVE control API.
- The checked-in `prisma/schema.prisma` currently declares `provider = "sqlite"`. Confirm the *actual production persistence* and migration workflow before building a globally shared, concurrent live-state or wallet ledger. Do not use an SQLite file or Redis key as an authoritative monetary ledger.
- Root `package.json` includes `test:tiktok`, and the overall test command includes current TikTok/source-specific suites. The full repository has many routes and dependencies, so run baseline gates and verify no regressions to the existing site.
- Existing auth/session and creator studio surfaces exist. Reuse them where semantics fit, but design separate, correct role checks and creator ownership for live rooms.

Pin the current WebFlix HEAD and production deployment SHA in the work log before implementation. Inspect current `AGENTS.md`, `docs/plans/wave-claims.md`, `WORKLOG.md` if present, relevant ADRs and current branch/PR state. Reconcile active claims; do not overwrite any other worker's active assignment.

## 3. Implementation principles (binding)

1. **A true media vertical slice before broad UI.** Start a real session, publish a real stream, watch it in a second browser/profile, send chat/reactions, end the stream and reconcile server state. Do not build gift/match UI ahead of a real stream and authorization model.
2. **Provider adapter boundaries.** Provider keys/URLs/SDK APIs must live behind server-side adapters. Route/component code depends on WebFlix contracts, not specific Cloudflare/LiveKit/Mux SDKs. An ADR pins decisions after a short evidence-based spike.
3. **Real-time is different from durable data.** Use the realtime layer for fan-out/presence, durable relational storage for users/rooms/sessions/moderation/money and replay metadata, and Redis only for ephemeral state, rate limiting and cache.
4. **Server-authoritative side effects.** Clients never supply authoritative counts, match scores, gift prices, balances, earnings, viewer count, permission outcomes, or room lifecycle. Clients send validated intent; the backend authorizes and derives the result.
5. **Idempotency on every side effect.** Stream provider webhooks, room lifecycle notifications, gifts, event registrations, payment callbacks, score events and moderator actions need idempotency/event IDs, durable state transitions and retry-safe logic.
6. **No credentials in the renderer.** Never expose provider API secrets, stream keys, long-lived participant grants or payment secrets to browser code. Issue short-lived, room-scoped tokens with least privilege, and redact tokens from logs/URLs.
7. **Feature-flagged region and eligibility gates.** Live, guest participation, gifts, subscriptions and payout are separate capabilities. Region, age, account status and creator eligibility are validated server-side. A disabled capability explains why.
8. **No fake success.** Every UI control is connected to a real backend operation or visibly disabled with a reason. Provider outage/unconfigured/offline/denied states are intentional and testable.
9. **Use original WebFlix assets and names.** Reproduce the user-value categories and interaction mechanics, not TikTok's proprietary art, exact gift animations, private UI assets or branding.
10. **Keep current source integrations separate.** No TikTok scraping, private endpoint replay, cookies copied from the user's browser, stream ripping/downloader sites, or browser automation that tries to send TikTok-native Gifts/Likes/co-host actions without a documented authorization path.

## 4. Feature scope: the full WebFlix LIVE system

Implement the following modules behind feature flags and phased acceptance. A feature counts as complete only when its API, permission model, persisted state where required, visible UX, tests and real environment evidence exist.

### A. LIVE discovery and viewer room
- Add a first-party `/live` discovery destination that is clearly distinct from `/explore/live` (YouTube's live search surface). Show only actual WebFlix-owned live sessions and upcoming WebFlix LIVE events, with LIVE/starting/ended states and fresh status.
- Live grid/feed, creator/channel identity, title, preview/cover, topic/category, current viewer count, follow state and event registration.
- Watch page/room with real provider playback, chat, reaction/tap rail, creator profile, follow, share, viewer count, polls/Q&A where available, guest layout, match panel when applicable and gift feed.
- Room transitions and URL deep links; correct browser history; full page scroll; mobile portrait viewport and desktop responsive layouts.
- Player connection state, camera/mic permission errors, autoplay behavior, reconnect, offline, provider failure and ended/replay states. No silent black frame or pretend LIVE badge.
- Viewer enter/exit events with de-duplication; counts are approximate where appropriate and must not be treated as billing/financial facts.

### B. Creator “Go Live” and console
- Discoverable `Go Live` action; preflight checklist; title/category/cover/visibility/audience options; guest/chat/reaction/gift permissions; explicit age controls; camera/mic permission test; preview; select camera/mic; start/end controls.
- Solo host via browser capture from a secure origin. Later add mobile camera switching, screen/window share, scene/background/effects, external OBS/RTMP/SRT input and scheduled broadcast.
- A creator console showing the program preview, stream health, viewer count, chat/requests, guests, moderation, gifts/score and current event. It must stay usable on small windows and with chat hidden/open.
- On end: correct stop/destroy sequence, room state reconciliation, recording readiness and analytics summary.

### C. Realtime chat and tap reactions
- WebSocket/realtime room channels for chat, presence and interactive events; role/badge presentation; pinned announcements; composer; loading/slow-mode/chat-disabled/permission-denied states.
- Pointer, keyboard and touch tap-to-like/heart interaction with floating reactions and aggregate counts. Batch/coalesce client taps (e.g. a measured 200–500ms batching window) instead of writing every tap separately; implement server-side per-user/IP/session limits, burst detection, anti-bot rules and fair scoring.
- Durable messages and moderation events; bounded in-memory windows, pagination/replay policy and exact message ordering semantics. At-least-once transport means duplicate messages/events must be deduped.
- Q&A/questions and polls can be added when contracts and room state are established; poll vote counts must be server-computed.

### D. Multi-guest, co-host and invitation management
- Guest request; creator invite to known/eligible users; accept/decline/expire/cancel; permission request indicators; guest device preview/permission checks; host/guest camera and mic controls; reconnect, host removal and guest leave.
- Implement grid and panel/fixed layout. Stage media layout and public viewer program output need to remain coherent when participants join/leave or change video state.
- Separate stage participant roles from ordinary viewer roles. The viewer cannot join as a publisher without an explicit host-approved invitation and a correctly scoped provider token.
- Define WebFlix's initial maximum guest count (suggest start with host + up to 4 remote guests), store capability limits/configuration, and load-test the limit instead of copying a changing TikTok-specific cap.

### E. Matches / team battles
- Host-initiated solo or team match between active eligible room participants; invite/accept; configurable duration and gift-scoring policy; countdown; live score ticker; timer; winner result/celebration; cancellation/disconnect behavior.
- Score inputs include validated batched tap reactions and eligible WebFlix gift events only; whether/what gifts count is explicit. Distinguish entertainment points from wallet/earnings.
- Append-only `ScoreEvent` table and idempotency key; server-authoritative scoring. The client may render snapshots but cannot modify them. Test duplicate/out-of-order/late events, rejoin, concurrent requests and event replay.
- Do not implement a match across separate TikTok-native streams or show a fake WebFlix score for an external provider.

### F. WebFlix gift catalogue and monetization
- Begin with non-monetary, clearly labelled dev gifts. Original catalogue, preview animation, send confirmation, target creator, sender identity, room gift activity, recipient acknowledgment, gift goal and leaderboards.
- Before real money: migrate/confirm PostgreSQL persistence and transactional constraints; design an immutable double-entry ledger with accounts for buyer wallet, consumed virtual items, creator earnings, platform revenue, pending/reversal/refund and payout liability as applicable. Money amounts use integer minor units and a single declared currency per transaction—never floating point.
- Payment provider interface; server-created checkout/payment intent; verified webhook signatures; idempotent processing; receipts; balances derived from ledger entries; transaction history; spend limits; explicit gift action confirmation; reversal and dispute path.
- Gift sent → event published only after durable financial commit; retry/outbox workers must not double charge or double credit. Gift animations can be retried independently of ledger posting.
- Creator earning calculation is versioned and recorded per gift transaction; cash payout is another audited workflow with eligibility, identity, tax and provider status.
- **Real-money send, recurring subscription and creator payout remain gated** until legal/compliance, payment provider, country/age rules, fraud, refund/chargeback, tax/KYC and platform terms are approved. Do not call WebFlix credits “TikTok Coins” or “TikTok Diamonds,” and do not suggest their balances are interchangeable.

### G. Fan clubs and subscriptions
- WebFlix-owned community clubs/memberships, member badges, roles, missions and non-cash activity points; member-only chat/live modes, subscriber-only rooms or replays, supporter emotes where built.
- Creator-configurable tiers/perks, privacy and visibility; subscriptions require secure billing, cancel/renew/refund semantics and real webhook handling before production.
- Reminder and notification infrastructure for followed creators, upcoming events, event cancellation, upcoming LIVE and room invitations. User notification preferences, deduplication and rate limits.

### H. Scheduling, replays and analytics
- LIVE Events create/update/cancel, register/unregister, viewer-local time display, share and calendar handoff.
- Provider recording/replay lifecycle, consent, retention policy, visibility/permission checks, replay processing state and playback; the chat replay policy must be explicit (recorded chat replay vs live-only).
- Creator analytics: session duration, peak viewers, watch time, retention, joins/leaves, reaction totals, chat metrics, gift totals/earnings only when supported by real ledger, stream errors and replay status.
- Operations dashboard with time-to-first-frame, join errors, media latency, reconnects, chat latency, outbox lag, provider costs, egress, high-volume rooms and rate-limits.

### I. Moderation, admin and trust
- Room creator/moderator/guest/viewer permission matrix; moderator grants and revocation; message report; timed mute, room-scoped ban/block, remove guest, slow mode, blocked keywords and variations, spam burst controls, viewer restrictions, chat disable, gift disable, guest request disable, live end/kill switch.
- Moderation queue/decision audit trail; anti-abuse telemetry and policy reasons; evidence retention with strict access and deletion schedule; appeals/escalation.
- Content policy, age and feature eligibility, reporting/notice, creator guidelines, replay removal/takedown and support workflows. Critical safety failures are release blockers.
- Server-side authorisation for every state mutation; test horizontal privilege escalation, room ID guessing, guest-token escalation, replay access leaks and moderator revocation during an active session.

## 5. Media/realtime architecture decision and spike

### Default candidate

Use a provider adapter boundary and run a short technical spike before locking production:
- **Interactive stage (host + guests):** evaluate LiveKit (WebRTC/SFU, participant access tokens, room lifecycle and composite egress).
- **Large audience delivery and recording:** evaluate Cloudflare Stream Live WebRTC (WHIP publish/WHEP playback, sub-second delivery and recording) and whether the required output from a LiveKit-composed stage can be delivered to the desired Cloudflare Stream input/profile. Cloudflare Stream WebRTC became GA on 2026-10-27 and delivery billing began on 2026-10-15; budget against real viewer minutes.
- **Fallback viewer distribution:** evaluate Mux Low-Latency HLS (documented roughly 4–7 seconds) if the LiveKit→Cloudflare output combination cannot meet requirements reliably. Keep `LivePlaybackPlan` provider-neutral.
- **Realtime events:** Vercel WebSockets are generally available as of 2026-10-20. Test a Vercel-hosted WebSocket path plus Upstash coordination at the expected load; compare a managed service if deployment limits, delivery semantics or backpressure require it.
- **Durability:** audit production persistence. Prisma's checked-in schema currently specifies SQLite, which is not a suitable authoritative backing store for shared live concurrency and wallet double-entry accounting. Use PostgreSQL for the live relational state/ledger boundary (Neon is one candidate) with migrations, constraints and transactions. Do not trust assumptions—measure and record how production actually connects today.

### Spike acceptance (must not become a multi-week architecture-only exercise)

Within the first implementation wave, prove:
1. browser host on HTTPS can request camera/mic, preview, publish and end;
2. second independent browser can join, see the real stream and recover after a network interruption;
3. if using LiveKit stage, a second publisher can join only via an accepted invitation, and a composed stream reaches the viewer delivery path;
4. room IDs and stream keys/secret URLs cannot be guessed and do not leak to public HTML/logs;
5. provider stop/webhook and app state reconcile idempotently;
6. cost calculation uses current rate card for one 30-minute host, 4 guests and 100/1,000/10,000 viewer sessions;
7. chosen protocol supports the intended viewer latency, recording/replay, supported browsers, target regions and explicit failure UX.

Record the decision in an ADR with measurements, exact SDK/doc versions, pricing date, API permissions, service SLO and fallback. Then proceed; do not deliver only a technology comparison.

## 6. Data and contract ownership

Freeze versioned contracts before parallel implementation. Minimum objects:
- `LiveRoom` — canonical stable room identity, creator/channel, room policy and visibility;
- `LiveSession` — one scheduled/actual broadcast lifecycle with provider IDs, start/end, status, replay and analytics status;
- `LiveParticipant` — participant role and session membership, never a provider credential;
- `LiveInvite` — invitation/request state and expiry;
- `LiveMediaEndpoint` / `LivePlaybackPlan` — provider-neutral ingest/playback path and capability status;
- `LiveChatMessage`, `LiveReactionBatch`, `LivePoll`, `LiveQuestion`, `LiveModerationAction` and `LiveReport`;
- `LiveMatch`, `MatchTeam`, `ScoreEvent` and `ScoreSnapshot`;
- `GiftCatalogItem`, `GiftIntent`, `GiftEvent`, `WalletAccount`, immutable `WalletLedgerEntry`, `CreatorEarning` and `Payout`;
- `LiveEvent`, `EventRegistration`, `FanClub`, `Membership`, `ReplayAsset` and `LiveAnalyticsSnapshot`.

Every event has a versioned schema and stable `eventId`, timestamps, room/session/actor where relevant, source, idempotency key and trace/correlation ID. Score and wallet state derive from validated durable events. UI components never authoritatively mutate a balance or score. Do not build a generic catch-all JSON table for all of these.

## 7. TL + three-worker plan (non-overlapping lanes)

**Before dispatch:** TL reads the current repo instructions, source policy ADRs, tests and work-claims ledger; records base SHA; reconciles existing work; opens/updates issue claims and creates branches from one pinned base. All workers must record commands actually run and report exact changed paths and evidence. The TL owns root config, shared contracts, architecture/ADR decisions, schema integration, merge gates and production acceptance. No overlapping file edits.

### Worker 1 — Media transport and room lifecycle
Own the assigned live provider adapter, media token issuance, room/session lifecycle APIs and integration tests. Prototype browser WHIP/WHEP and the interactive stage/composed-broadcast path; land real start/join/end/reconnect and honest error states. Do not edit creator UI or gifts/ledger models outside the frozen contracts.

### Worker 2 — Viewer room UX and realtime interaction
Own the assigned `/live` discovery, room/watch interface, realtime chat/presence, batched tap reactions, polls/Q&A and accessible room-state rendering. Use frozen contracts; do not call provider APIs directly from client components and do not create authoritative score or wallet writes. Existing `/explore/live` stays the YouTube destination.

### Worker 3 — Creator controls, safety and multi-guest UI
Own creator Go Live preflight/console, invitation/guest views and host/moderator moderation controls. Wire to frozen lifecycle/capability contracts and enforce role-specific UI. Provider token/permission checks stay server-side. Create visual/e2e tests for host/guest/viewer roles.

### TL / integration lane
Own live domain/contracts, architecture policy, DB/persistence choice, event schema, root configuration, the work-claims ledger, GitHub issue/roadmap/report status, and integration. After Phase 1 passes in a real GUI, dispatch follow-up subwaves for matches, non-monetary gifts/fan clubs, and then money/payout only after its gated prerequisites. Do not cram all monetization into the first transport PR.

If the repository's current worker/relay-bundle protocol is still in use, follow it exactly; do not invent a second collaboration workflow. Workers deliver a report and evidence, not a green check claim.

## 8. Definition of done and acceptance suite

### Phase 1: real stream vertical slice
- [ ] Actual WebFlix user can create a room as host and request browser devices only after clear consent.
- [ ] Stream uses real provider transport on HTTPS; a separate viewer account/browser can play it.
- [ ] Another user cannot create a publisher token or stop/join as host without authorization.
- [ ] Host ends live; provider/webhook/app state reconcile; no phantom LIVE room remains.
- [ ] Network drop/reconnect, denied camera/mic, stream input failure and unavailable provider produce useful truthful UI.
- [ ] No key/token in renderer bundles, page source, query string, logs or test artifacts.
- [ ] Existing YouTube `/explore/live`, YouTube live-chat/replay, TikTok embed hub, Netflix handoff, login/account and core watch tests remain passing.

### Phase 2: interaction, invites and moderation
- [ ] Viewer sends chat from one browser; host sees it in another with measured end-to-end delivery latency; message is durable and duplicate-suppressed.
- [ ] Rapid taps produce visible heart/reaction animation and correct authoritative batched aggregates without flooding database writes or scoring.
- [ ] One viewer requests/invites to guest; host accepts; guest joins with publisher rights only after authorization; host removes guest; the program and viewer playback remain stable.
- [ ] Moderator can only execute permitted actions; muted/blocked actor cannot continue chatting; all actions appear in audit logs; rate limits work.
- [ ] Poll/Q&A and scheduled event flows pass end-to-end once enabled.

### Phase 3: matches and gifting (non-monetary)
- [ ] Solo and team matches start/end from host controls; scores depend only on valid idempotent backend events.
- [ ] Duplicate event delivery does not double score; late events follow a documented rule; final result is deterministic and auditable.
- [ ] Original WebFlix gifts can be sent in sandbox/non-monetary mode with a real event, correct recipient animation, limits and anti-abuse. No fake money or TikTok virtual-item labels appear.

### Phase 4/5: money and creator payouts
- [ ] All ledger writes are PostgreSQL transactional, balanced, immutable and idempotent; every purchase, send, earning, refund and payout can be reconciled.
- [ ] Signed webhooks reject invalid signatures/replays; retry never double-charges; chargeback produces a compensating ledger entry.
- [ ] Feature stays disabled by default until legal/compliance, payment-provider approval, age/identity/payout rules and operational runbooks are signed off.
- [ ] No user can buy/send/redeem above available balance or bypass eligibility through client changes.

### Evidence and merge gate
- [ ] Current desktop/mobile viewport screenshots for discovery, viewer room, host preflight/console, guest layout, match, gift confirmation, moderation and replay.
- [ ] GUI/E2E uses separate actual browser contexts/identities and real transport; fixtures are labelled and never stand in for live media acceptance.
- [ ] Static/type/lint/format/architecture gates and relevant test suites pass at the exact candidate SHA; existing failures are listed as baseline and no new ones introduced.
- [ ] Load test covers target room concurrency, event rate, reconnect storms, provider failure and provider-minute costs; state the tested ceiling instead of asserting TikTok-scale parity.
- [ ] Update the feature matrix with COMPLETE/PARTIAL/BLOCKED for every feature, evidence paths and remaining work. A disabled or provider-gated surface is not “complete.”

## 9. Immediate start order

Do this now:
1. Refresh repo + production SHAs and inspect the current live routes, TikTok ADR, Prisma schema, current deployment DB and active work claims.
2. Add a detailed LIVE parity matrix and issue/claim rows; freeze the small shared contracts and permissions model.
3. Dispatch the three lanes above on disjoint branches.
4. Run the media-provider spike in parallel with the shell/interaction contract work, choose the smallest real vertical slice and implement it.
5. Deliver and verify host → live playback → viewer chat/reaction → end/reconcile in the actual WebFlix deployed preview.
6. Only after this slice is proven, dispatch multi-guest/match/gifts follow-up waves; real-money/payout remains separately gated.
7. Update this work order, research report, ADR, requirements/feature matrix and work-claims ledger with exact SHAs and verified facts. Do not ask the architect to restate the plan.

## 10. External documents to verify while implementing

- TikTok Developer Products: https://developers.tiktok.com/doc/
- TikTok Developer Guidelines: https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines
- TikTok Display API: https://developers.tiktok.com/docs/en/display-api-overview
- TikTok moderation: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/moderating-on-tiktok-live
- TikTok match: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/live-match
- TikTok virtual items policy: https://t.tiktok.com/legal/page/us/virtual-items/en
- Cloudflare Stream WebRTC: https://developers.cloudflare.com/stream/webrtc/
- Cloudflare live streaming / pricing: https://developers.cloudflare.com/stream/stream-live/ and https://developers.cloudflare.com/stream/pricing/
- LiveKit ingress/egress: https://docs.livekit.io/transport/media/ingress-egress/ingress/ and https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/
- Mux low-latency live: https://www.mux.com/live
- Vercel WebSockets GA: https://vercel.com/changelog/websocket-support-is-now-generally-available

Re-check these sources at execution time; feature policies, pricing and provider limits can change.
