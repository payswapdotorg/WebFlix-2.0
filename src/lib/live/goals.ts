/**
 * WFX2-LIVE-PLATFORM-1 Parity P70-3 — LIVE Goals (the TikTok-parity layer,
 * docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md §3 P70,
 * ADR-0012).
 *
 * THE GOAL LAW: a goal is a HOST-DECLARED counter the room chases together.
 * Everything about it obeys the house laws:
 *   - ONE open goal per room — enforced HERE in the domain (a create while
 *     an open goal exists is a 409), not by a partial index (the SQLite law).
 *   - PROGRESS IS DERIVED on read, never stored, never client-claimed
 *     (ADR-0008/0009 derivation law): hearts = Σ LiveReactionBatch.count,
 *     giftCredits = Σ GiftEvent.totalCredits, chat = non-tombstoned
 *     LiveRoomMessage count — ALL room-scoped and strictly since the goal's
 *     createdAt, so a goal measures exactly its own lifetime.
 *   - REACHED FLIPS LAZILY: a read (or an activity hook) that observes
 *     progress >= target stamps reached + reachedAt and publishes the goal
 *     envelope (the room's celebration line rides the envelope — the UI
 *     renders it; the server never fabricates a party).
 *   - CLOSED is the host's terminal state (closeGoal) — the room may start
 *     the next goal only after the open one is closed or reached.
 *   - Non-monetary by construction: giftCredits are DEV credits (ADR-0007);
 *     hearts and chat are entertainment facts (ADR-0010 extends verbatim).
 *
 * Gates: host-only create/close (the console's manager is the host's alone
 * — the report's own wording), rate-limited by RATE_LIMITS.goalManage on
 * the mutating path only (progress reads are free), room must exist for
 * reads (anonymous OK — the goal is a read-only room surface).
 */
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import type { LiveRoomGoal } from "@prisma/client";
import { opsRateLimit } from "./ops";
import {
  GOAL_KINDS,
  GOAL_LIST_MAX,
  GOAL_TARGET_MAX,
  GOAL_TITLE_MAX,
  isHost,
  liveActorFor,
  RATE_LIMITS,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { CreateLiveGoalInput, LiveGoalDto, LiveGoalKind, LiveGoalStatus } from "./types";

type GoalKindSource = (typeof GOAL_KINDS)[number];

/** Row → DTO with the progress derivation filled in. */
function mapGoal(row: LiveRoomGoal, progress: number): LiveGoalDto {
  return {
    id: row.id,
    roomId: row.roomId,
    kind: row.kind as LiveGoalKind,
    title: row.title,
    target: row.target,
    status: row.status as LiveGoalStatus,
    progress,
    createdAt: row.createdAt.toISOString(),
    reachedAt: row.reachedAt ? row.reachedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

/**
 * The one progress formula — switch on kind, room-scoped, strictly since
 * createdAt. ONE aggregate query per kind (never a scan of anything else).
 */
async function deriveProgress(row: LiveRoomGoal): Promise<number> {
  const since = { roomId: row.roomId, createdAt: { gte: row.createdAt } };
  switch (row.kind) {
    case "hearts": {
      const agg = await db.liveReactionBatch.aggregate({ where: since, _sum: { count: true } });
      return agg._sum.count ?? 0;
    }
    case "giftCredits": {
      const agg = await db.giftEvent.aggregate({ where: since, _sum: { totalCredits: true } });
      return agg._sum.totalCredits ?? 0;
    }
    case "chat": {
      return db.liveRoomMessage.count({ where: { ...since, deletedAt: null } });
    }
    default:
      return 0; // an unknown kind (schema drift) derives as zero — never lies
  }
}

/**
 * The lazy reach flip: when an OPEN goal has crossed its target, stamp
 * reached + reachedAt and publish the goal envelope (the room's celebration
 * line). Called from every read AND from the write-path activity hooks.
 * Returns the (possibly flipped) fresh row.
 */
async function reconcileReached(row: LiveRoomGoal): Promise<LiveRoomGoal> {
  if (row.status !== "open") return row;
  const progress = await deriveProgress(row);
  if (progress < row.target) return row;
  const flipped = await db.liveRoomGoal.update({
    where: { id: row.id },
    data: { status: "reached", reachedAt: new Date() },
  });
  publishLiveEvent(row.roomId, {
    kind: "goal",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    goal: mapGoal(flipped, progress),
  });
  return flipped;
}

/**
 * The write-path activity hook (gifts.ts / chat.ts / reactions.ts call this
 * best-effort after a durable commit): if the room has an OPEN goal of this
 * kind, re-derive and flip when crossed. NEVER throws to the caller — the
 * write that banked the row must not fail because a goal read hiccuped.
 */
export async function onRoomActivity(roomId: string, kind: GoalKindSource): Promise<void> {
  const open = await db.liveRoomGoal.findFirst({ where: { roomId, status: "open" } });
  if (!open || open.kind !== kind) return;
  await reconcileReached(open);
}

/**
 * Create the room's goal (host-only). One open goal per room is enforced
 * HERE (409 conflict, honest reason) — the domain law, not an index.
 */
export async function createGoal(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: CreateLiveGoalInput,
): Promise<LiveGoalDto> {
  // Gate order (the house law): not-found BEFORE forbidden — an unknown
  // room answers 404 even to a caller who would not be its host anyway.
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host-only");
  }

  if (!(await opsRateLimit(
        "goalManage",
        `wf:live:goalManage:${roomId}:${actor.id}`,
        RATE_LIMITS.goalManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }

  const kind = (input as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !GOAL_KINDS.includes(kind as GoalKindSource)) {
    throw new LiveDomainError("invalid", "unknown goal kind");
  }
  if (typeof input.target !== "number" || !Number.isFinite(input.target)) {
    throw new LiveDomainError("invalid", "target must be a finite number");
  }
  // A fractional target is silently REINTERPRETING the host's declaration —
  // rejected, not truncated (the honest-validation law; quantity clamps are
  // for client BUGS, a goal target is a host DECLARATION).
  if (!Number.isInteger(input.target)) {
    throw new LiveDomainError("invalid", "target must be a whole number");
  }
  const target = input.target;
  if (target < 1 || target > GOAL_TARGET_MAX) {
    throw new LiveDomainError("invalid", `target must be 1..${GOAL_TARGET_MAX}`);
  }
  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim().slice(0, GOAL_TITLE_MAX)
      : null;

  const open = await db.liveRoomGoal.findFirst({ where: { roomId, status: "open" } });
  if (open) {
    throw new LiveDomainError("conflict", "goal-open");
  }
  const row = await db.liveRoomGoal.create({
    data: { roomId, kind: kind as GoalKindSource, title, target, status: "open" },
  });
  const goal = mapGoal(row, 0);
  publishLiveEvent(roomId, {
    kind: "goal",
    eventId: crypto.randomUUID(),
    at: goal.createdAt,
    goal,
  });
  return goal;
}

/**
 * The room's goal history (newest first, GOAL_LIST_MAX cap; anonymous OK).
 * Every open goal reconciles its reached flip on the way out — the read IS
 * the correctness floor for the lazy derivation.
 */
export async function listGoals(roomId: string, limit?: number): Promise<LiveGoalDto[]> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const take = Math.min(Math.max(Math.trunc(limit ?? GOAL_LIST_MAX), 1), GOAL_LIST_MAX);
  const rows = await db.liveRoomGoal.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take,
  });
  const out: LiveGoalDto[] = [];
  for (const row of rows) {
    const reconciled = await reconcileReached(row);
    out.push(mapGoal(reconciled, await deriveProgress(reconciled)));
  }
  return out;
}

/**
 * Close the room's OPEN (or REACHED) goal — the host's terminal stamp. A
 * CLOSED goal is frozen: progress stops being reported as live (the row and
 * its final numbers stay in the history).
 */
export async function closeGoal(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  goalId: string,
): Promise<LiveGoalDto> {
  const actor = await liveActorFor(roomId, sessionUser);
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host-only");
  }
  if (!(await opsRateLimit(
        "goalManage",
        `wf:live:goalManage:${roomId}:${actor.id}`,
        RATE_LIMITS.goalManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const row = await db.liveRoomGoal.findFirst({ where: { id: goalId, roomId } });
  if (!row) throw new LiveDomainError("not-found");
  if (row.status === "closed") {
    throw new LiveDomainError("conflict", "goal-closed");
  }
  // A reached goal that closes keeps its crossed progress in the snapshot.
  const reconciled = await reconcileReached(row);
  const closed = await db.liveRoomGoal.update({
    where: { id: reconciled.id },
    data: { status: "closed", closedAt: new Date() },
  });
  const goal = mapGoal(closed, await deriveProgress(closed));
  publishLiveEvent(roomId, {
    kind: "goal",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    goal,
  });
  return goal;
}
