# WFX2-LIVE-PLATFORM-1 — Phase 3 frozen contracts (issue #2)

**Status:** FROZEN by the TL 2026-11-04, before lane dispatch (work order §7).
**Scope:** work order §4D (multi-guest stage) + §4E (matches) + the §8 Phase 3
gate's non-monetary gifting slice of §4F.
**Schema:** both Prisma variants carry the eight Phase 3 models + the two
`LiveRoom` policy columns (parity test guards; pushed to `db/live-test.db`).
**Types:** `src/lib/live/types.ts` §Phase 3 is the only DTO vocabulary.
**Shared core:** `src/lib/live/permissions.ts` (roles, sanctions, numeric
laws, RATE_LIMITS) + `src/lib/live/provider.ts` (`removeParticipant`).
**ADR:** `docs/adr/0007-live-guests-matches-gifts.md` pins the decisions.

## The four lanes (disjoint files; no lane touches another's tree)

| Lane | Owns (new files) | Tests |
| --- | --- | --- |
| **3-a guests** | `src/lib/live/guests.ts`, `src/app/api/live-rooms/[id]/invites/**`, `src/app/api/live-rooms/[id]/stage/**` | `tests/live-guests.test.ts` |
| **3-b matches** | `src/lib/live/matches.ts`, `src/app/api/live-rooms/[id]/matches/**` | `tests/live-matches.test.ts` |
| **3-c gifts** | `src/lib/live/gifts.ts`, `src/app/api/live/gifts/route.ts`, `src/app/api/live-rooms/[id]/gifts/route.ts` | `tests/live-gifts.test.ts` |
| **3-d UI** | `src/components/live/live-stage-grid.tsx`, `live-match-panel.tsx`, `live-gift-panel.tsx` | `tests/live-ui-phase3.test.tsx` |

Integration lane (TL only): `rooms.ts` (the guest token rung), `reactions.ts`
(the match-scoring hook), `moderation.ts` (the four policy toggles), the
stream route tail (new event kinds), UI wiring into the existing viewer room
+ console, `package.json` test registration, gates, acceptance, push.

## Frozen routes

- `POST /api/live-rooms/[id]/invites` — host posts `{ inviteeId }`
  (invitation) or a signed-in viewer posts `{}` (self-request);
  200 `{ invite: LiveInviteDto }`; 403 `guests-disabled` / `not-live` /
  `forbidden` (banned actor); 409 `invite-pending` (same pair already
  pending) / `stage-full` (host invite with GUEST_SLOTS_MAX occupied slots)
  / `invalid-invitee` (invitee is the host, or unknown); 429 inviteCreate.
- `GET /api/live-rooms/[id]/invites` — host gets the room's pending rows
  (requests first, newest first); everyone else gets only their own rows.
  Expired pendings sweep to `expired` on read (lazy, idempotent).
- `POST /api/live-rooms/[id]/invites/[inviteId]/respond` — body
  `RespondLiveInviteInput`; the RESPONDER is the invitee when the row is a
  host-invite, and the host when the row is a guest-request; accept on a
  live session upserts the invitee's participant row (role `guest`,
  state `connected`) and re-publishes the stage; 200 `{ invite }`; 409
  `invite-resolved` / `invite-expired` / `stage-full`; 403 otherwise.
- `DELETE /api/live-rooms/[id]/invites/[inviteId]` — cancel by the row's
  creator or the host; 200 `{ invite }` (status `cancelled`).
- `GET /api/live-rooms/[id]/stage` — public for public rooms; 200
  `LiveStageDto` (host + guests only, resolved handles, states, guest cap).
- `DELETE /api/live-rooms/[id]/stage/[userId]` — host removes a guest:
  participant → `removed`, best-effort `adapter.removeParticipant` (never
  fatal), stage re-published; 200 `{ stage }`; removal of the host or a
  non-stage identity 403/404.
- `POST /api/live-rooms/[id]/matches` — host only; body
  `StartLiveMatchInput`; 200 `{ match: LiveMatchDto }`; 409
  `match-active` / `not-live` / `invalid-roster` (unknown, non-stage,
  overlapping, over-sized, or wrong-arity rosters — `solo` = exactly 1 per
  side, `team` = 1..MATCH_TEAM_SIZE_MAX); 429 matchStart.
- `GET /api/live-rooms/[id]/matches/current` — public; 200
  `{ match: LiveMatchDto | null }`; performs the lazy wall-clock timeout
  first (see the scoring law).
- `POST /api/live-rooms/[id]/matches/[matchId]/end` — host only; ends an
  active match early (endReason `host`, winner + finals derived); 200
  `{ match }`; 404 foreign matchId; 409 already terminal.
- `POST /api/live-rooms/[id]/matches/[matchId]/cancel` — host only; status
  `cancelled`, NO winner, NO finals; banked ScoreEvents stand; 200
  `{ match }`.
- `GET /api/live/gifts` — the active catalogue (public); 200
  `{ gifts: GiftCatalogItemDto[] }`; the v1 catalogue self-seeds
  (idempotent upsert on first read — no migration dependency).
- `POST /api/live-rooms/[id]/gifts` — signed-in; body `SendGiftInput`;
  200 `{ gift: GiftEventDto, duplicate?: true, match?: { teamId, score } }`;
  403 `gifts-disabled` / `not-live` / `banned` / `spend-cap`; 404
  `invalid-gift`; 429 gifts. Duplicate `clientRequestId` replays the
  original event with `duplicate: true` (never a second row). When an
  ACTIVE match with `giftsScore` is running and `matchTeamId` names one of
  its teams, the send scores (amount = totalCredits) via
  `matches.ingestScore` and the answer carries `match`.
- `GET /api/live-rooms/[id]/gifts?limit≤GIFT_FEED_MAX` — the room's gift
  feed, newest first, resolved sender handles; public for public rooms.

## The scoring law (matches, work order §4E — binding)

1. **Append-only**: every score lives in `LiveScoreEvent`; standings are
   `SUM(amount) GROUP BY teamId`. Nothing ever UPDATEs or DELETEs a row.
2. **Server-authoritative**: clients never send amounts or scores. Reaction
   batches contribute `amount = batch count` for a rostered member; gift
   events contribute `amount = totalCredits` to the viewer-chosen
   (server-validated) team.
3. **Idempotent**: `(matchId, clientEventId)` UNIQUE — the reaction batch id
   / gift intent id is the idempotency key. A replay returns the existing
   row and never double-scores.
4. **Late rule (frozen)**: ingestion is accepted only while the match is
   `active` AND `now() <= endsAt`. A valid room-side action (batch/gift)
   that arrives after the wall clock answers its normal 200 but contributes
   no score. After a terminal status nothing ever scores.
5. **Lazy timeout**: any match read/ingest first transitions an
   `active` match past `endsAt` to `ended` (`endReason "timeout"`), derives
   the winner (higher SUM; tie → `winnerTeamId null`) and writes the final
   `LiveScoreSnapshot` per team — idempotent via the status guard.
6. **Deterministic result of record**: host `end` runs the same derivation;
   finals snapshots freeze the standings; `cancelled` matches have no
   winner and no finals; banked events stand (audit).
7. **Anti-abuse**: match scoring rides the SAME per-user rate limits and
   caps as the underlying surfaces (reactions batch cap + rate limit, gift
   spend window + quantity cap). No separate bypass exists.

## The gift sandbox law (work order §4F, non-monetary slice — binding)

1. **Zero cash value**: priceCredits are integer DEV credits. The UI must
   label them "dev credits — no cash value". No wallet, balance, purchase,
   or payout exists in Phase 3 (the money gate stays closed).
2. **Abuse bound**: a sender may spend at most GIFT_SPEND_WINDOW_MAX dev
   credits per rolling GIFT_SPEND_WINDOW_MS (server-computed SUM over the
   window), quantity clamped 1..GIFT_QTY_MAX, rate-limited by
   RATE_LIMITS.gifts.
3. **Original catalogue**: server-seeded, original WebFlix names/animation
   classes; no TikTok labels or art (work order §3.9).
4. **Recipient**: the room host by law in v1.
5. **Durable commit first**: the GiftEvent row commits before the SSE
   publish (the fan-out never precedes durability — work order §3.5).

## The guest-run law (work order §4D — binding)

1. Publisher rights require an ACCEPTED, non-expired invite on the room and
   a live session; everything else degrades honestly to the viewer rung
   (Phase 1 law kept).
2. Stage cap: host + GUEST_SLOTS_MAX guests; slots occupied by guests whose
   participant state is not `removed` on the active session.
3. Host removal is server-authoritative: participant `removed` +
   best-effort provider boot; a removed identity re-mints as viewer.
4. Guests keep ordinary viewer capabilities (chat/reactions/polls) on top
   of the publish rung.

## Stream fan-out (ADR-0006 fast path)

Each lane publishes its envelope after a durable commit via
`publishLiveEvent(roomId, event)`:
- invites → `{ kind: "invite", eventId, at, invite }` (and a `stage`
  publish whenever the stage roster changes)
- stage mutations → `{ kind: "stage", …, stage }`
- match mutations/ingestions → `{ kind: "match", …, match }` (full snapshot)
- gift sends → `{ kind: "gift", …, gift }` (and `match` when it scored)
eventId = `crypto.randomUUID()` per publish (clients dedupe; the DB tail
re-derives everything for multi-instance correctness).

## Laws every lane implements (no exceptions)

1. Server-authoritative outcomes; clients send validated intent +
   idempotency keys only (work order §3.4).
2. Signed-in writes resolve through `liveActorFor()`; `activeSanctions()`
   bans block invites/gifts/stage (mutes never do — the documented Phase 2
   asymmetry: mute blocks speech, not participation).
3. Active-session law: invites/matches/gifts/stage mutations 403
   (`not-live`) without a live session, except `GET catalogue`.
4. Rate limits via the app-wide `rateLimit()` adapter, keys namespaced
   `wf:live:<surface>:<roomId>:<userId>`.
5. Honest errors: the `LiveDomainError` → `liveErrorStatus` contract; 429
   is `rate-limited`.
6. No provider coupling: guests.ts/matches.ts/gifts.ts touch the adapter
   ONLY through `adapter().removeParticipant` (guests.ts), never LiveKit
   SDKs directly (work order §3.2).
7. Tests are behavior pins on the shared `db/live-test.db` via
   `tests/live-helpers.ts` (`setupLiveDb()` + unique room titles per file),
   minting cookies through the existing helpers and calling route handlers
   directly: authorization matrix, idempotent replays, late/duplicate
   scoring, wall-clock expiry, 403/409/429 contracts, server-computed
   standings. No LiveKit network calls in tests (fixtures start sessions
   directly).
8. Additive only: no lane edits frozen files (types.ts, permissions.ts,
   policy.ts, provider.ts, rooms.ts, reactions.ts, moderation.ts, hub.ts,
   schema) — needs go through the TL.
