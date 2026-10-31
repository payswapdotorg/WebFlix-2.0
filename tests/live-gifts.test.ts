/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 lane 3-c — the gift sandbox pins.
 *
 * Pins: the self-seeding frozen v1 catalogue (idempotent, sorted, prices
 * within 1..GIFT_PRICE_MAX), the full gate matrix (anon 401 / not-found /
 * not-live / gifts-disabled / banned — and the documented asymmetry that a
 * timed MUTE never blocks gifts), validation (invalid-gift 404, quantity
 * laws), the rolling per-sender spend window (GLOBALLY by sender — the
 * frozen abuse bound), the clientRequestId duplicate replay (one intent,
 * one event, ONE publish — idempotent success, never an error), match
 * scoring through `matches.ingestScore` (score the chosen team, dedupe
 * end-to-end, no-match ⇒ matchTeamId ignored), the room feed (newest
 * first, limit, anonymous OK, resolved handles) and the 429 budget.
 *
 * IDENTITY PLAN: the spend window is GLOBAL per sender over a rolling
 * 60s window, so every heavy-spending group uses a DISTINCT identity and
 * the spend-cap group mints a FRESH spender per run (a rerun inside the
 * window must not inherit the previous run's spend). Rate-limit buckets
 * are per room; every group runs in its own freshly created room.
 *
 * Run: DATABASE_URL=file:../db/live-gifts-test.db bun test --isolate tests/live-gifts.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  createRoomFixture,
  hostCookie,
  modCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
  VIEWER_CLAIMS,
} from "./live-helpers";
import { mintSessionCookie } from "./helpers";
import { GET as getCatalogRoute } from "@/app/api/live/gifts/route";
import {
  GET as getFeedRoute,
  POST as postGifts,
} from "@/app/api/live-rooms/[id]/gifts/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import {
  GIFT_PRICE_MAX,
  GIFT_QTY_MAX,
  GIFT_SPEND_WINDOW_MAX,
  GIFT_SPEND_WINDOW_MS,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import { subscribeLiveRoom } from "@/lib/live/hub";
import type {
  GiftCatalogItemDto,
  GiftEventDto,
  LiveStreamEvent,
} from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let MOD = "";
let OTHER = "";
let hostShadowId = "";
let viewerShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  MOD = await modCookie();
  OTHER = await otherCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
});

function giftsUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/gifts`;
}

async function sendAs(
  cookie: string,
  roomId: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await postGifts(
    reqWithCookie(giftsUrl(roomId), cookie, { method: "POST", body }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function feedAs(
  roomId: string,
  cookie?: string,
  limit?: number,
): Promise<{ status: number; body: any }> {
  const url = new URL(giftsUrl(roomId));
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
  const res = await getFeedRoute(
    reqWithCookie(url.toString(), cookie ?? "next-auth.session-token=none"),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function getCatalog(): Promise<{ status: number; body: any }> {
  const res = await getCatalogRoute();
  return { status: res.status, body: await res.json() };
}

async function liveRoom(
  policy: { giftsEnabled?: boolean } = {},
): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `3c-gift-${crypto.randomUUID().slice(0, 8)}`,
  );
  if (Object.keys(policy).length > 0) {
    await db.liveRoom.update({ where: { id: roomId }, data: policy });
  }
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

const FROZEN_IDS = [
  "wave-hello",
  "spark-cheer",
  "burst-applause",
  "float-lantern",
  "sparkle-storm",
  "burst-fireworks",
];
const FROZEN_PRICES = [1, 5, 10, 25, 50, 100];
const FROZEN_ANIMATIONS: GiftCatalogItemDto["animationKind"][] = [
  "wave",
  "sparkle",
  "burst",
  "float",
  "sparkle",
  "burst",
];

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — catalogue (self-seed)", () => {
  test("first call seeds the frozen v1 catalogue; sorted; prices within 1..GIFT_PRICE_MAX", async () => {
    const res = await getCatalog();
    expect(res.status).toBe(200);
    const gifts = res.body.gifts as GiftCatalogItemDto[];
    expect(gifts.map((g) => g.id)).toEqual(FROZEN_IDS);
    expect(gifts.map((g) => g.name)).toEqual([
      "Wave Hello",
      "Spark Cheer",
      "Burst Applause",
      "Floating Lantern",
      "Sparkle Storm",
      "Fireworks Burst",
    ]);
    expect(gifts.map((g) => g.animationKind)).toEqual(FROZEN_ANIMATIONS);
    expect(gifts.map((g) => g.priceCredits)).toEqual(FROZEN_PRICES);
    for (const g of gifts) {
      expect(g.priceCredits).toBeGreaterThanOrEqual(1);
      expect(g.priceCredits).toBeLessThanOrEqual(GIFT_PRICE_MAX);
    }
  });

  test("idempotent: a second call seeds no duplicates (exactly 6 active rows)", async () => {
    const first = await getCatalog();
    const second = await getCatalog();
    expect(second.status).toBe(200);
    expect((second.body.gifts as GiftCatalogItemDto[]).map((g) => g.id)).toEqual(
      (first.body.gifts as GiftCatalogItemDto[]).map((g) => g.id),
    );
    const rows = await db.giftCatalogItem.findMany();
    expect(rows.length).toBe(FROZEN_IDS.length);
    expect(rows.every((r) => r.active)).toBe(true);
    const sortOrders = rows.map((r) => r.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  test("anonymous GET /api/live/gifts is 200 — the catalogue is public", async () => {
    const res = await getCatalog();
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — gates", () => {
  test("anonymous POST is 401; unknown room is 404; no live session is 403 not-live", async () => {
    const { roomId } = await liveRoom();

    const anon = await sendAs("next-auth.session-token=none", roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "anon-gift-1",
    });
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const ghost = await sendAs(VIEWER, "room-does-not-exist", {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "ghost-gift1",
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");

    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `3c-gift-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const notLive = await sendAs(VIEWER, idle.roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "idlegift01",
    });
    expect(notLive.status).toBe(403);
    expect(notLive.body.error).toBe("forbidden");
    expect(notLive.body.message).toBe("not-live");
  });

  test("gifts disabled is 403 gifts-disabled (room policy column flipped directly)", async () => {
    const { roomId } = await liveRoom({ giftsEnabled: false });
    const { status, body } = await sendAs(VIEWER, roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "disabledg1",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.message).toBe("gifts-disabled");
  });

  test("banned is 403 banned — but a timed mute does NOT block gifts (the documented asymmetry)", async () => {
    const banned = await liveRoom();
    await db.liveModerationAction.create({
      data: {
        roomId: banned.roomId,
        actorId: hostShadowId,
        targetId: viewerShadowId,
        action: "ban",
      },
    });
    const bannedTry = await sendAs(VIEWER, banned.roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "bannedg001",
    });
    expect(bannedTry.status).toBe(403);
    expect(bannedTry.body.error).toBe("forbidden");
    expect(bannedTry.body.message).toBe("banned");

    const muted = await liveRoom();
    await db.liveModerationAction.create({
      data: {
        roomId: muted.roomId,
        sessionId: muted.sessionId,
        actorId: hostShadowId,
        targetId: viewerShadowId,
        action: "mute",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const mutedSend = await sendAs(VIEWER, muted.roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "mutedgift1",
    });
    // THE LAW: a mute is a CHAT sanction — it silences speech, not gifting.
    expect(mutedSend.status).toBe(200);
    expect(mutedSend.body.gift.totalCredits).toBe(1);
    expect(mutedSend.body.gift.recipientId).toBe(hostShadowId); // recipient is the host by law
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — validation", () => {
  test("unknown/unknown-active giftItemId is 404 invalid-gift", async () => {
    const { roomId } = await liveRoom();
    const bad = await sendAs(OTHER, roomId, {
      giftItemId: "rocket-tesla",
      quantity: 1,
      clientRequestId: "baditemid1",
    });
    expect(bad.status).toBe(404);
    expect(bad.body.error).toBe("not-found");
    expect(bad.body.message).toBe("invalid-gift");
  });

  test("quantity 0 (and negative / non-numeric) is 400 invalid", async () => {
    const { roomId } = await liveRoom();
    // PIN (documented reading): BELOW 1 is a client bug and is REJECTED — a
    // silent clamp-to-1 would charge credits nobody asked for. The frozen
    // text reserves `invalid` for non-finite input and clamps the range
    // 1..GIFT_QTY_MAX; the credit-bearing lower edge stays honest instead.
    const zero = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: 0,
      clientRequestId: "zerogift01",
    });
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe("invalid");

    const negative = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: -3,
      clientRequestId: "neggift001",
    });
    expect(negative.status).toBe(400);

    const stringQty = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: "five",
      clientRequestId: "strgift001",
    });
    expect(stringQty.status).toBe(400);
    expect(stringQty.body.error).toBe("invalid");
  });

  test("quantity 99 is CLAMPED to GIFT_QTY_MAX — the server never trusts the client", async () => {
    const { roomId, sessionId } = await liveRoom();
    const big = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: 99,
      clientRequestId: "clampbig01",
    });
    expect(big.status).toBe(200);
    expect(big.body.gift.quantity).toBe(GIFT_QTY_MAX);
    expect(big.body.gift.totalCredits).toBe(GIFT_QTY_MAX); // 10 × 1 credit
    const rows = await db.giftIntent.findMany({
      where: { sessionId, clientRequestId: "clampbig01" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(GIFT_QTY_MAX);
  });

  test("clientRequestId must be 8..64 chars", async () => {
    const { roomId } = await liveRoom();
    const short = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "short",
    });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe("invalid");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — the spend window (the frozen abuse bound)", () => {
  test("500 in-window credits pass; the next credit is 403 spend-cap; the rejected send writes nothing", async () => {
    // WINDOW MATH (pinned): the window is a rolling GIFT_SPEND_WINDOW_MS
    // (60s); the cap is the SUM of totalCredits over the sender's ACCEPTED
    // GiftIntent rows GLOBALLY (any room) within it — plus the server-
    // computed total of THIS send — and must stay ≤ GIFT_SPEND_WINDOW_MAX
    // (500). The spender below is FRESH PER RUN (unique sub) so a rerun
    // inside the window never inherits the previous run's spend.
    const spenderClaims = {
      sub: `u_wfx2_gift_spender_${crypto.randomUUID().slice(0, 8)}`,
      name: "Gift Spender",
      email: "gift-spender@webflix.test",
    };
    const spender = await mintSessionCookie(spenderClaims);
    const { roomId } = await liveRoom();

    const burst = await sendAs(spender, roomId, {
      giftItemId: "burst-fireworks",
      quantity: 5,
      clientRequestId: "capburst01",
    });
    expect(burst.status).toBe(200);
    expect(burst.body.gift.quantity).toBe(5);
    expect(burst.body.gift.totalCredits).toBe(500); // exactly GIFT_SPEND_WINDOW_MAX: 0 + 500 ≤ 500

    const over = await sendAs(spender, roomId, {
      giftItemId: "float-lantern",
      quantity: 1,
      clientRequestId: "capover001",
    });
    expect(over.status).toBe(403);
    expect(over.body.error).toBe("forbidden");
    expect(over.body.message).toBe("spend-cap"); // 500 + 25 > 500

    // The rejected send wrote NOTHING — no intent, no event.
    const spenderShadowId = (await ensureShadowUser(sessionUserOf(spenderClaims))).id;
    expect(
      await db.giftIntent.count({
        where: { senderId: spenderShadowId, clientRequestId: "capover001" },
      }),
    ).toBe(0);
    expect(await db.giftEvent.count({ where: { senderId: spenderShadowId } })).toBe(1);
    expect(GIFT_SPEND_WINDOW_MS).toBe(60_000);
    expect(GIFT_SPEND_WINDOW_MAX).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — duplicate clientRequestId replay", () => {
  test("replay answers the ORIGINAL with duplicate: true — one intent, one event, ONE publish", async () => {
    const { roomId, sessionId } = await liveRoom();
    const seen: LiveStreamEvent[] = [];
    const unsub = subscribeLiveRoom(roomId, (e) => seen.push(e));
    try {
      const first = await sendAs(MOD, roomId, {
        giftItemId: "wave-hello",
        quantity: 2,
        clientRequestId: "dupereq001",
      });
      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBeUndefined();
      const giftId = first.body.gift.id as string;
      const intentId = first.body.gift.intentId as string;

      // Same clientRequestId, DIFFERENT payload — the replay must return
      // the committed original, not apply the new numbers.
      const retry = await sendAs(MOD, roomId, {
        giftItemId: "spark-cheer",
        quantity: 9,
        clientRequestId: "dupereq001",
      });
      expect(retry.status).toBe(200);
      expect(retry.body.duplicate).toBe(true);
      expect(retry.body.gift.id).toBe(giftId);
      expect(retry.body.gift.quantity).toBe(2);
      expect(retry.body.gift.totalCredits).toBe(2);

      expect(
        await db.giftIntent.count({ where: { sessionId, clientRequestId: "dupereq001" } }),
      ).toBe(1);
      expect(await db.giftEvent.count({ where: { intentId } })).toBe(1);
      // No second publish on the replay (the original already fanned out).
      expect(seen.filter((e) => e.kind === "gift")).toHaveLength(1);
      expect((seen[0] as Extract<LiveStreamEvent, { kind: "gift" }>).gift.id).toBe(giftId);
    } finally {
      unsub();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — match scoring via matches.ingestScore", () => {
  test("active match: the gift scores the chosen team; the event carries the match ids; replay never double-scores", async () => {
    const { roomId, sessionId } = await liveRoom();
    const match = await db.liveMatch.create({
      data: {
        roomId,
        sessionId,
        createdById: hostShadowId,
        kind: "team",
        status: "active",
        durationSeconds: 300,
        reactionsScore: true,
        giftsScore: true,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 300_000),
      },
    });
    const teamA = await db.liveMatchTeam.create({
      data: { matchId: match.id, label: "A", position: 0 },
    });
    const teamB = await db.liveMatchTeam.create({
      data: { matchId: match.id, label: "B", position: 1 },
    });

    const send = await sendAs(OTHER, roomId, {
      giftItemId: "burst-fireworks",
      quantity: 1,
      clientRequestId: "matchgift1",
      matchTeamId: teamA.id,
    });
    expect(send.status).toBe(200);
    expect(send.body.match).toBeDefined();
    expect(send.body.match.teamId).toBe(teamA.id);
    // Fresh match: the team's standing after this ingestion IS the credits
    // just scored (100). The answer's `score` is ingestScore's own answer
    // passed through — the ledger below pins the authoritative math.
    expect(send.body.match.score).toBe(100);
    expect(send.body.gift.matchId).toBe(match.id);
    expect(send.body.gift.matchTeamId).toBe(teamA.id);

    const intentId = send.body.gift.intentId as string;
    const scoreRows = await db.liveScoreEvent.findMany({ where: { matchId: match.id } });
    expect(scoreRows).toHaveLength(1);
    expect(scoreRows[0]?.clientEventId).toBe(intentId); // idempotency key = the gift intent id
    expect(scoreRows[0]?.teamId).toBe(teamA.id);
    expect(scoreRows[0]?.actorId).toBe(
      (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id,
    );
    expect(scoreRows[0]?.source).toBe("gift");
    expect(scoreRows[0]?.amount).toBe(100);
    expect(scoreRows[0]?.linkId).toBe(send.body.gift.id);

    // Duplicate replay end-to-end: no second ScoreEvent, standing unchanged.
    const retry = await sendAs(OTHER, roomId, {
      giftItemId: "burst-fireworks",
      quantity: 1,
      clientRequestId: "matchgift1",
      matchTeamId: teamA.id,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.gift.matchId).toBe(match.id); // the committed row keeps its match links
    expect(await db.liveScoreEvent.count({ where: { matchId: match.id } })).toBe(1);
    const standingA = await db.liveScoreEvent.aggregate({
      where: { matchId: match.id, teamId: teamA.id },
      _sum: { amount: true },
    });
    expect(standingA._sum.amount ?? 0).toBe(100);

    // A SECOND FRESH gift to team B: the append-only ledger grows; per-team
    // SUMs stay server-computed and independent.
    const second = await sendAs(OTHER, roomId, {
      giftItemId: "float-lantern",
      quantity: 1,
      clientRequestId: "matchgift2",
      matchTeamId: teamB.id,
    });
    expect(second.status).toBe(200);
    expect(second.body.match?.teamId).toBe(teamB.id);
    const rowsB = await db.liveScoreEvent.findMany({
      where: { matchId: match.id, teamId: teamB.id },
    });
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.amount).toBe(25);
    expect(await db.liveScoreEvent.count({ where: { matchId: match.id } })).toBe(2);
  });

  test("no active match: a provided matchTeamId is IGNORED — the gift still commits, no match block", async () => {
    const { roomId } = await liveRoom();
    const send = await sendAs(OTHER, roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "nomatchg1",
      matchTeamId: "team-ghost",
    });
    expect(send.status).toBe(200);
    expect(send.body.match).toBeUndefined();
    expect(send.body.gift.matchId).toBeNull();
    expect(send.body.gift.matchTeamId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — the room feed", () => {
  test("newest first, respects the limit clamp, anonymous OK, handles + animationKind resolved", async () => {
    const { roomId } = await liveRoom();
    const a = await sendAs(MOD, roomId, {
      giftItemId: "wave-hello",
      quantity: 1,
      clientRequestId: "feedgift01",
    });
    await new Promise((r) => setTimeout(r, 5)); // distinct createdAt — stable newest-first pin
    const b = await sendAs(MOD, roomId, {
      giftItemId: "float-lantern",
      quantity: 1,
      clientRequestId: "feedgift02",
    });
    await new Promise((r) => setTimeout(r, 5));
    const c = await sendAs(MOD, roomId, {
      giftItemId: "spark-cheer",
      quantity: 3,
      clientRequestId: "feedgift03",
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);

    // Anonymous read (no cookie) — the room history is link-open like chat.
    const anon = await feedAs(roomId);
    expect(anon.status).toBe(200);
    const gifts = anon.body.gifts as GiftEventDto[];
    expect(gifts).toHaveLength(3);
    expect(gifts[0]?.id).toBe(c.body.gift.id);
    expect(gifts[1]?.id).toBe(b.body.gift.id);
    expect(gifts[2]?.id).toBe(a.body.gift.id);
    expect(gifts[0]?.senderHandle).not.toBe("unknown");
    expect(gifts[0]?.senderName).toBe("Live Mod");
    expect(gifts[0]?.animationKind).toBe("sparkle");
    expect(gifts[1]?.animationKind).toBe("float");

    const page = await feedAs(roomId, MOD, 2);
    expect(page.status).toBe(200);
    expect(page.body.gifts as GiftEventDto[]).toHaveLength(2);
    expect((page.body.gifts as GiftEventDto[])[0]?.id).toBe(c.body.gift.id);

    const ghost = await feedAs("room-does-not-exist");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live gifts — rate limit (429)", () => {
  test("fire > RATE_LIMITS.gifts with distinct ids → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.gifts.limit;
    for (let i = 0; i < limit + 2; i++) {
      const { status } = await sendAs(OTHER, roomId, {
        giftItemId: "wave-hello",
        quantity: 1,
        clientRequestId: `burst-gift-${crypto.randomUUID().slice(0, 8)}-${i}`,
      });
      if (i < limit) expect(status).toBe(200);
      else expect(status).toBe(429);
    }
  });
});
