# Research Report — WebFlix LIVE vs TikTok LIVE: the parity gap audit and the implementation plan

**Date:** 2026-10-31 (audit) · implementation waves P70–P73 same day
**Owner:** WebFlix 2.0 TL (issue #2, the resident station)
**Mandate:** "audit the gaps in the webflix live feature compared to that of tiktok / research ways to fix those gaps and turn webflix live into a system on par with that of tiktok live / write a report / implement all the suggestions in that report"
**Base evidence:** the delivered platform at origin/main `9e1ece6` (P61–P69), the frozen contracts (`docs/plans/wfx2-live-phase-*-contracts.md`, ADR-0005…0011), and the feature inventory in [`2026-10-29-tiktok-live-system-research.md`](./2026-10-29-tiktok-live-system-research.md) §1.1–§1.10 (official TikTok sources cited there).

---

## Executive conclusion

WebFlix LIVE is **architecturally at parity** with TikTok LIVE's interactive core — real WebRTC broadcast, server-authoritative rooms/sessions, durable chat with cursor replay, batched reactions, presence, guests with an authorization rung, server-scored matches, an original non-monetary gift ledger, fan clubs, supporter emotes, replays, analytics and an ops dashboard. The remaining gaps to "on par" are **product-depth gaps, not architecture gaps**. They cluster into four deliverable waves, all implementable inside the existing frozen contracts as **read-time derivations over durable rows** (the ADR-0008/0009 derivation law) plus small additive models:

- **P70 — Gift & goal depth:** combo gifts, the top-supporters wall, LIVE Goals.
- **P71 — Room richness:** pinned messages, room announcements, viewer loyalty levels in chat.
- **P72 — Broadcast & PK depth:** screen-share program source, cross-room PK battles (host matchmaking), the PK MVP.
- **P73 — Safety, discovery & retention:** room keyword filters (+ link blocking), the trending-rooms shelf, go-live notifications (reusing the orphaned `Notification` model).

Everything money-shaped in TikTok LIVE (Coins, Diamond payouts, paid subscriptions, wallet ledger, checkout) stays **GATED** exactly as the work order's own gate demands — the audit does not propose touching it. A short list of honest non-goals (external-encoder ingress, AR effects, layout switcher, larger team caps without load evidence) is documented at §5 so the report's suggestion list is exhaustive over what CAN be built now.

## 1. Method

1. Re-read the TikTok LIVE feature inventory (the 2026-10-29 research record §1.1–§1.10, which cites TikTok's official product/developer docs reviewed that day) as the parity baseline.
2. Inventory the delivered WebFlix LIVE implementation file-by-file at `9e1ece6` (26 domain modules in `src/lib/live/`, 40+ API routes, 15 UI components with their testids, both Prisma variants, 26 numeric laws, 26 rate limits, 398-pin battery).
3. For every TikTok capability, mark WebFlix **SHIPPED** (with the file evidence), **GAP → wave** (implementable now), **GATED** (money — not proposed), or **NON-GOAL** (with reason).
4. Turn every GAP into a wave suggestion with its contract sketch; implement all four waves the same day, per the house gates (frozen contracts → tests → two-browser acceptance → evidence → push-as-you-go).

## 2. The gap matrix (TikTok capability → WebFlix state → verdict)

Legend: ✅ SHIPPED · 🌊 GAP → wave · 🔒 GATED (money) · 🚫 NON-GOAL (reason). "Phase-N" = delivered waves P61–P68.

### 2.1 Discovery, entry and retention (research §1.1)

| TikTok capability | WebFlix state (evidence) | Verdict |
|---|---|---|
| LIVE browse surface + LIVE badge + viewer counts | `/live` first-party discovery (`src/app/live/view.tsx`), rooms via `GET /api/live-rooms`, badges `live-badge` | ✅ |
| Upcoming LIVE events + registration + local-time display | `events.ts`, `LiveEventsCard` (`live-events-card`), `LiveEvent` model | ✅ |
| Replays + post-LIVE history + discovery shelf | `replays.ts`, `LiveReplayShelf` (`live-replay-shelf`), public shelf route | ✅ |
| **Notifications when creators go live; event reminders** | `Notification` model exists in both variants but has **zero writers/readers in src/** (orphaned) — no go-live fan-out anywhere | 🌊 **P73-3** |
| **Engagement-ranked / trending browse** | `listRooms` lists rooms; no trending/engagement order over durable rows | 🌊 **P73-2** |
| Follow/subscribe the creator | App-wide follows exist for YouTube channels; the LIVE-creator community surface is the fan club (join/leave, levels) | ✅ (equivalent) |
| Share/copy room link | Room URLs are shareable deep links (`/live/[roomId]`) | ✅ |

### 2.2 Viewer room (research §1.2)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Responsive playback, room identity, LIVE status, viewer count, reconnect pill | `src/app/live/[roomId]/view.tsx` (`live-room-viewer`, `live-badge`, `live-viewer-count`, `live-console-reconnecting`) | ✅ |
| Chat with badges, newest-first, system events | `chat.ts` + `LiveChatPanel` (`chat-club-badge` club badges via `badgesFor`) | ✅ |
| **Pinned / highlighted messages** | No pin concept anywhere (no model, no route, no UI) | 🌊 **P71-1** |
| Tap-to-like with floating reactions + server aggregates | `reactions.ts` + `LiveReactionRail` (400ms batching, server SUM) | ✅ |
| Polls + Q&A | `polls.ts`, `questions.ts`, `LivePollsQuestions` | ✅ |
| Guest layouts, invitations, removal, roles | `guests.ts` + `LiveStageGrid` (host+4, tested cap) | ✅ |
| Gift picker, feed, gifted-by acknowledgement | `gifts.ts` + `LiveGiftPanel` (`gift-feed`, sandbox label) | ✅ |
| **Gift combos (rapid same-gift streaks)** | Not modeled — every send is an independent row, no combo derivation | 🌊 **P70-1** |
| **Creator gift goals / progress** | No goal concept | 🌊 **P70-3** |
| **Top contributors / rank displays** | No gifter ranking surface (totals derivable from `GiftEvent` rows) | 🌊 **P70-2** |
| **Viewer rank/level badges in chat** | Club badges only (members); no room-loyalty level derivation | 🌊 **P71-3** |
| **Room announcements / community notices** | Chat DTO validates `kind: "announcement"` but no server writer or UI exists | 🌊 **P71-2** |
| Match timers/scores/winner overlays | `LiveMatchPanel` (`match-countdown`, `match-result`) | ✅ |
| Keyword-filtered / restricted chat states visible | Slow-mode/muted/banned/disabled states render honestly; **no keyword filter exists** | 🌊 **P73-1** |
| Network quality, muted autoplay, fallback, a11y | Delivered Phase 2/4 (reconnect recovery, beacons, honest errors) | ✅ |

### 2.3 Broadcast creation and management (research §1.3)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Go Live entry + preflight checklist + consent | `/studio/live` (`go-live-*` testids), device test, confirm-gated end | ✅ |
| Title, visibility, permissions before going live | Title + visibility (public/unlisted/members) + policy toggles | ✅ |
| Camera/mic preview, device selection | `go-live-preview-video`, camera/mic pickers | ✅ |
| **Screen/window sharing as a program source; source replace mid-stream** | Console publishes camera+mic only; no `getDisplayMedia` path | 🌊 **P72-1** |
| Broadcaster console (guests, chat, moderation queue, match, end) | `live-console` + HostStageControls + policy controls + moderation dropdowns | ✅ |
| Post-stream summary + LIVE history + replay management | `live-ended-summary`, `live-analytics-summary`, `studio-past-sessions` | ✅ |
| External encoder (OBS/RTMP/SRT) ingress | Provider-level concern; web-first product; would need operator media infra (ingest RTMP, WHIP) beyond LiveKit cloud default | 🚫 honest non-goal (documented) |
| Cover/thumbnail upload for rooms | Room title only; a cover costs storage + upload surface | 🚫 non-goal this pass (revisit with the R2 re-supply) |
| Topic/category chips on rooms + browse filter | No category field | 🚫 non-goal this pass (low parity value vs the four shipped browse surfaces; revisit) |

### 2.4 Multi-guest, co-host and invitations (research §1.4)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Stateful invitations (pending/accepted/declined/expired/cancelled/removed) | `guests.ts` full lifecycle + lazy expiry sweep | ✅ |
| Guest removal boots publish server-side | Guest token rung (accepted invite + not-removed) | ✅ |
| Own tested guest capacity (not TikTok's) | host + 4 (`GUEST_SLOTS_MAX`) | ✅ |
| Co-host → match transition | Matches run over the live stage roster | ✅ |
| Layout switcher (grid/panel/filmstrip) | One grid layout | 🚫 non-goal (cosmetic; one coherent program is delivered) |

### 2.5 Matches, team battles, scoring (research §1.5)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Server-authoritative match state machine + append-only scoring + dedupe + late rule + finals | `matches.ts` (23-pin suite), `LiveScoreEvent` `@@unique([matchId, clientEventId])` | ✅ |
| Likes + eligible gifts count toward points | Reaction hook + gift side-scoring (`matchTeamId`) | ✅ |
| **Cross-stream PK: two LIVE rooms battle head-to-head** | Matches are in-room only; no cross-room battle concept | 🌊 **P72-2** |
| **Winner-side top contributor (MVP) recognition** | Finals snapshots exist; no per-actor MVP derivation | 🌊 **P72-3** |
| Larger team sizes | `MATCH_TEAM_SIZE_MAX = 2` — the work order demands load-test evidence before raising | 🚫 unchanged (evidence-gated, not skipped) |

### 2.6 Gifts and creator recognition (research §1.6)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Original catalogue, own virtual items, no TikTok interoperability | `GiftCatalogItem` self-seeded, "Dev credits — no cash value" pill (ADR-0007) | ✅ |
| Idempotent sends + spend windows + ban blocks | `GiftIntent` `@@unique([sessionId, senderId, clientRequestId])`, rolling 500/60s window | ✅ |
| **Combo gifting** | absent | 🌊 **P70-1** |
| **Top gifters / contributor walls** | absent (derivable) | 🌊 **P70-2** |
| **Gift animations on the room** | Feed rows only (hearts float) | 🌊 folded into P70-1 (combo burst) |
| Coins / Diamonds / wallet / payouts / receipts | **GATED** — the work order's own money gate (legal/compliance/payment/KYC); ADR-0010 keeps every surface non-monetary | 🔒 |

### 2.7 Fan clubs and community (research §1.7)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Fan clubs with levels, badges, activity points, missions | `clubs.ts` (ADR-0010), `LiveClubPanel` | ✅ |
| Subscriber-only chat/LIVE/replays | members-only chat policy, members visibility rooms, members-only replays | ✅ |
| Custom emotes gated by member level | ADR-0011 (`emotes.ts`, picker, render law) | ✅ |
| **Go-live reminders to the community** | same notification gap as §2.1 | 🌊 **P73-3** |

### 2.8 Moderation and safety (research §1.8)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Host/mod roles, audited actions, soft-revoke grants | `moderation.ts`, append-only `LiveModerationAction` ledger | ✅ |
| Mute (time-bounded), ban, delete/tombstone, reports queue | delivered Phase 2 (28-pin moderation suite) | ✅ |
| **Filter comments: host-defined blocked keywords + variations** | absent | 🌊 **P73-1** |
| **Link filtering** | absent | 🌊 **P73-1** (policy toggle) |
| Disable chat/gifts/requests toggles; slow mode | policy toggles + slow-mode (host/mod exempt) | ✅ |
| Rate limits everywhere (26 surfaces) | `RATE_LIMITS` + the ops capture law | ✅ |
| Real-money fraud/chargeback/age-gating for purchases | 🔒 GATED with the money gate | 🔒 |

### 2.9 Analytics and observability (research §1.9)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Session analytics (peak, unique, chat, hearts, gifts, matches, duration) | `analytics.ts`, derived snapshots | ✅ |
| Ops: TTFF, reconnects, join/media errors, chat latency, volumes | ADR-0009 dashboard (`/admin/live-ops`) | ✅ |
| Watch-time / retention / stream-error event history | documented PARTIAL (needs an event-history store) | 🚫 unchanged honest partial |
| Cost/egress metering | 🔒 operator-gated (billing API + `LIVEKIT_EGRESS_ENABLED`) | 🔒 |

### 2.10 Effects and media tools (research §1.10)

| TikTok capability | WebFlix state | Verdict |
|---|---|---|
| Camera/mic, device switching, mute, camera on/off | delivered Phase 1/3 | ✅ |
| **Screen share** | absent | 🌊 **P72-1** |
| Background blur / noise suppression / AR effects | browser-grade DSP/ML pipelines; heavy, low trust in headless verification | 🚫 non-goal (documented) |
| Batched low-latency taps with server rate limits | delivered Phase 2 | ✅ |

**Score:** of the 40 audited capabilities, 27 SHIPPED, 10 🌊 gaps (→ 12 concrete suggestions in 4 waves below), 3 🔒 money-gated, 8 🚫 documented non-goals. Zero architecture changes required — every suggestion lands inside the frozen contracts as additive models/columns/DTO-kinds + read-time derivations.

## 3. The suggestions (what this report commits to implement)

All four waves obey the house laws: frozen contracts first (both Prisma variants + parity test), additive DTOs in `src/lib/live/types.ts`, numeric laws + rate limits in `permissions.ts`, server-derived facts only (ADR-0008/0009 derivation law), honest states, test pins with own lane DBs, two-browser acceptance with in-repo evidence, push-as-you-go. **ADR-0012** records the parity-layer laws (derived-only engagement facts; additive stream kinds; the `Notification` reuse; the keyword honesty rule).

### P70 — Gift & goal depth (§2.2, §2.6 gaps)

1. **Combo gifts.** `sendGift` derives a combo per `(sessionId, senderId, itemId)` inside a frozen `GIFT_COMBO_WINDOW_MS = 4000`: combo count = COUNT of that sender's same-item `GiftEvent` rows in the window (read-time derivation — no new table, never client-claimed). The send response and the `gift` stream envelope carry `{ comboCount }`; the room renders a combo burst chip `×N` and the feed rows show the streak. The existing `clientRequestId` idempotency and spend window are untouched (a combo is an observation over accepted sends, never a new money fact).
2. **Top supporters wall.** `GET /api/live-rooms/[id]` room/policy surface gains `topGifters: { userId, displayName, totalCredits }[]` — server `SUM(totalCredits) GROUP BY senderId` over the room's sessions (frozen `GIFT_WALL_MAX = 3`, ties by most-recent send). UI: a "Top supporters" rail in the room with the non-monetary label carried verbatim. Derived-only; zero new tables.
3. **LIVE Goals.** New model `LiveRoomGoal` (both variants): `{ id, roomId, kind: "hearts"|"giftCredits"|"chat", target 1..GOAL_TARGET_MAX=100_000, status "open"|"reached"|"closed", createdAt, reachedAt?, closedAt? }` + the one-open-goal-per-room law (domain-enforced, `@@index([roomId, status])`). Progress is DERIVED on read: hearts = `SUM(LiveReactionBatch.count)` since `goal.createdAt` (room-scoped), giftCredits = `SUM(GiftEvent.totalCredits)` likewise, chat = non-tombstoned `COUNT(LiveRoomMessage)`. Crossing the target flips `reached` + a `goal` stream envelope + the room's celebration line; the host closes or starts the next goal from the console. Routes: `POST/GET/DELETE /api/live-rooms/[id]/goals`. Rate limit `goalManage 10/60s`; `GOAL_KINDS` frozen union; `GOAL_TITLE_MAX = 80` optional title.

### P71 — Room richness (§2.2 gaps)

4. **Pinned messages.** New model `LivePinnedMessage` `{ id, roomId @unique (one pin per room), messageId, sessionId, pinnedById, pinnedAt }` (the row IS the pin; unpin deletes). Host/mod only; the message must exist in that room and be non-tombstoned (a tombstoned pin is deleted lazily on read). Routes `POST/DELETE /api/live-rooms/[id]/pin`; a `pin` stream envelope (additive kind) carries the pinned body + author for late joiners via the room surface; UI: pin action in the chat row's moderation dropdown + a pinned banner above the chat with an unpin control. `PIN_BODY_MAX` inherited from `CHAT_BODY_MAX`; rate limit `pinManage 20/60s`. The moderation ledger records `pin`/`unpin` actions (additive ledger kinds, documented).
5. **Room announcements.** Additive `LiveRoom` columns: `announcementBody VARCHAR(280)?`, `announcementUpdatedAt DateTime?` (the host clears by nulling). Console setter + viewer banner (honest "updated" timestamp); changes republish the existing `room` envelope (no new kind needed — the room DTO already flows). Part of the frozen policy DTO.
6. **Viewer loyalty levels.** Room XP derived per sender at read time from durable rows since the room's FIRST session: `XP = 2×non-tombstoned chat messages + 1×reaction count + 1×gift credits sent` (frozen `ROOM_XP_WEIGHTS`), level = the frozen `ROOM_LEVELS = [0, 50, 150, 400, 1000, 2500, 6000, 15000]` table (level = highest threshold ≤ XP, cap 7). `mapChatMessage` stamps `senderRoomLevel` for the page's senders (bounded aggregate over the page's ≤50 sender ids); the chat row renders a level chip beside the club badge. Derived-only, never client-claimed, no table.

### P72 — Broadcast & PK depth (§2.3, §2.5 gaps)

7. **Screen-share program source.** The console gains "Share your screen instead": `getDisplayMedia({video, audio:false})` replaces the camera video track on the published LiveKit track (mic audio unchanged); consent copy explains exactly what the audience will see; honest refusal/blocked states (the browser's denial renders its reason); the camera can be restored. The screen track rides the existing publisher rung — no new token surface, no schema change. Verification: domain pins + the browser's deny path + the console state machine (the headless sandbox cannot grant a real display; the honest states are the verified surface).
8. **Cross-room PK battles.** New models: `LivePkBattle` `{ id, roomAId, roomBId?, status "open"|"active"|"final"|"cancelled", startsAt, endsAt, finalizedAt?, winnerSide?, mvpUserId?, mvpPoints? }` + `LivePkScoreSnapshot` `{ battleId, side "a"|"b", kind "final"|"mvp", amount, takenAt }`. Laws: a host OPENs a challenge (one open per room); the matchmaking read pairs the OLDEST other-host open challenge → `active` with `endsAt = now + duration` (frozen `PK_DURATION_MIN=60 / MAX=600 / DEFAULT=120`); **side score is DERIVED** during the battle from each room's durable rows since `startsAt` (reaction batch counts + gift credits — the same derivation law as goals); lazy finalize on read past `endsAt` stamps `final` snapshots + winner + **MVP** (the winning side's top contributor by the same XP weights, attributed from `LiveReactionBatch.senderId`/`GiftEvent.senderId` SUMs) + a `pk` envelope to BOTH rooms; cancel = no winner, no snapshots (banked nothing — pure derivation means zero residue). Routes under `/api/live-rooms/[id]/pk` (open/current/cancel). Rate limit `pkManage 6/60s`. Hub topology note: battle envelopes publish to both room topics in-process — the ADR-0006 single-instance ceiling extends verbatim to PK.
9. **PK MVP.** Included in 8 (the `mvp` snapshot + the banner on both rooms).

### P73 — Safety, discovery & retention (§2.1, §2.7, §2.8 gaps)

10. **Keyword filters + link blocking.** New model `LiveRoomKeyword` `{ id, roomId, pattern (trimmed, lowercased, 1..KEYWORD_MAX=60), createdById, createdAt }`, cap `KEYWORDS_PER_ROOM_MAX = 50` (domain-enforced), host/mod CRUD via the console (audited `keyword-add`/`keyword-remove` ledger kinds); additive `LiveRoom.blockLinks Boolean @default(false)` column both variants. Enforcement in `sendChat`'s frozen gate order (post-validation, pre-insert): a body containing any active pattern (case-insensitive substring) or a URL (`http://`/`https://`/`www.`) when `blockLinks` is on answers **422 `{ message: "flagged by the room's keyword filter" }`** — nobody's message is silently rewritten or shadow-hidden (the honesty rule); the composer renders the honest flagged state. Enforcement stats ride the ops capture law.
11. **Trending rooms shelf.** `/live` gains "Trending now": a server derivation over the last `TRENDING_WINDOW_MS = 24h` of durable rows — `engagement = Σ reaction counts + Σ gift credits + COUNT(non-tombstoned chat)` per LIVE room, top `TRENDING_MAX = 6`, zero-engagement rooms excluded (honest empty state), reusing the room DTOs. Derived-only; no table; the shelf renders above the room list.
12. **Go-live notifications (the orphaned `Notification` reuse).** `startSession` success fans out `Notification` rows (kind `"live"` — additive value, the model's other columns untouched) to the host's fan-club members, capped `LIVE_NOTIFY_FANOUT_MAX = 200` oldest-first, with the additive `liveRoomId` column (`@@unique([userId, liveRoomId])` — the model has zero writers today, so the migration is safe in both variants) and the honest dedupe (one row per member per room). `GET /api/notifications/center` merges the reader: local unread `live` rows prepend the YouTube broker feed (bounded 10, DB-trouble → broker-feed-only, honest fallback). The bell/center renders the LIVE entries with a deep link into the room. This turns TikTok's "creator is live" retention loop into WebFlix's own community loop.

## 4. Delivery gates (per wave and overall)

- Frozen contracts commit per wave: both Prisma variants green on the parity test; additive DTOs; numeric laws; the contracts appendix in this report's §6.
- Battery: every new domain file gets pins (own lane DB per the lane-db law); new UI files get happy-dom pins; the `test:live` script grows crash-safe sub-batches 12–15.
- Two-browser acceptance per wave on the resurrected station (real Chromium, fake camera/mic, self-hosted LiveKit v1.9.11), in-repo evidence + DB-verified facts.
- `tsc 0` repo-wide, eslint clean on touched files, the FULL battery suite-by-suite green, push-as-you-go, WORKLOG + wave-claims rows, the issue #2 delivery comment.

## 5. Explicit non-goals (so the suggestion list is exhaustive over what CAN be built)

- **Real money (Coins/Diamonds/wallet/payouts/checkout/subscriptions):** GATED by the work order's own review gate. ADR-0010/0011 keep every shipped surface provably non-monetary; the audit proposes zero money code.
- **External encoder ingress (OBS/RTMP/SRT):** operator media infrastructure beyond the web-first product; revisit with the operator.
- **AR effects / background blur / noise suppression:** heavy browser DSP/ML with weak headless verification; honest non-goal.
- **Room cover uploads & category chips:** storage- and taxonomy-shaped; revisit with the R2 re-supply.
- **Team size > 2 without load-test evidence:** the work order's own evidence bar; unchanged.
- **Watch-time/retention event history:** needs an event-history store; documented PARTIAL, unchanged.

## 6. Implementation record (appendix — filled as waves land)

| Wave | Suggestions | Base | Status |
|---|---|---|---|
| P70 | combo gifts · top supporters · LIVE goals | `9e1ece6` | **LANED** (0c866b8; combo derivation anchored at createdAt, the wall on the room GET, LiveRoomGoal + goals.ts + the awaited activity hooks; 11 goal pins + 7 combo/wall pins) |
| P71 | pinned messages · announcements · loyalty levels | `0c866b8` | **LANED** (d2c7a3b; LivePinnedMessage (the row IS the pin) + pins.ts + the announcement columns + the ROOM_XP_WEIGHTS/ROOM_LEVELS derivation; 11 pins) |
| P72 | screen share · cross-room PK (+MVP) | `d2c7a3b` | **LANED** (95b7ea2; ScreenShareControls inside the LiveKitRoom + LivePkBattle/LivePkScoreSnapshot + pk.ts (matchmaking, lazy finalize, MVP) + the LivePkBanner on both rooms + the pk tail floor; 8 pins) |
| P73 | keyword filter + link block · trending shelf · go-live notify | `95b7ea2` | **LANED** (474c614; LiveRoomKeyword + the 422-flagged enforcement + blockLinks, trendingRooms + the /live shelf, fanOutGoLive + the bell/center merge + the read-mark; 11 pins) |
| acceptance | the two-browser drive across all four waves | `474c614` | **VERIFIED** (40ce791; evidence/wfx2-live-platform-1-parity-p70-p73/ — 18 screenshots + acceptance-facts.json; DB facts: goal reached, pin row, announcement columns, keyword row, notification row, pk cancelled-no-winner, ledger kinds [pin, keyword-add×2]; console errors NONE on both contexts; mobile 375 overflow 0) |

**Battery:** 398 → **446 pass / 0 fail** across **15 crash-safe sub-batches**. `tsc 0` repo-wide; eslint clean on every touched file. **ADR-0012** records the parity-layer laws; the frozen contracts: [`docs/plans/wfx2-live-phase-parity-contracts.md`](../plans/wfx2-live-phase-parity-contracts.md).
**Honest residuals:** the two-browser PK drive covers the OPEN + CANCEL states, and the TWO-HOST drive (the follow-up rung) exercised the full battle in real browsers — the pairing, BOTH rooms' ACTIVE banners with countdowns, the live derived scores, the lazy finalize and the MVP line on both consoles — with the DB holding exactly 2 final snapshots + 1 MVP row (the settle-claim law; the first run RACED three concurrent readers into tripling the snapshot rows — found BY the acceptance, fixed with an atomic conditional-update claim, re-verified). The money gate stays CLOSED (§5 non-goals unchanged); the push to origin waits on the operator credential re-supply (the vault died with the sandbox reset — recorded in the WORKLOG).
