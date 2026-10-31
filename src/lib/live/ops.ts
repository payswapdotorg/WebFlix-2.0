/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — operations telemetry (work order §4H,
 * ADR-0009, frozen contracts: docs/plans/wfx2-live-phase-4-ops-contracts.md).
 *
 * THE OBSERVATION LAW: a LiveOpsEvent row is an observation, never authority.
 * Nothing here mutates room state, moderation state, scores, analytics
 * snapshots or balances — this module only WRITES ops rows (best-effort,
 * never throws into a caller's 200 path) and READS them back (the overview
 * derivation). A client can never claim a number the server derives: the
 * beacon route validates/clamps/rate-limits, and `deriveOpsOverview` is the
 * ONE place the dashboard's figures are computed from durable rows (the
 * ADR-0008 derivation law, applied to operations).
 *
 * Server-capture seams (best-effort by contract §5):
 *   - opsRateLimit(): wraps the shared rateLimit() — a denial records a
 *     `rate_limit` observation for that surface (identity never stored).
 *   - rooms.ts startSession/endRoom: provider failures record
 *     `provider_error` (the honest domain error still surfaces unchanged).
 *   - the session end hook records `end_reconcile` (the ADR-0008 analytics
 *     hook runs beside it).
 */
import { db } from "@/lib/db";
import { rateLimit, type RateLimitOptions } from "@/lib/youtube/cache";
import { attachedStreamCount } from "./hub";
import {
  OPS_BEACON_KINDS,
  OPS_CODE_MAX,
  OPS_META_MAX,
  OPS_SURFACE_MAX,
  OPS_VALUE_MS_MAX,
  OPS_WINDOW_MS_DEFAULT,
  OPS_WINDOW_MS_MAX,
  OPS_WINDOW_MS_MIN,
} from "./permissions";
import type {
  LiveOpsBeaconKind,
  LiveOpsEventKind,
  LiveOpsOverviewDto,
  LiveOpsTopDto,
} from "./types";

/**
 * Compile-time parity pin: the shared law (permissions.ts) and the
 * import-free types.ts union must never drift. This array is typed as the
 * types.ts union — a new kind in one and not the other fails tsc HERE.
 */
const _beaconKindParity: readonly LiveOpsBeaconKind[] = OPS_BEACON_KINDS;
void _beaconKindParity;

/** The ADR-0006 DB-tail cadence — the documented multi-instance floor. */
export const LIVE_TAIL_FLUSH_MS = 900;

/** The top-N size for every keyed list in the overview (frozen contracts §4). */
const OPS_TOP_N = 5;
/** The high-volume room count (frozen contracts §4). */
const OPS_VOLUME_ROOMS = 10;
/**
 * The analysis cap on sampled observations per percentile kind. Percentiles
 * are computed over the MOST RECENT observations up to this cap (beacon
 * sampling keeps real traffic far below it); exact COUNTS are always
 * groupBy-exact, never capped.
 */
const OPS_SAMPLE_CAP = 5000;

/** A server-side ops observation (server kinds are never client-claimable). */
export interface RecordOpsEventInput {
  kind: LiveOpsEventKind;
  surface?: string | null;
  roomId?: string | null;
  sessionId?: string | null;
  actorId?: string | null;
  code?: string | null;
  valueMs?: number | null;
  /** Bounded, identity-free context — re-serialized server-side. */
  meta?: Record<string, unknown> | null;
}

function clampStr(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function clampMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(OPS_VALUE_MS_MAX, Math.round(value)));
}

/** The client-beaconable kind guard (the server kinds are rejected). */
export function isOpsBeaconKind(value: unknown): value is LiveOpsBeaconKind {
  return (
    typeof value === "string" &&
    (OPS_BEACON_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Record one operational observation. BEST-EFFORT by law: any failure is
 * swallowed (an ops row must never break a media, chat or lifecycle path).
 */
export async function recordOpsEvent(input: RecordOpsEventInput): Promise<void> {
  try {
    let meta: string | null = null;
    if (input.meta) {
      try {
        const serialized = JSON.stringify(input.meta);
        // An oversized blob is DROPPED, never truncated into invalid JSON —
        // the row lands, the context honestly does not.
        if (serialized.length <= OPS_META_MAX) meta = serialized;
      } catch {
        meta = null;
      }
    }
    await db.liveOpsEvent.create({
      data: {
        kind: input.kind,
        surface: clampStr(input.surface, OPS_SURFACE_MAX),
        roomId: clampStr(input.roomId, 64),
        sessionId: clampStr(input.sessionId, 64),
        actorId: clampStr(input.actorId, 64),
        code: clampStr(input.code, OPS_CODE_MAX),
        valueMs: clampMs(input.valueMs),
        meta,
      },
    });
  } catch {
    // The observation law: never surface.
  }
}

/**
 * The rate-limit capture seam: the shared limiter, wrapped so a denial is
 * itself an observation. The key NEVER lands in the ops row (no identity
 * in telemetry) — only the surface name.
 */
export async function opsRateLimit(
  surface: string,
  key: string,
  limits: RateLimitOptions,
): Promise<boolean> {
  const ok = await rateLimit(key, limits);
  if (!ok) {
    void recordOpsEvent({ kind: "rate_limit", surface });
  }
  return ok;
}

// ═══════════════════════════════════════════════════════════════════
// The overview derivation — the ONE place the dashboard's numbers live.
// ═══════════════════════════════════════════════════════════════════

export function clampOpsWindowMs(raw: number | string | null | undefined): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return OPS_WINDOW_MS_DEFAULT;
  return Math.max(OPS_WINDOW_MS_MIN, Math.min(OPS_WINDOW_MS_MAX, Math.round(n)));
}

/** Nearest-rank percentile over an ascending-sorted sample. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function latencyOf(values: number[]): { count: number; p50Ms: number | null; p95Ms: number | null } {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95) };
}

function topOf(entries: Map<string, number>): LiveOpsTopDto {
  let total = 0;
  for (const c of entries.values()) total += c;
  const top = [...entries.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, OPS_TOP_N);
  return { count: total, top };
}

export async function deriveOpsOverview(
  rawWindowMs: number | string | null | undefined,
): Promise<LiveOpsOverviewDto> {
  const windowMs = clampOpsWindowMs(rawWindowMs);
  const since = new Date(Date.now() - windowMs);

  // ── Exact per-kind counts (groupBy — never capped) ──
  const kindCounts = await db.liveOpsEvent.groupBy({
    by: ["kind"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const countFor = (kind: string): number =>
    kindCounts.find((k) => k.kind === kind)?._count._all ?? 0;

  // ── Keyed counts: rate-limit surfaces + error codes ──
  const surfaceRows = await db.liveOpsEvent.groupBy({
    by: ["kind", "surface"],
    where: { createdAt: { gte: since }, kind: "rate_limit" },
    _count: { _all: true },
  });
  const rateLimitTop = topOf(
    new Map(surfaceRows.map((r) => [r.surface ?? "unspecified", r._count._all])),
  );

  const codeRows = await db.liveOpsEvent.groupBy({
    by: ["kind", "code"],
    where: { createdAt: { gte: since }, kind: { in: ["join_error", "media_error", "provider_error"] } },
    _count: { _all: true },
  });
  const topForKind = (kind: string): LiveOpsTopDto =>
    topOf(new Map(codeRows.filter((r) => r.kind === kind).map((r) => [r.code ?? "unspecified", r._count._all])));

  // ── Sampled percentiles (most recent observations up to the cap) ──
  const samples = await db.liveOpsEvent.findMany({
    where: {
      kind: { in: ["ttff", "chat_latency"] },
      valueMs: { not: null },
      createdAt: { gte: since },
    },
    select: { kind: true, valueMs: true },
    orderBy: { createdAt: "desc" },
    take: OPS_SAMPLE_CAP,
  });
  const ttffValues: number[] = [];
  const chatValues: number[] = [];
  for (const s of samples) {
    if (s.valueMs === null) continue;
    if (s.kind === "ttff") ttffValues.push(s.valueMs);
    else chatValues.push(s.valueMs);
  }

  // ── Room lifecycle (durable rows) ──
  const [liveNow, startedInWindow, endedInWindow, endReasonRows] = await Promise.all([
    db.liveRoom.count({ where: { status: "live" } }),
    db.liveSession.count({ where: { startedAt: { gte: since } } }),
    db.liveSession.count({ where: { status: "ended", endedAt: { gte: since } } }),
    db.liveSession.groupBy({
      by: ["endReason"],
      where: { status: "ended", endedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const endReasons = endReasonRows
    .map((r) => ({ key: r.endReason ?? "unspecified", count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  // ── High-volume rooms (window-bounded durable interaction rows) ──
  const sessionRows = await db.liveSession.findMany({
    where: { OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }] },
    select: { roomId: true, id: true, peakViewers: true, startedAt: true, endedAt: true },
  });
  const [chatByRoom, reactionsByRoom, giftsByRoom, matchesByRoom] = await Promise.all([
    db.liveRoomMessage.groupBy({ by: ["roomId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.liveReactionBatch.groupBy({
      by: ["roomId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { count: true },
    }),
    db.giftEvent.groupBy({ by: ["roomId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.liveMatch.groupBy({ by: ["roomId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const chatMap = new Map(chatByRoom.map((r) => [r.roomId, r._count._all]));
  const reactionBatchesMap = new Map(reactionsByRoom.map((r) => [r.roomId, r._count._all]));
  const heartsMap = new Map(reactionsByRoom.map((r) => [r.roomId, r._sum.count ?? 0]));
  const giftsMap = new Map(giftsByRoom.map((r) => [r.roomId, r._count._all]));
  const matchesMap = new Map(matchesByRoom.map((r) => [r.roomId, r._count._all]));

  const sessionAgg = new Map<string, { sessions: number; peak: number; last: Date | null }>();
  for (const s of sessionRows) {
    const agg = sessionAgg.get(s.roomId) ?? { sessions: 0, peak: 0, last: null as Date | null };
    agg.sessions += 1;
    agg.peak = Math.max(agg.peak, s.peakViewers);
    const stamp = s.endedAt ?? s.startedAt;
    if (stamp && (agg.last === null || stamp > agg.last)) agg.last = stamp;
    sessionAgg.set(s.roomId, agg);
  }

  const volumeRoomIds = new Set<string>([
    ...sessionAgg.keys(),
    ...chatMap.keys(),
    ...reactionBatchesMap.keys(),
    ...giftsMap.keys(),
    ...matchesMap.keys(),
  ]);
  const volumeRooms =
    volumeRoomIds.size > 0
      ? await db.liveRoom.findMany({
          where: { id: { in: [...volumeRoomIds] } },
          select: {
            id: true,
            title: true,
            status: true,
            host: { select: { handle: true, name: true } },
          },
        })
      : [];
  const roomMeta = new Map(volumeRooms.map((r) => [r.id, r]));
  const ranked = [...volumeRoomIds]
    .map((roomId) => {
      const agg = sessionAgg.get(roomId);
      const chat = chatMap.get(roomId) ?? 0;
      const batches = reactionBatchesMap.get(roomId) ?? 0;
      const gifts = giftsMap.get(roomId) ?? 0;
      const matches = matchesMap.get(roomId) ?? 0;
      return {
        roomId,
        interactions: chat + batches + gifts + matches,
        chat,
        batches,
        gifts,
        matches,
        sessions: agg?.sessions ?? 0,
        peak: agg?.peak ?? 0,
        last: agg?.last ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.interactions - a.interactions ||
        b.sessions - a.sessions ||
        a.roomId.localeCompare(b.roomId),
    )
    .slice(0, OPS_VOLUME_ROOMS);

  const volume = ranked.map((r) => {
    const meta = roomMeta.get(r.roomId);
    return {
      roomId: r.roomId,
      title: meta?.title ?? "(room purged)",
      hostHandle: meta?.host.handle ?? "unknown",
      hostName: meta?.host.name ?? "Unknown",
      status: meta?.status ?? "unknown",
      sessions: r.sessions,
      chatMessages: r.chat,
      reactionHearts: heartsMap.get(r.roomId) ?? 0,
      giftEvents: r.gifts,
      matches: r.matches,
      peakViewers: r.peak,
      lastActivityAt: r.last ? r.last.toISOString() : null,
    };
  });

  // ── Moderation pressure + stored replay volume ──
  const [actions, reports, replayAgg] = await Promise.all([
    db.liveModerationAction.count({ where: { createdAt: { gte: since } } }),
    db.liveReport.count({ where: { createdAt: { gte: since } } }),
    db.liveReplayAsset.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
  ]);

  // ── The honest-unavailable blocks (work order §3.8 — never zeros) ──
  const egressDeclared = process.env.LIVEKIT_EGRESS_ENABLED === "true";
  const overview: LiveOpsOverviewDto = {
    windowMs,
    generatedAt: new Date().toISOString(),
    media: {
      ttff: latencyOf(ttffValues),
      reconnects: countFor("reconnect"),
      joinErrors: topForKind("join_error"),
      mediaErrors: topForKind("media_error"),
    },
    chatLatency: latencyOf(chatValues),
    rateLimits: rateLimitTop,
    provider: {
      errors: topForKind("provider_error"),
      costs: {
        status: "unavailable",
        reason: "provider-billing-api-not-connected",
        detail:
          "No provider billing API is connected to this deployment — cost figures would be fabricated.",
      },
      egress: {
        status: "unavailable",
        reason: egressDeclared ? "egress-metering-not-instrumented" : "egress-not-configured",
        detail: "storage.replayBytes is the one real stored-volume fact shown alongside.",
      },
    },
    reconciles: { endReconciles: countFor("end_reconcile") },
    rooms: { liveNow, startedInWindow, endedInWindow, endReasons },
    volume: { rooms: volume },
    moderation: { actions, reports },
    transport: {
      // Instance-local by design (ADR-0006) — the dashboard labels it as such.
      attachedStreamsThisInstance: attachedStreamCount(),
      tailFlushMs: LIVE_TAIL_FLUSH_MS,
      outbox: {
        status: "not-applicable",
        reason: "adr-0006-has-no-outbox",
        detail: "The ~900ms DB tail is the documented multi-instance flush floor.",
      },
    },
    storage: {
      replayAssets: replayAgg._count._all,
      replayBytes: replayAgg._sum.sizeBytes ?? 0,
    },
  };
  return overview;
}
