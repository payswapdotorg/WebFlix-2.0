/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-a) — tap reaction batches.
 *
 * One POST is one client batching window (the 400ms coalescing law lives
 * client-side; the server only sees batches). Server-authoritative laws:
 *   - the per-batch count is CLAMPED to 1..REACTION_BATCH_MAX — the client
 *     never supplies an authoritative number;
 *   - totals are ALWAYS server-computed SUMs over accepted batches
 *     (one aggregate query), never client-claimed;
 *   - `(sessionId, senderId, clientBatchId)` is unique — a retried batch
 *     returns the CURRENT total without inserting a second row.
 *
 * SANCTION LAW (deliberate): a timed mute does NOT block reactions — mute
 * is a CHAT sanction (it silences speech, not applause). Only an active
 * ban blocks reactions here.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import {
  activeSanctions,
  activeSessionFor,
  liveActorFor,
  RATE_LIMITS,
  REACTION_BATCH_MAX,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { LiveReactionKind, LiveReactionTotalDto, SendLiveReactionBatchInput } from "./types";

/**
 * The cumulative server-computed total for one reaction kind on a session.
 * ONE aggregate query (`_sum count`, `_max createdAt`) — never a scan.
 */
export async function reactionTotal(
  sessionId: string,
  kind: LiveReactionKind = "heart",
): Promise<LiveReactionTotalDto> {
  const agg = await db.liveReactionBatch.aggregate({
    where: { sessionId, kind },
    _sum: { count: true },
    _max: { createdAt: true },
  });
  return {
    sessionId,
    kind,
    total: agg._sum.count ?? 0,
    lastBatchAt: agg._max.createdAt ? agg._max.createdAt.toISOString() : null,
  };
}

/**
 * Accept one reaction batch. Gates in the frozen order: unauthenticated →
 * not-found → not-live → reactions-disabled → banned → rate-limited →
 * validation → idempotent insert → server-computed total.
 */
export async function sendReactionBatch(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  input: SendLiveReactionBatchInput,
): Promise<{ total: LiveReactionTotalDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (room.reactionsEnabled === false) {
    throw new LiveDomainError("forbidden", "reactions-disabled");
  }

  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  // NOTE: sanctions.mutedUntil is deliberately NOT checked here — a mute is
  // a chat sanction and does not block reactions (see the file header).
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");

  if (!(await rateLimit(`wf:live:reactions:${roomId}:${actor.id}`, RATE_LIMITS.reactions))) {
    throw new LiveDomainError("rate-limited");
  }

  const kind = input.kind ?? "heart";
  if (kind !== "heart") throw new LiveDomainError("invalid", "unknown reaction kind");
  if (typeof input.count !== "number" || !Number.isFinite(input.count)) {
    throw new LiveDomainError("invalid", "count must be a number");
  }
  // Server clamp — the client taps are coalesced upstream; anything that
  // arrives here is capped at REACTION_BATCH_MAX and floored at 1.
  const count = Math.min(Math.max(Math.trunc(input.count), 1), REACTION_BATCH_MAX);
  const clientBatchId =
    typeof input.clientBatchId === "string" ? input.clientBatchId.trim() : "";
  if (clientBatchId.length < 8 || clientBatchId.length > 64) {
    throw new LiveDomainError("invalid", "clientBatchId must be 8..64 chars");
  }

  let accepted = false;
  try {
    await db.liveReactionBatch.create({
      data: {
        roomId,
        sessionId: session.id,
        senderId: actor.id,
        clientBatchId,
        kind,
        count,
      },
    });
    accepted = true;
  } catch (err) {
    // Idempotency: a retried clientBatchId must not double-count. The
    // current total (the SUM over accepted batches) is returned either way.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }

  const total = await reactionTotal(session.id, kind);
  if (accepted) {
    // Phase 3 (TL integration): a batcher rostered on an ACTIVE match with
    // reaction scoring banks the batch as match points. Best-effort — any
    // refusal (match closed, not rostered, policy off) or failure leaves
    // the room-wide 200 and the reaction publish untouched; ingestScore
    // itself dedupes by clientEventId and publishes the match snapshot.
    try {
      const match = await db.liveMatch.findFirst({
        where: { sessionId: session.id, status: "active" },
        select: { id: true, reactionsScore: true },
      });
      if (match && match.reactionsScore) {
        const { ingestScore } = await import("./matches");
        await ingestScore(match.id, {
          source: "reaction",
          actorId: actor.id,
          amount: count,
          clientEventId: clientBatchId,
        });
      }
    } catch {
      // the room-wide batch succeeded; match scoring is additive
    }
    // Publish law: instant same-instance fan-out of the fresh total.
    publishLiveEvent(roomId, {
      kind: "reaction",
      eventId: crypto.randomUUID(),
      at: new Date().toISOString(),
      total,
    });
  }
  return { total };
}
