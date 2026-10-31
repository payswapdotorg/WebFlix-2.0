/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 (lane 3-b) — host-run matches + the frozen
 * scoring law (work order §4E, docs/plans/wfx2-live-phase-3-contracts.md).
 *
 * THE SCORING LAW (binding, no deviations):
 *   1. Append-only — every score lives in LiveScoreEvent; standings are
 *      SUM(amount) GROUP BY teamId. Nothing ever UPDATEs or DELETEs a row.
 *   2. Server-authoritative — callers of ingestScore send validated intent
 *      (source, actor, idempotency key); amounts are audited against the
 *      frozen caps (reaction ≤ REACTION_BATCH_MAX, gift ≤ GIFT_QTY_MAX ×
 *      GIFT_PRICE_MAX) so the ledger can never carry a client-supplied
 *      number that outruns the underlying surface's own clamp.
 *   3. Idempotent — (matchId, clientEventId) UNIQUE; a replay fetches the
 *      existing row and answers `duplicate: true` without a second row.
 *   4. Late rule — ingestion only while the match is `active` AND
 *      now() <= endsAt; after a terminal status nothing ever scores.
 *   5. Lazy timeout — any read/ingest first transitions an `active` match
 *      past `endsAt` to `ended` (endReason "timeout"), derives the winner
 *      (higher SUM; tie → winnerTeamId null) and writes one final
 *      LiveScoreSnapshot per team. Idempotent via a status guard: the
 *      transition is an updateMany `WHERE status = "active"`, so only the
 *      caller that wins the guard ever writes finals (never double-written).
 *   6. Deterministic result of record — host end runs the same derivation
 *      with endReason "host"; cancelled matches have no winner and no
 *      finals; banked LiveScoreEvent rows always stand (audit).
 *   7. Anti-abuse — match scoring rides the SAME per-user rate limits and
 *      caps as the underlying surfaces (enforced by the reactions/gifts
 *      routes BEFORE they call ingestScore). No bypass exists here.
 *
 * INTEGRATION SEAM: `ingestScore` is the single scoring entry point for
 * lane 3-c's gifts service (`import { ingestScore } from "./matches"`) and
 * the TL's reactions hook. It returns a plain verdict object (never throws
 * for domain rejections) so a valid room-side action that arrives late
 * still answers its normal 200 while contributing no score.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import {
  activeSessionFor,
  GIFT_PRICE_MAX,
  GIFT_QTY_MAX,
  liveActorFor,
  MATCH_DURATION_DEFAULT,
  MATCH_DURATION_MAX,
  MATCH_DURATION_MIN,
  MATCH_TEAM_SIZE_MAX,
  RATE_LIMITS,
  REACTION_BATCH_MAX,
  resolveHandles,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type {
  LiveMatchDto,
  LiveMatchKind,
  LiveMatchStatus,
  StartLiveMatchInput,
} from "./types";

/** A match row with its teams + rosters (the shape every read path needs). */
type MatchWithTeams = Prisma.LiveMatchGetPayload<{
  include: { teams: { include: { members: true } } };
}>;

type HandleMap = Map<string, { handle: string; name: string }>;

/** One validated scoring intent (the frozen ingestScore signature). */
export interface IngestScoreEvent {
  source: "reaction" | "gift";
  actorId: string;
  /** Gift law: the viewer-chosen side (server-validated against the match). */
  teamId?: string;
  amount: number;
  /** The idempotency key (reaction batch id / gift intent id). */
  clientEventId: string;
  /** Trace: the reaction batch row id / gift event row id. */
  linkId?: string;
}

/** The ingestScore verdict — a domain answer, never a thrown error. */
export interface IngestScoreResult {
  accepted: boolean;
  duplicate?: boolean;
  reason?: "match-closed" | "not-member" | "invalid-team" | "policy-off";
  teamId?: string;
  teamScore?: number;
}

// ── mapping / read helpers ─────────────────────────────────────────────

async function loadMatchWithTeams(matchId: string): Promise<MatchWithTeams | null> {
  return db.liveMatch.findUnique({
    where: { id: matchId },
    include: { teams: { include: { members: true } } },
  });
}

/** Server-computed standings: SUM(amount) per team (ONE aggregate query). */
async function scoreTotals(matchId: string): Promise<Map<string, number>> {
  const rows = await db.liveScoreEvent.groupBy({
    by: ["teamId"],
    where: { matchId },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.teamId, r._sum.amount ?? 0]));
}

async function teamScoreFor(matchId: string, teamId: string): Promise<number> {
  const agg = await db.liveScoreEvent.aggregate({
    where: { matchId, teamId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** The authoritative match snapshot (teams by position, resolved handles). */
function mapMatchDto(
  match: MatchWithTeams,
  scores: Map<string, number>,
  handles: HandleMap,
): LiveMatchDto {
  return {
    id: match.id,
    roomId: match.roomId,
    sessionId: match.sessionId,
    kind: match.kind as LiveMatchKind,
    status: match.status as LiveMatchStatus,
    durationSeconds: match.durationSeconds,
    scoring: { reactions: match.reactionsScore, gifts: match.giftsScore },
    startedAt: match.startedAt.toISOString(),
    endsAt: match.endsAt.toISOString(),
    endedAt: match.endedAt ? match.endedAt.toISOString() : null,
    endReason: (match.endReason as LiveMatchDto["endReason"]) ?? null,
    winnerTeamId: match.winnerTeamId,
    teams: [...match.teams]
      .sort((a, b) => a.position - b.position)
      .map((team) => ({
        id: team.id,
        label: team.label,
        position: team.position,
        members: team.members.map((member) => ({
          userId: member.userId,
          handle: handles.get(member.userId)?.handle ?? "unknown",
          name: handles.get(member.userId)?.name ?? "Unknown",
          leftAt: member.leftAt ? member.leftAt.toISOString() : null,
        })),
        score: scores.get(team.id) ?? 0,
      })),
    serverNow: new Date().toISOString(),
  };
}

/** Load scores + handles and map the full snapshot (every dto path). */
async function matchDtoFor(match: MatchWithTeams): Promise<LiveMatchDto> {
  const [scores, handles] = await Promise.all([
    scoreTotals(match.id),
    resolveHandles(match.teams.flatMap((t) => t.members.map((m) => m.userId))),
  ]);
  return mapMatchDto(match, scores, handles);
}

/** Fan-out law: every match mutation/ingestion publishes the FULL snapshot. */
function publishMatchEnvelope(roomId: string, match: LiveMatchDto): void {
  publishLiveEvent(roomId, {
    kind: "match",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    match,
  });
}

// ── the lazy wall-clock timeout (the frozen late-rule mechanism) ───────

/**
 * Transition an `active` match past `endsAt` to `ended` ("timeout"):
 * winner derived from the CURRENT SUM (tie → null), one final
 * LiveScoreSnapshot per team. Idempotent via the status guard — only the
 * caller whose updateMany moves the row off "active" writes the finals,
 * so a settle can never double-write. Publishes the fresh envelope after
 * commit when it actually transitioned (the fan-out law).
 */
async function settleIfExpired(matchId: string): Promise<MatchWithTeams | null> {
  const match = await loadMatchWithTeams(matchId);
  if (!match || match.status !== "active") return match;
  if (match.endsAt.getTime() > Date.now()) return match;
  const settled = await settleMatch(match, "timeout");
  const fresh = await loadMatchWithTeams(matchId);
  if (settled && fresh) {
    publishMatchEnvelope(fresh.roomId, await matchDtoFor(fresh));
  }
  return fresh;
}

/**
 * The active→ended derivation shared by the lazy timeout (reason
 * "timeout") and the host end (reason "host"). Returns false when the
 * status guard lost a race (the row went terminal under us) — the caller
 * re-reads and answers conflict; finals are only ever written by the
 * guard winner.
 */
async function settleMatch(match: MatchWithTeams, reason: "host" | "timeout"): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const guarded = await tx.liveMatch.updateMany({
      where: { id: match.id, status: "active" },
      data: { status: "ended", endedAt: new Date(), endReason: reason },
    });
    if (guarded.count === 0) return false;

    const totals = await tx.liveScoreEvent.groupBy({
      by: ["teamId"],
      where: { matchId: match.id },
      _sum: { amount: true },
    });
    const amountOf = (teamId: string) =>
      totals.find((t) => t.teamId === teamId)?._sum.amount ?? 0;

    const ordered = [...match.teams].sort((a, b) => a.position - b.position);
    let winnerTeamId: string | null = null;
    if (ordered.length === 2) {
      const a = amountOf(ordered[0].id);
      const b = amountOf(ordered[1].id);
      if (a > b) winnerTeamId = ordered[0].id;
      else if (b > a) winnerTeamId = ordered[1].id;
    }

    await tx.liveMatch.update({ where: { id: match.id }, data: { winnerTeamId } });
    if (ordered.length > 0) {
      await tx.liveScoreSnapshot.createMany({
        data: ordered.map((team) => ({
          matchId: match.id,
          teamId: team.id,
          teamLabel: team.label,
          kind: "final",
          amount: amountOf(team.id),
        })),
      });
    }
    return true;
  });
}

// ── startMatch ─────────────────────────────────────────────────────────

/** Roster gate failures are conflicts ("invalid-roster"), per the contract. */
function invalidRoster(): never {
  throw new LiveDomainError("conflict", "invalid-roster");
}

/**
 * Start a match between ACTIVE stage participants of the CURRENT session.
 * Gates (frozen order): unauthenticated → room not-found → host only →
 * live session ("not-live") → rate limit → match-active → roster
 * validation (arity → duplicates → disjoint → active stage membership).
 */
export async function startMatch(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: StartLiveMatchInput,
): Promise<LiveMatchDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role !== "host") throw new LiveDomainError("forbidden");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (!(await rateLimit(`wf:live:matches:${roomId}:${actor.id}`, RATE_LIMITS.matchStart))) {
    throw new LiveDomainError("rate-limited");
  }

  const existing = await db.liveMatch.findFirst({
    where: { sessionId: session.id, status: "active" },
    select: { id: true },
  });
  if (existing) throw new LiveDomainError("conflict", "match-active");

  const body = input ?? ({} as StartLiveMatchInput);
  const kind = body.kind;
  if (kind !== "solo" && kind !== "team") {
    throw new LiveDomainError("invalid", "kind must be solo or team");
  }
  const isRoster = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
  if (!isRoster(body.teamA) || !isRoster(body.teamB)) {
    throw new LiveDomainError("invalid", "teamA/teamB must be arrays of user ids");
  }
  const aIds = body.teamA.map((id) => id.trim());
  const bIds = body.teamB.map((id) => id.trim());

  // Arity: "solo" is EXACTLY 1 per side; "team" is 1..MATCH_TEAM_SIZE_MAX.
  if (kind === "solo") {
    if (aIds.length !== 1 || bIds.length !== 1) invalidRoster();
  } else if (
    aIds.length < 1 ||
    aIds.length > MATCH_TEAM_SIZE_MAX ||
    bIds.length < 1 ||
    bIds.length > MATCH_TEAM_SIZE_MAX
  ) {
    invalidRoster();
  }
  // Duplicates within a side would violate (matchId, userId) UNIQUE.
  if (new Set(aIds).size !== aIds.length || new Set(bIds).size !== bIds.length) invalidRoster();
  // The two rosters must be disjoint.
  const bSet = new Set(bIds);
  if (aIds.some((id) => bSet.has(id))) invalidRoster();
  // EVERY member must be an ACTIVE stage participant of THIS session
  // (LiveParticipant role "host"|"guest", state != "removed").
  const rows = await db.liveParticipant.findMany({
    where: { sessionId: session.id, userId: { in: [...aIds, ...bIds] } },
    select: { userId: true, role: true, state: true },
  });
  const eligible = new Set(
    rows
      .filter((r) => (r.role === "host" || r.role === "guest") && r.state !== "removed")
      .map((r) => r.userId),
  );
  if (![...aIds, ...bIds].every((id) => eligible.has(id))) invalidRoster();

  // durationSeconds clamps to the frozen bounds; scoring defaults on.
  let durationSeconds = MATCH_DURATION_DEFAULT;
  if (body.durationSeconds !== undefined) {
    if (typeof body.durationSeconds !== "number" || !Number.isFinite(body.durationSeconds)) {
      throw new LiveDomainError("invalid", "durationSeconds must be a number");
    }
    durationSeconds = Math.min(
      Math.max(Math.trunc(body.durationSeconds), MATCH_DURATION_MIN),
      MATCH_DURATION_MAX,
    );
  }
  if (body.scoring !== undefined && (typeof body.scoring !== "object" || body.scoring === null)) {
    throw new LiveDomainError("invalid", "scoring must be an object");
  }
  const scoring = {
    reactions: body.scoring?.reactions ?? true,
    gifts: body.scoring?.gifts ?? true,
  };

  const now = new Date();
  // LiveMatchMember carries a DENORMALIZED matchId column (no member→match
  // FK), so the rosters are appended after the match + team rows exist —
  // one create for match + sides, one createMany for the roster rows.
  const match = await db.liveMatch.create({
    data: {
      roomId,
      sessionId: session.id,
      createdById: actor.id,
      kind,
      status: "active",
      durationSeconds,
      reactionsScore: scoring.reactions,
      giftsScore: scoring.gifts,
      startedAt: now,
      endsAt: new Date(now.getTime() + durationSeconds * 1000),
      teams: {
        create: [
          { label: "A", position: 0 },
          { label: "B", position: 1 },
        ],
      },
    },
    include: { teams: true },
  });
  const teamA = match.teams.find((t) => t.position === 0);
  const teamB = match.teams.find((t) => t.position === 1);
  if (!teamA || !teamB) throw new LiveDomainError("provider-failed", "match sides missing");
  await db.liveMatchMember.createMany({
    data: [
      ...aIds.map((userId) => ({ matchId: match.id, teamId: teamA.id, userId })),
      ...bIds.map((userId) => ({ matchId: match.id, teamId: teamB.id, userId })),
    ],
  });

  // Publish law: the envelope goes out AFTER the durable commit.
  const full = await loadMatchWithTeams(match.id);
  if (!full) throw new LiveDomainError("provider-failed", "match vanished after create");
  const dto = await matchDtoFor(full);
  publishMatchEnvelope(roomId, dto);
  return dto;
}

// ── currentMatch ───────────────────────────────────────────────────────

/**
 * The most recent match on the room's ACTIVE session — ANY status (the UI
 * renders terminal states too), null when none. Public (anonymous OK).
 * Runs the lazy wall-clock timeout FIRST, so an expired match is settled
 * (endReason "timeout", winner derived, finals written) on read.
 */
export async function currentMatch(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<LiveMatchDto | null> {
  void sessionUser; // public read — the caller identity is irrelevant by contract
  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) return null;

  const latest = await db.liveMatch.findFirst({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return null;

  const match = await settleIfExpired(latest.id);
  if (!match) return null;
  return matchDtoFor(match);
}

// ── endMatch / cancelMatch ─────────────────────────────────────────────

/**
 * Host ends an ACTIVE match early: the same derivation as the lazy
 * timeout with endReason "host" (winner + finals). A match that expired
 * was already settled by the lazy timeout with endReason "timeout" —
 * ending it then is an honest conflict. Foreign matchId → not-found;
 * terminal → conflict.
 */
export async function endMatch(
  roomId: string,
  matchId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LiveMatchDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role !== "host") throw new LiveDomainError("forbidden");

  const existing = await loadMatchWithTeams(matchId);
  if (!existing || existing.roomId !== roomId) throw new LiveDomainError("not-found");

  const lazy = await settleIfExpired(matchId);
  if (!lazy || lazy.status !== "active") {
    throw new LiveDomainError("conflict", "match-ended");
  }
  const settled = await settleMatch(lazy, "host");
  if (!settled) throw new LiveDomainError("conflict", "match-ended");

  const ended = await loadMatchWithTeams(matchId);
  if (!ended) throw new LiveDomainError("not-found");
  const dto = await matchDtoFor(ended);
  publishMatchEnvelope(roomId, dto);
  return dto;
}

/**
 * Host cancels an ACTIVE match: status "cancelled", endReason "host",
 * NO winner, NO finals — the banked LiveScoreEvent rows stand (audit).
 * Terminal matches cannot be cancelled (conflict).
 */
export async function cancelMatch(
  roomId: string,
  matchId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LiveMatchDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role !== "host") throw new LiveDomainError("forbidden");

  const existing = await loadMatchWithTeams(matchId);
  if (!existing || existing.roomId !== roomId) throw new LiveDomainError("not-found");

  const lazy = await settleIfExpired(matchId);
  if (!lazy || lazy.status !== "active") {
    throw new LiveDomainError("conflict", "match-ended");
  }
  const guarded = await db.liveMatch.updateMany({
    where: { id: matchId, status: "active" },
    data: { status: "cancelled", endedAt: new Date(), endReason: "host" },
  });
  if (guarded.count === 0) throw new LiveDomainError("conflict", "match-ended");

  const cancelled = await loadMatchWithTeams(matchId);
  if (!cancelled) throw new LiveDomainError("not-found");
  const dto = await matchDtoFor(cancelled);
  publishMatchEnvelope(roomId, dto);
  return dto;
}

// ── ingestScore (the scoring heart — lanes 3-c + the TL reactions hook) ─

/**
 * Ingest ONE validated scoring event into the append-only ledger.
 * Gates (frozen order): lazy timeout → active → policy → team resolution
 * → amount audit bound → idempotent insert → SUM + envelope.
 *
 * NEVER throws for domain rejections — the caller answers its normal 200
 * and simply contributes no score (the frozen late rule). Throws only for
 * a caller bug (blank clientEventId), which is an internal contract
 * violation, not client state.
 */
export async function ingestScore(
  matchId: string,
  ev: IngestScoreEvent,
): Promise<IngestScoreResult> {
  // 1. The lazy timeout runs before ANYTHING else; a settled match is closed.
  const match = await settleIfExpired(matchId);
  if (!match || match.status !== "active") {
    return { accepted: false, reason: "match-closed" };
  }

  // 2. Policy: which inputs count is the host's explicit match policy.
  if (ev.source === "reaction" && !match.reactionsScore) {
    return { accepted: false, reason: "policy-off" };
  }
  if (ev.source === "gift" && !match.giftsScore) {
    return { accepted: false, reason: "policy-off" };
  }

  // 3. Team resolution: gifts name their side (server-validated);
  //    reactions derive the team from match membership (not left).
  let teamId: string;
  if (ev.source === "gift") {
    if (!ev.teamId || !match.teams.some((t) => t.id === ev.teamId)) {
      return { accepted: false, reason: "invalid-team" };
    }
    teamId = ev.teamId;
  } else {
    const member = match.teams
      .flatMap((t) => t.members.map((m) => ({ teamId: t.id, userId: m.userId, leftAt: m.leftAt })))
      .find((m) => m.userId === ev.actorId);
    if (!member || member.leftAt) {
      return { accepted: false, reason: "not-member" };
    }
    teamId = member.teamId;
  }

  // 4. Amount audit bound (server clamps upstream make this unreachable —
  //    it exists so the ledger can never carry an out-of-policy number).
  const cap = ev.source === "reaction" ? REACTION_BATCH_MAX : GIFT_QTY_MAX * GIFT_PRICE_MAX;
  if (!Number.isInteger(ev.amount) || ev.amount < 1 || ev.amount > cap) {
    return { accepted: false, reason: "policy-off" };
  }

  const clientEventId = typeof ev.clientEventId === "string" ? ev.clientEventId.trim() : "";
  if (!clientEventId) {
    // Caller bug (the idempotency key is mandatory) — not a domain verdict.
    throw new Error("ingestScore: clientEventId is required");
  }

  // 5. Idempotent append — a replay answers the EXISTING row, never a
  //    second one, never a double-score.
  try {
    await db.liveScoreEvent.create({
      data: {
        matchId,
        teamId,
        actorId: ev.actorId,
        source: ev.source,
        amount: ev.amount,
        clientEventId,
        linkId: ev.linkId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.liveScoreEvent.findUnique({
        where: { matchId_clientEventId: { matchId, clientEventId } },
      });
      if (existing) {
        return {
          accepted: true,
          duplicate: true,
          teamId: existing.teamId,
          teamScore: await teamScoreFor(matchId, existing.teamId),
        };
      }
    }
    throw err;
  }

  // 6. Fresh insert: the team's new SUM + the fresh full-match envelope
  //    (publish AFTER the durable commit — the fan-out law).
  const teamScore = await teamScoreFor(matchId, teamId);
  const fresh = await loadMatchWithTeams(matchId);
  if (fresh) {
    publishMatchEnvelope(fresh.roomId, await matchDtoFor(fresh));
  }
  return { accepted: true, teamId, teamScore };
}
