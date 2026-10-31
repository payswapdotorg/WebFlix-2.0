# ADR-0009 — LIVE operations telemetry and the ops-admin gate

**Status:** Accepted
**Date:** 2026-10-31
**Context:** WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the work order §4H operations
dashboard (the last ungated wave). Issue #2.

## Decision

1. **Ops facts are durable observations, never authority.** A new append-only
   `LiveOpsEvent` table (both prisma variants, no FKs — bare ids, the same law as the
   interaction rows) records operational observations: client media beacons (TTFF,
   reconnects, join/media errors, sampled chat latency) and server-side facts
   (rate-limit denials, provider errors, end reconciles). Ops rows can never mutate
   room state, moderation state, scores, analytics snapshots or balances; a client
   can never claim a number the server derives. The dashboard's every figure is
   computed in ONE place (`deriveOpsOverview`) from durable rows — the ADR-0008
   derivation law, applied to operations.
2. **Client beacons are validated, clamped, rate-limited, identity-stamped.** The
   beacon endpoint accepts only the five client-beaconable kinds, requires a signed-in
   session, validates room/session membership, clamps every field
   (code ≤ 80, surface ≤ 60, meta ≤ 512 chars, valueMs ≤ 1h) and rate-limits through
   the capture path itself. Anonymous viewers are not captured — documented residual,
   never zero-filled.
3. **The ops surface is gated by an operator-declared allowlist** —
   `WEBFLIX_OPS_ADMIN_EMAILS` (case-insensitive session-email match). Fail-closed:
   unconfigured → 503 with the env name; signed out → 401; not on the list → 403.
   Resolved per request. This is the first first-party admin gate in the app; it is
   deliberately env-declared (no admin-role schema, no privilege-escalation surface)
   until a real admin domain is ever needed.
4. **Unmeasurable metrics answer honestly, not with zeros.** Provider costs
   (`provider-billing-api-not-connected`), egress metering
   (`egress-not-configured` / `egress-metering-not-instrumented`), outbox lag
   (`not-applicable` under ADR-0006 — hub + DB-tail, no outbox table), and
   anonymous-viewer media facts are typed unavailable blocks with reasons. The one
   real stored-volume fact (`SUM LiveReplayAsset.sizeBytes`) is shown as storage.
5. **Transport facts are labelled instance-local.** The attached-stream count comes
   from the ADR-0006 in-process hub (per-instance by design); the ~900ms DB tail is
   documented as the multi-instance flush floor.

## Consequences

- The dashboard is honest by construction: what it cannot measure it says so, with a
  reason, in a typed block — satisfying the work order §3.8 "no fake success" law for
  operations.
- The ops log is append-only and unbounded in v1; growth is bounded by the beacon
  rate limit and real traffic. A retention sweep is the documented follow-up when
  real traffic demands it.
- The rate-limit capture covers the high-traffic write surfaces; low-traffic
  surfaces keep the plain limiter (documented coverage, not silent).
- The money gate (§4F/§4G) is untouched: no cost/earnings figure exists on the
  dashboard, and none can arrive through the observation law.
