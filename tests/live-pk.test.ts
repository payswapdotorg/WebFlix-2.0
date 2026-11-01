/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Parity P72 — the cross-room PK battle pins (ADR-0012).
 *
 * Pins: the host-only gate (anon 401 / viewer 403 / host 200), the
 * one-open-per-room law (409 challenge-open), the duration clamp
 * (PK_DURATION_MIN/MAX/DEFAULT), the MATCHMAKING law (the OLDEST other-host
 * open challenge pairs → both active with a shared window, mySide a/b),
 * the DERIVED side score (reaction counts + gift credits since startsAt —
 * pre-battle rows never count), the LAZY FINALIZE (past endsAt → final
 * snapshots + winner + MVP + envelopes to BOTH rooms, idempotent), the
 * CANCEL law (no winner, no snapshots — banked nothing), and the
 * pkManage 429 budget.
 *
 * Run: DATABASE_URL=file:../db/live-pk-test.db bun test --isolate tests/live-pk.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  hostCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import {
  PK_DURATION_DEFAULT,
  PK_DURATION_MAX,
  PK_DURATION_MIN,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import { subscribeLiveRoom } from "@/lib/live/hub";
import { sendReactionBatch } from "@/lib/live/reactions";
import { sendGift } from "@/lib/live/gifts";
import type { LiveStreamEvent } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let OTHERHOST = "";
let VIEWER = "";
let hostShadowId = "";
let otherHostShadowId = "";
let viewerShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  OTHERHOST = await otherCookie();
  VIEWER = await viewerCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  otherHostShadowId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
});

function pkUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/pk`;
}

async function openAs(
  cookie: string,
  roomId: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> {
  const { POST } = await import("@/app/api/live-rooms/[id]/pk/route");
  const res = await POST(reqWithCookie(pkUrl(roomId), cookie, { method: "POST", body }), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

async function cancelAs(
  cookie: string,
  roomId: string,
): Promise<{ status: number; body: any }> {
  const { DELETE } = await import("@/app/api/live-rooms/[id]/pk/route");
  const res = await DELETE(reqWithCookie(pkUrl(roomId), cookie, { method: "DELETE" }), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

async function getBattle(roomId: string): Promise<{ status: number; body: any }> {
  const { GET } = await import("@/app/api/live-rooms/[id]/pk/route");
  const res = await GET(
    reqWithCookie(pkUrl(roomId), "next-auth.session-token=none"),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function liveRoomFor(claims: Record<string, unknown>, cookie: string) {
  void cookie;
  const { roomId } = await createRoomFixture(
    sessionUserOf(claims),
    `p72-pk-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

function recordEnvelopes(roomId: string): { events: LiveStreamEvent[]; stop: () => void } {
  const events: LiveStreamEvent[] = [];
  const stop = subscribeLiveRoom(roomId, (event) => events.push(event));
  return { events, stop };
}

// ─────────────────────────────────────────────────────────────────────
describe("live pk — the gates + the open law", () => {
  test("constants pin: 60..600s, default 120; the limiter budget pins", () => {
    expect(PK_DURATION_MIN).toBe(60);
    expect(PK_DURATION_MAX).toBe(600);
    expect(PK_DURATION_DEFAULT).toBe(120);
    expect(RATE_LIMITS.pkManage).toEqual({ limit: 6, windowMs: 60_000 });
  });

  test("anon 401 · viewer 403 · host 200 (status open, mySide null, no sideB yet)", async () => {
    const { roomId } = await liveRoomFor(HOST_CLAIMS, HOST);
    const anon = await openAs("next-auth.session-token=none", roomId, {});
    expect(anon.status).toBe(401);
    const viewer = await openAs(VIEWER, roomId, {});
    expect(viewer.status).toBe(403);
    const host = await openAs(HOST, roomId, {});
    expect(host.status).toBe(200);
    expect(host.body.battle.status).toBe("open");
    expect(host.body.battle.mySide).toBeNull();
    expect(host.body.battle.sideB).toBeNull();
    expect(host.body.battle.durationSeconds).toBe(PK_DURATION_DEFAULT);
    // One open per room: a second open is 409 challenge-open.
    const second = await openAs(HOST, roomId, {});
    expect(second.status).toBe(409);
    expect(second.body.message).toBe("challenge-open");
    // Cancel clears the room (banked nothing).
    const cleared = await cancelAs(HOST, roomId);
    expect(cleared.status).toBe(200);
    expect(cleared.body.battle.status).toBe("cancelled");
    expect(cleared.body.battle.winnerSide).toBeNull();
    const rows = await db.livePkScoreSnapshot.findMany({
      where: { battleId: cleared.body.battle.id },
    });
    expect(rows).toHaveLength(0);
  });

  test("duration clamps: 5 → 60 · 5000 → 600 · unspecified → 120", async () => {
    const low = await openAs(HOST, (await liveRoomFor(HOST_CLAIMS, HOST)).roomId, {
      durationSeconds: 5,
    });
    expect(low.status).toBe(200);
    expect(low.body.battle.durationSeconds).toBe(PK_DURATION_MIN);
    await cancelAs(HOST, low.body.battle.sideA.roomId);
    const high = await openAs(HOST, (await liveRoomFor(HOST_CLAIMS, HOST)).roomId, {
      durationSeconds: 5000,
    });
    expect(high.status).toBe(200);
    expect(high.body.battle.durationSeconds).toBe(PK_DURATION_MAX);
    await cancelAs(HOST, high.body.battle.sideA.roomId);
  });

  test("unknown room 404", async () => {
    const res = await openAs(HOST, "room-does-not-exist", {});
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live pk — matchmaking + the derived side scores", () => {
  test("the OLDEST other-host open challenge pairs → both active, mySide a/b, shared window", async () => {
    const a = await liveRoomFor(HOST_CLAIMS, HOST);
    const b = await liveRoomFor(OTHER_CLAIMS, OTHERHOST);
    const openA = await openAs(HOST, a.roomId, { durationSeconds: 120 });
    expect(openA.body.battle.status).toBe("open");
    const { events: eventsA, stop: stopA } = recordEnvelopes(a.roomId);
    const { events: eventsB, stop: stopB } = recordEnvelopes(b.roomId);
    const openB = await openAs(OTHERHOST, b.roomId, { durationSeconds: 120 });
    expect(openB.status).toBe(200);
    expect(openB.body.battle.status).toBe("active");
    expect(openB.body.battle.mySide).toBe("b");
    expect(openB.body.battle.sideA.roomId).toBe(a.roomId);
    expect(openB.body.battle.sideB.roomId).toBe(b.roomId);
    // The paired window lands in the future on both reads.
    const readA = await getBattle(a.roomId);
    expect(readA.body.battle.status).toBe("active");
    expect(readA.body.battle.mySide).toBe("a");
    expect(new Date(readA.body.battle.endsAt).getTime()).toBeGreaterThan(Date.now());
    stopA();
    stopB();
    const pkA = eventsA.filter((e) => e.kind === "pk");
    const pkB = eventsB.filter((e) => e.kind === "pk");
    expect(pkA.length).toBeGreaterThanOrEqual(1);
    expect(pkB.length).toBeGreaterThanOrEqual(1);
    // Cancel from side A ends it for both (banked nothing).
    await cancelAs(HOST, a.roomId);
    const after = await getBattle(b.roomId);
    expect(after.body.battle.status).toBe("cancelled");
  });

  test("side scores DERIVE from durable rows since startsAt (reactions + gifts; pre-battle excluded)", async () => {
    const a = await liveRoomFor(HOST_CLAIMS, HOST);
    const b = await liveRoomFor(OTHER_CLAIMS, OTHERHOST);
    // Pre-battle activity in room A — must NEVER count.
    await sendReactionBatch(a.roomId, sessionUserOf(VIEWER_CLAIMS), {
      clientBatchId: "prebattle0001",
      count: 999,
    });
    const openA = await openAs(HOST, a.roomId, {});
    expect(openA.status).toBe(200);
    await openAs(OTHERHOST, b.roomId, {});
    // In-battle activity: 40 hearts + 10 gift credits in room A; 5 hearts in B.
    await sendReactionBatch(a.roomId, sessionUserOf(VIEWER_CLAIMS), {
      clientBatchId: "battle-a00001",
      count: 40,
    });
    await sendGift(a.roomId, sessionUserOf(VIEWER_CLAIMS), {
      giftItemId: "spark-cheer",
      quantity: 2,
      clientRequestId: "battle-agift1",
    });
    await sendReactionBatch(b.roomId, sessionUserOf(OTHER_CLAIMS), {
      clientBatchId: "battle-b00001",
      count: 5,
    });
    const readA = await getBattle(a.roomId);
    expect(readA.body.battle.sideA.score).toBe(50); // 40 hearts + 10 credits
    expect(readA.body.battle.sideB.score).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live pk — the lazy finalize + MVP", () => {
  test("past endsAt → final snapshots + winner + MVP (idempotent) + envelopes to BOTH rooms", async () => {
    const a = await liveRoomFor(HOST_CLAIMS, HOST);
    const b = await liveRoomFor(OTHER_CLAIMS, OTHERHOST);
    await openAs(HOST, a.roomId, {});
    const paired = await openAs(OTHERHOST, b.roomId, { durationSeconds: PK_DURATION_MIN });
    const battleId = paired.body.battle.id;
    // In-battle: room B outscores room A (viewer hearts + a gift).
    await sendReactionBatch(b.roomId, sessionUserOf(VIEWER_CLAIMS), {
      clientBatchId: "fin-b000001",
      count: 100,
    });
    await sendGift(b.roomId, sessionUserOf(VIEWER_CLAIMS), {
      giftItemId: "spark-cheer",
      quantity: 1,
      clientRequestId: "fin-bgift1",
    });
    await sendReactionBatch(a.roomId, sessionUserOf(VIEWER_CLAIMS), {
      clientBatchId: "fin-a000001",
      count: 10,
    });
    // Backdate the window so the read past endsAt finalizes (no real wait).
    await db.livePkBattle.update({
      where: { id: battleId },
      data: {
        startsAt: new Date(Date.now() - 10 * 60_000),
        endsAt: new Date(Date.now() - 5_000),
      },
    });
    const { events: eventsA, stop: stopA } = recordEnvelopes(a.roomId);
    const { events: eventsB, stop: stopB } = recordEnvelopes(b.roomId);
    const read = await getBattle(b.roomId);
    expect(read.body.battle.status).toBe("final");
    expect(read.body.battle.winnerSide).toBe("b");
    expect(read.body.battle.sideB.score).toBe(65); // 100 taps clamp to the 60-batch law + 5 credits
    expect(read.body.battle.sideA.score).toBe(10);
    expect(read.body.battle.mvp?.userId).toBe(viewerShadowId);
    expect(read.body.battle.mvp?.side).toBe("b");
    // The stored snapshots exist exactly once (final a/b + mvp).
    const snapshots = await db.livePkScoreSnapshot.findMany({ where: { battleId } });
    expect(snapshots.filter((s) => s.kind === "final")).toHaveLength(2);
    expect(snapshots.filter((s) => s.kind === "mvp")).toHaveLength(1);
    // BOTH rooms hear the finalize.
    stopA();
    stopB();
    const finalsA = eventsA.filter((e): e is Extract<LiveStreamEvent, { kind: "pk" }> => e.kind === "pk");
    const finalsB = eventsB.filter((e): e is Extract<LiveStreamEvent, { kind: "pk" }> => e.kind === "pk");
    expect(finalsA.some((e) => e.battle.status === "final")).toBe(true);
    expect(finalsB.some((e) => e.battle.status === "final")).toBe(true);
    // IDEMPOTENT: a re-read answers the SAME final without new snapshots.
    const again = await getBattle(b.roomId);
    expect(again.body.battle.status).toBe("final");
    const snapshots2 = await db.livePkScoreSnapshot.findMany({ where: { battleId } });
    expect(snapshots2).toHaveLength(snapshots.length);
  });

  test("the 429 budget: > RATE_LIMITS.pkManage mutating calls → 429", async () => {
    const { roomId } = await liveRoomFor(HOST_CLAIMS, HOST);
    const limit = RATE_LIMITS.pkManage.limit;
    let saw429 = false;
    for (let i = 0; i < limit + 3; i++) {
      const res = await openAs(HOST, roomId, {});
      if (res.status === 200) await cancelAs(HOST, roomId);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
