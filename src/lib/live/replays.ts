/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 lane 4-a — the replay domain service
 * (ADR-0008: ONE replay lifecycle, TWO recording sinks).
 *
 * The replay law (frozen contract §The replay law, binding):
 *   1. ONE asset per session (LiveReplayAsset.sessionId UNIQUE). A failed
 *      asset is replaceable (upsert-replace on restart); a recording /
 *      processing / ready one conflicts (409).
 *   2. Host-only control (start/stop/visibility); `recording` itself is a
 *      stage-level fact every participant sees — the notifier seam below
 *      republishes the stage envelope on every durable start/stop (the
 *      consent law: no hidden recording, ever).
 *   3. The server owns the truth: uploads are size/MIME/duration-guarded,
 *      the storage seam decides where bytes live, the DB stores opaque
 *      keys only, playback URLs are minted at read time. No DTO ever
 *      carries a storageKey, path, or provider URL (the leak law).
 *   4. Durable commit before ready: object saved → row `ready`. A failed
 *      save flips the row to `failed` with the honest error.
 *   5. Retention + visibility are enforced at read time (lazy sweep) — no
 *      purge worker is needed for correctness in v1.
 *
 * INTEGRATION SEAM (TL wires at Phase 4 integration): recording start/stop
 * must republish the STAGE envelope (`recording: true/false` is stage
 * fact, ADR-0006 fast path). The stage DTO lives in guests.ts, which is
 * OUTSIDE this lane's file set — so the TL injects the publisher here via
 * `setStageRecordingNotifier(...)` at integration time. This module calls
 * the notifier (awaited, try/catch swallowed) after every durable start
 * (true) and stop (false) commit; the notifier can never fail the replay
 * response — the durable row is the truth.
 *
 * SERVER-ONLY (imports the provider adapter and the storage seam).
 */
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/youtube/cache";
import type { LiveReplayAsset } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import {
  RATE_LIMITS,
  REPLAY_DURATION_MAX_MS,
  REPLAY_LIST_MAX,
  REPLAY_MIME_TYPES,
  REPLAY_RETENTION_DAYS,
  REPLAY_UPLOAD_MAX_BYTES,
  activeSessionFor,
} from "./permissions";
import { LiveDomainError, adapter, resolveLiveIdentity } from "./rooms";
import { deleteReplayObject, saveReplayObject } from "./replay-storage";
import type {
  LiveReplayAssetDto,
  LiveReplaySink,
  LiveReplayStatus,
  LiveReplaySummaryDto,
  StartReplayInput,
} from "./types";

type ReplayVisibility = LiveReplayAssetDto["visibility"];

const VISIBILITIES: ReplayVisibility[] = ["inherit", "public", "unlisted", "hidden"];

// ── the stage-notifier seam (documented above; TL wires at integration) ──
let stageRecordingNotifier:
  | ((roomId: string, sessionId: string, recording: boolean) => Promise<void>)
  | null = null;

/** Integration hook: inject the stage-envelope republisher (TL-owned). */
export function setStageRecordingNotifier(
  fn: ((roomId: string, sessionId: string, recording: boolean) => Promise<void>) | null,
): void {
  stageRecordingNotifier = fn;
}

/** Best-effort by law — a notifier failure never fails the replay 200. */
async function notifyRecordingChanged(
  roomId: string,
  sessionId: string,
  recording: boolean,
): Promise<void> {
  if (!stageRecordingNotifier) return;
  try {
    await stageRecordingNotifier(roomId, sessionId, recording);
  } catch {
    // swallow: the stage republish is a fan-out courtesy, never the truth
  }
}

// ── DTO mapping (the leak law: storageKey NEVER leaves the server) ──

/** Map a durable row to the client DTO. Casts ride the frozen unions. */
export function mapReplayAssetDto(row: LiveReplayAsset): LiveReplayAssetDto {
  return {
    id: row.id,
    roomId: row.roomId,
    sessionId: row.sessionId,
    sink: row.sink as LiveReplaySink,
    status: row.status as LiveReplayStatus,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    visibility: row.visibility as ReplayVisibility,
    error: row.error,
    recordingStartedAt: row.recordingStartedAt.toISOString(),
    stoppedAt: row.stoppedAt ? row.stoppedAt.toISOString() : null,
    readyAt: row.readyAt ? row.readyAt.toISOString() : null,
    retentionExpiresAt: row.retentionExpiresAt
      ? row.retentionExpiresAt.toISOString()
      : null,
  };
}

/**
 * The opaque storage key for an asset's take. Derived deterministically
 * from the asset id + the guarded MIME so the stream route can re-derive
 * it from DTO-safe fields alone (no key is ever persisted in a URL).
 */
export function replayStorageKeyFor(assetId: string, mimeType: string | null): string {
  return `replay_${assetId}.${mimeType === "video/mp4" ? "mp4" : "webm"}`;
}

/** Shared gate: the room must exist and the caller must be its host. */
async function hostRoomOrThrow(roomId: string, sessionUser: WebFlixSessionUser | null) {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  const room = await db.liveRoom.findUnique({
    where: { id: roomId },
    select: { id: true, hostId: true },
  });
  if (!room) throw new LiveDomainError("not-found");
  if (room.hostId !== identity.id) throw new LiveDomainError("forbidden");
  return { identity, room };
}

/**
 * POST /replay/start — host only, live session required (else forbidden
 * "not-live"). Sink defaults to "host-capture"; "provider-egress" is
 * feature-checked against the OPTIONAL adapter().recording capability and
 * answers an honest 409 "egress-not-configured" when undeclared (never a
 * guessed attempt). One-asset law: recording/processing/ready conflicts
 * (409 "replay-active"); failed is replaceable via upsert-replace.
 */
export async function startReplay(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: StartReplayInput,
): Promise<LiveReplayAssetDto> {
  const { identity } = await hostRoomOrThrow(roomId, sessionUser);

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (
    !(await rateLimit(
      `wf:live:replayStart:${roomId}:${identity.id}`,
      RATE_LIMITS.replayStart,
    ))
  ) {
    throw new LiveDomainError("rate-limited", "replayStart");
  }

  const sink: LiveReplaySink = input.sink ?? "host-capture";
  if (sink !== "host-capture" && sink !== "provider-egress") {
    throw new LiveDomainError("invalid", "invalid-sink");
  }

  // One-asset conflict pre-check (pure read — never starts an egress for
  // a request that is going to 409 anyway).
  const existing = await db.liveReplayAsset.findUnique({
    where: { sessionId: session.id },
  });
  if (
    existing &&
    (existing.status === "recording" ||
      existing.status === "processing" ||
      existing.status === "ready")
  ) {
    throw new LiveDomainError("conflict", "replay-active");
  }

  if (sink === "provider-egress") {
    const capability = adapter().recording;
    if (!capability || !capability.egressConfigured) {
      throw new LiveDomainError("conflict", "egress-not-configured");
    }
    try {
      await capability.startRoomEgress(session.providerRoomId);
    } catch (err) {
      console.error("startReplay: provider egress failed", err);
      throw new LiveDomainError("provider-failed", "egress-start-failed");
    }
  }

  const now = new Date();
  const fresh = {
    sink,
    requestedById: identity.id,
    status: "recording",
    // fresh recording state: the failed take's facts are superseded
    error: null,
    storageKey: null,
    sizeBytes: null,
    durationMs: null,
    mimeType: null,
    stoppedAt: null,
    readyAt: null,
    retentionExpiresAt: null,
    recordingStartedAt: now,
  };
  const row = existing
    ? await db.liveReplayAsset.update({ where: { id: existing.id }, data: fresh })
    : await db.liveReplayAsset.create({
        data: { sessionId: session.id, roomId, ...fresh },
      });

  // Consent law: the stage envelope republishes recording:true (best-effort).
  await notifyRecordingChanged(roomId, session.id, true);
  return mapReplayAssetDto(row);
}

/**
 * POST /replay/stop — the host-capture finalize. Raw webm/mp4 body (NOT
 * JSON), Content-Type guarded, durationMs taken from the query. All guards
 * run BEFORE any write; the object is saved through the storage seam FIRST
 * and the row flips to `ready` only on a successful save (durable commit
 * before ready — law 4). durationMs is REJECTED, never clamped: a recorder
 * claiming an impossible take is lying, and the server does not lie for it.
 */
export async function stopReplay(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  upload: { body: ArrayBuffer; contentType: string | null; durationMs: number | null },
): Promise<LiveReplayAssetDto> {
  const { identity } = await hostRoomOrThrow(roomId, sessionUser);

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (
    !(await rateLimit(
      `wf:live:replayStop:${roomId}:${identity.id}`,
      RATE_LIMITS.replayStop,
    ))
  ) {
    throw new LiveDomainError("rate-limited", "replayStop");
  }

  const asset = await db.liveReplayAsset.findUnique({
    where: { sessionId: session.id },
  });
  if (!asset || asset.status !== "recording") {
    throw new LiveDomainError("conflict", "replay-not-recording");
  }

  // ── upload guards (all reject, none clamp) ──
  if (upload.body.byteLength === 0) {
    throw new LiveDomainError("invalid", "empty-recording");
  }
  if (
    !upload.contentType ||
    !(REPLAY_MIME_TYPES as readonly string[]).includes(upload.contentType)
  ) {
    throw new LiveDomainError("invalid", "unsupported-media-type");
  }
  if (upload.body.byteLength > REPLAY_UPLOAD_MAX_BYTES) {
    throw new LiveDomainError("invalid", "recording-too-large");
  }
  if (
    upload.durationMs === null ||
    !Number.isInteger(upload.durationMs) ||
    upload.durationMs <= 0 ||
    upload.durationMs > REPLAY_DURATION_MAX_MS
  ) {
    // CLAMPING IS FORBIDDEN (the no-silent-lies law) — reject.
    throw new LiveDomainError("invalid", "invalid-duration");
  }

  // ── durable commit: object FIRST, row flips after ──
  const storageKey = replayStorageKeyFor(asset.id, upload.contentType);
  try {
    await saveReplayObject(storageKey, new Uint8Array(upload.body));
  } catch (err) {
    console.error("stopReplay: storage save failed", err);
    await db.liveReplayAsset
      .update({ where: { id: asset.id }, data: { status: "failed", error: "storage-failed" } })
      .catch(() => undefined);
    throw new LiveDomainError("provider-failed", "storage-failed");
  }

  const now = new Date();
  const updated = await db.liveReplayAsset.update({
    where: { id: asset.id },
    data: {
      status: "ready",
      storageKey,
      mimeType: upload.contentType,
      sizeBytes: upload.body.byteLength,
      durationMs: upload.durationMs,
      stoppedAt: now,
      readyAt: now,
      retentionExpiresAt: new Date(now.getTime() + REPLAY_RETENTION_DAYS * 86_400_000),
      error: null,
    },
  });

  // Consent law: the stage envelope republishes recording:false.
  await notifyRecordingChanged(roomId, session.id, false);
  return mapReplayAssetDto(updated);
}

/**
 * GET /replay — visibility-checked read (works on ended rooms; the
 * active-session law only gates start/stop). Runs the LAZY RETENTION
 * SWEEP first: a ready asset past retentionExpiresAt purges its object
 * (best-effort) and flips to `expired` — the row survives as audit.
 * Visibility law: hidden → host only; otherwise the effective visibility
 * (asset override, else the room's) admits "public" (anyone) and
 * "unlisted" (link holders — a bare roomId IS the link). Returns null on
 * any denial; the route answers 404 (never a 403 — existence is not
 * disclosed to non-viewers).
 */
export async function getReplayFor(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<{ asset: LiveReplayAssetDto; playbackUrl: string } | null> {
  const room = await db.liveRoom.findUnique({
    where: { id: roomId },
    select: { id: true, hostId: true, visibility: true },
  });
  if (!room) return null;

  const callerId = sessionUser ? (await resolveLiveIdentity(sessionUser)).id : null;

  let asset = await db.liveReplayAsset.findFirst({
    where: { roomId },
    orderBy: { recordingStartedAt: "desc" },
  });
  if (!asset) return null;

  // Lazy retention sweep FIRST (law 5) — expired objects are purged on
  // read; no purge worker is required for v1 correctness.
  if (
    asset.status === "ready" &&
    asset.retentionExpiresAt &&
    asset.retentionExpiresAt.getTime() < Date.now()
  ) {
    if (asset.storageKey) {
      await deleteReplayObject(asset.storageKey).catch(() => undefined);
    }
    const swept = await db.liveReplayAsset
      .update({ where: { id: asset.id }, data: { status: "expired" } })
      .catch(() => null);
    if (swept) asset = swept;
  }

  const isHost = callerId !== null && callerId === room.hostId;
  if (asset.visibility === "hidden") {
    if (!isHost) return null;
  } else {
    const effective: string =
      asset.visibility === "inherit" ? room.visibility : asset.visibility;
    if (effective !== "public" && effective !== "unlisted") return null;
  }

  // Playback URL minted at read time — carries NO key, NO storageKey.
  return {
    asset: mapReplayAssetDto(asset),
    playbackUrl: `/api/live-rooms/${roomId}/replay/stream`,
  };
}

/**
 * PATCH /replay — host-only visibility control on the room's newest
 * replay asset. Validated against the frozen union; rate-limited.
 */
export async function setReplayVisibility(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  visibility: unknown,
): Promise<LiveReplayAssetDto> {
  const { identity } = await hostRoomOrThrow(roomId, sessionUser);

  if (
    !(await rateLimit(
      `wf:live:replayVisibility:${roomId}:${identity.id}`,
      RATE_LIMITS.replayVisibility,
    ))
  ) {
    throw new LiveDomainError("rate-limited", "replayVisibility");
  }

  if (typeof visibility !== "string" || !VISIBILITIES.includes(visibility as ReplayVisibility)) {
    throw new LiveDomainError("invalid", "invalid-visibility");
  }

  const asset = await db.liveReplayAsset.findFirst({
    where: { roomId },
    orderBy: { recordingStartedAt: "desc" },
  });
  if (!asset) throw new LiveDomainError("not-found", "no-replay");

  const updated = await db.liveReplayAsset.update({
    where: { id: asset.id },
    data: { visibility },
  });
  return mapReplayAssetDto(updated);
}

/**
 * GET /api/live/replays — the discovery shelf: the newest REPLAY_LIST_MAX
 * ready replays on public rooms with public/inherit asset visibility,
 * resolved host handles. Storage keys and absolute URLs stay server-side
 * (summaries carry the room link surface only).
 */
export async function listPublicReplays(): Promise<LiveReplaySummaryDto[]> {
  const assets = await db.liveReplayAsset.findMany({
    where: {
      status: "ready",
      visibility: { in: ["public", "inherit"] },
    },
    orderBy: { readyAt: "desc" },
    take: REPLAY_LIST_MAX * 4, // over-fetch before the room-visibility join
  });
  const roomIds = [...new Set(assets.map((a) => a.roomId))];
  const rooms = roomIds.length
    ? await db.liveRoom.findMany({
        where: { id: { in: roomIds }, visibility: "public" },
        select: {
          id: true,
          title: true,
          host: { select: { handle: true, name: true } },
        },
      })
    : [];
  const byRoom = new Map(rooms.map((r) => [r.id, r]));

  const out: LiveReplaySummaryDto[] = [];
  for (const asset of assets) {
    const room = byRoom.get(asset.roomId);
    if (!room) continue; // unlisted/hidden room — never on the shelf
    out.push({
      roomId: asset.roomId,
      sessionId: asset.sessionId,
      title: room.title,
      hostHandle: room.host.handle,
      hostName: room.host.name,
      readyAt: (asset.readyAt ?? asset.updatedAt).toISOString(),
      durationMs: asset.durationMs,
    });
    if (out.length >= REPLAY_LIST_MAX) break;
  }
  return out;
}

/**
 * The end-hook finalize (called by the TL's session-end path): any asset
 * still `recording` when the stream ends never got its take — flip it to
 * the honest `failed` state ("stream-ended-before-stop"). provider-egress
 * stopRoomEgress remains the end-hook's own business. NEVER throws.
 */
export async function finalizeRecordingOnEnd(sessionId: string, roomId: string): Promise<void> {
  try {
    const asset = await db.liveReplayAsset.findUnique({ where: { sessionId } });
    if (!asset || asset.status !== "recording") return;
    await db.liveReplayAsset.update({
      where: { id: asset.id },
      data: { status: "failed", error: "stream-ended-before-stop" },
    });
  } catch (err) {
    console.error("finalizeRecordingOnEnd failed", err);
  }
}
