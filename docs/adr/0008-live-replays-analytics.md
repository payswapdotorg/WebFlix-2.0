# ADR 0008 — WebFlix LIVE replays (two recording sinks) and creator analytics

**Status:** ACCEPTED (Phase 4, 2026-10-31)
**Decided by:** TL, under [issue #2](https://github.com/payswapdotorg/WebFlix-2.0/issues/2)
**Work order:** [WFX2-LIVE-PLATFORM-1](../plans/work-orders/WFX2-LIVE-PLATFORM-1.md) §4H
**Supersedes:** none. **Related:** ADR 0005 (LiveKit stage), ADR 0006 (SSE), ADR 0007 (guests/matches/gifts).

## Context

The work order §4H requires a provider recording/replay lifecycle with consent,
retention policy, visibility/permission checks, replay processing state and
playback, plus an explicit chat replay policy and creator analytics. The money
gate (§4F/§4G billing) stays closed; replays + analytics are the remaining
ungated wave. Production runs LiveKit Cloud (ADR-0005) but the sandbox dev
environment runs a self-hosted LiveKit with no egress service, and no object
storage credential (R2) is currently re-supplied.

## Decision

**ONE replay lifecycle (`LiveReplayAsset`), TWO recording sinks behind it:**

1. **`provider-egress`** — LiveKit RoomCompositeEgress via the new optional
   `adapter().recording` capability. Gated on an explicit operator
   declaration (`LIVEKIT_EGRESS_ENABLED=true`; the storage destination is
   the egress deployment's own config, filepath prefix overridable via
   `LIVEKIT_EGRESS_FILEPATH`); undeclared egress answers an honest
   409 `egress-not-configured` and never a guessed attempt. The
   processing state (`recording → processing → ready/failed`) is reserved for
   this sink; the provider's produced file is transferred into WebFlix storage
   before `ready` (never hot-linked).
2. **`host-capture`** — the host console records the program view locally
   (MediaRecorder over the console's composite canvas + mixed stage audio) and
   uploads the take at stop to `POST /api/live-rooms/[id]/replay/stop`.
   Size-capped (REPLAY_UPLOAD_MAX_BYTES = 64 MiB), MIME-checked
   (webm/mp4), rate-limited. This is a first-party, provider-neutral path that
   works on every deployment including the self-hosted dev station.
   Honest limit: v1 host-capture records what the console composites — the
   host program; guest media contributes only while rendered into the console
   composite. This limit is stated in the UI copy ("records the program view
   in this console") and in the work-order matrix (PARTIAL until egress is
   provisioned).

**Storage seam** (`src/lib/live/replay-storage.ts`): `saveReplayObject` /
`readReplayObject` / `deleteReplayObject` over a local-FS implementation
(`db/live-replays/`, gitignored) today; an R2/Cloudflare implementation slots
in behind the same seam when credentials are re-supplied. Objects are stored
under opaque keys; no absolute URL is ever persisted — playback URLs are
issued at read time (`GET .../replay/stream` with Range support).

**Consent + indicator law:** recording start is host-only, and the stage DTO
carries `recording: boolean`; the stage envelope republishes on start/stop so
every participant (and the viewer room) renders the REC indicator while
recording. A hidden indicator is a contract violation, not a UI detail.

**Chat replay policy (explicit, as the work order demands):** durable chat IS
replayed on the replay view, with moderation tombstones applied (removed
messages stay removed). Polls/Q&A/matches are NOT replayed in v1 — their
per-instant state would render misleadingly on a scrubbed timeline; the
replay view shows the recorded video + the durable chat only.

**Retention:** `REPLAY_RETENTION_DAYS = 30`. `retentionExpiresAt` is stamped
at finalize; any replay read lazily purges expired objects and marks the row
`expired` (the row survives as audit).

**Creator analytics:** `LiveAnalyticsSnapshot` is DERIVED, never claimed.
Every number is recomputed server-side from durable rows on each host read
(idempotent upsert): session window (duration), `LiveSession.peakViewers`
(presence-time concurrent peak, raised by the heartbeat path), distinct viewer
rows, non-tombstoned chat count, SUM(reaction batches), gift events/credits
(dev credits, §4F sandbox), matches run, and the replay status. The end
session path writes the snapshot best-effort and the host read always
re-derives — a failed end-hook self-heals on the next read.
Watch-time/retention/stream-error metrics need event history that Phase 4
does not add; they are honest residuals, not silently-zero fields.

## Consequences

- `prisma` gains two models in BOTH variants (`LiveReplayAsset`,
  `LiveAnalyticsSnapshot`) + the additive `LiveSession.peakViewers` column
  (parity test guards).
- The adapter interface gains an OPTIONAL `recording` capability — the first
  optional member; callers must feature-check it (`adapter().recording`).
- The console gains REC start/stop + upload; the viewer room and ended-room
  gain the replay player; discovery gains a replays shelf
  (`GET /api/live/replays`).
- No money flows: replays are free, analytics show dev-credit gift totals,
  and the §8 Phase 4/5 money gate remains CLOSED.
- Egress cost/billing remains unmeasured until the operator provisions and
  declares egress; the ADR-0005 cost basis stands.
