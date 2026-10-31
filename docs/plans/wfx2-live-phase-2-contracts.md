# WFX2-LIVE-PLATFORM-1 — Phase 2 frozen contracts (issue #2)

**Status:** FROZEN by the TL 2026-10-31, before lane dispatch (work order §7).
**Schema:** both Prisma variants carry the Phase 2 models (parity test guards).
**Types:** `src/lib/live/types.ts` §Phase 2 is the only DTO vocabulary.
**Shared core:** `src/lib/live/permissions.ts` (roles, sanctions, numeric laws).

## The three lanes (disjoint files; no lane touches another's tree)

| Lane | Owns (src/lib/live) | Owns (api) | Owns (tests) |
| --- | --- | --- | --- |
| **2-a interaction** | `chat.ts`, `reactions.ts`, `presence.ts`, `hub.ts` | `chat/`, `reactions/`, `presence/`, `stream/` | `live-chat.test.ts`, `live-reactions.test.ts`, `live-presence.test.ts` |
| **2-b safety** | `moderation.ts` | `moderation/`, `moderators/`, `reports/` | `live-moderation.test.ts` |
| **2-c polls/events** | `polls.ts`, `events.ts`, `questions.ts` | `polls/`, `questions/`, `live-events/` | `live-polls.test.ts`, `live-events.test.ts` |

Integration lane (TL only): `rooms.ts` viewer-count windowing, UI wiring,
`package.json` test registration, acceptance, push, issue comment.

## Frozen routes

- `POST /api/live-rooms/[id]/chat` — body `SendLiveChatInput`; 200
  `{ message: LiveChatMessageDto, duplicate?: true }`; 403
  `{ error: "forbidden", message: "muted" | "banned" | "chat-disabled" |
  "slow-mode" | "not-live" }`; 429 rate-limited (RATE_LIMITS.chat, plus the
  slow-mode gap when `slowModeSeconds > 0`); duplicate `clientMessageId`
  returns the original message with `duplicate: true` (idempotent success).
- `GET /api/live-rooms/[id]/chat?after=<seq>&limit≤100` — durable replay
  (ordered by seq asc), tombstoned rows included (deleted: true).
- `POST /api/live-rooms/[id]/reactions` — body `SendLiveReactionBatchInput`;
  count 1..REACTION_BATCH_MAX (server clamps), 200
  `{ total: LiveReactionTotalDto }` (SUM over the session's batches); 403
  when reactions disabled / not live; 429 per RATE_LIMITS.reactions.
- `POST /api/live-rooms/[id]/presence` — heartbeat; upserts the caller's
  participant `lastSeenAt` (viewer role only), 200 `{ presence }`; 429 per
  RATE_LIMITS.presence. Viewer count = participants with role "viewer",
  state "connected", `lastSeenAt` inside PRESENCE_WINDOW_MS.
- `GET /api/live-rooms/[id]/stream` — SSE (ADR-0006); params
  `chatCursor`, `backfill`; emits `LiveStreamEvent` envelopes; capped
  lifetime; anonymous allowed for public rooms (read-only events).
- `POST /api/live-rooms/[id]/moderators` — host only; body
  `{ userId }`; 200 `{ moderator }`; DELETE (body `{ userId }`) soft-revokes
  (revokedAt/By); both audited implicitly by the LiveRoomModerator ledger.
- `POST /api/live-rooms/[id]/moderation` — body
  `PerformLiveModerationInput`; host+moderator; host-only actions:
  `slow-mode` / `chat-enable` / `chat-disable` (and `ban`/`unban` are
  host+moderator, targets may never be the host); delete-message accepts
  `messageId`; every call appends a LiveModerationAction row; 200
  `{ action: LiveModerationActionDto }`.
- `GET /api/live-rooms/[id]/moderation?limit≤100` — the audit trail
  (host+moderator, newest first).
- `POST /api/live-rooms/[id]/reports` — any signed-in viewer; 200
  `{ report }`; 429 per RATE_LIMITS.reports.
- `GET /api/live-rooms/[id]/reports` — host only, newest first.
- `POST /api/live-rooms/[id]/polls` — host+moderator; body
  `CreateLivePollInput` (2..6 options, labels 1..80 chars); closes any
  previous open poll (one open poll per session); 200 `{ poll }`.
- `POST /api/live-rooms/[id]/polls/[pollId]/vote` — body `{ optionId }`;
  once per (poll, user) via the unique row; re-vote = UPDATE (moving a
  vote decrements the old option by construction — counts are SUMs);
  409 when poll closed.
- `POST /api/live-rooms/[id]/polls/[pollId]/close` — host+moderator.
- `POST /api/live-rooms/[id]/questions` — any viewer; RATE_LIMITS.questions;
  body `CreateLiveQuestionInput`.
- `POST /api/live-rooms/[id]/questions/[qid]/answer` and `/hide` —
  host+moderator (answer sets answeredAt; hide sets hiddenAt; hidden
  questions leave public lists but stay in the audit set).
- `GET /api/live-rooms/[id]/questions` — public list (non-hidden, newest
  first); host/moderator additionally get hidden rows via `?includeHidden`.
- `GET /api/live-events?status=scheduled` — public discovery (upcoming
  first); `GET /api/live-events/mine` — the creator's own events.
- `POST /api/live-events` — any signed-in user (RATE_LIMITS.eventCreate);
  title 1..EVENT_TITLE_MAX, `scheduledFor` must be a valid future ISO date.
- `GET /api/live-events/[id]` — public; `PATCH` — creator only (title/
  description/scheduledFor); `POST .../cancel` — creator only.
- `POST /api/live-events/[id]/register` / `DELETE .../register` — signed-in
  users; row-derived counts.

## Laws every lane implements (no exceptions)

1. **Server-authoritative**: counts, totals, policy outcomes are derived
   server-side; clients send intent + idempotency keys only.
2. **Signed-in unless noted**: stream/GET chat/GET questions/live-events
   list are readable anonymously for public rooms; every WRITE requires a
   session and resolves through `liveActorFor()`.
3. **Active session required**: chat/reactions/presence/polls/questions
   writes 403 (`not-live`) when the room has no active session.
4. **Rate limits** via the app-wide `rateLimit()` adapter, keys namespaced
   `wf:live:<surface>:<roomId>:<userId>` (IP fallback for anonymous where
   applicable).
5. **Tombstones, never deletions**: moderation hides; the audit trail is
   append-only.
6. **Honest errors**: the Phase 1 `LiveApiError` contract; 429 is
   `rate-limited`.
7. **No provider coupling**: none of these routes touch LiveKit.
8. **Tests are behavior pins**: each lane's bun tests use their own SQLite
   db file (`DATABASE_URL=file:../db/live-<lane>-test.db prisma db push`),
   mint sessions via the existing test helpers, and pin: authorization
   matrix, idempotent replays (duplicate clientMessageId / clientBatchId),
   rate-limit 429s, tombstone flows, server-computed totals, and the
   honest 403/409 error contract.
