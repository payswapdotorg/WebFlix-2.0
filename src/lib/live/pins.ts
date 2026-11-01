/**
 * WFX2-LIVE-PLATFORM-1 Parity P71 — room richness (the TikTok-parity layer,
 * docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md §3 P71,
 * ADR-0012): pinned messages (P71-1), room announcements (P71-2) and the
 * viewer loyalty levels (P71-3).
 *
 * THE PIN LAW: the LivePinnedMessage row IS the pin — one per room (the
 * unique roomId), pinned by host/moderator only, and the pinned message
 * must exist in THAT room and be non-tombstoned (a tombstoned pin is
 * deleted lazily on read — the audit trail never hides behind a dead pin).
 * Unpin deletes the row. Every pin/unpin appends an audited
 * LiveModerationAction row (the additive `pin`/`unpin` ledger kinds — the
 * same append-only law as every moderation decision) and publishes the
 * `pin` stream envelope (a null pin = cleared).
 *
 * THE ANNOUNCEMENT LAW: host/moderator-set room columns
 * (announcementBody/announcementUpdatedAt) — the host clears by nulling.
 * Changes republish the EXISTING `room` envelope (the room DTO already
 * flows; no new stream kind needed — the report's own wording).
 *
 * THE LOYALTY LAW (P71-3): XP derives per sender at READ time from the
 * room's durable rows since the room's FIRST session:
 *   XP = 2×non-tombstoned chat messages + 1×reaction count + 1×gift
 *   credits sent (ROOM_XP_WEIGHTS), level = the highest ROOM_LEVELS
 *   threshold ≤ XP (cap level 7). Derived only — never stored, never
 *   client-claimed (ADR-0008/0009). Read paths stamp it through a bounded
 *   aggregate over the page's sender ids.
 */
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { opsRateLimit } from "./ops";
import {
  ANNOUNCEMENT_BODY_MAX,
  canModerate,
  liveActorFor,
  RATE_LIMITS,
  resolveHandles,
  ROOM_LEVELS,
  ROOM_XP_WEIGHTS,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { LivePinnedMessageDto, LiveRoomDto } from "./types";

/** Map a pinned row + its message + handles into the room-surface DTO. */
function mapPin(
  pin: { id: string; roomId: string; messageId: string; sessionId: string; pinnedById: string; pinnedAt: Date },
  message: { body: string; kind: string },
  handles: Map<string, { handle: string; name: string }>,
): LivePinnedMessageDto {
  return {
    id: pin.id,
    roomId: pin.roomId,
    messageId: pin.messageId,
    sessionId: pin.sessionId,
    body: message.body,
    kind: message.kind as LivePinnedMessageDto["kind"],
    pinnedById: pin.pinnedById,
    pinnedByHandle: handles.get(pin.pinnedById)?.handle ?? "unknown",
    pinnedByName: handles.get(pin.pinnedById)?.name ?? "Unknown",
    pinnedAt: pin.pinnedAt.toISOString(),
  };
}

/**
 * The room's current pin (anonymous OK — the banner is a read-only room
 * surface). LAZY TOMBSTONE SWEEP: a pin whose message was tombstoned (or
 * vanishes) is deleted here and answers null — a dead pin never renders.
 */
export async function currentPin(roomId: string): Promise<LivePinnedMessageDto | null> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const pin = await db.livePinnedMessage.findUnique({ where: { roomId } });
  if (!pin) return null;
  const message = await db.liveRoomMessage.findUnique({ where: { id: pin.messageId } });
  if (!message || message.deletedAt !== null || message.roomId !== roomId) {
    await db.livePinnedMessage.deleteMany({ where: { roomId, id: pin.id } });
    return null;
  }
  const handles = await resolveHandles([pin.pinnedById]);
  return mapPin(pin, message, handles);
}

/**
 * Pin a message (host/moderator). Gates: unauthenticated → not-found →
 * forbidden → rate-limited → message validation (must exist in THIS room,
 * non-tombstoned) → REPLACE (the room's existing pin is removed — one pin
 * per room is the unique law) → ledger row + envelope. 200 with the fresh
 * pin DTO.
 */
export async function pinMessage(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  messageId: string,
): Promise<LivePinnedMessageDto> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "pinManage",
        `wf:live:pinManage:${roomId}:${actor.id}`,
        RATE_LIMITS.pinManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  if (typeof messageId !== "string" || messageId.trim().length === 0) {
    throw new LiveDomainError("invalid", "messageId required");
  }
  const message = await db.liveRoomMessage.findUnique({ where: { id: messageId.trim() } });
  if (!message || message.roomId !== roomId) {
    throw new LiveDomainError("not-found", "message-not-in-room");
  }
  if (message.deletedAt !== null) {
    throw new LiveDomainError("invalid", "message-tombstoned");
  }

  const pin = await db.livePinnedMessage.upsert({
    where: { roomId },
    create: {
      roomId,
      messageId: message.id,
      sessionId: message.sessionId,
      pinnedById: actor.id,
    },
    update: {
      messageId: message.id,
      sessionId: message.sessionId,
      pinnedById: actor.id,
      pinnedAt: new Date(),
    },
  });
  const handles = await resolveHandles([actor.id]);
  const dto = mapPin(pin, message, handles);
  // The append-only ledger records intent (the additive pin kind).
  await db.liveModerationAction.create({
    data: { roomId, actorId: actor.id, action: "pin", messageId: message.id },
  });
  publishLiveEvent(roomId, {
    kind: "pin",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    pin: dto,
  });
  return dto;
}

/**
 * Unpin (host/moderator). Idempotent success: no pin → still 200 (the
 * ledger records intent, exactly like unmute/unban). Publishes the null-pin
 * envelope so every attached room unmounts its banner instantly.
 */
export async function unpinMessage(
  roomId: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ cleared: boolean }> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "pinManage",
        `wf:live:pinManage:${roomId}:${actor.id}`,
        RATE_LIMITS.pinManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const deleted = await db.livePinnedMessage.deleteMany({ where: { roomId } });
  await db.liveModerationAction.create({
    data: { roomId, actorId: actor.id, action: "unpin" },
  });
  publishLiveEvent(roomId, {
    kind: "pin",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    pin: null,
  });
  return { cleared: deleted.count > 0 };
}

/**
 * Set or clear the room announcement (host/moderator). `body: null` clears
 * (the host's nulling law). Publishes the fresh `room` envelope — the room
 * DTO already flows, the banner rides it. Returns the room DTO.
 */
export async function setAnnouncement(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  body: string | null,
): Promise<LiveRoomDto> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "announcementManage",
        `wf:live:announcementManage:${roomId}:${actor.id}`,
        RATE_LIMITS.announcementManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const trimmed = body === null ? null : (typeof body === "string" ? body.trim() : "");
  if (trimmed !== null && (trimmed.length < 1 || trimmed.length > ANNOUNCEMENT_BODY_MAX)) {
    throw new LiveDomainError("invalid", `announcement must be 1..${ANNOUNCEMENT_BODY_MAX} chars`);
  }
  await db.liveRoom.update({
    where: { id: roomId },
    data: {
      announcementBody: trimmed,
      announcementUpdatedAt: trimmed === null ? null : new Date(),
    },
  });
  // The room envelope republish (the report's law — no new stream kind).
  const { getRoom } = await import("./rooms");
  const fresh = await getRoom(roomId, sessionUser);
  if (fresh) {
    publishLiveEvent(roomId, {
      kind: "room",
      eventId: crypto.randomUUID(),
      at: new Date().toISOString(),
      room: fresh,
    });
  }
  // The honest DTO back to the setter (announcement fields included).
  return fresh ?? ({} as LiveRoomDto);
}

/** One sender's room-loyalty level from raw XP (the level-table law). */
export function levelForXp(xp: number): number {
  let level = 0;
  for (let i = 0; i < ROOM_LEVELS.length; i++) {
    if (xp >= ROOM_LEVELS[i]) level = i;
  }
  return level;
}

/**
 * P71-3 — the BATCHED room-loyalty derivation for a page of senders. THREE
 * groupBy aggregates over the room's durable rows (the room's FULL history
 * — since its first session), then the frozen weights + level table in
 * memory. Bounded by the page's sender count (≤ ~50 ids per read). NEVER
 * throws — a derivation failure renders no level, never a failed read.
 */
export async function roomLevelsFor(
  roomId: string,
  senderIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(senderIds.filter(Boolean))];
  const out: Map<string, number> = new Map();
  if (unique.length === 0) return out;
  try {
    const [chatCounts, reactionSums, giftSums] = await Promise.all([
      db.liveRoomMessage.groupBy({
        by: ["senderId"],
        where: { roomId, senderId: { in: unique }, deletedAt: null },
        _count: { _all: true },
      }),
      db.liveReactionBatch.groupBy({
        by: ["senderId"],
        where: { roomId, senderId: { in: unique } },
        _sum: { count: true },
      }),
      db.giftEvent.groupBy({
        by: ["senderId"],
        where: { roomId, senderId: { in: unique } },
        _sum: { totalCredits: true },
      }),
    ]);
    const chat = new Map(chatCounts.map((r) => [r.senderId, r._count._all]));
    const hearts = new Map(reactionSums.map((r) => [r.senderId, r._sum.count ?? 0]));
    const credits = new Map(giftSums.map((r) => [r.senderId, r._sum.totalCredits ?? 0]));
    for (const id of unique) {
      const xp =
        ROOM_XP_WEIGHTS.chat * (chat.get(id) ?? 0) +
        ROOM_XP_WEIGHTS.reaction * (hearts.get(id) ?? 0) +
        ROOM_XP_WEIGHTS.gift * (credits.get(id) ?? 0);
      out.set(id, levelForXp(xp));
    }
    return out;
  } catch (err) {
    console.error("live room-level derivation failed", err);
    return out;
  }
}
