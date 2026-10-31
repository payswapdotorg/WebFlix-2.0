/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 — creator analytics (work order §4H;
 * ADR-0008 "the analytics law").
 *
 * THE DERIVATION LAW: every number in a LiveAnalyticsSnapshotDto is
 * computed HERE, in one place, from durable rows only —
 *   - durationMs:     the session's startedAt..endedAt window (endedAt ?? now)
 *   - peakViewers:    LiveSession.peakViewers (the presence-time fact raised
 *                     by the heartbeat path — never client-claimable)
 *   - uniqueViewers:  distinct viewer-role LiveParticipant rows (the
 *                     sessionId_userId unique constraint guarantees it)
 *   - chatMessages:   non-tombstoned LiveRoomMessage rows (all kinds)
 *   - reactionHearts: SUM over LiveReactionBatch.count
 *   - giftEvents / giftCredits: GiftEvent rows / SUM(totalCredits) —
 *                     DEV credits with zero cash value (the §4F money gate
 *                     stays closed; no wallet/earnings/payout field exists)
 *   - matchesRun:     LiveMatch rows in ANY state (every terminal state)
 *   - replayStatus:   the session's LiveReplayAsset.status, when an asset
 *                     exists (cast to the frozen union)
 *
 * Clients can never supply a number. The host read RE-DERIVES and upserts
 * (idempotent: same durable rows → same numbers). The end-session hook is
 * BEST-EFFORT (recordSessionAnalytics never throws — the end reconcile must
 * not depend on it); the next host read re-derives, so a failed end-hook
 * self-heals. Watch time / retention curves / stream-error counts need
 * event history Phase 4 does not add — documented honest residuals
 * (ADR-0008), not zero-filled fakes.
 */
import { db } from "@/lib/db";
import type { LiveSession } from "@prisma/client";
import { LiveDomainError } from "./rooms";
import type {
  LiveAnalyticsSnapshotDto,
  LiveReplayStatus,
  LiveRoomStatus,
  LiveSessionDto,
} from "./types";

/** The computed numbers before they hit the upsert. */
interface DerivedNumbers {
  durationMs: number;
  peakViewers: number;
  uniqueViewers: number;
  chatMessages: number;
  reactionHearts: number;
  giftEvents: number;
  giftCredits: number;
  matchesRun: number;
}

/** Raw LiveAnalyticsSnapshot row shape as Prisma returns it. */
type SnapshotRow = {
  id: string;
  sessionId: string;
  roomId: string;
  durationMs: number;
  peakViewers: number;
  uniqueViewers: number;
  chatMessages: number;
  reactionHearts: number;
  giftEvents: number;
  giftCredits: number;
  matchesRun: number;
  computedAt: Date;
};

function mapSnapshotRow(
  row: SnapshotRow,
  replayStatus?: LiveReplayStatus | null,
): LiveAnalyticsSnapshotDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    roomId: row.roomId,
    computedAt: row.computedAt.toISOString(),
    durationMs: row.durationMs,
    peakViewers: row.peakViewers,
    uniqueViewers: row.uniqueViewers,
    chatMessages: row.chatMessages,
    reactionHearts: row.reactionHearts,
    giftEvents: row.giftEvents,
    giftCredits: row.giftCredits,
    matchesRun: row.matchesRun,
    replayStatus: replayStatus ?? null,
  };
}

/** LiveSession row → the frozen DTO (mirrors rooms.ts's session mapping). */
function mapSessionDto(s: LiveSession): LiveSessionDto {
  return {
    id: s.id,
    roomId: s.roomId,
    provider: s.provider as LiveSessionDto["provider"],
    providerRoomId: s.providerRoomId,
    status: s.status as LiveSessionDto["status"],
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    endReason: (s.endReason as LiveSessionDto["endReason"]) ?? null,
  };
}

/**
 * THE recompute law — derive every number for a session from durable rows
 * and upsert the snapshot on the sessionId unique (idempotent: two
 * recomputes with unchanged rows produce identical numbers). Throws
 * not-found for an unknown session; server-side only by construction.
 */
export async function computeAnalyticsSnapshot(
  sessionId: string,
): Promise<LiveAnalyticsSnapshotDto> {
  const session = await db.liveSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new LiveDomainError("not-found", "no-session");

  // The session window: startedAt..endedAt (endedAt ?? now for a session
  // that is still open); 0 when the session never started. A negative
  // window (data anomaly) clamps honestly to 0.
  const durationMs = session.startedAt
    ? Math.max(0, (session.endedAt ?? new Date()).getTime() - session.startedAt.getTime())
    : 0;

  // Every interaction number is a count/aggregate over durable rows.
  const uniqueViewers = await db.liveParticipant.count({
    where: { sessionId, role: "viewer" },
  });
  const chatMessages = await db.liveRoomMessage.count({
    where: { sessionId, deletedAt: null },
  });
  const reactionSum = await db.liveReactionBatch.aggregate({
    where: { sessionId },
    _sum: { count: true },
  });
  const giftEvents = await db.giftEvent.count({ where: { sessionId } });
  const giftCreditSum = await db.giftEvent.aggregate({
    where: { sessionId },
    _sum: { totalCredits: true },
  });
  const matchesRun = await db.liveMatch.count({ where: { sessionId } });
  const replayAsset = await db.liveReplayAsset.findUnique({ where: { sessionId } });

  const numbers: DerivedNumbers = {
    durationMs,
    // The presence-time concurrent peak — the one fact the heartbeat path
    // already recorded on the session row; analytics summarizes it.
    peakViewers: session.peakViewers,
    uniqueViewers,
    chatMessages,
    reactionHearts: reactionSum._sum.count ?? 0,
    giftEvents,
    giftCredits: giftCreditSum._sum.totalCredits ?? 0,
    matchesRun,
  };

  // Idempotent upsert on the sessionId unique: create stamps the room +
  // numbers; update re-stamps the numbers + computedAt. Same rows in,
  // same numbers out — the snapshot can never drift from what it sums.
  const row = await db.liveAnalyticsSnapshot.upsert({
    where: { sessionId },
    create: { sessionId, roomId: session.roomId, ...numbers },
    update: { ...numbers, computedAt: new Date() },
  });

  return mapSnapshotRow(row, (replayAsset?.status as LiveReplayStatus | undefined) ?? null);
}

/**
 * The end-hook wrapper the endSession reconcile calls — BEST-EFFORT by law
 * (ADR-0008 #4): it NEVER throws, so a snapshot failure can never block the
 * end reconcile. The next host read re-derives (self-healing), which is why
 * the wrapper owes nothing beyond the attempt. `roomId` is carried for the
 * call site's symmetry (the snapshot re-derives roomId from the session
 * row — one place, one truth).
 */
export async function recordSessionAnalytics(sessionId: string, roomId: string): Promise<void> {
  try {
    await computeAnalyticsSnapshot(sessionId);
  } catch (err) {
    console.error("live analytics end-hook failed", err);
  }
}

/** One studio-panel row: room + latest ended session + snapshot + replay. */
export interface StudioLiveSessionRow {
  room: { id: string; title: string; createdAt: string; status: LiveRoomStatus };
  session: LiveSessionDto;
  /** RAW read — the listing never recomputes per row (the detail GET re-derives). */
  snapshot: LiveAnalyticsSnapshotDto | null;
  replay: { status: LiveReplayStatus; readyAt: string | null; durationMs: number | null } | null;
}

/**
 * The studio panel feed: the host's own rooms (newest 50) → each room's
 * most recent ENDED session → the snapshot row if present (raw read) and
 * the replay asset status. Sorted by session endedAt desc, limit 20 by
 * default. Host-scoped by construction (hostId on the room query).
 */
export async function listStudioSessions(
  hostShadowId: string,
  limit = 20,
): Promise<StudioLiveSessionRow[]> {
  const rooms = await db.liveRoom.findMany({
    where: { hostId: hostShadowId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  if (rooms.length === 0) return [];

  const endedSessions = await db.liveSession.findMany({
    where: { roomId: { in: rooms.map((r) => r.id) }, status: "ended" },
    orderBy: { endedAt: "desc" },
    take: 200,
  });
  // The most recent ENDED session per room (the list is already endedAt-desc).
  const latestByRoom = new Map<string, LiveSession>();
  for (const s of endedSessions) {
    if (!latestByRoom.has(s.roomId)) latestByRoom.set(s.roomId, s);
  }
  const picked = [...latestByRoom.values()]
    .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))
    .slice(0, Math.min(Math.max(limit, 1), 50));

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const rows = await Promise.all(
    picked.map(async (session) => {
      const room = roomById.get(session.roomId);
      if (!room) return null;
      const [snapshotRow, replayRow] = await Promise.all([
        db.liveAnalyticsSnapshot.findUnique({ where: { sessionId: session.id } }),
        db.liveReplayAsset.findUnique({ where: { sessionId: session.id } }),
      ]);
      return {
        room: {
          id: room.id,
          title: room.title,
          createdAt: room.createdAt.toISOString(),
          status: room.status as LiveRoomStatus,
        },
        session: mapSessionDto(session),
        snapshot: snapshotRow ? mapSnapshotRow(snapshotRow) : null,
        replay: replayRow
          ? {
              status: replayRow.status as LiveReplayStatus,
              readyAt: replayRow.readyAt ? replayRow.readyAt.toISOString() : null,
              durationMs: replayRow.durationMs,
            }
          : null,
      } satisfies StudioLiveSessionRow;
    }),
  );
  return rows.filter((r): r is StudioLiveSessionRow => r !== null);
}
