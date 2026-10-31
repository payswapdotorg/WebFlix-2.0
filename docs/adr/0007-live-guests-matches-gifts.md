# ADR-0007: LIVE Phase 3 — guest stage authorization, server-authoritative match scoring, non-monetary dev gifting

**Date:** 2026-11-04
**Status:** Accepted
**Deciders:** WebFlix 2.0 TL (WFX2-LIVE-PLATFORM-1, issue #2)
**Supersedes:** none; extends ADR-0005 (LiveKit interactive stage) and ADR-0006 (SSE transport)

## Context

Work order §8 Phase 3 requires: multi-guest participation where "the viewer
cannot join as a publisher without an explicit host-approved invitation and
a correctly scoped provider token" (§4D), host-initiated matches whose
"scores depend only on valid idempotent backend events" with a documented
late-event rule (§4E), and non-monetary gifting with real events, limits
and anti-abuse before any money exists (§4F/§8).

## Decisions

### D1 — The guest rung is an invite-authorized token, nothing else

- `mintJoinToken` mints the publisher guest rung ONLY for a caller holding
  an accepted, non-expired `LiveInvite` on that room while a session is
  live; every other request degrades to the subscribe-only viewer rung
  (the Phase 1 honest-degrade law, now with a real authorization path).
- Stage capacity is frozen at host + 4 remote guests (`GUEST_SLOTS_MAX`);
  occupancy is app-state (participant rows), not provider state.
- Host removal is two-layer: the app row goes `removed` (the authorization
  truth consulted on every future mint) and the provider participant is
  booted best-effort through the new `removeParticipant` adapter method —
  the adapter boundary stays provider-neutral.

### D2 — Match scoring is an append-only event ledger with a frozen late rule

- `LiveScoreEvent` is append-only; standings are server-computed
  `SUM(amount) GROUP BY teamId`; clients render, never supply.
- Idempotency: `(matchId, clientEventId)` UNIQUE — the reaction batch id /
  gift intent id is the dedupe key, so at-least-once transport (SSE, route
  retries) can never double-score.
- Late rule: ingestion only while `active` AND `now() <= endsAt`; the wall
  clock is enforced lazily (any read/ingest transitions an expired match
  first), so no timer infrastructure is needed and the rule is testable.
- Result of record: finals `LiveScoreSnapshot` rows written at the
  active→ended transition (host end or lazy timeout); draws have no winner;
  cancelled matches have no winner and no finals. Deterministic and
  auditable by construction.
- Match scoring reuses the underlying surfaces' rate limits and caps (no
  separate bypass) — anti-abuse is inherited, not re-invented.

### D3 — Gifting v1 is non-monetary dev credits with a spend window, no wallet

- The catalogue is original and server-seeded; `priceCredits` are integer
  DEV credits explicitly labelled zero-cash-value in the UI (work order
  §3.8/§3.9; no TikTok labels).
- The v1 abuse bound is a rolling per-sender spend window
  (`GIFT_SPEND_WINDOW_MAX` credits / 60s) + quantity clamp + rate limit.
  A balance/wallet is deliberately NOT built: the double-entry ledger,
  payment provider and compliance gates belong to the money phase, and a
  fake balance would violate the no-fake-success law.
- Gift sends commit durably (`GiftIntent` + `GiftEvent`) before any SSE
  fan-out; duplicates replay by `(sessionId, senderId, clientRequestId)`.
- During an active match with gift scoring, a viewer may direct a gift at a
  team (`matchTeamId`, server-validated) — the TikTok-style "support a
  side" mechanic without any money semantics.

## Consequences

- The guest token rung in `rooms.ts` consults `guests.ts` (the only new
  coupling on the Phase 1 lifecycle; everything else is additive).
- The stream contract widens by four event kinds (invite/stage/match/gift);
  the SSE DB tail re-derives all four for multi-instance correctness.
- Four moderation toggles (`guests-enable|disable`, `gifts-enable|disable`)
  join the audited vocabulary so hosts can gate the new surfaces mid-stream.
- Revisit triggers: >4-guest stages need an egress/composition decision
  (Cloudflare Stream/Mux path, work order §5); real-money gifting requires
  the §8 Phase 4/5 gate — PostgreSQL ledger review, signed webhooks, KYC —
  and must NOT extend these tables in place.
