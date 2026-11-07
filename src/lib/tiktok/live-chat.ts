/**
 * P100-TIKTOK-LIVE — the watch-party chat (docs/research/2026-11-07-p100-
 * tiktok-live-in-app-report.md §5): the INTERACT closure for TikTok lives.
 * TikTok-side writes are API-impossible (the project's API-impossible law —
 * no official surface, and unofficial cookie writes are banned), so the
 * interaction layer on WebFlix is THIS durable, WebFlix-native lane keyed
 * by the normalized creator handle (roomKey).
 *
 * Gates in the frozen order: identity (route-level 401) → roomKey validity →
 * input validation → rate limit (route-level, the request-layer law) →
 * idempotent insert. Idempotency law:
 * (roomKey, userId, clientMessageId) is unique — a retried send returns the
 * ORIGINAL row with `duplicate: true`, never a second row. Tombstones,
 * never deletions: deleted rows render "message removed" and stay (the
 * append-only audit law, mirroring the native live chat).
 *
 * THE FOOTNOTE THE UI CARRIES: this chat is WebFlix-native. TikTok's own
 * live chat is NOT mirrored here yet (operator-gated relay, report §6) —
 * no TikTok write is claimed or performed.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { isTikTokHandle, normalizeTikTokHandle } from "./urls";
import type { WebFlixSessionUser } from "@/lib/auth/types";

export const TIKTOK_LIVE_CHAT_BODY_MAX = 500;
/** The per-sender chat burst cap the route enforces (the request-layer law:
 * lib/tiktok stays @/lib/youtube-import-free, so the limiter rides the route). */
export const TIKTOK_LIVE_CHAT_RATE = { limit: 20, windowMs: 60_000 } as const;

/** Typed domain error the routes map straight onto HTTP statuses. */
export class TikTokLiveChatError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TikTokLiveChatError";
    this.status = status;
  }
}

/** The sender block the UI renders next to each row. */
export interface TikTokLiveChatSender {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}

export interface TikTokLiveChatMessageDto {
  id: string;
  roomKey: string;
  body: string;
  deleted: boolean;
  createdAt: string;
  sender: TikTokLiveChatSender | null;
  duplicate?: boolean;
}

type ChatMessageRow = {
  id: string;
  roomKey: string;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
  userId: string;
  user: { id: string; handle: string; name: string; avatarUrl: string } | null;
};

const rowInclude = { user: { select: { id: true, handle: true, name: true, avatarUrl: true } } };

function toDto(row: ChatMessageRow, duplicate = false): TikTokLiveChatMessageDto {
  const tombstoned = row.deletedAt !== null;
  return {
    id: row.id,
    roomKey: row.roomKey,
    body: tombstoned ? "" : row.body,
    deleted: tombstoned,
    createdAt: row.createdAt.toISOString(),
    sender: tombstoned
      ? null
      : row.user
        ? {
            id: row.user.id,
            handle: row.user.handle,
            name: row.user.name,
            avatarUrl: row.user.avatarUrl,
          }
        : null,
    ...(duplicate ? { duplicate: true } : {}),
  };
}

/**
 * The normalized roomKey: every chat rung rides the G20 law, so `@@LoFiGirl`
 * and `lofigirl` are one room, and a truly-invalid room is a 400 (never a
 * silently different room).
 */
export function normalizeTikTokLiveRoomKey(raw: string): string {
  const key = normalizeTikTokHandle(raw ?? "");
  if (!key || !isTikTokHandle(key)) {
    throw new TikTokLiveChatError("Invalid TikTok live room", 400);
  }
  return key;
}

/**
 * Send one watch-party message. The session caller is the shadow identity
 * (the app-wide seam); the send is idempotent per clientMessageId and
 * rate-limited per sender (20/60s — chat bursts are human-bounded).
 */
export async function sendTikTokLiveChatMessage(
  sessionUser: WebFlixSessionUser,
  roomRaw: string,
  clientMessageId: string,
  bodyRaw: string
): Promise<TikTokLiveChatMessageDto> {
  const roomKey = normalizeTikTokLiveRoomKey(roomRaw);
  if (!sessionUser || !sessionUser.id) {
    throw new TikTokLiveChatError("Sign in to join the watch party.", 401);
  }
  const body = (bodyRaw ?? "").trim();
  if (!body) {
    throw new TikTokLiveChatError("Message cannot be empty.", 400);
  }
  if (body.length > TIKTOK_LIVE_CHAT_BODY_MAX) {
    throw new TikTokLiveChatError(
      `Message is too long — the cap is ${TIKTOK_LIVE_CHAT_BODY_MAX} characters.`,
      400
    );
  }
  const clientKey = (clientMessageId ?? "").trim();
  if (!clientKey || clientKey.length > 128) {
    throw new TikTokLiveChatError("A clientMessageId is required.", 400);
  }
  const sender = await ensureShadowUser(sessionUser);
  try {
    const row = await db.tikTokLiveChatMessage.create({
      data: { roomKey, userId: sender.id, clientMessageId: clientKey, body },
      include: rowInclude,
    });
    return toDto(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // the idempotency law: the ORIGINAL row, marked duplicate
      const existing = await db.tikTokLiveChatMessage.findUnique({
        where: {
          roomKey_userId_clientMessageId: { roomKey, userId: sender.id, clientMessageId: clientKey },
        },
        include: rowInclude,
      });
      if (existing) return toDto(existing, true);
    }
    throw err;
  }
}

/**
 * List a room's transcript. Items are ALWAYS chronological (oldest first —
 * the live-chat scroll law). Without a cursor the answer is the LATEST
 * `limit` rows (the initial window); with `after` the answer is every row
 * newer than that id (the poller's incremental tail). Tombstones keep
 * their place. Guests may read (sending is the signed-in rung).
 */
export async function listTikTokLiveChatMessages(
  roomRaw: string,
  opts: { after?: string | null; limit?: number } = {}
): Promise<{ items: TikTokLiveChatMessageDto[]; nextCursor: string | null }> {
  const roomKey = normalizeTikTokLiveRoomKey(roomRaw);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50) || 50, 1), 200);
  if (opts.after) {
    const anchor = await db.tikTokLiveChatMessage.findUnique({
      where: { id: opts.after },
      select: { id: true, roomKey: true, createdAt: true },
    });
    if (!anchor || anchor.roomKey !== roomKey) {
      return { items: [], nextCursor: null };
    }
    // the compound law: rows sort by (createdAt, id), so two sends in the
    // same millisecond never skip each other
    const rows = await db.tikTokLiveChatMessage.findMany({
      where: {
        roomKey,
        OR: [
          { createdAt: { gt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { gt: anchor.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      include: rowInclude,
    });
    const last = rows.at(-1);
    return { items: rows.map((r) => toDto(r as ChatMessageRow)), nextCursor: last?.id ?? null };
  }
  // the latest window, delivered oldest-first
  const rows = await db.tikTokLiveChatMessage.findMany({
    where: { roomKey },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: rowInclude,
  });
  const ordered = [...rows].reverse();
  const last = ordered.at(-1);
  return { items: ordered.map((r) => toDto(r as ChatMessageRow)), nextCursor: last?.id ?? null };
}

/**
 * Tombstone the caller's OWN message (owner-only; strangers get false —
 * the route maps that to 403). The row stays; the body leaves.
 */
export async function deleteOwnTikTokLiveChatMessage(
  sessionUser: WebFlixSessionUser,
  roomRaw: string,
  messageId: string
): Promise<boolean> {
  const roomKey = normalizeTikTokLiveRoomKey(roomRaw);
  if (!sessionUser?.id || !messageId) return false;
  const sender = await ensureShadowUser(sessionUser);
  const row = await db.tikTokLiveChatMessage.findUnique({ where: { id: messageId } });
  if (!row || row.roomKey !== roomKey) return false;
  if (row.userId !== sender.id) return false;
  if (row.deletedAt) return true; // idempotent tombstone
  await db.tikTokLiveChatMessage.update({
    where: { id: row.id },
    data: { deletedAt: new Date() },
  });
  return true;
}
