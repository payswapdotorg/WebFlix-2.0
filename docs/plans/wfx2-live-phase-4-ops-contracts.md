# WFX2-LIVE-PLATFORM-1 — Phase 4-OPS contracts (frozen)

**Work order:** `docs/plans/work-orders/WFX2-LIVE-PLATFORM-1.md` §4H, last bullet —
_"Operations dashboard with time-to-first-frame, join errors, media latency, reconnects,
chat latency, outbox lag, provider costs, egress, high-volume rooms and rate-limits."_

**Status:** FROZEN by the TL before implementation (work order §7: the TL owns shared
contracts). This is the LAST ungated wave of the work order; the §4F/§4G money gate
stays closed (Phase 5 blocked until legal/compliance/payment-provider/KYC sign-off).

**Base SHA:** `6f08e32` (Phase 4 acceptance round, on `main`).

## 0. The two laws this wave adds

1. **The observation law (ADR-0009).** Ops rows are *observations*, never authority.
   A `LiveOpsEvent` can never mutate room state, scores, moderation state, analytics
   snapshots or any balance. Client beacons are labelled client observations and are
   validated, clamped, rate-limited and identity-stamped server-side; every count the
   dashboard shows is server-derived from durable rows in ONE place
   (`deriveOpsOverview`), the same derivation law ADR-0008 set for creator analytics.
2. **The ops-gate law.** There was no first-party site-admin concept before this wave.
   The operations surface is gated by an operator-declared allowlist —
   `WEBFLIX_OPS_ADMIN_EMAILS` (comma-separated, case-insensitive, compared against the
   session email). Fail-closed: no env → 503 `ops-admin-not-configured` (the honest
   explainer, never a fake empty dashboard); signed out → 401; signed in but not on
   the list → 403. The gate resolves per request — never from client payloads.

## 1. The durable model — `LiveOpsEvent` (additive, BOTH prisma variants)

```
model LiveOpsEvent {
  id        String   @id @default(cuid())
  kind      String
  surface   String?
  roomId    String?
  sessionId String?
  actorId   String?
  code      String?
  valueMs   Int?
  meta      String?
  createdAt DateTime @default(now())
  @@index([kind, createdAt])
  @@index([roomId, createdAt])
  @@index([createdAt])
}
```

- **No FKs by design** (same law as the interaction rows: bare shadow ids) — the ops
  log must survive even a room purge and never cascade-delete history.
- `kind` is the frozen union below; `surface` is the route/surface label;
  `code` is an error/limit code; `valueMs` is a sampled duration;
  `meta` is a bounded JSON blob (≤ 512 chars, never identity-bearing keys).
- Append-only: nothing in this wave ever updates or deletes an ops row.

### The frozen kind union

| kind | source | meaning |
|---|---|---|
| `ttff` | client beacon | time-to-first-frame: join intent → first rendered program frame (ms) |
| `reconnect` | client beacon | a media reconnect recovered back to Connected (valueMs = recovery time) |
| `join_error` | client beacon | the viewer room failed to attach (code = the honest error code) |
| `media_error` | client beacon | a media failure after attach (code) |
| `chat_latency` | client beacon | sampled server-commit latency of the sender's own chat POST (ms) |
| `rate_limit` | server | a LIVE route denied a request for exceeding `RATE_LIMITS[surface]` |
| `provider_error` | server | the LiveKit adapter failed a lifecycle call (code) |
| `end_reconcile` | server | a session end reconcile ran (the end-hook fact, valueMs = session duration) |

Client-beaconable kinds are exactly: `ttff, reconnect, join_error, media_error,
chat_latency` (the first five). The server kinds (`rate_limit, provider_error,
end_reconcile`) are **never** accepted from a client payload.

## 2. Numeric laws (appended to the shared core in `permissions.ts`)

```ts
export const OPS_BEACON_KINDS = [...]        // the 5 client-beaconable kinds
export const OPS_CODE_MAX = 80;              // code/surface char clamps: 80/60
export const OPS_SURFACE_MAX = 60;
export const OPS_META_MAX = 512;             // serialized meta clamp
export const OPS_VALUE_MS_MAX = 3_600_000;   // 1h clamp on any sampled duration
export const OPS_WINDOW_MS_MIN = 3_600_000;      // overview window clamp 1h..30d
export const OPS_WINDOW_MS_MAX = 30 * 24 * 3_600_000;
export const OPS_WINDOW_MS_DEFAULT = 24 * 3_600_000;
RATE_LIMITS.beacon      = { limit: 30, windowMs: 60_000 };
RATE_LIMITS.opsOverview = { limit: 30, windowMs: 60_000 };
```

## 3. Routes (frozen)

### `POST /api/live/ops/beacon` — client media observations
- Body: `{ kind, roomId, sessionId?, code?, valueMs?, meta? }` (all strings clamped,
  `valueMs` integer-clamped; `meta` ≤ 512 chars of JSON the server re-serializes).
- Requires a signed-in session (the shadow-user seam stamps `actorId`). Anonymous
  viewers cannot beacon — an honest, documented residual (their media facts are
  simply not captured; nothing is synthesized for them).
- Validates: kind ∈ `OPS_BEACON_KINDS`; the room exists (404 otherwise); the session
  id, when supplied, belongs to that room (422 otherwise).
- Rate-limited via the ops capture path itself (`RATE_LIMITS.beacon`) — a denied
  beacon is itself a `rate_limit` observation.
- Answers `200 { ok: true }`; never leaks anything (fire-and-forget on the client).

### `GET /api/live/ops/overview?windowMs=` — the ops dashboard feed
- The ops-gate law (§0.2) resolves first: 401 / 503 / 403 / 200 in that order.
- `windowMs` clamped to `[OPS_WINDOW_MS_MIN, OPS_WINDOW_MS_MAX]`, default 24h.
- Answers the `LiveOpsOverviewDto` — every number derived in `deriveOpsOverview()`
  from durable rows only (ops log + rooms/sessions/participants + chat/reactions/
  gifts/matches + moderation/report rows + replay assets). No client claim anywhere.

## 4. The `LiveOpsOverviewDto` (frozen shape, `types.ts` §Phase 4-OPS)

- `windowMs`, `generatedAt`
- `media`: `ttff {count, p50Ms, p95Ms}`, `reconnects`, `joinErrors {count, top[5]}`,
  `mediaErrors {count, top[5]}`
- `chatLatency`: `{count, p50Ms, p95Ms}` (server-commit latency, sampled client-side)
- `rateLimits`: `{denials, top[5] by surface}`
- `provider`: `{errors, top[5] by code, costs: unavailable, egress: unavailable|declared}`
- `reconciles`: `{endReconciles}`
- `rooms`: `{liveNow, startedInWindow, endedInWindow, endReasons[]}`
- `volume.rooms[10]`: the high-volume rooms — per room `title/hostHandle/status/
  sessions/chatMessages/reactionHearts/giftEvents/matches/peakViewers/lastActivityAt`,
  ranked by interaction volume in the window (server-computed, durable rows only)
- `moderation`: `{actions, reports}` in window
- `transport`: `{attachedStreamsThisInstance, tailFlushMs: 900, outbox: not-applicable}`
  — the hub listener count is an **instance-local** fact and is labelled as such
  (ADR-0006: per-instance fast path + the DB tail as the multi-instance floor).
- `storage`: `{replayAssets, replayBytes}` (SUM `LiveReplayAsset.sizeBytes` — the one
  real stored-volume fact that exists)

### The honest-unavailable contract (work order §3.8 — no fake success)

| Metric | Dashboard answer | Why |
|---|---|---|
| provider costs | `{status:"unavailable", reason:"provider-billing-api-not-connected"}` | no provider billing API is connected to this deployment |
| egress | `{status:"unavailable", reason:"egress-not-configured"}` (or `egress-metering-not-instrumented` when the operator declares `LIVEKIT_EGRESS_ENABLED`) | egress metering is not instrumented; `storage.replayBytes` is the real stored-volume fact shown alongside |
| outbox lag | `{status:"not-applicable", reason:"adr-0006-has-no-outbox"}` | ADR-0006 chose hub + DB-tail, deliberately no outbox table; `tailFlushMs: 900` is the documented flush cadence |
| anonymous-viewer media facts | absent (not zero-filled) | beacons require a session; the residual is documented, never synthesized |

## 5. Server capture points (this wave, best-effort — never throws into a 200 path)

1. `opsRateLimit(surface, key, limits)` in `ops.ts` — wraps the shared `rateLimit()`;
   on denial records `rate_limit` for that surface. The high-traffic LIVE write
   surfaces (chat, reactions, presence, gifts, invites, match start, moderation,
   replay start/stop, beacon, overview) capture; low-traffic surfaces keep the plain
   limiter and are documented as uncaptured coverage.
2. `startSession` / `endRoom` provider failures in `rooms.ts` record `provider_error`
   (best-effort, the honest domain error still surfaces to the route unchanged).
3. The session end-hook (where `recordSessionAnalytics` already runs) records
   `end_reconcile` with the session's duration.

## 6. Client surfaces (this wave)

- `src/lib/live/ops-beacon.ts` — the client beacon helper: fire-and-forget POST,
  silent on any failure, never blocks media, never retries (the next observation
  supersedes a dropped sample).
- The viewer room (`view.tsx`): TTFF (join intent → first program frame via the
  stage's video element), reconnect recovery, join/media errors.
- The chat panel: every 5th own send samples `chat_latency` (POST start → durable
  200).
- `/admin/live-ops`: the gated dashboard — honest gate states (sign-in explainer /
  not-configured explainer with the env name / restricted), window selector
  (1h/24h/7d), metric blocks, top-rooms table, auto-refresh 30s. No sidebar entry —
  the surface is operator-reachable by URL (documented residual: discoverability is
  deliberate, an ops console is not a consumer nav item).

## 7. Test pins (the battery)

`tests/live-ops.test.ts` (+ UI pins): kind-allowlist (server kinds rejected from
clients), clamps (code/surface/meta/valueMs), the gate matrix (unauthenticated 401 /
not-configured 503 / non-admin 403 / admin 200), beacon room/session validation,
beacon rate limit records a `rate_limit` row, `deriveOpsOverview` math (p50/p95,
counts, endReason distribution, top-rooms ranking, honest-unavailable blocks),
`end_reconcile` capture, `provider_error` capture, and the parity law stays green
(additive model in BOTH variants).

## 8. Non-goals (this wave)

- No money metrics (the §4F gate is closed; no wallet exists).
- No ops-event retention sweep in v1 — the log grows one row per observation at
  beacon-rate limits (≤ 30/min/actor) and server captures (bounded by real traffic);
  a retention policy is documented as the follow-up when real traffic demands it.
- No multi-instance aggregation (the transport facts are instance-local and labelled).
