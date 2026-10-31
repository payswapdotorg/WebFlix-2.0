# ADR-0010 — LIVE fan clubs: non-monetary community, derivation and gates

**Status:** Accepted
**Date:** 2026-10-31
**Context:** WFX2-LIVE-PLATFORM-1 Phase 5 — the work order §4G bullet 1
(non-monetary fan clubs), the last ungated gap under issue #2. The money
gate (§4G paid subscriptions, §4F real-money gifts, payouts) stays CLOSED.

## Decision

1. **The non-monetary law.** Club points, levels, badges and missions are
   ENTERTAINMENT facts. They are never money, never wallet balances, never
   convertible, never purchasable, and carry no cash value claim anywhere
   in the UI. The §4F/§4G money gate is untouched: no billing, no price,
   no payout path exists behind any club surface.
2. **One club per creator.** `LiveFanClub` carries a unique `hostId` — the
   TikTok fan-club model. Name/motto are clamped (CLUB_NAME_MAX /
   CLUB_MOTTO_MAX); join capacity is an honest documented law
   (CLUB_MEMBERS_MAX) rather than an unbounded growth path.
3. **Points derive from durable server facts only.** The append-only
   `LiveClubPointEvent` ledger is the authoritative history; every row
   carries an idempotencyKey derived from the durable event that earned it
   (`watch:{sessionId}:{userId}`, `chat:{messageId}`, `gift:{giftEventId}`) —
   duplicate delivery can never double-award (the ScoreEvent law). Awards
   ride the server's own durable commits (participant row, durable chat
   message, gift event) — clients never claim points. `member.points` is a
   maintained projection, re-derivable from the ledger.
4. **Levels are one server formula.** `level = min(CLUB_LEVEL_MAX,
   floor(points / club.pointsPerLevel) + 1)`. One knob per club; no
   per-tier configuration matrix in v1.
5. **Badges are derived at read, never stored on the message.** The chat
   payload stamps `senderClubLevel` from ONE batched membership lookup per
   fan-out — a membership change is reflected immediately and no denormalized
   badge column can drift.
6. **Members-only gates are server-side.** Room policy gains a
   `membersOnlyChat` toggle (audited moderation actions
   `members-chat-enable`/`members-chat-disable`); `canChat` combines it
   with club membership and reports the honest `members-only` blocked
   reason. Room `visibility` gains `"members"` — join/token/stage are
   gated on club membership (host always allowed) and members rooms are
   excluded from public discovery. Replay visibility gains `"members"` —
   playback authorizes the same membership gate. No client-supplied
   membership claim is ever trusted.
7. **Missions are derived read-only projections.** Three fixed non-monetary
   missions (first-steps: join a live session; voice: send chat messages;
   supporter: send a gift in a host room) are evaluated at read time from
   durable rows. No mission tables, no claimable state, no client-side
   counters.
8. **Best-effort awarding, never blocking.** A club-point award failure can
   never fail the chat send, gift send, or room join it rides on (the same
   best-effort law as the ops beacons and the match-scoring hook).

## Consequences

- The LIVE domain gains three additive tables in BOTH prisma variants
  (parity guard green); the club routes live at `/api/live-clubs/*` and
  speak the frozen DTOs only.
- The fan-club slice completes the work order's §4G bullet 1 without
  touching the money gate; paid subscriptions remain gated until
  legal/compliance/payment-provider/KYC sign-off.
- "Supporter emotes" remain unbuilt (work order: "where built") and are
  documented as not present rather than faked.
