/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-c) — server-authoritative polls.
 *
 * The domain owns every gate and count; clients send intent only. Laws:
 *  - creation is host+moderator (canModerate), requires an ACTIVE session,
 *    and closes the room's previous open poll (THE ONE-OPEN-POLL LAW —
 *    room-scoped close is a strict superset of the frozen "per session"
 *    law, so a stale poll from an ended session can never linger open).
 *  - voting is once per (poll, user) via the unique (pollId, userId) row:
 *    re-voting MOVES the vote (update optionId); counts are NEVER
 *    client-supplied — every dto number is a server SUM (one groupBy).
 *  - mute is a CHAT sanction (speech), not a ballot one: a muted viewer
 *    may still vote. A banned viewer may not. Mute state is the shared
 *    activeSanctions() derivation (timed mutes; see the lane report).
 *  - closing is idempotent (already closed → 200 with the dto, closedAt
 *    never bumped).
 */
import { db } from "@/lib/db";
import type { LivePoll, LivePollOption } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import { opsRateLimit } from "./ops";
import { LiveDomainError } from "./rooms";
import { publishLiveEvent } from "./hub";
import {
  activeSanctions,
  activeSessionFor,
  canModerate,
  liveActorFor,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  RATE_LIMITS,
} from "./permissions";
import type { CreateLivePollInput, LivePollDto } from "./types";

/** Max poll option label length (the frozen contract: labels 1..80 chars). */
const OPTION_LABEL_MAX = 80;

/** Raw poll row shape the dto mapper consumes (options preloaded). */
export type PollWithOptions = LivePoll & { options: LivePollOption[] };

function invalid(message: string): LiveDomainError {
  return new LiveDomainError("invalid", message);
}

/** Load a poll with its options (or null). */
async function loadPoll(pollId: string): Promise<PollWithOptions | null> {
  return db.livePoll.findUnique({ where: { id: pollId }, include: { options: true } });
}

/**
 * The poll dto — counts come from ONE groupBy over vote rows (server
 * computed), myVoteOptionId from the caller's unique vote row (null when
 * absent), options ordered by position. No client claim can touch any of it.
 */
export async function pollDto(
  poll: PollWithOptions,
  callerUserId: string | null,
): Promise<LivePollDto> {
  const [counts, myVote] = await Promise.all([
    db.livePollVote.groupBy({
      by: ["optionId"],
      where: { pollId: poll.id },
      _count: { _all: true },
    }),
    callerUserId
      ? db.livePollVote.findUnique({
          where: { pollId_userId: { pollId: poll.id, userId: callerUserId } },
          select: { optionId: true },
        })
      : Promise.resolve(null),
  ]);
  const votesByOption = new Map(counts.map((c) => [c.optionId, c._count._all]));
  return {
    id: poll.id,
    roomId: poll.roomId,
    sessionId: poll.sessionId,
    question: poll.question,
    status: poll.status as LivePollDto["status"],
    createdById: poll.createdById,
    options: [...poll.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        id: o.id,
        label: o.label,
        position: o.position,
        votes: votesByOption.get(o.id) ?? 0,
      })),
    myVoteOptionId: myVote?.optionId ?? null,
    createdAt: poll.createdAt.toISOString(),
    closedAt: poll.closedAt ? poll.closedAt.toISOString() : null,
  };
}

/**
 * POST /api/live-rooms/[id]/polls — create a poll (host+moderator only).
 * Creating closes the room's previous open poll first (one-open-poll law).
 */
export async function createPoll(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: CreateLivePollInput,
): Promise<{ poll: LivePollDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "poll creation is host+moderator only");
  }
  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (question.length < 1 || question.length > 280) {
    throw invalid("question must be 1..280 chars");
  }
  if (!Array.isArray(input.options)) throw invalid("options must be an array");
  const labels = input.options.map((o) => (typeof o === "string" ? o.trim() : ""));
  if (labels.length < POLL_OPTIONS_MIN || labels.length > POLL_OPTIONS_MAX) {
    throw invalid(`options must be ${POLL_OPTIONS_MIN}..${POLL_OPTIONS_MAX} labels`);
  }
  if (labels.some((l) => l.length < 1 || l.length > OPTION_LABEL_MAX)) {
    throw invalid(`each option label must be 1..${OPTION_LABEL_MAX} chars`);
  }
  const seen = new Set<string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) throw invalid("duplicate option labels");
    seen.add(key);
  }

  if (!(await opsRateLimit(
        "pollCreate",
        `wf:live:polls:${roomId}:${actor.id}`,
        RATE_LIMITS.pollCreate,
      ))) {
    throw new LiveDomainError("rate-limited");
  }

  // THE ONE-OPEN-POLL LAW: the new poll's create closes every still-open
  // poll in this room (which subsumes "the session's previous open poll").
  await db.livePoll.updateMany({
    where: { roomId, status: "open" },
    data: { status: "closed", closedAt: new Date() },
  });
  const poll = await db.livePoll.create({
    data: {
      roomId,
      sessionId: session.id,
      question,
      createdById: actor.id,
      status: "open",
    },
  });
  await db.livePollOption.createMany({
    data: labels.map((label, position) => ({ pollId: poll.id, label, position })),
  });
  const fresh = await loadPoll(poll.id);
  const dto = await pollDto(fresh as PollWithOptions, actor.id);
  publishPoll(roomId, dto);
  return { poll: dto };
}

/** Fan-out (ADR-0006 fast path) — one place per envelope shape. */
function publishPoll(roomId: string, poll: LivePollDto): void {
  publishLiveEvent(roomId, {
    kind: "poll",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    poll,
  });
}

/**
 * POST /api/live-rooms/[id]/polls/[pollId]/vote — cast or MOVE the caller's
 * single vote. One vote per (poll, user) by the unique row: voting again
 * updates optionId (the old option's count drops by construction — counts
 * are sums over rows). Voting the same option again is a no-op success.
 * Muted viewers may vote (mute is a chat sanction); banned may not.
 */
export async function votePoll(
  roomId: string,
  pollId: string,
  sessionUser: WebFlixSessionUser,
  optionId: string,
): Promise<{ poll: LivePollDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");
  // Live-room law: poll writes are LIVE-room state (frozen contract §Laws 3).
  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  const poll = await loadPoll(pollId);
  if (!poll || poll.roomId !== roomId) throw new LiveDomainError("not-found");
  if (poll.status !== "open") throw new LiveDomainError("conflict", "poll-closed");
  if (!optionId || !poll.options.some((o) => o.id === optionId)) {
    throw invalid("optionId must belong to this poll");
  }

  if (!(await opsRateLimit(
        "pollVote",
        `wf:live:poll-vote:${roomId}:${actor.id}`,
        RATE_LIMITS.pollVote,
      ))) {
    throw new LiveDomainError("rate-limited");
  }

  // THE ONE-VOTE LAW: upsert on (pollId, userId) — re-vote = UPDATE (move),
  // same-option re-vote writes the same value (no-op success).
  await db.livePollVote.upsert({
    where: { pollId_userId: { pollId: poll.id, userId: actor.id } },
    create: { pollId: poll.id, userId: actor.id, optionId },
    update: { optionId },
  });
  const dto = await pollDto(poll, actor.id);
  publishPoll(roomId, dto);
  return { poll: dto };
}

/**
 * POST /api/live-rooms/[id]/polls/[pollId]/close — close a poll
 * (host+moderator). Idempotent: an already-closed poll answers 200 with
 * the dto and its original closedAt (never bumped).
 */
export async function closePoll(
  roomId: string,
  pollId: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ poll: LivePollDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!canModerate(actor.role)) {
    throw new LiveDomainError("forbidden", "closing a poll is host+moderator only");
  }
  const poll = await loadPoll(pollId);
  if (!poll || poll.roomId !== roomId) throw new LiveDomainError("not-found");
  if (poll.status !== "closed") {
    await db.livePoll.update({
      where: { id: poll.id },
      data: { status: "closed", closedAt: new Date() },
    });
  }
  const fresh = poll.status === "closed" ? poll : await loadPoll(poll.id);
  const dto = await pollDto(fresh as PollWithOptions, actor.id);
  publishPoll(roomId, dto);
  return { poll: dto };
}
