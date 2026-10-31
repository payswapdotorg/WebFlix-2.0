/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — the SAFETY domain service (lane 2-b).
 *
 * Moderation, moderator grants and viewer reports, all server-authoritative
 * (work order §4I): clients send intent ids only; THIS layer resolves the
 * actor through liveActorFor() and derives every outcome. Laws implemented
 * here:
 *   - Host + granted moderators share the moderation capability set
 *     (canModerate); slow-mode / chat-enable / chat-disable are HOST-ONLY
 *     (isHost) — moderators never flip room policy.
 *   - The room host may never be muted or banned — by anyone, including
 *     the host themselves.
 *   - EVERY successful call appends exactly ONE LiveModerationAction row.
 *     Rows are append-only (never updated, never deleted); mute/ban STATE
 *     is derived from this ledger by activeSanctions() (permissions.ts), so
 *     state can never drift from the audit trail. Unmute/unban are
 *     idempotent: even with no prior sanction the call succeeds and still
 *     appends the row — the ledger records intent.
 *   - delete-message tombstones the LiveRoomMessage (deletedAt/deletedBy);
 *     the row SURVIVES (audit law — never hard-delete).
 *   - Cross-lane publish law: room-policy changes and tombstones are
 *     persisted here; the SSE fan-out is lane 2-a's concern (the stream
 *     tail picks the change up). This file imports NOTHING from chat/hub.
 *   - Moderator grants are a persistent ledger (LiveRoomModerator):
 *     revocation soft-deletes (revokedAt/revokedBy, row survives), a
 *     re-grant re-activates the revoked row.
 *   - Rate limits via the app-wide rateLimit() adapter, keys namespaced
 *     wf:live:<surface>:<roomId>:<userId> (shared law §4).
 */
import { db } from "@/lib/db";
import { LiveDomainError } from "./rooms";
import { publishLiveEvent } from "./hub";
import { mapChatMessage } from "./chat";
import {
  activeSessionFor,
  canModerate,
  isHost,
  liveActorFor,
  RATE_LIMITS,
  resolveHandles,
  roomPolicyFor,
  SLOW_MODE_MAX_SECONDS,
  type LiveActor,
} from "./permissions";
import { rateLimit } from "@/lib/youtube/cache";
import type {
  CreateLiveReportInput,
  LiveModerationActionDto,
  LiveModerationActionKind,
  LiveReportDto,
  LiveReportReason,
  PerformLiveModerationInput,
} from "./types";
import type { LiveModerationAction, LiveReport, LiveRoomModerator } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";

/** Mute window bounds (seconds) — default 10 minutes, max one day. */
const MUTE_DEFAULT_SECONDS = 600;
const MUTE_MIN_SECONDS = 1;
const MUTE_MAX_SECONDS = 86_400;
/** Moderation reason cap (chars) — mirrors the chat body cap. */
const MODERATION_REASON_MAX = 280;
/** Report detail cap (chars). */
const REPORT_DETAIL_MAX = 1000;
/** Default/max page sizes for the audit/report read paths. */
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

const ACTION_KINDS: ReadonlySet<string> = new Set<LiveModerationActionKind>([
  "delete-message",
  "mute",
  "unmute",
  "ban",
  "unban",
  "slow-mode",
  "chat-enable",
  "chat-disable",
]);

/** Kill-switch class actions — the host's alone (moderators never flip policy). */
const HOST_ONLY_KINDS: ReadonlySet<string> = new Set<LiveModerationActionKind>([
  "slow-mode",
  "chat-enable",
  "chat-disable",
]);

const REPORT_REASONS: ReadonlySet<string> = new Set<LiveReportReason>([
  "spam",
  "harassment",
  "inappropriate",
  "other",
]);

/** The small inline DTO for the moderator grant ledger (contracts doc). */
export interface LiveRoomModeratorDto {
  roomId: string;
  userId: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

type HandleMap = Map<string, { handle: string; name: string }>;

function invalid(message: string): LiveDomainError {
  return new LiveDomainError("invalid", message);
}

function mapAction(row: LiveModerationAction, handles: HandleMap): LiveModerationActionDto {
  return {
    id: row.id,
    roomId: row.roomId,
    actorId: row.actorId,
    actorHandle: handles.get(row.actorId)?.handle ?? "",
    targetId: row.targetId,
    targetHandle: row.targetId ? (handles.get(row.targetId)?.handle ?? "") : null,
    action: row.action as LiveModerationActionKind,
    reason: row.reason,
    messageId: row.messageId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapReport(row: LiveReport, handles: HandleMap): LiveReportDto {
  return {
    id: row.id,
    roomId: row.roomId,
    reporterId: row.reporterId,
    reporterHandle: handles.get(row.reporterId)?.handle ?? "",
    targetId: row.targetId,
    messageId: row.messageId,
    reason: row.reason as LiveReportReason,
    detail: row.detail,
    status: row.status as LiveReportDto["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function mapModerator(row: LiveRoomModerator): LiveRoomModeratorDto {
  return {
    roomId: row.roomId,
    userId: row.userId,
    grantedBy: row.grantedBy,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedBy: row.revokedBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Optional free-text field: trimmed, length-capped, empty → null. */
function normalizeText(raw: unknown, max: number, label: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw invalid(`${label} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length > max) throw invalid(`${label} must be ≤${max} chars`);
  return trimmed.length > 0 ? trimmed : null;
}

/** Shared read-path clamp: default 50, max 100, garbage → default. */
function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return LIST_DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), LIST_MAX_LIMIT);
}

function requireTarget(input: PerformLiveModerationInput): string {
  const targetId = input.targetId;
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw invalid("targetId is required for this action");
  }
  return targetId;
}

/** The room host is untouchable — by anyone, themselves included. */
function guardNotHost(hostId: string, targetId: string): void {
  if (targetId === hostId) {
    throw new LiveDomainError("forbidden", "the room host cannot be moderated");
  }
}

// ═══════════════════════════════════════════════════════════════════
// Moderation actions (the append-only audit trail)
// ═══════════════════════════════════════════════════════════════════

/**
 * Perform one audited moderation action. Authorization ladder:
 * unauthenticated → not-found (room) → forbidden (not host/moderator) →
 * forbidden (host-only kind) → invalid (kind/payload) — then the ledger
 * append. Room-policy flips and message tombstones are persisted here;
 * fan-out is lane 2-a's (no chat/hub imports on purpose).
 */
export async function performModeration(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  input: PerformLiveModerationInput,
): Promise<{ action: LiveModerationActionDto }> {
  const actor: LiveActor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }

  const kind = input?.action;
  if (typeof kind !== "string" || !ACTION_KINDS.has(kind)) {
    throw invalid("unknown moderation action");
  }
  if (HOST_ONLY_KINDS.has(kind) && !isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host-only action");
  }

  if (
    !(await rateLimit(`wf:live:moderation:${roomId}:${actor.id}`, RATE_LIMITS.moderation))
  ) {
    throw new LiveDomainError("rate-limited");
  }

  const reason = normalizeText(input.reason, MODERATION_REASON_MAX, "reason");
  const now = new Date();
  // Best-effort session stamp for the audit row (moderation is legal
  // between sessions too, so null is fine).
  const sessionId = (await activeSessionFor(roomId))?.id ?? null;

  let targetId: string | null = null;
  let messageId: string | null = null;
  let expiresAt: Date | null = null;

  switch (kind) {
    case "delete-message": {
      const id = input.messageId;
      if (typeof id !== "string" || id.length === 0) {
        throw invalid("messageId is required for delete-message");
      }
      const message = await db.liveRoomMessage.findFirst({ where: { id, roomId } });
      if (!message) {
        throw new LiveDomainError("not-found", "no such message in this room");
      }
      // Tombstone, never delete — the audit law (schema comment: the row
      // survives so the audit trail survives).
      await db.liveRoomMessage.update({
        where: { id: message.id },
        data: { deletedAt: now, deletedBy: actor.id },
      });
      messageId = message.id;
      break;
    }
    case "mute": {
      targetId = requireTarget(input);
      guardNotHost(room.hostId, targetId);
      const seconds = input.expiresInSeconds ?? MUTE_DEFAULT_SECONDS;
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < MUTE_MIN_SECONDS ||
        seconds > MUTE_MAX_SECONDS
      ) {
        throw invalid(`expiresInSeconds must be ${MUTE_MIN_SECONDS}..${MUTE_MAX_SECONDS}`);
      }
      expiresAt = new Date(now.getTime() + seconds * 1000);
      break;
    }
    case "unmute": {
      targetId = requireTarget(input);
      // Idempotent by law: no prior sanction still succeeds (the ledger
      // records intent); no host guard needed — the host can never be
      // muted in the first place.
      break;
    }
    case "ban":
    case "unban": {
      targetId = requireTarget(input);
      guardNotHost(room.hostId, targetId);
      break;
    }
    case "slow-mode": {
      const seconds = input.slowModeSeconds;
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        seconds > SLOW_MODE_MAX_SECONDS
      ) {
        throw invalid(`slowModeSeconds must be 0..${SLOW_MODE_MAX_SECONDS}`);
      }
      await db.liveRoom.update({
        where: { id: roomId },
        data: { slowModeSeconds: seconds },
      });
      break;
    }
    case "chat-enable":
    case "chat-disable": {
      await db.liveRoom.update({
        where: { id: roomId },
        data: { chatEnabled: kind === "chat-enable" },
      });
      break;
    }
  }

  const row = await db.liveModerationAction.create({
    data: {
      roomId,
      sessionId,
      actorId: actor.id,
      targetId,
      action: kind,
      reason,
      messageId,
      expiresAt,
    },
  });
  const handles = await resolveHandles([actor.id, targetId ?? ""]);
  const action = mapAction(row, handles);
  // Fan-out (ADR-0006 fast path): every audited decision reaches attached
  // streams instantly; the DB tail remains the multi-instance floor.
  publishLiveEvent(roomId, {
    kind: "moderation",
    eventId: crypto.randomUUID(),
    at: row.createdAt.toISOString(),
    action,
  });
  if (kind === "delete-message" && messageId) {
    // The tombstone is an UPDATE in place (no new seq), so replay can never
    // carry it — the chat envelope delivers it to live clients instead.
    const tombstoned = await db.liveRoomMessage.findUnique({ where: { id: messageId } });
    if (tombstoned) {
      const senderHandles = await resolveHandles([tombstoned.senderId]);
      publishLiveEvent(roomId, {
        kind: "chat",
        eventId: crypto.randomUUID(),
        at: tombstoned.createdAt.toISOString(),
        message: mapChatMessage(tombstoned, senderHandles),
      });
    }
  }
  return { action };
}

/** The audit trail — host + moderators, newest first, batched handles. */
export async function listModeration(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  opts: { limit?: number } = {},
): Promise<{ actions: LiveModerationActionDto[] }> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  const rows = await db.liveModerationAction.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: clampLimit(opts.limit),
  });
  const handles = await resolveHandles(rows.flatMap((r) => [r.actorId, r.targetId ?? ""]));
  return { actions: rows.map((r) => mapAction(r, handles)) };
}

// ═══════════════════════════════════════════════════════════════════
// Moderator grants (the persistent LiveRoomModerator ledger)
// ═══════════════════════════════════════════════════════════════════

/**
 * Grant moderation on a room — HOST only. Upsert on (roomId, userId):
 * a previously-revoked row is re-activated (revoked* cleared, grantedBy
 * refreshed), a fresh row is created. The target must be a real User row
 * and may never be the host.
 */
export async function grantModerator(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  targetId: string,
): Promise<{ moderator: LiveRoomModeratorDto }> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host only");
  }
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw invalid("userId is required");
  }
  if (
    !(await rateLimit(`wf:live:moderators:${roomId}:${actor.id}`, RATE_LIMITS.moderatorGrant))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const target = await db.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw new LiveDomainError("not-found", "no such user");
  guardNotHost(room.hostId, targetId);

  const row = await db.liveRoomModerator.upsert({
    where: { roomId_userId: { roomId, userId: targetId } },
    create: { roomId, userId: targetId, grantedBy: actor.id },
    update: { grantedBy: actor.id, revokedAt: null, revokedBy: null },
  });
  return { moderator: mapModerator(row) };
}

/**
 * Revoke moderation — HOST only. The row must exist AND be currently
 * active, else not-found; revocation soft-deletes (revokedAt/revokedBy)
 * so the grant ledger stays complete.
 */
export async function revokeModerator(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  targetId: string,
): Promise<{ moderator: LiveRoomModeratorDto }> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host only");
  }
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw invalid("userId is required");
  }
  if (
    !(await rateLimit(`wf:live:moderators:${roomId}:${actor.id}`, RATE_LIMITS.moderatorGrant))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const row = await db.liveRoomModerator.findUnique({
    where: { roomId_userId: { roomId, userId: targetId } },
  });
  if (!row || row.revokedAt !== null) {
    throw new LiveDomainError("not-found", "no active moderator grant");
  }
  const updated = await db.liveRoomModerator.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), revokedBy: actor.id },
  });
  return { moderator: mapModerator(updated) };
}

// ═══════════════════════════════════════════════════════════════════
// Viewer reports
// ═══════════════════════════════════════════════════════════════════

/**
 * File a report against a live room — any signed-in user (host/moderator/
 * guest/viewer). The reason must be from the frozen vocabulary; an
 * optional messageId must belong to THIS room; targetId carries no
 * existence requirement (off-platform actor ids are reportable).
 */
export async function createReport(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  input: CreateLiveReportInput,
): Promise<{ report: LiveReportDto }> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const reason = input?.reason;
  if (typeof reason !== "string" || !REPORT_REASONS.has(reason)) {
    throw invalid("reason must be spam | harassment | inappropriate | other");
  }
  if (!(await rateLimit(`wf:live:reports:${roomId}:${actor.id}`, RATE_LIMITS.reports))) {
    throw new LiveDomainError("rate-limited");
  }

  const detail = normalizeText(input.detail, REPORT_DETAIL_MAX, "detail");

  let messageId: string | null = null;
  if (input.messageId !== undefined && input.messageId !== null) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw invalid("messageId must be a string");
    }
    const message = await db.liveRoomMessage.findFirst({
      where: { id: input.messageId, roomId },
      select: { id: true },
    });
    if (!message) {
      throw new LiveDomainError("not-found", "no such message in this room");
    }
    messageId = message.id;
  }

  const targetId =
    typeof input.targetId === "string" && input.targetId.length > 0 ? input.targetId : null;
  const sessionId = (await activeSessionFor(roomId))?.id ?? null;

  const row = await db.liveReport.create({
    data: {
      roomId,
      sessionId,
      reporterId: actor.id,
      targetId,
      messageId,
      reason,
      detail,
      status: "open",
    },
  });
  const handles = await resolveHandles([row.reporterId, targetId ?? ""]);
  return { report: mapReport(row, handles) };
}

/** The room's report queue — HOST only, newest first. */
export async function listReports(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  opts: { limit?: number } = {},
): Promise<{ reports: LiveReportDto[] }> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role === "anonymous") {
    throw new LiveDomainError("unauthenticated");
  }
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host only");
  }
  const rows = await db.liveReport.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: clampLimit(opts.limit),
  });
  const handles = await resolveHandles(rows.flatMap((r) => [r.reporterId, r.targetId ?? ""]));
  return { reports: rows.map((r) => mapReport(r, handles)) };
}
