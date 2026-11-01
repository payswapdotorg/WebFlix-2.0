# ADR-0012 — the LIVE TikTok-parity layer (P70–P73): derived-only engagement facts, additive stream kinds, the Notification reuse, the keyword honesty rule

**Date:** 2026-11-01 (the parity waves LANED same-day)
**Status:** ACCEPTED
**Mandate:** the four-part instruction — audit the gaps vs TikTok LIVE → research fixes → write the report → implement every suggestion. The report is
[`docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md`](../research/2026-10-31-webflix-live-tiktok-parity-audit.md) (40 capabilities audited: 27 SHIPPED, 10 gaps → 12 suggestions in 4 waves, 3 money-gated, 8 documented non-goals). This ADR records the laws every wave obeyed.

## Context

The delivered platform at `9e1ece6` (P61–P69) is architecturally at parity with TikTok LIVE's interactive core. The remaining gaps are product-depth gaps, and every one of them is implementable **inside the frozen contracts** as read-time derivations over durable rows plus small additive models. Nothing in this layer touches the money gate (§4F/§4G: Coins/Diamonds/wallet/payouts stay GATED — legal/compliance/payment/KYC review; ADR-0007/0010/0011 keep every surface provably non-monetary).

## Decisions

### D1 — Derived-only engagement facts (the ADR-0008/0009 law extends verbatim)

Every new engagement number is a **read-time derivation over durable rows** — never stored, never client-claimed:

- **Combo streak (P70-1):** the count of the sender's same-item `GiftEvent` rows inside `GIFT_COMBO_WINDOW_MS = 4000`, **anchored at the send's own createdAt** (an idempotent replay re-derives the SAME number). No counter table.
- **Top-supporters wall (P70-2):** `SUM(totalCredits) GROUP BY senderId` over the room's `GiftEvent` rows, top `GIFT_WALL_MAX = 3`, ties by most-recent send. Computed fresh on every room GET.
- **Goal progress (P70-3):** per kind — hearts = Σ batch counts, giftCredits = Σ totalCredits, chat = non-tombstoned messages — all room-scoped and strictly since the goal's `createdAt`. The **reach flip is lazy** (a read or the awaited `onRoomActivity` hook stamps `reached` + publishes the `goal` envelope).
- **Room-loyalty levels (P71-3):** `XP = 2×chat + 1×reaction + 1×gift credits` since the room's FIRST session; level = the highest `ROOM_LEVELS` threshold ≤ XP (cap 7). Stamped through ONE bounded derivation over each chat page's sender ids.
- **PK side scores (P72):** Σ reaction counts + Σ gift credits per room since `startsAt` — derived per read; the tail re-derives for multi-instance convergence (D4). Only the **final/MVP snapshots** are ever stored (written once at lazy finalize). MVP = the winning side's top contributor by the same reaction+gift sums.
- **Trending (P73-2):** engagement over the last `TRENDING_WINDOW_MS = 24h` (reactions + gift credits + non-tombstoned chat) per LIVE public room, top `TRENDING_MAX = 6`, **zero-engagement rooms excluded** (the honest empty state hides the shelf). No table.

### D2 — Additive stream kinds and models

- New stream kinds: `goal` (P70), `pin` (P71, `null` pin = cleared), `pk` (P72). Additive DTO fields are optional by law (`GiftEventDto.comboCount?`, `LiveChatMessageDto.senderRoomLevel?`, `LiveRoomDto.announcementBody?/announcementUpdatedAt?`, `NotificationDTO.liveRoomId?`).
- New models (both Prisma variants, byte-equivalent modulo provider): `LiveRoomGoal`, `LivePinnedMessage` (the row IS the pin — one per room by the unique `roomId`; unpin deletes; a tombstoned pin is deleted lazily on read), `LivePkBattle` + `LivePkScoreSnapshot`, `LiveRoomKeyword`. Additive columns: `LiveRoom.announcementBody/announcementUpdatedAt/blockLinks`, `Notification.liveRoomId` (+ `@@unique([userId, liveRoomId])`; `sourceChannelId` relaxed to nullable — a "live" notification's source is a room, not a YouTube channel).
- New error code: `LiveDomainError("flagged")` → the honest **422**.
- New rate limits: `goalManage 10/60s`, `pinManage 20/60s`, `announcementManage 20/60s`, `pkManage 6/60s`, `keywordManage 30/60s`.

### D3 — The moderation ledger absorbs every new staff action

Pin, unpin, keyword-add, keyword-remove, and the blockLinks flips all append audited `LiveModerationAction` rows (the additive ledger kinds) — state can never drift from the audit trail (the Phase 2 law).

### D4 — The ADR-0006 hub ceiling extends verbatim to goals, pins, announcements and PK

Every new fact publishes through the in-process hub fast path AND re-derives in the stream's ~900ms DB tail (pk: a status+derived-score stamp; announcements: the roomStamp fingerprint) so multi-instance deployments converge within one tick. Announcements republish the **existing** `room` envelope — no new kind.

### D5 — The `Notification` reuse (the orphaned model's first writers AND readers)

A successful `startSession` fans out kind `"live"` rows to the host's fan-club members (oldest-first, `LIVE_NOTIFY_FANOUT_MAX = 200`, the host excluded) with the additive `liveRoomId` deep link. The honest dedupe is the `(userId, liveRoomId)` unique (pre-read form — SQLite's createMany has no skipDuplicates). The bell + center merge the caller's unread local rows (bounded 10) ahead of the YouTube broker feed; DB trouble → broker-feed-only. The read route marks the LOCAL lane durably while the 501 youtube-unsupported answer stands for the upstream.

### D6 — The keyword honesty rule (nobody's message is rewritten)

Enforcement lives in `sendChat`'s frozen gate order **post-validation, pre-insert**: a body containing any active pattern (case-insensitive substring) — or ANY URL when the room's `blockLinks` is on — answers **422 flagged**. Nothing is written, nothing is silently rewritten, nothing is shadow-hidden; the composer renders the flagged state with the draft surviving. The staff bypass does NOT apply (staff wrote the filter).

### D7 — Screen share rides the existing publisher rung

`getDisplayMedia({ video: true, audio: false })` publishes the display track under `Track.Source.Camera` (mic untouched); restore re-enables the camera. The browser's own denial renders its reason verbatim. No new token surface, no schema change.

## Consequences

- The battery grew 398 → **446 pins** across **15 crash-safe sub-batches** (each new lane db schema-pushes before its batch; the ops lane db resets per run — it is the file's own assumption).
- Two-browser acceptance: `evidence/wfx2-live-platform-1-parity-p70-p73/` (18 screenshots + DB-verified facts; the screen-share path exercised as a REAL grant + camera restore in the fake-media browser).
- Money stays gated; the operator residuals (R2 replay storage, egress metering, real-traffic retention sweep) are unchanged.
- Non-goals stand as documented in the report §5 (external-encoder ingress, AR effects, layout switcher, covers/categories, team size > 2 without load evidence, watch-time event history).
