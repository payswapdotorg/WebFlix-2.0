/**
 * WFX2-LIVE-PLATFORM-1 Parity P72 — cross-room PK battles (the TikTok-parity
 * layer, docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md §3
 * P72, ADR-0012).
 *
 * THE PK LAW: two hosts put their rooms head-to-head. The lifecycle:
 *   - OPEN: a host opens a challenge on their room (one open challenge per
 *     room — domain-enforced 409). durationSeconds clamps to
 *     PK_DURATION_MIN..MAX (default PK_DURATION_DEFAULT).
 *   - MATCHMAKING: the open read pairs the OLDEST other-host open challenge
 *     → BOTH flip to `active` with a shared window: endsAt = now + duration
 *     (the joining side's duration wins the window — the pair answer).
 *   - ACTIVE: side scores are DERIVED on read from each room's durable rows
 *     since startsAt: Σ LiveReactionBatch.count + Σ GiftEvent.totalCredits
 *     (the same derivation law as goals — never stored, never claimed).
 *   - LAZY FINALIZE: a read past endsAt stamps the final snapshots + the
 *     winner (higher derived score; a tie answers winnerSide null) + the
 *     MVP (the WINNING side's top contributor by reaction+gift sums,
 *     attributed from senderId SUMs) and publishes `pk` envelopes to BOTH
 *     rooms. Finalize is idempotent (status final short-circuits).
 *   - CANCEL: the host cancels an open/active challenge → status
 *     cancelled, NO winner, NO snapshots (pure derivation means zero
 *     residue — the report's own banked-nothing law), envelopes to both
 *     rooms.
 *
 * Hub topology note: battle envelopes publish to both room topics
 * in-process — the ADR-0006 single-instance ceiling extends verbatim to PK
 * (the DB tail re-derives for every other instance).
 */
import { db } from "@/lib/db";
import type { LiveRoom, LivePkBattle } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { opsRateLimit } from "./ops";
import {
  isHost,
  liveActorFor,
  PK_DURATION_DEFAULT,
  PK_DURATION_MAX,
  PK_DURATION_MIN,
  RATE_LIMITS,
  resolveHandles,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { CreateLivePkInput, LivePkBattleDto, LivePkMvpDto, LivePkSideDto } from "./types";

type HandleMap = Map<string, { handle: string; name: string }>;

/** Room title + host handle for a side row (resolve at read time). */
async function sideRow(roomId: string | null, handles: HandleMap): Promise<LivePkSideDto | null> {
  if (!roomId) return null;
  const room = await db.liveRoom.findUnique({
    where: { id: roomId },
    select: { hostId: true, title: true },
  });
  if (!room) return null;
  const hostHandles = await resolveHandles([room.hostId]);
  void handles;
  return {
    roomId,
    hostHandle: hostHandles.get(room.hostId)?.handle ?? "unknown",
    hostName: hostHandles.get(room.hostId)?.name ?? "Unknown",
    title: room.title,
    score: 0, // filled by the caller's derivation
  };
}

/**
 * The DERIVED side score for one room since one instant (the frozen
 * formula): reaction batch counts + gift credits, both room-scoped and
 * strictly since `since`. TWO aggregate queries.
 */
async function deriveSideScore(roomId: string, since: Date): Promise<number> {
  const window = { roomId, createdAt: { gte: since } };
  const [reactions, gifts] = await Promise.all([
    db.liveReactionBatch.aggregate({ where: window, _sum: { count: true } }),
    db.giftEvent.aggregate({ where: window, _sum: { totalCredits: true } }),
  ]);
  return (reactions._sum.count ?? 0) + (gifts._sum.totalCredits ?? 0);
}

/** The MVP: the winning side's top contributor by reaction+gift sums. */
async function deriveMvp(
  roomId: string,
  since: Date,
  side: "a" | "b",
): Promise<LivePkMvpDto | null> {
  const window = { roomId, createdAt: { gte: since } };
  const [reactions, gifts] = await Promise.all([
    db.liveReactionBatch.groupBy({
      by: ["senderId"],
      where: window,
      _sum: { count: true },
    }),
    db.giftEvent.groupBy({
      by: ["senderId"],
      where: window,
      _sum: { totalCredits: true },
    }),
  ]);
  const totals: Map<string, number> = new Map();
  for (const r of reactions) totals.set(r.senderId, (totals.get(r.senderId) ?? 0) + (r._sum.count ?? 0));
  for (const g of gifts) totals.set(g.senderId, (totals.get(g.senderId) ?? 0) + (g._sum.totalCredits ?? 0));
  let top: { userId: string; points: number } | null = null;
  for (const [userId, points] of totals) {
    if (!top || points > top.points) top = { userId, points };
  }
  if (!top) return null;
  const handles = await resolveHandles([top.userId]);
  return {
    userId: top.userId,
    handle: handles.get(top.userId)?.handle ?? "unknown",
    displayName: handles.get(top.userId)?.name ?? "Unknown",
    points: top.points,
    side,
  };
}

/** Row (+ derived scores) → DTO. `mySide` is the CALLING room's side. */
async function mapBattle(
  battle: LivePkBattle,
  callerRoomId: string,
): Promise<LivePkBattleDto> {
  const handles: HandleMap = new Map();
  const [sideA, sideB] = await Promise.all([
    sideRow(battle.roomAId, handles),
    sideRow(battle.roomBId, handles),
  ]);
  const derived = await Promise.all([
    deriveSideScore(battle.roomAId, battle.startsAt),
    battle.roomBId && battle.status !== "open"
      ? deriveSideScore(battle.roomBId, battle.startsAt)
      : Promise.resolve(0),
  ]);
  if (sideA) sideA.score = derived[0];
  if (sideB) sideB.score = derived[1];
  let mvp: LivePkMvpDto | null = null;
  if (battle.status === "final" && battle.winnerSide) {
    const snapshot = await db.livePkScoreSnapshot.findFirst({
      where: { battleId: battle.id, kind: "mvp" },
    });
    if (snapshot?.userId) {
      const winnerRoomId = battle.winnerSide === "a" ? battle.roomAId : battle.roomBId;
      const handles2 = await resolveHandles([snapshot.userId]);
      mvp = {
        userId: snapshot.userId,
        handle: handles2.get(snapshot.userId)?.handle ?? "unknown",
        displayName: handles2.get(snapshot.userId)?.name ?? "Unknown",
        points: snapshot.amount,
        side: winnerRoomId === battle.roomAId ? "a" : "b",
      };
    }
  }
  return {
    id: battle.id,
    status: battle.status as LivePkBattleDto["status"],
    sideA,
    sideB,
    mySide:
      battle.status === "open"
        ? null
        : callerRoomId === battle.roomAId
          ? "a"
          : callerRoomId === battle.roomBId
            ? "b"
            : null,
    startsAt: battle.startsAt.toISOString(),
    endsAt: battle.endsAt.toISOString(),
    finalizedAt: battle.finalizedAt ? battle.finalizedAt.toISOString() : null,
    winnerSide: (battle.winnerSide as LivePkBattleDto["winnerSide"]) ?? null,
    mvp,
    durationSeconds: battle.durationSec,
    serverNow: new Date().toISOString(),
  };
}

/**
 * The room's battle view: the open challenge it hosts, the active battle
 * it fights, or the latest final/cancelled one (newest first, one row).
 * The LAZY FINALIZE runs here — a read past endsAt settles the battle.
 */
export async function currentBattle(roomId: string): Promise<LivePkBattleDto | null> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const battle = await db.livePkBattle.findFirst({
    where: { OR: [{ roomAId: roomId }, { roomBId: roomId }] },
    orderBy: { createdAt: "desc" },
  });
  if (!battle) return null;
  const settled = await lazyFinalize(battle);
  return mapBattle(settled, roomId);
}

/**
 * The lazy finalize: an ACTIVE battle past endsAt stamps final snapshots +
 * winner + MVP (idempotent — a final/cancelled battle returns as-is).
 */
async function lazyFinalize(battle: LivePkBattle): Promise<LivePkBattle> {
  if (battle.status !== "active") return battle;
  if (battle.endsAt.getTime() > Date.now()) return battle;
  const [scoreA, scoreB] = await Promise.all([
    deriveSideScore(battle.roomAId, battle.startsAt),
    battle.roomBId ? deriveSideScore(battle.roomBId, battle.startsAt) : Promise.resolve(0),
  ]);
  const winnerSide: "a" | "b" | null =
    scoreA === scoreB ? null : scoreA > scoreB ? "a" : "b";
  const finalized = await db.livePkBattle.update({
    where: { id: battle.id },
    data: { status: "final", finalizedAt: new Date(), winnerSide },
  });
  const mvp = winnerSide
    ? await deriveMvp(
        winnerSide === "a" ? battle.roomAId : (battle.roomBId ?? battle.roomAId),
        battle.startsAt,
        winnerSide,
      )
    : null;
  const takenAt = new Date();
  await db.livePkScoreSnapshot.createMany({
    data: [
      { battleId: battle.id, side: "a", kind: "final", amount: scoreA, takenAt },
      { battleId: battle.id, side: "b", kind: "final", amount: scoreB, takenAt },
      ...(mvp
        ? [
            {
              battleId: battle.id,
              side: mvp.side,
              kind: "mvp",
              amount: mvp.points,
              userId: mvp.userId,
              takenAt,
            },
          ]
        : []),
    ],
  });
  // Both rooms hear the result (the in-process hub; the DB tail is the
  // multi-instance floor — the ADR-0006 ceiling extends verbatim to PK).
  const dtoA = await mapBattle(finalized, battle.roomAId);
  publishLiveEvent(battle.roomAId, {
    kind: "pk",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    battle: dtoA,
  });
  if (battle.roomBId) {
    const dtoB = await mapBattle(finalized, battle.roomBId);
    publishLiveEvent(battle.roomBId, {
      kind: "pk",
      eventId: crypto.randomUUID(),
      at: new Date().toISOString(),
      battle: dtoB,
    });
  }
  return finalized;
}

/**
 * Open a challenge (host-only; one open per room). When another host's
 * challenge is waiting, the OLDEST one pairs: both flip active with the
 * shared window. Otherwise the challenge waits (status open).
 */
export async function openChallenge(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: CreateLivePkInput,
): Promise<LivePkBattleDto> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host-only");
  }
  if (!(await opsRateLimit(
        "pkManage",
        `wf:live:pkManage:${roomId}:${actor.id}`,
        RATE_LIMITS.pkManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const durationRaw = typeof input?.durationSeconds === "number" ? input.durationSeconds : NaN;
  const durationSeconds = Number.isFinite(durationRaw)
    ? Math.min(Math.max(Math.trunc(durationRaw), PK_DURATION_MIN), PK_DURATION_MAX)
    : PK_DURATION_DEFAULT;

  const existing = await db.livePkBattle.findFirst({
    where: { roomAId: roomId, status: "open" },
  });
  if (existing) throw new LiveDomainError("conflict", "challenge-open");

  // MATCHMAKING: the OLDEST other-host open challenge pairs with this one.
  const opponent = await db.livePkBattle.findFirst({
    where: { status: "open", roomAId: { not: roomId } },
    orderBy: { startsAt: "asc" },
  });
  const now = new Date();
  if (opponent) {
    const endsAt = new Date(now.getTime() + durationSeconds * 1000);
    const paired = await db.livePkBattle.update({
      where: { id: opponent.id },
      data: {
        roomBId: roomId,
        status: "active",
        startsAt: now,
        endsAt,
        durationSec: durationSeconds,
      },
    });
    // Both rooms hear the pairing (side B's duration wins the window — the
    // pair answer; documented in the contract doc).
    const dtoA = await mapBattle(paired, paired.roomAId);
    publishLiveEvent(paired.roomAId, {
      kind: "pk",
      eventId: crypto.randomUUID(),
      at: now.toISOString(),
      battle: dtoA,
    });
    const dtoB = await mapBattle(paired, roomId);
    publishLiveEvent(roomId, {
      kind: "pk",
      eventId: crypto.randomUUID(),
      at: now.toISOString(),
      battle: dtoB,
    });
    return dtoB;
  }

  const battle = await db.livePkBattle.create({
    data: {
      roomAId: roomId,
      status: "open",
      startsAt: now,
      endsAt: new Date(now.getTime() + durationSeconds * 1000),
      durationSec: durationSeconds,
    },
  });
  return mapBattle(battle, roomId);
}

/**
 * Cancel the room's open/active challenge (host-only). No winner, no
 * snapshots — banked nothing (pure derivation = zero residue). Both rooms
 * hear the cancellation.
 */
export async function cancelChallenge(
  roomId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LivePkBattleDto> {
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const actor = await liveActorFor(roomId, sessionUser);
  if (!isHost(actor.role)) {
    throw new LiveDomainError("forbidden", "host-only");
  }
  if (!(await opsRateLimit(
        "pkManage",
        `wf:live:pkManage:${roomId}:${actor.id}`,
        RATE_LIMITS.pkManage,
      ))) {
    throw new LiveDomainError("rate-limited");
  }
  const battle = await db.livePkBattle.findFirst({
    where: {
      roomAId: roomId,
      status: { in: ["open", "active"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!battle) throw new LiveDomainError("not-found", "no-open-challenge");
  const cancelled = await db.livePkBattle.update({
    where: { id: battle.id },
    data: { status: "cancelled" },
  });
  const dtoA = await mapBattle(cancelled, battle.roomAId);
  publishLiveEvent(battle.roomAId, {
    kind: "pk",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    battle: dtoA,
  });
  if (battle.roomBId) {
    const dtoB = await mapBattle(cancelled, battle.roomBId);
    publishLiveEvent(battle.roomBId, {
      kind: "pk",
      eventId: crypto.randomUUID(),
      at: new Date().toISOString(),
      battle: dtoB,
    });
  }
  return dtoA;
}

export type { LiveRoom };
