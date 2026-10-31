# ADR 0006 — WebFlix LIVE realtime room channels: SSE + durable cursor tail

**Status:** ACCEPTED (Phase 2)
**Decided by:** TL, under [issue #2](https://github.com/payswapdotorg/WebFlix-2.0/issues/2)
**Work order:** [WFX2-LIVE-PLATFORM-1](../plans/work-orders/WFX2-LIVE-PLATFORM-1.md) §4C, §5
**Related:** ADR 0005 (LiveKit pins the interactive MEDIA stage; this ADR covers
the event fan-out layer: chat, reactions, presence, room state, polls,
questions, moderation notices — not WebRTC media).

## Context

Phase 2 needs realtime room channels. Constraints measured, not assumed:

1. **Deployment reality:** WebFlix production is Vercel (`webflix-2-0`). A
   socket.io long-lived server is a separate process that Vercel's serverless
   model cannot host, so a socket.io mini-service would work in the dev
   sandbox but could never serve production — a two-transport architecture
   that silently diverges.
2. **Vercel WebSockets (GA 2026-10-20)** are designed for the Vercel runtime;
   there is no honest way to exercise that exact path inside `next dev` in
   this station, and the work order's no-fake-success law forbids shipping a
   transport that was never truly run. (The Phase 1 spike could run LiveKit
   locally because LiveKit is a real reachable server — a Vercel-only WS
   endpoint has no local truth.)
3. **Server-Sent Events work identically in `next dev` (Node runtime) and on
   Vercel** (streaming route handlers), need no extra process, and ride the
   existing HTTP/gateway path.
4. **Durability is relational by law** (work order §3.3): chat is durable
   Prisma state (`LiveRoomMessage` with a strict `seq` cursor); reactions and
   presence are ephemeral aggregates; nothing durable ever lives only in the
   fan-out layer.

## Decision

**One SSE endpoint per room** — `GET /api/live-rooms/[id]/stream` — is the
Phase 2 realtime layer, with a dual-speed delivery model:

- **Fast path (same instance):** an in-process hub (`src/lib/live/hub.ts`,
  a `BroadcastChannel`-free, plain EventEmitter keyed by room) receives
  publishes directly from the write routes and flushes to attached streams
  immediately. In the dev station and any single-instance deployment this is
  the common case.
- **Correctness floor (any topology):** every attached stream also tails the
  durable store on a ~900ms cadence (chat by `seq` cursor; the latest
  reaction total, presence count, room row, open poll). A write that took
  the fast path is idempotent with its own tail row (dedupe by `eventId`),
  so multi-instance production (Vercel) degrades to ≤ ~1s fan-out latency
  rather than to lost events.
- **At-least-once + resume:** streams are capped (~4 min) and the client
  reconnects with its max chat `seq`; the server replays strictly-after
  cursor. Every event carries `eventId`; clients dedupe. Reactions/presence
  are snapshot events (no replay needed beyond the latest snapshot).
- **Writes stay boring:** chat/reactions/presence/polls/questions/moderation
  are plain rate-limited POST routes (idempotency keys on every side
  effect). No client ever supplies an authoritative count (work order §3.4).

## Measured evidence (to be recorded at Phase 2 acceptance)

- Local same-instance chat delivery latency (hub fast path) — measured in
  the Phase 2 browser acceptance, target sub-100ms, recorded in the
  completion comment on issue #2 and in the wave-claims ledger row.
- Tail-floor fan-out latency (~900ms cadence) — verified by the SSE test
  pins; the multi-instance ceiling is STATED, not hidden.

## Consequences

- **Honest ceiling:** one SSE connection per viewer holds one streaming
  function invocation (Vercel fluid compute). At 10k concurrent viewers per
  room this is the wrong tool — the revisit trigger is documented: when a
  room sustains > ~500 attached streams or tail polling becomes a measured
  DB cost, re-open with Vercel WebSockets or a managed realtime service
  (work order §5 names both), behind the same frozen `LiveStreamEvent`
  envelope so client code never changes.
- The stream is **provider-neutral** (no LiveKit dependency) — media state
  arrives via the existing room-poll contract; ADR-0005 stays scoped to
  media.
- Chat ordering is total (single `seq`); the moderator tombstone flows as a
  chat event (`deleted: true`), so every client converges on the same truth.
