# WFX2-LIVE-PLATFORM-1 — Phase 5 frozen contracts: non-monetary fan clubs (§4G bullet 1)

**Status:** FROZEN (TL, 2026-10-31) · **Base:** main @ `a4c1905` (Phase 4-OPS)
**Tracking:** issue #2 · **ADR:** [ADR-0010](../adr/0010-live-fan-clubs.md)

Phase 5 completes the work order's §4G bullet 1 — WebFlix-owned clubs,
member badges, non-cash activity points, missions, member-only chat and
members-only rooms/replays. **The money gate stays CLOSED**: no billing, no
purchase, no payout exists behind any of this (ADR-0010 non-monetary law).

## 1. Frozen schema (both prisma variants; parity guard green)

- `LiveFanClub` — unique `hostId` (one club per creator), `name`, `motto?`,
  `pointsPerLevel` (default 500).
- `LiveFanClubMember` — unique `(clubId, userId)`, `points` projection,
  `joinedAt`, `lastActiveAt`.
- `LiveClubPointEvent` — append-only; `amount`, `source` ("watch" | "chat" |
  "gift"), `sourceEventId?`, unique `idempotencyKey`.

## 2. Frozen numeric laws (`src/lib/live/permissions.ts`)

`CLUB_NAME_MAX 40` · `CLUB_MOTTO_MAX 120` · `CLUB_PER_CREATOR 1` ·
`CLUB_MEMBERS_MAX 1000` · `CLUB_LEVEL_MAX 50` · `CLUB_MEMBER_PREVIEW_MAX 10` ·
`CLUB_MEMBERS_PAGE 50` · `CLUB_POINT_AWARD_MAX 100` · `CLUB_POINTS_WATCH 2` ·
`CLUB_POINTS_CHAT 1` · RATE_LIMITS `clubCreate 2/10min` · `clubJoin 10/60s` ·
`clubLeave 10/60s` · `clubManage 20/60s`.

Level law: `level = min(CLUB_LEVEL_MAX, floor(points / pointsPerLevel) + 1)`.

## 3. Frozen award law (ADR-0010 §3)

| source | trigger (durable commit) | idempotencyKey | amount |
|---|---|---|---|
| watch | LiveParticipant row created on a live session | `watch:{sessionId}:{userId}` | 2 |
| chat | durable LiveChatMessage committed | `chat:{messageId}` | 1 |
| gift | GiftEvent committed in the host's room | `gift:{giftEventId}` | gift credits (clamp 100) |

Awards are best-effort — a failure never fails the chat send, gift send or
room join it rides on. Duplicate delivery can never double-award (unique key).

## 4. Frozen gates (server-authoritative)

- Room policy column `membersOnlyChat` (default false); audited moderation
  actions `members-chat-enable` / `members-chat-disable`;
  `LiveRoomPolicyDto.membersOnlyChat` + `chatBlockedReason "members-only"`.
- Room `visibility` gains `"members"`: create input accepts it; join/token/
  stage authorize club membership (host always allowed); public discovery
  excludes members rooms; the caller's club overview surfaces them.
- Replay `visibility` gains `"members"`: playback authorizes the same gate.
- Chat badge: `LiveChatMessageDto` gains `senderClubBadge`
  (`{ clubName, level } | null`) — derived at read from ONE batched
  membership lookup, never stored on the row, never client-claimed.

## 5. Frozen routes (`/api/live-clubs/*`; DTOs in `src/lib/live/types.ts` §Phase 5)

- `POST /api/live-clubs` — create (creator-only, one per creator, rate-limited).
- `GET /api/live-clubs/mine` — the caller's own club + roster.
- `GET /api/live-clubs/[hostId]` — overview (club + caller membership +
  derived missions + top members + the host's live room when visible).
- `POST /api/live-clubs/[hostId]/join` · `POST /api/live-clubs/[hostId]/leave`.
- `GET /api/live-clubs/[hostId]/members?cursor=` — paged roster (top by points).

Missions (derived read-only, no tables): `first-steps` (join 1 live
session) · `voice` (send 10 chat messages) · `supporter` (send 1 gift).

## 6. The three disjoint lanes (dispatch on this frozen base; additive-only)

- **5-a club domain** — NEW files only: `src/lib/live/clubs.ts` (create/join/
  leave/overview/roster/points award + derivation/missions), the five route
  files, `tests/live-clubs.test.ts`. Zero edits to existing files.
- **5-b LIVE integration** — rooms.ts (membersOnlyChat column handling +
  visibility "members" gates + award hook on join), chat.ts (canChat
  members-only law + badge stamping + award hook on send), moderation.ts
  (the two audited toggles), replays.ts (visibility "members" gate),
  gifts.ts (award hook), `tests/live-clubs-integration.test.ts`. Touches
  ONLY those five lib files + its one test file.
- **5-c UI** — viewer room club panel + chat badge rendering + honest
  members-only composer state + console policy toggle + club manager +
  studio visibility option + `tests/live-ui-phase5.test.tsx`. Touches ONLY
  components/hooks + its one test file.

Contract drift in any lane = the lane's PR is rejected; TL re-freezes first.
