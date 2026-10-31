# WFX2-LIVE-PLATFORM-1 — Phase 4 frozen contracts (issue #2)

**Status:** FROZEN by the TL 2026-10-31, before lane dispatch (work order §7).
**Scope:** work order §4H (replays + creator analytics). The §4F/§4G money
gate stays CLOSED — no billing, wallet, subscription, or payout exists in
this wave.
**Schema:** both Prisma variants carry `LiveReplayAsset` +
`LiveAnalyticsSnapshot` + the additive `LiveSession.peakViewers` column
(parity test guards; pushed to `db/live-test.db`).
**Types:** `src/lib/live/types.ts` §Phase 4 is the only DTO vocabulary;
`LiveStageDto` gains the additive `recording: boolean`.
**Shared core:** `src/lib/live/permissions.ts` (REPLAY_* numeric laws + four
new RATE_LIMITS) + `src/lib/live/provider.ts` (the OPTIONAL
`recording` capability) + `src/lib/live/livekit-adapter.ts` (env-gated
`LIVEKIT_EGRESS_ENABLED`).
**ADR:** `docs/adr/0008-live-replays-analytics.md` pins the decisions.

## The three lanes (disjoint files; no lane touches another's tree)

| Lane | Owns (new files) | Tests |
| --- | --- | --- |
| **4-a replay** | `src/lib/live/replays.ts`, `src/lib/live/replay-storage.ts`, `src/app/api/live-rooms/[id]/replay/**`, `src/app/api/live/replays/route.ts` | `tests/live-replays.test.ts` |
| **4-b analytics** | `src/lib/live/analytics.ts`, `src/app/api/live-rooms/[id]/analytics/route.ts`, `src/app/api/studio/live-sessions/route.ts` | `tests/live-analytics.test.ts` |
| **4-c UI** | `src/components/live/live-replay-panel.tsx`, `src/components/live/live-recorder-console.tsx`, `src/components/live/live-replay-shelf.tsx` | `tests/live-ui-phase4.test.tsx` |

Integration lane (TL only): `rooms.ts` (end-hook: analytics snapshot +
recording finalize), `presence.ts` (peak-viewers raise), `guests.ts` (stage
DTO carries `recording` + stage republish on start/stop), the viewer room
view + studio live view + discovery view wiring of the 4-c components,
`package.json` test registration, gates, acceptance, push.

## Frozen routes

- `POST /api/live-rooms/[id]/replay/start` — host only, live session; body
  `StartReplayInput`; 200 `{ asset: LiveReplayAssetDto }`; 403 forbidden /
  not-live; 409 `replay-active` (a non-failed asset already exists on the
  session) / `egress-not-configured` (sink `provider-egress` without the
  declared capability); 429 replayStart. Start flips the asset to
  `recording`, stamps `recordingStartedAt`, and republishes the stage
  envelope (`recording: true`).
- `POST /api/live-rooms/[id]/replay/stop` — host only; raw webm/mp4 body
  (NOT JSON; `Content-Type` must be in REPLAY_MIME_TYPES) with
  `?durationMs=` query; 200 `{ asset }` (status `ready`, `storageKey`
  stamped, `retentionExpiresAt` set, `readyAt` now); 403/404; 409
  `replay-not-recording`; 400 `invalid` (empty body, foreign MIME, size >
  REPLAY_UPLOAD_MAX_BYTES, durationMs > REPLAY_DURATION_MAX_MS); 429
  replayStop. Upload is the durable commit — the object is saved BEFORE the
  row flips to `ready` (a failed save flips the row to `failed` with the
  honest error).
- `GET /api/live-rooms/[id]/replay` — visibility-checked (room public OR
  caller is host; hidden replays are host-only; unlisted rooms serve link
  holders). 200 `{ asset: LiveReplayAssetDto, playbackUrl: string }` — the
  playback URL is issued at read time and carries no key. Lazy retention
  sweep runs here: expired → object deleted, row `expired`.
- `PATCH /api/live-rooms/[id]/replay` — host only; body
  `{ visibility: "inherit" | "public" | "unlisted" | "hidden" }`; 200
  `{ asset }`; 429 replayVisibility.
- `GET /api/live-rooms/[id]/replay/stream` — the issued playback URL;
  supports HTTP Range (`206` partial content, `Content-Range`), serves
  `Content-Type` from the asset, `X-Content-Type-Options: nosniff`; 404 for
  non-ready/hidden/expired per the same visibility law.
- `GET /api/live/replays` — the discovery shelf: the newest REPLAY_LIST_MAX
  public ready replays on public rooms, resolved host handles; 200
  `{ replays: LiveReplaySummaryDto[] }`.
- `GET /api/live-rooms/[id]/analytics` — host only; RE-DERIVES the snapshot
  from durable rows and upserts (idempotent); 200
  `{ snapshot: LiveAnalyticsSnapshotDto }`; 403 otherwise; 429 analytics.
- `GET /api/studio/live-sessions` — host's own rooms' latest ended sessions
  (limit 20, newest first) with `{ room, session, snapshot, replay }`
  summaries for the studio panel; host-scoped by construction.

## The replay law (binding)

1. **One asset per session** (`sessionId` UNIQUE). A `failed` asset may be
   re-started (the failed row is superseded — its replacement reuses the
   session slot via upsert); a `recording`/`ready` one conflicts (409).
2. **Host-only control, visible-to-all fact**: start/stop/visibility are
   host mutations; `recording` is a stage-level fact every participant sees
   (the consent law — no hidden recording, ever).
3. **Server owns the truth**: the upload is size/MIME/duration-guarded; the
   storage seam decides where bytes live; the DB stores opaque keys only;
   playback URLs are minted at read time. No renderer ever sees a key, path,
   or provider URL.
4. **Durable commit before ready**: object saved → row `ready`. The
   inverse path (row ready, object missing) must not exist; reads verify
   and answer `failed` honestly when the object is gone.
5. **Retention + visibility enforced at read time** (lazy sweep), so no
   purge worker is required for correctness in v1.
6. **Idempotent finalize**: a repeated stop with the same body returns the
   existing ready asset (client retry safety); a stop on a non-recording
   asset 409s.

## The analytics law (binding)

1. **Derived-only**: every field comes from durable rows (participants,
   messages, reaction batches, gift events, matches, session window,
   `LiveSession.peakViewers`). Clients can never supply a number.
2. **Idempotent recompute**: the upsert keys on `sessionId`; two recomputes
   produce the same numbers while the underlying rows are unchanged.
3. **Money stays zero-cash**: `giftCredits` counts DEV credits (no cash
   value); no wallet/earnings/payout field exists in Phase 4 (the gate).
4. **The end-hook is best-effort, the read is authoritative**: endSession
   attempts the snapshot; a failure never blocks the end reconcile, and the
   next host read re-derives (self-healing).
5. **Honest residuals**: watch time, retention curves, and stream-error
   counts need event history Phase 4 does not add — they are documented
   gaps (PARTIAL in the feature matrix), not zero-filled fakes.

## Stream fan-out (ADR-0006 fast path)

Recording start/stop republishes the STAGE envelope (the `recording` flag is
stage fact). A replay becoming `ready` does NOT need a live fan-out — the
room is ended at that point and the ended-room poll reconciles (the Phase 1
proved path).

## Laws every lane implements (no exceptions)

1. Server-authoritative outcomes; clients send validated intent +
   idempotency keys only (work order §3.4).
2. Signed-in writes resolve through `liveActorFor()`; bans block replay
   control by the same law; mutes never do (the Phase 2 asymmetry holds).
3. Active-session law: replay start/stop 403 (`not-live`) without a live
   session; GET replay / stream / shelf / analytics work on ended rooms.
4. Rate limits via the app-wide `rateLimit()` adapter, keys namespaced
   `wf:live:<surface>:<roomId>:<userId>`.
5. Honest errors: the `LiveDomainError` → `liveErrorStatus` contract.
6. No provider coupling outside the adapter: `provider-egress` rides
   `adapter().recording` only (feature-checked, optional).
7. Tests are behavior pins on the shared `db/live-test.db` via
   `tests/live-helpers.ts`, calling route handlers directly: authorization
   matrix, one-asset law, upload guards (size/MIME/duration), visibility
   matrix, retention sweep, idempotent recompute, 403/409/429 contracts. No
   LiveKit network calls in tests (fixtures start sessions directly).
8. Additive only: no lane edits frozen files (types.ts, permissions.ts,
   policy.ts, provider.ts, rooms.ts, presence.ts, reactions.ts,
   moderation.ts, hub.ts, guests.ts, schema) — needs go through the TL.
