# WFX2-LIVE-PLATFORM-1 — the Parity contracts (P70–P73, frozen)

**Frozen by:** the TL before the parity waves dispatched · **Base:** origin/main `9e1ece6` (P69)
**Mandate:** docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md §3 — 12 suggestions in 4 waves.
**Laws:** ADR-0012 (derived-only engagement facts · additive stream kinds · the ledger absorbs staff actions · the hub ceiling extends · the Notification reuse · the keyword honesty rule · screen share rides the publisher rung). Money stays GATED (§4F/§4G).

## 1. Schema additions (both Prisma variants, byte-equivalent modulo provider)

| Model / column | Shape | Laws |
|---|---|---|
| `LiveRoomGoal` | `{ id, roomId, kind "hearts"\|"giftCredits"\|"chat", title?, target 1..100000, status "open"\|"reached"\|"closed", createdAt, reachedAt?, closedAt? }` | one open per room = domain law (409 `goal-open`); progress DERIVED on read |
| `LivePinnedMessage` | `{ id, roomId @unique, messageId, sessionId, pinnedById, pinnedAt }` | the row IS the pin; unpin deletes; tombstoned pin → lazy delete on read |
| `LiveRoom.announcementBody / announcementUpdatedAt` | `String? / DateTime?` | 280-char law; the host clears by nulling |
| `LiveRoom.blockLinks` | `Boolean @default(false)` | the link policy (PATCH toggle, audited) |
| `LivePkBattle` | `{ id, roomAId, roomBId?, status "open"\|"active"\|"final"\|"cancelled", startsAt, endsAt, finalizedAt?, winnerSide "a"\|"b"?null, durationSec }` | side scores DERIVED; cancel banks nothing |
| `LivePkScoreSnapshot` | `{ id, battleId, side "a"\|"b", kind "final"\|"mvp", amount, userId?, takenAt }` | written ONCE at lazy finalize |
| `LiveRoomKeyword` | `{ id, roomId, pattern, createdById, createdAt }` | `@@unique([roomId, pattern])`; trim+lowercase; 1..60; cap 50/room (domain) |
| `Notification` (additive) | `sourceChannelId String?` (relaxed), `liveRoomId String?` + `@@unique([userId, liveRoomId])` | the go-live fan-out rows; every other column's semantics untouched |

## 2. Domain modules

| File | Exports | Gate order / notes |
|---|---|---|
| `goals.ts` | `createGoal` (host-only; room-404 BEFORE role-403; kind/target/title validation; fractional target rejected), `listGoals` (lazy reach flip), `closeGoal` (terminal; 409 already-closed), `onRoomActivity` (awaited best-effort hook) | `RATE_LIMITS.goalManage` |
| `gifts.ts` (ext) | `deriveComboCount` (window anchored at createdAt), `topGiftersFor` (SUM/wall/tie laws) | combo is an observation over accepted sends — never a money fact |
| `pins.ts` | `currentPin` (lazy tombstone sweep), `pinMessage` (REPLACE; ledger `pin`), `unpinMessage` (idempotent; ledger `unpin`; null-pin envelope), `setAnnouncement` (nulling law; republishes the `room` envelope), `roomLevelsFor` (bounded derivation), `levelForXp` | `pinManage` / `announcementManage` |
| `pk.ts` | `openChallenge` (host-only; one open 409; duration clamps 60..600 default 120; OLDEST other-host open pairs → active shared window), `currentBattle` (lazy finalize → snapshots + winner + MVP + envelopes to BOTH rooms; idempotent), `cancelChallenge` (side A only; no winner no snapshots) | `pkManage`; hub publishes to both room topics |
| `keywords.ts` | `roomPatterns`, `flagForBody` (pure), `listKeywords` (staff-only), `addKeyword` (cap 50 → 409 `keyword-cap`; dup-add idempotent), `removeKeyword`, `setBlockLinks` | `keywordManage`; all mutations audited (`keyword-add`/`keyword-remove`) |
| `notify.ts` | `fanOutGoLive` (club members oldest-first, cap 200, host excluded, pre-read dedupe) | awaited best-effort inside startSession's try |
| `live-merge.ts` | `localLiveNotifications(userId)` (unread kind-live rows → NotificationDTO + liveRoomId; bounded 10; DB-trouble → []) | the bell/center merge reader |
| `rooms.ts` (ext) | `trendingRooms` (24h engagement; top 6; zero excluded) | derived only |

## 3. Routes

| Route | Methods | Contract |
|---|---|---|
| `/api/live-rooms/[id]/goals` | POST/GET/DELETE | host-only create/close; GET anonymous; DELETE `?goalId=` |
| `/api/live-rooms/[id]/pin` | GET/POST/DELETE | GET anonymous (`{pin: dto\|null}`); POST `{messageId}`; DELETE idempotent |
| `/api/live-rooms/[id]/announcement` | POST/DELETE | `{body}` 1..280; DELETE nulls |
| `/api/live-rooms/[id]/pk` | GET/POST/DELETE | GET anonymous (lazy finalize inside); POST `{durationSeconds?}`; DELETE (side A) |
| `/api/live-rooms/[id]/keywords` | GET/POST/PATCH/DELETE | GET/POST/PATCH/DELETE staff-only; PATCH `{blockLinks: bool}`; DELETE `?id=` |
| `/api/live/trending` | GET | `{rooms, windowMs}`; anonymous OK |
| `/api/notifications` + `/api/notifications/center` | GET | local unread live rows PREPEND the broker feed (bounded 10) |
| `/api/notifications/read` | POST | local live rows mark read durably; the 501 youtube-unsupported answer stands for upstream (`markedLocal` rides the body) |

## 4. Stream kinds (additive to the frozen envelope)

- `goal` — `{ goal: LiveGoalDto }` on create / lazy reach / close.
- `pin` — `{ pin: LivePinnedMessageDto | null }` (null = cleared).
- `pk` — `{ battle: LivePkBattleDto }` on pair / finalize / cancel; the DB tail carries a state+derived-score stamp (the multi-instance floor).
- `room` — announcements ride the EXISTING kind (the roomStamp fingerprint grew the announcement timestamp).

## 5. Numeric laws (permissions.ts)

`GIFT_COMBO_WINDOW_MS=4000` · `GIFT_WALL_MAX=3` · `GOAL_KINDS=[hearts,giftCredits,chat]` · `GOAL_TARGET_MAX=100000` · `GOAL_TITLE_MAX=80` · `GOAL_LIST_MAX=10` · `ANNOUNCEMENT_BODY_MAX=280` · `ROOM_XP_WEIGHTS={chat:2,reaction:1,gift:1}` · `ROOM_LEVELS=[0,50,150,400,1000,2500,6000,15000]` · `PK_DURATION_MIN=60/MAX=600/DEFAULT=120` · `KEYWORD_MAX=60` · `KEYWORDS_PER_ROOM_MAX=50` · `TRENDING_WINDOW_MS=24h` · `TRENDING_MAX=6` · `LIVE_NOTIFY_FANOUT_MAX=200` · `RATE_LIMITS.goalManage=10/60s` · `pinManage=20/60s` · `announcementManage=20/60s` · `pkManage=6/60s` · `keywordManage=30/60s`

## 6. Error contract

`LiveDomainError("flagged")` → **422** (the keyword/link enforcement; the honest refusal — nothing written, nothing rewritten). `LiveApiError` grew `"flagged"`; `use-live-club`'s fallback copy grew the flagged line.

## 7. Battery lanes (the crash-safe sub-batches 12–15)

| # | DB | Files |
|---|---|---|
| 12 | `live-goals-test.db` (push + fresh) | tests/live-goals.test.ts |
| 13 | `live-pins-test.db` | tests/live-pins.test.ts |
| 14 | `live-pk-test.db` | tests/live-pk.test.ts |
| 15 | `live-p73-test.db` | tests/live-keywords.test.ts |

Legacy lane dbs schema-push before their batches; the ops lane db resets per run (its file's own assumption). Full battery: **446 pass / 0 fail**.
