/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-c) — room Q&A.
 *
 * Sanction law for questions (the asymmetry, documented):
 *  - asking is SPEECH: a banned viewer cannot ask AND a muted viewer cannot
 *    ask (mute blocks speech — chat and questions alike).
 *  - mute state is the shared activeSanctions() derivation, which models
 *    mutes as TIMED (mutedUntil). A mute row without expiresAt resolves as
 *    "not muted" in the frozen shared core — see the lane report; tests pin
 *    timed mutes.
 *  - answering/hiding is host+moderator, idempotent (answeredAt/hiddenAt
 *    never reset or re-stamped on repeat calls), and hiddenAt is the
 *    moderation tombstone: hidden questions leave public lists but stay in
 *    the audit set (includeHidden for host+moderators only).
 */
import { db } from "@/lib/db";
import type { LiveQuestion } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import { LiveDomainError } from "./rooms";
import { publishLiveEvent } from "./hub";
import {
  activeSanctions,
  activeSessionFor,
  canModerate,
  liveActorFor,
  QUESTION_BODY_MAX,
  RATE_LIMITS,
  resolveHandles,
} from "./permissions";
import type { CreateLiveQuestionInput, LiveQuestionDto } from "./types";

/** Public list default/max (the frozen contract: default 30, max 50). */
const LIST_DEFAULT_LIMIT = 30;
const LIST_MAX_LIMIT = 50;

function invalid(message: string): LiveDomainError {
  return new LiveDomainError("invalid", message);
}

/** Map a row to its dto with the asker handle pre-resolved. */
function mapQuestion(
  row: LiveQuestion,
  asker: { handle: string; name: string } | undefined,
): LiveQuestionDto {
  return {
    id: row.id,
    roomId: row.roomId,
    askerId: row.askerId,
    askerHandle: asker?.handle ?? row.askerId,
    body: row.body,
    answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function singleQuestionDto(row: LiveQuestion): Promise<LiveQuestionDto> {
  const handles = await resolveHandles([row.askerId]);
  return mapQuestion(row, handles.get(row.askerId));
}

/**
 * POST /api/live-rooms/[id]/questions — any signed-in viewer asks (banned
 * and muted cannot: asking is speech). Requires an active session.
 */
export async function askQuestion(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: CreateLiveQuestionInput,
): Promise<{ question: LiveQuestionDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");
  if (sanctions.mutedUntil) {
    throw new LiveDomainError("forbidden", "muted");
  }
  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length < 1 || body.length > QUESTION_BODY_MAX) {
    throw invalid(`body must be 1..${QUESTION_BODY_MAX} chars`);
  }

  if (!(await rateLimit(`wf:live:questions:${roomId}:${actor.id}`, RATE_LIMITS.questions))) {
    throw new LiveDomainError("rate-limited");
  }

  const row = await db.liveQuestion.create({
    data: { roomId, sessionId: session.id, askerId: actor.id, body },
  });
  const question = await singleQuestionDto(row);
  publishLiveEvent(roomId, { kind: "question", eventId: crypto.randomUUID(), at: new Date().toISOString(), question });
  return { question };
}

/**
 * GET /api/live-rooms/[id]/questions — the public list: non-hidden rows,
 * newest first, limit default 30 max 50. Anonymous reads are allowed
 * (public-room read law). `includeHidden` is honored ONLY for
 * host+moderators; a viewer passing it still gets the public list.
 */
export async function listQuestions(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  opts: { includeHidden?: boolean; limit?: number } = {},
): Promise<{ questions: LiveQuestionDto[] }> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");

  let includeHidden = false;
  if (sessionUser && opts.includeHidden) {
    const actor = await liveActorFor(roomId, sessionUser);
    includeHidden = canModerate(actor.role);
  }
  const limit = Math.min(Math.max(opts.limit ?? LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT);

  const rows = await db.liveQuestion.findMany({
    where: { roomId, ...(includeHidden ? {} : { hiddenAt: null }) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const handles = await resolveHandles(rows.map((r) => r.askerId));
  return { questions: rows.map((r) => mapQuestion(r, handles.get(r.askerId))) };
}

/**
 * POST /api/live-rooms/[id]/questions/[qid]/answer — host+moderator.
 * Idempotent: re-answering returns 200 with the dto and does NOT reset
 * (or re-stamp) answeredAt.
 */
export async function answerQuestion(
  roomId: string,
  questionId: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ question: LiveQuestionDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "answering is host+moderator only");
  }
  const row = await db.liveQuestion.findUnique({ where: { id: questionId } });
  if (!row || row.roomId !== roomId) throw new LiveDomainError("not-found");
  if (row.answeredAt === null) {
    await db.liveQuestion.update({
      where: { id: row.id },
      data: { answeredAt: new Date() },
    });
  }
  const fresh =
    row.answeredAt === null
      ? await db.liveQuestion.findUniqueOrThrow({ where: { id: row.id } })
      : row;
  const question = await singleQuestionDto(fresh);
  publishLiveEvent(roomId, { kind: "question", eventId: crypto.randomUUID(), at: new Date().toISOString(), question });
  return { question };
}

/**
 * POST /api/live-rooms/[id]/questions/[qid]/hide — the moderation
 * tombstone (host+moderator). Idempotent: hiddenAt is never re-stamped.
 * Hidden questions leave public lists but stay in the audit set.
 */
export async function hideQuestion(
  roomId: string,
  questionId: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ question: LiveQuestionDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "hiding is host+moderator only");
  }
  const row = await db.liveQuestion.findUnique({ where: { id: questionId } });
  if (!row || row.roomId !== roomId) throw new LiveDomainError("not-found");
  if (row.hiddenAt === null) {
    await db.liveQuestion.update({
      where: { id: row.id },
      data: { hiddenAt: new Date() },
    });
  }
  const fresh =
    row.hiddenAt === null
      ? await db.liveQuestion.findUniqueOrThrow({ where: { id: row.id } })
      : row;
  const question = await singleQuestionDto(fresh);
  publishLiveEvent(roomId, { kind: "question", eventId: crypto.randomUUID(), at: new Date().toISOString(), question });
  return { question };
}
