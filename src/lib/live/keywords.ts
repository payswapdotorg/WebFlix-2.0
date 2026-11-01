/**
 * WFX2-LIVE-PLATFORM-1 Parity P73 — the room keyword filter + link blocking
 * (the TikTok-parity layer, docs/research/2026-10-31-webflix-live-tiktok-
 * parity-audit.md §3 P73, ADR-0012).
 *
 * THE KEYWORD LAW: host/mod-defined blocked patterns (trimmed, lowercased,
 * 1..KEYWORD_MAX=60 chars, cap KEYWORDS_PER_ROOM_MAX=50 per room — enforced
 * HERE in the domain). Every add/remove appends an audited
 * LiveModerationAction row (the additive keyword-add/keyword-remove ledger
 * kinds — the append-only law).
 *
 * THE ENFORCEMENT LAW (lives in chat.ts's frozen gate order, post-validation
 * pre-insert): a body containing any active pattern (case-insensitive
 * substring) — or ANY URL (http:// / https:// / www.) when the room's
 * blockLinks policy is on — answers 422 `{ error: "flagged" }`. Nobody's
 * message is silently rewritten or shadow-hidden (the honesty rule): the
 * composer renders the honest flagged state and the sender retries.
 *
 * THE LINK POLICY: `LiveRoom.blockLinks` (host/mod toggle, additive column,
 * default false) — the toggle rides the keyword route's PATCH.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { opsRateLimit } from "./ops";
import {
  canModerate,
  KEYWORD_MAX,
  KEYWORDS_PER_ROOM_MAX,
  liveActorFor,
  RATE_LIMITS,
} from "./permissions";
import { LiveDomainError } from "./rooms";
import type { LiveRoomKeywordDto } from "./types";

/** The URL pattern the link policy blocks (any http/https/www link). */
export const URL_PATTERN = /https?:\/\/|www\./i;

/** Row → DTO (the pattern is stored lowercase; the row is the truth). */
function mapKeyword(row: {
  id: string;
  roomId: string;
  pattern: string;
  createdAt: Date;
}): LiveRoomKeywordDto {
  return {
    id: row.id,
    roomId: row.roomId,
    pattern: row.pattern,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The room's active patterns (the enforcement read — cheap, indexed). */
export async function roomPatterns(roomId: string): Promise<string[]> {
  const rows = await db.liveRoomKeyword.findMany({
    where: { roomId },
    select: { pattern: true },
  });
  return rows.map((r) => r.pattern);
}

/**
 * THE ENFORCEMENT CHECK (called from sendChat post-validation pre-insert):
 * returns the honest flag reason when the body trips the room's filter,
 * null when it passes. Case-insensitive substring match per pattern + the
 * URL rule when blockLinks is on.
 */
export function flagForBody(
  body: string,
  patterns: string[],
  blockLinks: boolean,
): string | null {
  const lowered = body.toLowerCase();
  if (blockLinks && URL_PATTERN.test(body)) {
    return "links are blocked in this room";
  }
  for (const pattern of patterns) {
    if (lowered.includes(pattern)) {
      return "flagged by the room's keyword filter";
    }
  }
  return null;
}

/** The room's keyword list (staff-visible; anonymous callers get 403 — the
 * filter is a moderation tool, not a viewer surface). */
export async function listKeywords(
  roomId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LiveRoomKeywordDto[]> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  const rows = await db.liveRoomKeyword.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapKeyword);
}

/** Add a blocked keyword (host/mod; the 50-per-room cap is domain law). */
export async function addKeyword(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  pattern: string,
): Promise<LiveRoomKeywordDto> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "keywordManage",
        `wf:live:keywordManage:${roomId}:${actor.id}`,
        RATE_LIMITS.keywordManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const trimmed = typeof pattern === "string" ? pattern.trim().toLowerCase() : "";
  if (trimmed.length < 1 || trimmed.length > KEYWORD_MAX) {
    throw new LiveDomainError("invalid", `pattern must be 1..${KEYWORD_MAX} chars`);
  }
  const count = await db.liveRoomKeyword.count({ where: { roomId } });
  if (count >= KEYWORDS_PER_ROOM_MAX) {
    throw new LiveDomainError("conflict", "keyword-cap");
  }
  try {
    const row = await db.liveRoomKeyword.create({
      data: { roomId, pattern: trimmed, createdById: actor.id },
    });
    await db.liveModerationAction.create({
      data: { roomId, actorId: actor.id, action: "keyword-add", reason: trimmed },
    });
    return mapKeyword(row);
  } catch (err) {
    // The (roomId, pattern) unique — a duplicate add is a no-op success
    // (idempotent CRUD, like every audited re-intent).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.liveRoomKeyword.findUnique({
        where: { roomId_pattern: { roomId, pattern: trimmed } },
      });
      if (existing) return mapKeyword(existing);
    }
    throw err;
  }
}

/** Remove a blocked keyword (host/mod; the audited keyword-remove kind). */
export async function removeKeyword(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  patternId: string,
): Promise<{ removed: boolean }> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "keywordManage",
        `wf:live:keywordManage:${roomId}:${actor.id}`,
        RATE_LIMITS.keywordManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const row = await db.liveRoomKeyword.findFirst({ where: { id: patternId, roomId } });
  if (!row) throw new LiveDomainError("not-found");
  await db.liveRoomKeyword.delete({ where: { id: row.id } });
  await db.liveModerationAction.create({
    data: { roomId, actorId: actor.id, action: "keyword-remove", reason: row.pattern },
  });
  return { removed: true };
}

/** Toggle the room's link-blocking policy (host/mod; audited). */
export async function setBlockLinks(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  enabled: boolean,
): Promise<{ blockLinks: boolean }> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "host or moderator required");
  }
  if (!(await opsRateLimit(
        "keywordManage",
        `wf:live:keywordManage:${roomId}:${actor.id}`,
        RATE_LIMITS.keywordManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  await db.liveRoom.update({ where: { id: roomId }, data: { blockLinks: enabled } });
  await db.liveModerationAction.create({
    data: {
      roomId,
      actorId: actor.id,
      action: enabled ? "keyword-add" : "keyword-remove",
      reason: enabled ? "block-links-on" : "block-links-off",
    },
  });
  return { blockLinks: enabled };
}
