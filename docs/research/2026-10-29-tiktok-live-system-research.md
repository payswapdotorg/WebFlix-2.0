# Research Report — TikTok LIVE as a Product System and a WebFlix LIVE Implementation Strategy

**Research date:** 2026-10-29  
**Target:** `payswapdotorg/WebFlix-2.0` (existing Next.js web application)  
**Purpose:** document the full user-facing and operational feature system behind TikTok LIVE, distinguish what TikTok exposes to third-party developers from what must be built natively, and recommend an evidence-driven path for a WebFlix-owned live platform.

## Executive conclusion

TikTok LIVE is not just a video element and a chat box. It is an integrated real-time product comprising live-room discovery, low-latency media delivery, broadcaster creation tools, audience interaction, multi-person video, competitive matches, digital gifts, fan/status systems, subscriptions, live events and reminders, moderation, creator analytics, replays, and financial/compliance controls.

**WebFlix should build a first-party “WebFlix LIVE” system with an original implementation and product identity.** It can be modeled on the user experience and feature categories documented by TikTok, but WebFlix should not attempt to control or recreate a user's TikTok-native live room through undocumented endpoints. TikTok's currently documented public developer catalog centers on Login Kit, Content Display/Display API, Content Posting, embeds and restricted research products. The public documentation reviewed does not expose a general API for creating/controlling TikTok LIVE rooms, sending platform-native Gifts, generating screen-tap likes, managing co-hosts, or operating LIVE Matches. Treat those as unavailable through the public integration unless TikTok explicitly approves a partner capability in writing. See [TikTok developer products](https://developers.tiktok.com/doc/) and [Display API overview](https://developers.tiktok.com/docs/en/display-api-overview).

The existing WebFlix code already distinguishes its provider surfaces: `/explore/live` and `/api/live` discover YouTube live streams; `/api/videos/[id]/livechat` and `LiveChatPanel` handle YouTube live chat; `/tiktok` and `/api/tiktok/*` display a bounded curated set of TikTok posts through TikTok's official embed player. These are **third-party source integrations**, not WebFlix-owned broadcast rooms. The current TikTok ADR explicitly says TikTok does not expose a public feed API and requires using the official player for playback: [ADR 0004](../adr/0004-tiktok-embed-policy.md). Do not conflate the two.

## 1. TikTok LIVE feature inventory

The following organizes the product into user-facing systems and the underlying capabilities that make them work. Feature availability can vary by region, account standing, age, app version, eligibility and rollout. These are functional categories to research and reproduce, not a claim every account gets every feature.

### 1.1 Discovery, entry and retention

- LIVE entry points from Home/For You, Following, creator profiles, search, LIVE-specific browse surfaces, topic/category queries and other recommendation surfaces.
- Live cards with creator identity, title/caption, category, preview, LIVE badge, viewers/engagement signals and age/audience restrictions where applicable.
- Vertical/next-LIVE navigation and entry to a room without forcing the viewer through an unrelated route.
- Follow/subscribe creator actions, share/copy link, report and block, view counts, notifications when creators go live, and event reminders.
- Upcoming LIVE Events: creators can schedule a start, audiences can register, share the event and add it to a local calendar. The scheduled time is shown in a viewer's local time. Official reference: [TikTok LIVE Events](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/tiktok-live-events).
- Replays and post-LIVE history, when enabled by the creator and permitted by product policy.

### 1.2 Viewer room

- Responsive vertical or landscape video playback, room title and creator identity, LIVE status, viewer count, follow affordance, share, report/block controls and connection/retry states.
- Live chat with newest messages, sender identity, creator/moderator/verified/member badges where applicable, pinned/highlighted messages, emoji and system events.
- Tap-to-like / repeated heart reactions, visible floating reactions and near-real-time aggregate counts. The display animation is separate from the durable server-side interaction count.
- Polls and Q&A/question collection; creator or moderator can surface questions, reply, pin, dismiss or close them.
- Co-host and guest layouts, invitations, requests to join as a guest, accept/decline, remove guest, reconnect, device controls and clear roles.
- Gift picker, gift animation, gift/event feed, gifted-by acknowledgement, creator gift goals/progress, top contributors and rank/leaderboard displays.
- Event overlays, match timers/scores and winner state where the room is in a competitive session.
- Report/mute/block and moderation feedback; chat-disabled, slow-mode, keyword-filter and viewer-restricted states must be visible and understandable.
- Network-quality indicator, reconnect handling, muted autoplay policy, device permissions, playback fallback, keyboard/accessibility, reduced motion and mobile safe areas.

### 1.3 Broadcast creation and management

- An obvious “Go Live” entry from the main navigation/create menu with a preflight checklist rather than an obscure setup flow.
- Before going live: title, cover/thumbnail, topic/category, visibility/audience controls, comments/gifts/guest permissions, optional age restriction, camera/mic selection, camera preview, permission check, connection test and explicit start confirmation.
- Browser camera/mic streaming; portrait/landscape layouts; front/back camera where device support allows; screen/window sharing; selecting or replacing sources; mute/unmute; camera on/off; device switching; stream health and reconnect.
- Simple mode for “start with camera” and advanced mode for scenes, screen capture, encoder/RTMP/SRT input and external tools such as OBS.
- Persistent broadcaster console showing program preview, current guests, chat, viewer count, reactions, gift events, match state, moderation queue and end-stream control.
- Post-stream summary: duration, peak/concurrent viewers, watch time, chat/reaction/gift metrics and replay/recording status.
- A creator dashboard with LIVE history, replay management, eligibility/capability statuses, moderation and monetization settings.

TikTok documents browser-based LIVE with LIVE Studio (Windows) or OBS Studio (Linux/macOS/Windows) and explicitly describes moderators operating from a browser without access to the encoder software. Reference: [Moderating on TikTok LIVE](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/moderating-on-tiktok-live); [OBS streaming setup](https://seller-uk.tiktok.com/university/essay?default_language=en&identity=1&knowledge_id=7738055662569218).

### 1.4 Multi-guest, co-host and invitations

- Host can invite friends/eligible creators or accept requests from viewers where enabled.
- Invitations are stateful: pending, accepted, declined, expired, cancelled, disconnected, removed. Only the host/authorized moderator can perform host-level changes.
- Participant presence, role, audio/video state, connection quality and guest removal/reconnect are distinct from viewer presence.
- Grid, panel or fixed layouts; host can change layout while the audience sees a coherent program.
- Co-host sessions can transition into a separate match/game mode. TikTok's product pages describe Multi-Guest and Co-host as separate but related modes; reported guest capacity has changed over time and may be account/region dependent, so WebFlix should define its own tested limits instead of hard-coding a TikTok capacity.
- The stage needs a reliable media mixer/compositor (or server-side composed output) if a large HLS/CDN audience sees one program feed while the host and guests use interactive WebRTC.

References: [Co-host on TikTok LIVE](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/cohost-on-tiktok-live); [TikTok's multi-guest feature announcement](https://newsroom.tiktok.com/enhancing-the-live-community-experience?from_seo_redirect=1&lang=en).

### 1.5 Matches, team battles and scoring

TikTok LIVE Match is a co-host mode in which solo creators or teams compete; viewer Likes and eligible Gifts contribute to points, and the highest score wins. Creators can choose whether all Gifts or selected Gifts count toward a specific-Gift match. Reference: [LIVE Match](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/live-match).

A WebFlix equivalent needs a server-authoritative session contract:

- match state: scheduled/setup → invite-pending → countdown → live/scoring → paused (if explicitly supported) → finished/cancelled;
- participant and team assignments; start/end timestamps; configurable match duration; score rules, allowed gift set and eligibility;
- deduplicated, authenticated scoring events with origin, actor, room, match and idempotency key;
- live score snapshots plus append-only score-event history; final winner computed on the server;
- handling for disconnects, late events, network retries, duplicate gifts, reconnects, clock drift and moderator cancellation;
- anti-bot/abuse controls to stop synthetic tap floods from inflating the score.

Do not let the browser tell the server “my team has 10,000 points.” The client emits validated intents/events; the server validates and updates score.

### 1.6 Gifts, virtual currency and creator recognition

TikTok's model includes a catalogue of virtual gifts, Coins, sending gifts during a LIVE, visual animations, creator recognition and Diamonds/reward eligibility. Gift-related features can include fan-club entry, goals, rankings, gift limits and account/region eligibility. Official references: [Gifts](https://support.tiktok.com/en/live-gifts-wallet/gifts), [Diamonds](https://support.tiktok.com/en/business-and-creator/video-gifts-on-tiktok/diamonds?invalid_lang=de), [LIVE Fan Club](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/live-fan-club/), [US Virtual Items Policy](https://t.tiktok.com/legal/page/us/virtual-items/en).

**WebFlix must create its own virtual-item products and ledger.** TikTok Coins/Gifts/Diamonds exist only within TikTok's own product policies; they are not balances WebFlix can spend, transfer, redeem or settle. Do not use TikTok branding, gift art, pricing or implied interoperability for WebFlix gift items.

Required native WebFlix pieces:

- original gift catalogue (ID, artwork, price/currency, animation, regional availability, active dates, campaign, maximum value and rule version);
- wallet/credit balance and immutable double-entry ledger if monetary value is involved;
- explicit gift-confirmation UI showing cost, currency, target creator, remaining balance and refund/reversal terms;
- purchase/checkout provider adapter and verified webhooks; gift-send idempotency; durable event ledger; receipt and transaction history;
- server-side gift delivery events; animation for recipients and viewers; per-room/creator totals and ranking;
- creator earning accrual, platform fee, refund/chargeback reversal and payout accounting separated from non-monetary room score;
- spend caps/notifications, suspicious-activity detection, customer support and dispute path;
- clear disclosure: gifts are digital items, not direct transfer of cash to the streamer. Do not describe non-redeemable credits as cash or promise earnings before a payout programme is approved.
- age gating and jurisdiction-specific eligibility before any purchase/send/redeem feature; never assume that a signed-in user is an adult.
- a feature flag and provider-backed live checkout gate; do not enable real-money creator payouts on a fixture ledger.

TikTok's U.S. Virtual Items Policy, last updated 2026-01-22, specifically states TikTok virtual items are for use on TikTok's platform and that Coins cannot be used as general currency. This reinforces the need for separate WebFlix assets, terms and accounting.

### 1.7 Fan clubs, memberships, subscriptions and community

- recurring creator subscriptions with transparent price and perks; subscriber badges, subscriber-only LIVE/chat/content and custom emotes where supported by WebFlix's own product rules;
- fan clubs with levels, badges, activity-based points, reminders and non-monetary participation missions;
- event registration/notifications; member-only or invite-only rooms; membership/role-aware chat access;
- creator-specific follower/member goals and community messages.

TikTok describes LIVE Subscription perks including subscriber badges, subscriber-only LIVE, subscriber-only chats, custom emotes and subscriber-only videos. Feature eligibility and minimums have changed across dates/regions, so re-check current policies before implementing a matching eligibility rule. Reference: [TikTok LIVE subscription perks](https://newsroom.tiktok.com/live-subscription-subscriber-only-videos/?lang=en).

### 1.8 Moderation and safety as core infrastructure

TikTok's LIVE moderation system documents creator/moderator controls for filtering comments, blocking keywords/variations, muting, limiting, reporting and blocking viewers; moderators must be granted permission. Audience/age controls can also be set before/during a LIVE. Reference: [Moderating on TikTok LIVE](https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/moderating-on-tiktok-live).

WebFlix must model safety explicitly, rather than adding it after gifts/guest rooms ship:

- roles/permissions: host, co-host/guest, moderator, subscriber, member, viewer, support/admin. Permission checks occur on the server for every action.
- user and message report flows, evidence retention with access controls, reason codes, reviewer decisions, appeal paths and audit logs;
- mute (room-scoped/time-bounded), chat timeout, block, moderator removal, guest kick, room restriction, account suspension and escalation;
- configurable rate limits, duplicate/spam floods, link filtering, keyword filters, profanity/harassment detection, bot mitigation, suspicious gift/chargeback behavior and raid protections;
- safety controls for doxxing, sexual exploitation, self-harm, violence, minors, impersonation, dangerous acts, harassment and copyright/content rights;
- live-session emergency stop / disable gifting / disable requests / terminate stream; safe UI when moderation/provider services are unavailable;
- age-gating and regional feature gates, especially before live broadcasting, guest participation, virtual-item purchase and creator payouts;
- creator guidelines, viewer rules, privacy disclosure, camera/mic permission transparency and clear recording/replay consent;
- no public use of real money until age/identity requirements, payout KYC, taxes, consumer protection, payment-provider terms, refunds and jurisdictional legal review are signed off.

### 1.9 Creator analytics, replays and operational observability

- room lifecycle audit: who started/ended it, time, stream-provider IDs, disconnects, moderation events and policy changes;
- concurrent viewers / peak viewers / watch time, join/leave, chat activity, reaction volume, gift metrics and match participation;
- recording readiness, replay playback, retention policies, creator delete/takedown actions and failure states;
- operational metrics: join failure, time to first frame, end-to-end latency, reconnect rate, video quality, chat event lag, duplicate event rate, moderation response time, cost per viewer-minute and stream-provider health;
- per-provider diagnostics and runbooks; redact stream keys/tokens and prevent participant data from leaking to URLs/logs.

### 1.10 Effects, media tools and “tap” interactions

TikTok LIVE can be supported by camera/effects and external broadcast software; available effects and controls vary by device/app/account. For WebFlix, design a provider-neutral media-source pipeline:
- camera/mic, screen share, local video/file, virtual camera, audio mixer and optional OBS/RTMP/SRT ingress;
- portrait/landscape safe framing; camera switching; noise suppression/background blur; configurable simple effects and optional GPU/browser filters;
- low-latency reaction tap with client-side throttling and server-side per-user/device rate limits;
- accessible alternatives to gesture-only controls (keyboard, pointer, touch and screen-reader labels), reduced-motion mode and no haptics requirement for desktop.

Do not treat client-side hearts/taps as individually durable database writes. Batch/coalesce them, then maintain authoritative aggregates/event windows server-side.

## 2. What TikTok officially lets WebFlix integrate

### Publicly documented paths

- **Login Kit**: user authorization, with product-specific scopes and review. Current docs state that baseline `user.info.basic` is available and other scopes require approval; the access token and refresh token belong server-side. Reference: [Login Kit overview](https://developers.tiktok.com/docs/en/login-kit-overview).
- **Display API**: user profile basics and metadata for a user's recent/public videos via `/v2/user/info/`, `/v2/video/list/` and `/v2/video/query/`, subject to scopes. It is not a LIVE control API. Reference: [Display API overview](https://developers.tiktok.com/docs/en/display-api-overview).
- **Official Embed Player**: supported third-party playback of TikTok posts. WebFlix's current ADR 0004 already selects this lane and disallows stream extraction.
- **Content Posting API / Share Kit**: publishing or sharing to TikTok within their permission/review model, not controlling the live room experience.
- **Research API / Commercial Content API**: restricted, purpose-specific products; do not treat them as consumer LIVE feeds.

TikTok reviews apps and scopes before moving integrations live, and expects complete end-to-end demo flows; see [Developer Guidelines](https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines) and [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines).

### Not documented in the public catalogue reviewed

No public, generally available API was found to:
- create/start/end a TikTok LIVE from WebFlix;
- enumerate arbitrary active TikTok LIVE rooms or obtain the TikTok LIVE recommendation feed;
- publish comments/chat to a TikTok LIVE, send Likes by screen-tapping, send Gifts, or manage a user's TikTok Coins;
- invite/remove TikTok LIVE guests, switch co-host/multi-guest layout or run TikTok LIVE Match;
- access the TikTok LIVE moderation API, viewer-level realtime event stream, or creator LIVE analytics as general third-party product capabilities.

This is a statement about the public documentation reviewed on 2026-10-29, not a claim that TikTok has no private partner programmes. If TikTok offers WebFlix a private LIVE partner SDK/API, TL must verify its actual contract, review status and permitted use before changing this assessment. Do not implement undocumented web endpoints, replay copied browser cookies, scrape live chat, simulate clicks in a remote logged-in account, or use unofficial TikTok downloader/stream extraction APIs.

## 3. Recommended WebFlix architecture

### 3.1 Separate two products and data planes

1. **WebFlix LIVE** — first-party creator broadcasting, rooms, chat/reactions, guests, matches, WebFlix gifts, subscriptions, moderation, events and replays. WebFlix owns room state, users, media pipeline contracts, WebFlix virtual items, ledger, roles and its own policy system.
2. **TikTok connector** — official profile/video metadata and Embed Player where permitted, plus outbound links to TikTok for its native LIVE/Gift/Like/Match experiences until official access is granted. Never present a TikTok embed as a WebFlix-owned room and never claim a WebFlix Like/Gift affects TikTok.

### 3.2 Recommended media path: test an adapter-first hybrid

- Build a `LiveMediaProvider` contract rather than scattering provider SDK calls through React/API routes.
- Strong initial candidate for browser-first broadcast distribution: **Cloudflare Stream Live WebRTC**, which became generally available on 2026-10-27 and documents browser-based WHIP publishing and WHEP playback with sub-second latency to thousands of concurrent viewers. Delivery billing began 2026-10-15; evaluate realistic cost and feature constraints before launch. Reference: [Cloudflare Stream WebRTC](https://developers.cloudflare.com/stream/webrtc/), [browser broadcast example](https://developers.cloudflare.com/stream/examples/browser-based-webrtc/), [pricing](https://developers.cloudflare.com/stream/pricing/).
- For host + multi-guest interactive rooms, evaluate **LiveKit** as the real-time stage/SFU, with server-issued participant tokens, room role grants and compositor/egress. LiveKit documents RTMP/WHIP ingress and room-composite egress. Reference: [LiveKit ingress](https://docs.livekit.io/transport/media/ingress-egress/ingress/), [RoomComposite egress](https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/), [pricing](https://livekit.com/pricing).
- The recommended *production shape* is an interactive stage provider (host/guests) plus a viewer-distribution provider/CDN (large audience), with an adapter boundary that permits replacing either. Test whether the chosen LiveKit egress output can be ingested by the selected Cloudflare Stream lane with the latency/output mode required. If not, compare Mux Low-Latency HLS (Mux documents approximately 4–7 seconds in LL-HLS and 20+ seconds standard HLS) or an alternative provider. Reference: [Mux live latency modes](https://www.mux.com/live).
- Do not send thousands of audience viewers as full two-way WebRTC participants merely because that works in a two-browser demo. Audience delivery cost and fan-out architecture must be load-tested.
- For the very first solo-host experiment, Cloudflare's native browser WHIP/WHEP flow can validate start → play → end without a separate encoder. Keep the API behind the provider adapter so the product's room contract does not depend on this one ingest path.

### 3.3 Realtime and durable state

- Use the app's existing Next.js/Vercel deployment for control-plane routes: create/schedule/end a room, authorize host/guest/viewer, issue short-lived media tokens/URLs, request gift sends, moderation actions and retrieve summaries.
- Use a dedicated realtime channel for chat, presence, reactions, room-state updates, invites, scores, Q&A and gift notifications. Vercel announced WebSockets generally available on 2026-10-20, so Vercel WebSockets are now an implementation option; benchmark against a managed realtime service and define a failover/scale plan rather than assuming any connection count will be free. Reference: [Vercel WebSockets GA](https://vercel.com/changelog/websocket-support-is-now-generally-available).
- Use durable relational storage for canonical room/session/users, permissions, schedules, moderation, ledgers, gifts, matches, payouts and replay metadata. The checked-in WebFlix Prisma schema currently declares `provider = "sqlite"`; audit the actual production DB path before adding concurrent realtime or monetary writes. Use PostgreSQL for the live shared-state/ledger boundary (and Neon is a candidate if it fits deployment), with reviewed migrations and transactional constraints. Do not put wallet accounting on SQLite or in Redis.
- Redis is for ephemeral presence, rate limiting, fan-out coordination and cache, not the authoritative wallet/score/ownership database. Every money/score side effect requires idempotency, server-side validation and a durable event/ledger entry.
- Stream keys, provider tokens, private room URLs and OAuth client secrets are secrets: keep them server-side, issue short-lived scoped tokens, never send root API credentials to the browser, and redact logs.

### 3.4 Core canonical contracts

At minimum version contracts for:
- `LiveRoom`, `LiveSession` (draft/scheduled/starting/live/ending/ended/failed/cancelled), `LiveMediaEndpoint`, `LivePlaybackPlan`, `RoomPolicy`, `LiveParticipant` and `ParticipantRole`;
- `LiveInvite`, `LiveChatMessage`, `LiveReactionBatch`, `LivePoll`, `LiveQuestion`, `LiveModerationAction`, `LiveReport`;
- `LiveMatch`, `MatchTeam`, `ScoreEvent`, `ScoreSnapshot`;
- `GiftCatalogItem`, `WalletAccount`, immutable double-entry `WalletLedgerEntry`, `GiftIntent`, `GiftEvent`, `CreatorEarning`, `Payout`;
- `LiveEvent`, `EventRegistration`, `FanClub`, `Membership`, `ReplayAsset`, `LiveAnalyticsSnapshot`;
- a versioned event envelope with `eventId`, `roomId`, `sessionId`, `actorId`, `occurredAt`, `schemaVersion`, `idempotencyKey` and source/provider metadata.

The initial schema can be smaller, but the ownership and event/ledger boundaries must be agreed before parallel work. No browser component writes score or wallet balances directly.

## 4. Phased delivery plan

### Phase 0 — source audit + acceptance contracts
- Record exact WebFlix HEAD, Vercel production SHA and live UI baseline.
- Review current app routes/shell/session/creator studio, Prisma schema, Neon/Redis settings, deploy model, auth, existing TikTok ADR and live-chat code.
- Add a LIVE feature parity matrix to the repo; classify every feature: WebFlix-owned, TikTok official connector, partner-gated, policy-blocked or deferred.
- Run a short media-provider spike: direct browser WHIP/WHEP; multi-guest stage; composition/RTMP egress; viewer delivery; recording; stream-key secrecy; cost and reliability from mobile/desktop networks. Lock provider decision in an ADR.
- Freeze contracts, roles, event schemas, access-control and monetary boundaries before worker dispatch.

### Phase 1 — private beta: real live room
- Room creation and lifecycle, preview/start/end, camera/mic permissions, server-created input, private/scoped playback credentials, real video stream, live status, viewer join/leave and reconnect.
- Live page/discovery with only real WebFlix rooms and truthful states; creator pages and upcoming event surfaces as data exists.
- Persistent room data and provider webhooks reconciled idempotently; no fake “live” state when the provider is inactive.
- No real-money gift/payout UI yet; use zero-value fixture/dev events labelled explicitly for engineering tests.

### Phase 2 — live interaction and safety
- Realtime chat, touch/pointer tap hearts and batched reaction aggregation, viewer count, share, follow, Q&A, polls, pinned messages, blocking/reporting, creator/moderator permissions, rate limits and a moderator console.
- End-to-end browser tests across host, guest/moderator and viewer identities; multi-tab and mobile viewport tests; concurrency and reconnect tests.
- First-party notifications and scheduled LIVE Events/registrations/reminders.
- Replay recording lifecycle, retention and creator controls, subject to consent and provider support.

### Phase 3 — multi-guest and matches
- Guest requests/invitations, accepting/declining/expiry, host controls, participant tokens, permission boundaries, grid/panel layout, disconnect/reconnect/remove, and clean teardown.
- Match setup, solo/team, countdown, timers, backend-authoritative score events for eligible taps/reactions and gift types, score snapshots, winner result and anti-abuse.
- Test duplicated/out-of-order events and a guest losing connectivity in the middle of a match.

### Phase 4 — non-monetary creator/community recognition
- Original gifts with non-monetary or sandbox-only value, visual animations, gift feed, goals, leaderboard, fan clubs, badges and activity missions.
- Admin policy controls, catalog versioning, age-gate interface, creator eligibility states and tests. Clear disclosure that these are WebFlix products.

### Phase 5 — real money and creator earnings (policy/legal gate)
- PostgreSQL-backed immutable double-entry wallet ledger; idempotent checkout and webhook processing; spend ceilings, confirmation UX, transaction history, disputes/refunds/chargebacks, tax/identity/payout requirements and reconciliation.
- Only enable provider-approved payment methods and countries. No real money until qualified legal/compliance and payment-provider approval; no storing card numbers in WebFlix.
- Separate virtual-gift spend from viewer match points and creator payout accounting. A gift never implies a direct transfer to another viewer.

### Phase 6 — quality, scaling and creator studio
- Creator analytics, replays, events/calendar, stream health dashboard, camera/layout polish, captions/moderation integrations and optional OBS ingress.
- Load-test room state/realtime event fan-out and many concurrent audience viewers; test SLOs and cost budgets; exercise disaster/rollback, content moderation outage, stream provider outage and account lockout.
- Only claim TikTok-like parity for features that have real implementation and evidence. TikTok-native LIVE is a separate connector and remains limited to documented, approved capabilities.

## 5. Quality and launch gates

- Full product test matrix, with owners and acceptance evidence for each feature.
- Auth tests: guest, signed-in viewer, creator, co-host, moderator, admin; all endpoints authorize server-side. A viewer cannot create guest tokens, start/stop another creator's stream, moderate without permission, or spend another wallet.
- Live GUI/E2E: three browser contexts (host, guest, audience); real camera/mic and media transport under HTTPS; host starts; viewer joins within a measured target; viewer chats/taps; host invites guest; guest accepts; host ends session; replays/status update correctly.
- Policy tests: age/region/capability denied, account suspended, room age gate, camera permission denied, storage/DB failure, provider timeout, expired token, moderation disabled/unavailable, chat flood, duplicate gift webhook, duplicate score event, chargeback reversal.
- Performance: first-frame time, A/V sync, 95th percentile chat latency, event backlog, connection recovery, video delivery bytes/minute, provider cost per viewer-minute and peak concurrent viewers.
- Accessibility: keyboard-only, screen reader announcements, captions, visible mute states, focus behavior, reduced motion and touch target size.
- Real-money gate remains BLOCKED until DB transactions, app security, provider approval, legal/compliance review, age/payout policies and reconciliation evidence are approved.
- No fixture-only, mock-only or browser-render-only run closes a live media acceptance gate.

## 6. Risks and explicit non-goals

- **Not a TikTok LIVE API clone.** Public APIs reviewed do not expose the required control surface. A TikTok connector may display permitted posts and send users to TikTok for native live interaction; WebFlix-owned rooms provide the native-like full experience.
- **No scraping, private endpoint replay or account cookie theft.** No undocumented TikTok WebCast/InnerTube endpoints, creator stream keys, private mobile APIs or headless account actions.
- **No video stream ripping.** Third-party TikTok content uses the official embed/player and attribution.
- **No fake wallet or cash balance.** Ledger events must be transactional, idempotent and auditable; real-money features are separately gated.
- **No premature “unlimited scale.”** Provider bills/limits, per-viewer-minute usage, rate-limits, room capacity and egress scale must be measured.
- **No copied proprietary gift assets, exact branding or protected UI resources.** Use the feature categories and learnings; design WebFlix's own interface, terms, gifts, animation assets and community rules.

## 7. Source register (reviewed 2026-10-29)

### TikTok official product and developer docs
- TikTok Developer products: https://developers.tiktok.com/doc/
- Display API: https://developers.tiktok.com/docs/en/display-api-overview
- Login Kit: https://developers.tiktok.com/docs/en/login-kit-overview
- Developer guidelines / review: https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines
- App review guidelines: https://developers.tiktok.com/docs/en/app-review-guidelines
- Developer terms: https://t.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en
- What is TikTok LIVE: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/what-is-tiktok-live
- Co-host: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/cohost-on-tiktok-live
- Match: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/live-match
- Events: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/tiktok-live-events
- Moderation: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/moderating-on-tiktok-live
- Fan Club: https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/live-fan-club/
- Gifts / Coins: https://support.tiktok.com/en/live-gifts-wallet/gifts
- Diamonds: https://support.tiktok.com/en/business-and-creator/video-gifts-on-tiktok/diamonds?invalid_lang=de
- LIVE Subscription perks: https://newsroom.tiktok.com/live-subscription-subscriber-only-videos/?lang=en
- TikTok U.S. Virtual Items Policy: https://t.tiktok.com/legal/page/us/virtual-items/en

### Streaming and WebFlix architecture
- Cloudflare Stream Live: https://developers.cloudflare.com/stream/stream-live/
- Cloudflare Stream WebRTC (updated 2026-10-27): https://developers.cloudflare.com/stream/webrtc/
- Cloudflare browser WHIP/WHEP tutorial: https://developers.cloudflare.com/stream/examples/browser-based-webrtc/
- Cloudflare Stream pricing (updated 2026-09-08): https://developers.cloudflare.com/stream/pricing/
- LiveKit ingress: https://docs.livekit.io/transport/media/ingress-egress/ingress/
- LiveKit composited output: https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/
- LiveKit pricing: https://livekit.com/pricing
- Mux latency options: https://www.mux.com/live
- Vercel WebSockets generally available 2026-10-20: https://vercel.com/changelog/websocket-support-is-now-generally-available
- WebFlix TikTok policy: [ADR 0004](../adr/0004-tiktok-embed-policy.md)
- WebFlix existing live route: `src/app/explore/live`, `src/app/api/live/route.ts`
- WebFlix existing TikTok source: `src/app/tiktok`, `src/app/api/tiktok/*`, `src/lib/tiktok/*`
