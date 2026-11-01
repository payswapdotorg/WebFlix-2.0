/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 (lane 3-c) — non-monetary dev gifting.
 *
 * THE GIFT SANDBOX LAW (frozen contracts §"The gift sandbox law", ADR-0007
 * D3): v1 gifting is NON-MONETARY — `priceCredits` are integer DEV credits
 * with ZERO cash value (no wallet, balance, purchase or payout exists; the
 * money gate stays closed). The abuse bound is server-authoritative:
 *   - quantity clamped 1..GIFT_QTY_MAX (server-computed, never claimed);
 *   - a rolling per-sender spend window: SUM(totalCredits) over the
 *     sender's ACCEPTED GiftIntent rows GLOBALLY (across rooms — safer by
 *     freeze) within GIFT_SPEND_WINDOW_MS may not exceed
 *     GIFT_SPEND_WINDOW_MAX (this send's server-computed total included);
 *   - rate-limited per room+sender by RATE_LIMITS.gifts.
 *
 * Gate order (frozen): unauthenticated → room not-found → not-live →
 * gifts-disabled → banned (a timed MUTE never blocks gifts — the documented
 * asymmetry: mute silences speech, not gifting) → rate-limited →
 * validation → duplicate replay → spend-cap → durable commit.
 *
 * IDEMPOTENCY LAW: (sessionId, senderId, clientRequestId) is unique. A
 * replay returns the committed GiftEvent dto with `duplicate: true` —
 * never a second row, never a second publish, never an error.
 *
 * DURABILITY LAW: the GiftIntent + GiftEvent rows commit BEFORE any SSE
 * fan-out (the publish never precedes durability — work order §3.5).
 *
 * RECIPIENT LAW: the room HOST by law in v1.
 *
 * MATCH SCORING: when the caller supplies matchTeamId AND an ACTIVE match
 * exists on the session, the send scores amount = totalCredits through
 * `matches.ingestScore` (lane 3-b, frozen signature). If the ingestion is
 * not accepted (match closed / policy off / invalid team / wall clock) the
 * gift STILL commits — it is a valid room gift; only the match block is
 * omitted. No active match ⇒ a provided matchTeamId is ignored.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import { opsRateLimit } from "./ops";
import {
  activeSanctions,
  activeSessionFor,
  GIFT_COMBO_WINDOW_MS,
  GIFT_FEED_MAX,
  GIFT_QTY_MAX,
  GIFT_SPEND_WINDOW_MAX,
  GIFT_SPEND_WINDOW_MS,
  GIFT_WALL_MAX,
  liveActorFor,
  RATE_LIMITS,
  resolveHandles,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import { ingestScore } from "./matches";
import type { GiftCatalogItemDto, GiftEventDto, LiveTopGifterDto, SendGiftInput } from "./types";

// ── The frozen v1 catalogue (original WebFlix names — work order §4F/§9) ──
// Server-seeded, idempotent upsert-when-missing; rows are never renamed or
// re-priced (GiftEvent.giftName is the denormalized audit snapshot).
const FROZEN_CATALOG: ReadonlyArray<{
  id: string;
  name: string;
  animationKind: GiftCatalogItemDto["animationKind"];
  priceCredits: number;
}> = [
  { id: "wave-hello", name: "Wave Hello", animationKind: "wave", priceCredits: 1 },
  { id: "spark-cheer", name: "Spark Cheer", animationKind: "sparkle", priceCredits: 5 },
  { id: "burst-applause", name: "Burst Applause", animationKind: "burst", priceCredits: 10 },
  { id: "float-lantern", name: "Floating Lantern", animationKind: "float", priceCredits: 25 },
  { id: "sparkle-storm", name: "Sparkle Storm", animationKind: "sparkle", priceCredits: 50 },
  { id: "burst-fireworks", name: "Fireworks Burst", animationKind: "burst", priceCredits: 100 },
];

/** Raw GiftEvent row shape (as Prisma returns it, before DTO mapping). */
type GiftEventRow = {
  id: string;
  intentId: string;
  roomId: string;
  sessionId: string;
  senderId: string;
  recipientId: string;
  giftItemId: string;
  giftName: string;
  quantity: number;
  totalCredits: number;
  matchId: string | null;
  matchTeamId: string | null;
  createdAt: Date;
};

type HandleMap = Map<string, { handle: string; name: string }>;
type CatalogMap = Map<string, GiftCatalogItemDto>;

function catalogByIds(items: GiftCatalogItemDto[]): CatalogMap {
  return new Map(items.map((c) => [c.id, c]));
}

/**
 * Row → DTO. Sender handles resolve at READ time (the rows carry bare
 * shadow ids by the no-FK law); animationKind resolves from the catalogue
 * map (the row denormalizes only giftName).
 */
function mapGiftEvent(
  row: GiftEventRow,
  handles: HandleMap,
  catalog: CatalogMap,
  comboCount?: number,
): GiftEventDto {
  const sender = handles.get(row.senderId);
  return {
    id: row.id,
    intentId: row.intentId,
    roomId: row.roomId,
    sessionId: row.sessionId,
    senderId: row.senderId,
    senderHandle: sender?.handle ?? "unknown",
    senderName: sender?.name ?? "Unknown",
    recipientId: row.recipientId,
    giftItemId: row.giftItemId,
    giftName: row.giftName,
    animationKind: catalog.get(row.giftItemId)?.animationKind ?? "unknown",
    quantity: row.quantity,
    totalCredits: row.totalCredits,
    matchId: row.matchId,
    matchTeamId: row.matchTeamId,
    createdAt: row.createdAt.toISOString(),
    ...(comboCount !== undefined ? { comboCount } : {}),
  };
}

/**
 * Parity P70-1 — the COMBO DERIVATION LAW: the streak for one send is the
 * COUNT of that sender's same-item GiftEvent rows inside the frozen
 * GIFT_COMBO_WINDOW_MS, anchored at the send's OWN createdAt (so an
 * idempotent replay re-derives the SAME number the original answered —
 * the window never "grows" after the fact). Read-time derivation over
 * durable rows only: no new table, no stored counter, never client-claimed,
 * never a money fact (each row in the streak is an independent, accepted,
 * idempotent send — the combo is an OBSERVATION over them).
 */
async function deriveComboCount(
  sessionId: string,
  senderId: string,
  giftItemId: string,
  anchorAt: Date,
): Promise<number> {
  const agg = await db.giftEvent.count({
    where: {
      sessionId,
      senderId,
      giftItemId,
      createdAt: { gt: new Date(anchorAt.getTime() - GIFT_COMBO_WINDOW_MS), lte: anchorAt },
    },
  });
  return agg;
}

/**
 * The catalogue read law: self-seeds the frozen v1 rows when missing
 * (idempotent upsert — no migration dependency, safe under concurrency via
 * the id primary key), then answers the ACTIVE items sorted by sortOrder.
 * Every catalogue consumer (route, send validation, feed mapping) goes
 * through THIS function so the seed happens on first touch, wherever that
 * is.
 */
export async function giftCatalog(): Promise<GiftCatalogItemDto[]> {
  const ids = FROZEN_CATALOG.map((c) => c.id);
  const existing = await db.giftCatalogItem.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const have = new Set(existing.map((e) => e.id));
  const missing = FROZEN_CATALOG.filter((c) => !have.has(c.id));
  if (missing.length > 0) {
    try {
      await db.giftCatalogItem.createMany({
        data: missing.map((c) => ({
          id: c.id,
          name: c.name,
          animationKind: c.animationKind,
          priceCredits: c.priceCredits,
          active: true,
          sortOrder: FROZEN_CATALOG.findIndex((f) => f.id === c.id) + 1,
        })),
      });
    } catch (err) {
      // Another process won the seed race — the rows exist either way.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
    }
  }
  const rows = await db.giftCatalogItem.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    animationKind: r.animationKind as GiftCatalogItemDto["animationKind"],
    priceCredits: r.priceCredits,
  }));
}

/**
 * The committed duplicate: the GiftEvent of an existing
 * (sessionId, senderId, clientRequestId) intent, or null. A replay must
 * return the ORIGINAL event — no new rows, no second publish.
 */
async function committedEventFor(
  sessionId: string,
  senderId: string,
  clientRequestId: string,
  catalog: CatalogMap,
): Promise<GiftEventDto | null> {
  const intent = await db.giftIntent.findUnique({
    where: { sessionId_senderId_clientRequestId: { sessionId, senderId, clientRequestId } },
  });
  if (!intent) return null;
  const event = await db.giftEvent.findUnique({ where: { intentId: intent.id } });
  if (!event) return null; // v1 always commits intent+event together
  const handles = await resolveHandles([event.senderId]);
  // The replay re-derives the combo anchored at the ORIGINAL event's
  // createdAt — the same streak the first answer carried.
  const comboCount = await deriveComboCount(
    event.sessionId,
    event.senderId,
    event.giftItemId,
    event.createdAt,
  );
  return mapGiftEvent(event, handles, catalog, comboCount);
}

/**
 * Send a gift. Gates in the frozen order (see the file header). The answer
 * is `{ gift, duplicate? }` — `duplicate: true` on a clientRequestId replay
 * — plus `match: { teamId, score }` when an ACTIVE match with gift scoring
 * accepted the send against the caller-chosen team.
 */
export async function sendGift(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: SendGiftInput,
): Promise<{ gift: GiftEventDto; duplicate?: boolean; match?: { teamId: string; score: number } }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (room.giftsEnabled === false) {
    throw new LiveDomainError("forbidden", "gifts-disabled");
  }

  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  // SANCTION LAW (deliberate): sanctions.mutedUntil is NOT checked here — a
  // mute is a chat sanction and does not block gifts (the documented
  // asymmetry: mute silences speech, not participation). Only a ban does.
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");

  if (!(await opsRateLimit(
        "gifts",
        `wf:live:gifts:${roomId}:${actor.id}`,
        RATE_LIMITS.gifts,
      ))) {
    throw new LiveDomainError("rate-limited");
  }

  // ── Validation (after the gates — the honest error contract) ──
  const clientRequestId =
    typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";
  if (clientRequestId.length < 8 || clientRequestId.length > 64) {
    throw new LiveDomainError("invalid", "clientRequestId must be 8..64 chars");
  }
  // Quantity: a finite number is required; below 1 is a client bug and is
  // REJECTED (a clamped-to-1 send would silently charge credits nobody
  // asked for); above GIFT_QTY_MAX is an overreach the server CLAMPS —
  // it never trusts the client (the reaction-batch clamp law, applied to
  // the credit-bearing side of the range).
  if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity)) {
    throw new LiveDomainError("invalid", "quantity must be a finite number");
  }
  const requestedQty = Math.trunc(input.quantity);
  if (requestedQty < 1) {
    throw new LiveDomainError("invalid", "quantity must be at least 1");
  }
  const quantity = Math.min(requestedQty, GIFT_QTY_MAX);

  const catalog = await giftCatalog();
  const catalogMap = catalogByIds(catalog);
  const item = catalog.find((c) => c.id === input.giftItemId);
  if (!item) throw new LiveDomainError("not-found", "invalid-gift");

  // Duplicate replay BEFORE the spend window: an idempotent retry is a
  // success story, never an error — and it must not re-enter the cap math.
  const replay = await committedEventFor(session.id, actor.id, clientRequestId, catalogMap);
  if (replay) return { gift: replay, duplicate: true };

  // ── The spend window (the frozen abuse bound) ──
  // Server-computed SUM over THIS SENDER'S accepted intents GLOBALLY (any
  // room — the safer freeze) within the rolling window, plus the
  // server-computed total of THIS send (quantity × catalogue price — never
  // a client-supplied amount).
  const totalCredits = quantity * item.priceCredits;
  const windowSpend = await db.giftIntent.aggregate({
    where: {
      senderId: actor.id,
      status: "accepted",
      createdAt: { gt: new Date(Date.now() - GIFT_SPEND_WINDOW_MS) },
    },
    _sum: { totalCredits: true },
  });
  if ((windowSpend._sum.totalCredits ?? 0) + totalCredits > GIFT_SPEND_WINDOW_MAX) {
    throw new LiveDomainError("forbidden", "spend-cap");
  }

  // ── Durable commit: GiftIntent then GiftEvent, BEFORE any fan-out ──
  let intentId: string;
  try {
    const intent = await db.giftIntent.create({
      data: {
        roomId,
        sessionId: session.id,
        senderId: actor.id,
        giftItemId: item.id,
        quantity,
        clientRequestId,
        status: "accepted",
        totalCredits,
      },
    });
    intentId = intent.id;
  } catch (err) {
    // Concurrency net for the same clientRequestId (two in-flight sends):
    // the unique (sessionId, senderId, clientRequestId) made one of them
    // the committed original — replay it, never a second row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const replayed = await committedEventFor(session.id, actor.id, clientRequestId, catalogMap);
      if (replayed) return { gift: replayed, duplicate: true };
    }
    throw err;
  }

  let event: GiftEventRow = await db.giftEvent.create({
    data: {
      intentId,
      roomId,
      sessionId: session.id,
      senderId: actor.id,
      recipientId: room.hostId,
      giftItemId: item.id,
      giftName: item.name,
      quantity,
      totalCredits,
    },
  });

  // ── Phase 5 club award (ADR-0010 §3) ──
  // The durable GiftEvent commit in the host's room earns club points =
  // the raw gift credits (awardClubPoints re-clamps server-side). The
  // frozen idempotency key (gift:{giftEventId}) makes duplicate delivery
  // impossible to double-award; a failure is best-effort and NEVER fails
  // the gift it rides on. Dynamic import keeps the gifts→clubs edge
  // acyclic (the Phase 3 pattern).
  try {
    const { awardClubPoints } = await import("./clubs");
    await awardClubPoints(room.hostId, actor.id, {
      source: "gift",
      sourceEventId: event.id,
      amount: totalCredits,
    });
  } catch (err) {
    console.error("live club gift award failed", err);
  }

  // ── Match scoring (lane 3-b boundary) ──
  // A provided matchTeamId scores ONLY when an ACTIVE match exists on this
  // session; ingestScore owns the rest of the law (giftsScore policy, team
  // existence, wall clock, idempotency). Not accepted ⇒ the gift stands
  // without a match block. The narrowing is deliberate: the ingest answer
  // is validated at runtime at this cross-lane boundary.
  let match: { teamId: string; score: number } | undefined;
  const teamRaw: unknown = input.matchTeamId;
  if (typeof teamRaw === "string" && teamRaw.trim().length > 0) {
    const teamId = teamRaw.trim();
    const activeMatch = await db.liveMatch.findFirst({
      where: { sessionId: session.id, status: "active" },
    });
    if (activeMatch) {
      const answer: unknown = await ingestScore(activeMatch.id, {
        source: "gift",
        actorId: actor.id,
        teamId,
        amount: totalCredits,
        clientEventId: intentId,
        linkId: event.id,
      });
      // IngestScoreResult (lane 3-b, frozen): { accepted, teamId?, teamScore? }
      // — teamScore is the team's server-computed standing AFTER this ingest.
      const scored = answer as {
        accepted?: unknown;
        teamId?: unknown;
        teamScore?: unknown;
      } | null | undefined;
      if (scored?.accepted === true && typeof scored.teamScore === "number") {
        const scoredTeamId = typeof scored.teamId === "string" ? scored.teamId : teamId;
        event = await db.giftEvent.update({
          where: { id: event.id },
          data: { matchId: activeMatch.id, matchTeamId: scoredTeamId },
        });
        match = { teamId: scoredTeamId, score: scored.teamScore };
      }
    }
  }

  const handles = await resolveHandles([event.senderId]);
  // Parity P70-1: the combo streak derives AFTER the durable commit (the
  // accepted row counts itself inside its own window).
  const comboCount = await deriveComboCount(
    event.sessionId,
    event.senderId,
    event.giftItemId,
    event.createdAt,
  );
  const gift = mapGiftEvent(event, handles, catalogMap, comboCount);
  // Publish law: instant same-instance fan-out AFTER the durable commit
  // (skipped entirely on duplicate replays — the original already fanned).
  publishLiveEvent(roomId, {
    kind: "gift",
    eventId: crypto.randomUUID(),
    at: gift.createdAt,
    gift,
  });
  // Parity P70-3 hook: the accepted send may cross the room's open
  // giftCredits goal — awaited inside the try (deterministic by return
  // time) but best-effort by law: a failure NEVER fails the gift; the
  // dynamic import keeps the gifts→goals edge acyclic.
  try {
    const { onRoomActivity } = await import("./goals");
    await onRoomActivity(roomId, "giftCredits");
  } catch (err) {
    console.error("live goal gift activity failed", err);
  }
  return match ? { gift, match } : { gift };
}

/**
 * The room's gift feed — the durable room history (roomId-scoped, so it
 * survives across sessions). Newest first; `limit` clamped 1..GIFT_FEED_MAX
 * (default 20). Sender handles resolve at read time; animationKind maps
 * from the catalogue. Readable anonymously for public rooms (unlisted rooms
 * are reachable by direct link — the chat-replay law). `sessionUser` is
 * part of the frozen signature (the private-feed gate arrives with the
 * private-room work; today the read is link-open).
 */
export async function giftFeed(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
  limit?: number,
): Promise<GiftEventDto[]> {
  void sessionUser;
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new LiveDomainError("not-found");
  const take = Math.min(Math.max(Math.trunc(limit ?? 20), 1), GIFT_FEED_MAX);
  const [rows, catalog] = await Promise.all([
    db.giftEvent.findMany({
      where: { roomId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    giftCatalog(),
  ]);
  // Parity P70-1: the feed renders the streak too. ONE bounded candidate
  // fetch (rows within one window of the OLDEST fetched row) covers every
  // row's window — the in-memory derivation is O(candidates²) on ≤ ~2×take
  // rows, trivial at the feed cap.
  const oldest = rows[rows.length - 1]?.createdAt;
  const candidates = oldest
    ? await db.giftEvent.findMany({
        where: {
          roomId,
          createdAt: { gte: new Date(oldest.getTime() - GIFT_COMBO_WINDOW_MS) },
        },
        select: { senderId: true, giftItemId: true, createdAt: true },
      })
    : [];
  const comboForRow = (row: GiftEventRow): number =>
    candidates.filter(
      (c) =>
        c.senderId === row.senderId &&
        c.giftItemId === row.giftItemId &&
        c.createdAt.getTime() > row.createdAt.getTime() - GIFT_COMBO_WINDOW_MS &&
        c.createdAt.getTime() <= row.createdAt.getTime(),
    ).length;
  const handles = await resolveHandles(rows.map((r) => r.senderId));
  const catalogMap = catalogByIds(catalog);
  return rows.map((r) => mapGiftEvent(r, handles, catalogMap, comboForRow(r)));
}

/**
 * Parity P70-2 — the TOP-SUPPORTERS WALL. Server SUM(totalCredits)
 * GROUP BY senderId over the room's GiftEvent rows (the room's durable
 * history — survives across sessions), top GIFT_WALL_MAX, ties broken by
 * the most-recent send. Display names resolve at read time (the no-FK
 * law). DEV credits — zero cash value (the ADR-0007 sandbox law extends
 * verbatim; the wall carries no money semantics).
 */
export async function topGiftersFor(roomId: string): Promise<LiveTopGifterDto[]> {
  const grouped = await db.giftEvent.groupBy({
    by: ["senderId"],
    where: { roomId },
    _sum: { totalCredits: true },
    _max: { createdAt: true },
    orderBy: { _sum: { totalCredits: "desc" } },
    take: GIFT_WALL_MAX * 4, // over-fetch so the tie-break sort is honest
  });
  const ranked = [...grouped]
    .sort(
      (a, b) =>
        (b._sum.totalCredits ?? 0) - (a._sum.totalCredits ?? 0) ||
        (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0),
    )
    .slice(0, GIFT_WALL_MAX);
  if (ranked.length === 0) return [];
  const handles = await resolveHandles(ranked.map((r) => r.senderId));
  return ranked.map((r) => ({
    userId: r.senderId,
    handle: handles.get(r.senderId)?.handle ?? "unknown",
    displayName: handles.get(r.senderId)?.name ?? "Unknown",
    totalCredits: r._sum.totalCredits ?? 0,
  }));
}
