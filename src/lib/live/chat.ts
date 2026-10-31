/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-a) — durable room chat.
 *
 * Server-authoritative gates in the frozen order:
 *   unauthenticated → not-found → not-live → banned → muted →
 *   chat-disabled (host/moderator bypass) → slow-mode (host/moderator
 *   bypass) → rate-limited → input validation → idempotent insert.
 *
 * IDEMPOTENCY LAW: `(sessionId, senderId, clientMessageId)` is unique —
 * a retry that hits the P2002 unique-violation returns the ORIGINAL row
 * with `duplicate: true` (200), never a second row. Tombstones, never
 * deletions: `listChat` renders deleted rows with `deleted: true` and an
 * empty body; the rows themselves stay (the moderation audit trail is
 * append-only).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import {
  activeSanctions,
  activeSessionFor,
  canModerate,
  CHAT_BODY_MAX,
  liveActorFor,
  RATE_LIMITS,
  resolveHandles,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { LiveChatKind, LiveChatMessageDto, SendLiveChatInput } from "./types";

/** Raw LiveRoomMessage row shape (as Prisma returns it, before DTO mapping). */
export type LiveChatMessageRow = {
  id: string;
  seq: number;
  roomId: string;
  sessionId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  kind: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
};

export type HandleMap = Map<string, { handle: string; name: string }>;

/**
 * Row → DTO. Tombstoned rows keep their place in the transcript but render
 * "message removed": `deleted: true`, `body: ""` (the raw body never leaves
 * the server once a moderator has hidden it).
 */
export function mapChatMessage(row: LiveChatMessageRow, handles: HandleMap): LiveChatMessageDto {
  const sender = handles.get(row.senderId);
  return {
    id: row.id,
    seq: row.seq,
    roomId: row.roomId,
    sessionId: row.sessionId,
    senderId: row.senderId,
    senderHandle: sender?.handle ?? "unknown",
    senderName: sender?.name ?? "Unknown",
    kind: row.kind as LiveChatKind,
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    deleted: row.deletedAt != null,
  };
}

async function handlesFor(senderIds: string[]): Promise<HandleMap> {
  return resolveHandles(senderIds);
}

/**
 * Durable replay for the room (readable anonymously — law #2). Ordered by
 * the strict `seq` cursor ascending; `after` replays strictly after that
 * seq. Default limit 50, max 100.
 */
export async function listChat(
  roomId: string,
  opts: { after?: number; limit?: number } = {},
): Promise<LiveChatMessageDto[]> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 100);
  const after =
    opts.after !== undefined && Number.isFinite(opts.after) ? Math.trunc(opts.after) : null;
  const rows = await db.liveRoomMessage.findMany({
    where: { roomId, ...(after !== null ? { seq: { gt: after } } : {}) },
    orderBy: { seq: "asc" },
    take: limit,
  });
  const handles = await handlesFor(rows.map((r) => r.senderId));
  return rows.map((r) => mapChatMessage(r, handles));
}

/**
 * Send a chat message / announcement. Every gate is re-derived per request
 * from durable state (room policy + sanction ledger) — clients claim nothing.
 */
export async function sendChat(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  input: SendLiveChatInput,
): Promise<{ message: LiveChatMessageDto; duplicate?: boolean }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");
  if (sanctions.mutedUntil) throw new LiveDomainError("forbidden", "muted");

  // chat-disabled is a policy gate with a staff bypass: the host and granted
  // moderators can still speak (system/announcement channel stays usable).
  if (room.chatEnabled === false && !canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "chat-disabled");
  }

  // Slow-mode applies to viewer/guest senders only (host/moderator bypass).
  if (room.slowModeSeconds > 0 && !canModerate(actor.role)) {
    const latest = await db.liveRoomMessage.findFirst({
      where: { sessionId: session.id, senderId: actor.id },
      orderBy: { seq: "desc" },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < room.slowModeSeconds * 1000) {
      throw new LiveDomainError("forbidden", "slow-mode");
    }
  }

  if (!(await rateLimit(`wf:live:chat:${roomId}:${actor.id}`, RATE_LIMITS.chat))) {
    throw new LiveDomainError("rate-limited");
  }

  // Validation (after the gates — the honest error contract for THIS caller).
  // `kind` arrives from an untrusted client, so it is re-validated at runtime
  // even though the DTO type narrows it (a forged "system" must hit 400).
  const kindRaw: unknown = (input as { kind?: unknown }).kind;
  const kind: LiveChatKind =
    kindRaw === undefined || kindRaw === null ? "chat" : (kindRaw as LiveChatKind);
  if (kind === "system") {
    // "system" rows are server-internal only — never client-submittable.
    throw new LiveDomainError("invalid", "system messages are server-internal");
  }
  if (kind !== "chat" && kind !== "announcement") {
    throw new LiveDomainError("invalid", "unknown message kind");
  }
  if (kind === "announcement" && !canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "announcement");
  }
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length < 1 || body.length > CHAT_BODY_MAX) {
    throw new LiveDomainError("invalid", `body must be 1..${CHAT_BODY_MAX} chars`);
  }
  const clientMessageId =
    typeof input.clientMessageId === "string" ? input.clientMessageId.trim() : "";
  if (clientMessageId.length < 8 || clientMessageId.length > 64) {
    throw new LiveDomainError("invalid", "clientMessageId must be 8..64 chars");
  }

  const handles = await handlesFor([actor.id]);
  try {
    const row = await db.liveRoomMessage.create({
      data: {
        roomId,
        sessionId: session.id,
        senderId: actor.id,
        clientMessageId,
        body,
        kind,
      },
    });
    const message = mapChatMessage(row, handles);
    // Publish law: same-instance subscribers get instant fan-out; other
    // instances converge via the stream's DB tail (ADR-0006).
    publishLiveEvent(roomId, {
      kind: "chat",
      eventId: crypto.randomUUID(),
      at: message.createdAt,
      message,
    });
    return { message };
  } catch (err) {
    // IDEMPOTENCY LAW: a retried (sessionId, senderId, clientMessageId)
    // returns the ORIGINAL message with duplicate: true — never a second row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.liveRoomMessage.findUnique({
        where: {
          sessionId_senderId_clientMessageId: {
            sessionId: session.id,
            senderId: actor.id,
            clientMessageId,
          },
        },
      });
      if (existing) return { message: mapChatMessage(existing, handles), duplicate: true };
    }
    throw err;
  }
}
