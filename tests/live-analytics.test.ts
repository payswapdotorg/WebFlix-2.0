/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 lane 4-b — the creator analytics pins.
 *
 * Pins: the read gate matrix (anonymous 401, viewer 403, host 200), THE
 * DERIVATION PIN (every number derives from durable rows exactly —
 * durationMs from the seeded startedAt..endedAt window, peakViewers from
 * the LiveSession column, uniqueViewers from viewer-role participant rows
 * only, non-tombstoned chat only, SUM(reaction batches), gift events +
 * DEV credits, matches in any state, replayStatus null without an asset),
 * the idempotent recompute law (two reads → identical numbers, refreshed
 * computedAt, same row), the self-healing law (a deleted snapshot row is
 * re-derived on the next host read), and the studio panel law (host sees
 * their ended sessions newest-first with the raw snapshot summary; a
 * stranger's call never returns another host's rows; anonymous 401).
 *
 * Interaction rows are seeded DIRECTLY via the db (messages, a reaction
 * batch, a gift event, a match, participant rows, session window +
 * peakViewers) — no provider calls, no client-supplied numbers anywhere.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  endSessionFixture,
  hostCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { GET as getRoomAnalytics } from "@/app/api/live-rooms/[id]/analytics/route";
import { GET as getStudioSessions } from "@/app/api/studio/live-sessions/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let OTHER = "";
let hostShadowId = "";
let viewerId = "";
let otherId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  OTHER = await otherCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
  otherId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
});

// ── fixtures ───────────────────────────────────────────────────────────

function analyticsUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/analytics`;
}
const STUDIO_URL = "http://localhost/api/studio/live-sessions";

async function getAnalyticsAs(cookie: string | null, roomId: string) {
  const req = cookie
    ? reqWithCookie(analyticsUrl(roomId), cookie)
    : new Request(analyticsUrl(roomId));
  const res = await getRoomAnalytics(req, { params: Promise.resolve({ id: roomId }) });
  return { status: res.status, body: (await res.json()) as any };
}

async function getStudioAs(cookie: string | null) {
  const req = cookie ? reqWithCookie(STUDIO_URL, cookie) : new Request(STUDIO_URL);
  const res = await getStudioSessions(req);
  return { status: res.status, body: (await res.json()) as any };
}

/** The EXACT numbers the seeded durable rows must derive to. */
const DERIVED = {
  durationMs: 120_000,
  peakViewers: 7,
  uniqueViewers: 2,
  chatMessages: 2,
  reactionHearts: 5,
  giftEvents: 1,
  giftCredits: 50,
  matchesRun: 1,
  replayStatus: null,
};

/**
 * A host room whose session carries the exact durable rows behind DERIVED:
 * window 120000ms, peakViewers 7, 2 viewer participants + 1 host row (must
 * NOT count), 3 chat rows (1 tombstoned), one reaction batch (count 5),
 * one gift event (50 credits), 1 match (ended).
 */
async function seedDerivationRows(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `4b-analytics-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  const startedAt = new Date(Date.now() - 10 * 60_000);
  const endedAt = new Date(startedAt.getTime() + DERIVED.durationMs);
  // seed the session window + the presence-time peak directly (facts the
  // presence lane records; analytics only summarizes them)
  await db.liveSession.update({
    where: { id: sessionId },
    data: { startedAt, endedAt, peakViewers: DERIVED.peakViewers },
  });

  // participants: 2 viewers count; the host-role row must NOT count
  await db.liveParticipant.create({
    data: { sessionId, userId: viewerId, role: "viewer", state: "connected" },
  });
  await db.liveParticipant.create({
    data: { sessionId, userId: otherId, role: "viewer", state: "disconnected" },
  });
  await db.liveParticipant.create({
    data: { sessionId, userId: hostShadowId, role: "host", state: "connected" },
  });

  // chat: 3 rows, one tombstoned (moderation delete) → 2 count
  for (let i = 0; i < 3; i++) {
    await db.liveRoomMessage.create({
      data: {
        roomId,
        sessionId,
        senderId: viewerId,
        clientMessageId: `cm-${crypto.randomUUID()}`,
        body: `hello ${i}`,
        kind: "chat",
        ...(i === 2 ? { deletedAt: new Date(), deletedBy: hostShadowId } : {}),
      },
    });
  }

  // reactions: one accepted batching window of 5 hearts
  await db.liveReactionBatch.create({
    data: {
      roomId,
      sessionId,
      senderId: viewerId,
      clientBatchId: `cb-${crypto.randomUUID()}`,
      kind: "heart",
      count: 5,
    },
  });

  // gifts: one dev-credit gift (§4F sandbox — zero cash value)
  await db.giftEvent.create({
    data: {
      intentId: `intent-${crypto.randomUUID()}`,
      roomId,
      sessionId,
      senderId: viewerId,
      recipientId: hostShadowId,
      giftItemId: "gift-rose-4b",
      giftName: "Test Rose",
      quantity: 1,
      totalCredits: 50,
    },
  });

  // matches: one ended match — any terminal state counts
  await db.liveMatch.create({
    data: {
      roomId,
      sessionId,
      createdById: hostShadowId,
      kind: "solo",
      status: "ended",
      durationSeconds: 30,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30_000),
      endedAt: new Date(startedAt.getTime() + 30_000),
      endReason: "timeout",
    },
  });

  return { roomId, sessionId };
}

/** A host room with one ended session at a deterministic endedAt. */
async function seedEndedRoom(endedAt: Date): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `4b-studio-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  await endSessionFixture(roomId);
  await db.liveSession.update({ where: { id: sessionId }, data: { endedAt } });
  await db.liveRoomMessage.create({
    data: {
      roomId,
      sessionId,
      senderId: viewerId,
      clientMessageId: `cm-${crypto.randomUUID()}`,
      body: "studio chat",
      kind: "chat",
    },
  });
  return { roomId, sessionId };
}

// ── gates ──────────────────────────────────────────────────────────────

describe("live analytics — read gates", () => {
  test("anonymous is 401; viewer is 403 forbidden; host is 200", async () => {
    const { roomId } = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `4b-gates-${crypto.randomUUID().slice(0, 8)}`,
    );
    const { sessionId } = await startSessionFixture(roomId);
    await endSessionFixture(roomId);

    const anon = await getAnalyticsAs(null, roomId);
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const viewerTry = await getAnalyticsAs(VIEWER, roomId);
    expect(viewerTry.status).toBe(403);
    expect(viewerTry.body.error).toBe("forbidden");

    const host = await getAnalyticsAs(HOST, roomId);
    expect(host.status).toBe(200);
    expect(host.body.snapshot.sessionId).toBe(sessionId);
    expect(host.body.snapshot.roomId).toBe(roomId);
  });
});

// ── the derivation law ─────────────────────────────────────────────────

describe("live analytics — the derivation pin (server-derived law)", () => {
  test("every field derives from durable rows, EXACTLY", async () => {
    const { roomId, sessionId } = await seedDerivationRows();

    const { status, body } = await getAnalyticsAs(HOST, roomId);
    expect(status).toBe(200);
    const snap = body.snapshot;
    expect(snap.sessionId).toBe(sessionId);
    expect(snap.roomId).toBe(roomId);
    expect(typeof snap.id).toBe("string");
    expect(typeof snap.computedAt).toBe("string");
    // every derived number, field by field
    expect(snap.durationMs).toBe(DERIVED.durationMs);
    expect(snap.peakViewers).toBe(DERIVED.peakViewers);
    expect(snap.uniqueViewers).toBe(DERIVED.uniqueViewers);
    expect(snap.chatMessages).toBe(DERIVED.chatMessages);
    expect(snap.reactionHearts).toBe(DERIVED.reactionHearts);
    expect(snap.giftEvents).toBe(DERIVED.giftEvents);
    expect(snap.giftCredits).toBe(DERIVED.giftCredits);
    expect(snap.matchesRun).toBe(DERIVED.matchesRun);
    expect(snap.replayStatus).toBe(DERIVED.replayStatus);
  });
});

// ── idempotent recompute + self-healing ────────────────────────────────

describe("live analytics — idempotent recompute and self-healing", () => {
  test("two reads derive identical numbers and refresh computedAt on the same row", async () => {
    const { roomId } = await seedDerivationRows();

    const first = await getAnalyticsAs(HOST, roomId);
    expect(first.status).toBe(200);
    await Bun.sleep(3); // computedAt must visibly refresh on the second read
    const second = await getAnalyticsAs(HOST, roomId);
    expect(second.status).toBe(200);

    expect(second.body.snapshot.id).toBe(first.body.snapshot.id); // upsert, not a second row
    expect(second.body.snapshot).toMatchObject(DERIVED); // same rows → same numbers
    expect(new Date(second.body.snapshot.computedAt).getTime()).toBeGreaterThan(
      new Date(first.body.snapshot.computedAt).getTime(),
    );
  });

  test("self-heal: a deleted snapshot row is re-derived with the same numbers", async () => {
    const { roomId, sessionId } = await seedDerivationRows();

    const first = await getAnalyticsAs(HOST, roomId);
    expect(first.status).toBe(200);

    // simulate the failed end-hook: no row at all
    await db.liveAnalyticsSnapshot.deleteMany({ where: { sessionId } });
    const gone = await db.liveAnalyticsSnapshot.findUnique({ where: { sessionId } });
    expect(gone).toBeNull();

    const healed = await getAnalyticsAs(HOST, roomId);
    expect(healed.status).toBe(200);
    expect(healed.body.snapshot).toMatchObject(DERIVED); // the read is authoritative
    const recreated = await db.liveAnalyticsSnapshot.findUnique({ where: { sessionId } });
    expect(recreated).not.toBeNull();
  });
});

// ── the studio panel law ───────────────────────────────────────────────

describe("live analytics — studio panel feed", () => {
  test("host sees their ended sessions newest-first with snapshot summaries; strangers never do; anonymous 401", async () => {
    const base = Date.now() - 60_000;
    const older = await seedEndedRoom(new Date(base));
    const newer = await seedEndedRoom(new Date(base + 30_000));

    // the host read re-derives + persists the snapshot for the newer room
    // only — the listing must carry it as a RAW row, never recompute per row
    const computed = await getAnalyticsAs(HOST, newer.roomId);
    expect(computed.status).toBe(200);

    const hostView = await getStudioAs(HOST);
    expect(hostView.status).toBe(200);
    const rows = hostView.body.sessions as Array<any>;

    const newerRow = rows.find((r) => r.session.id === newer.sessionId);
    expect(newerRow).toBeDefined();
    expect(newerRow.room.id).toBe(newer.roomId);
    expect(newerRow.room.title).toContain("4b-studio-");
    expect(newerRow.room.status).toBe("ended");
    expect(newerRow.session.status).toBe("ended");
    expect(newerRow.session.endedAt).toBe(new Date(base + 30_000).toISOString());
    expect(newerRow.snapshot).not.toBeNull();
    expect(newerRow.snapshot).toMatchObject({
      sessionId: newer.sessionId,
      roomId: newer.roomId,
      chatMessages: 1,
    });
    expect(newerRow.replay).toBeNull();

    const olderRow = rows.find((r) => r.session.id === older.sessionId);
    expect(olderRow).toBeDefined();
    expect(olderRow.snapshot).toBeNull(); // raw read — no per-row recompute

    // newest-first ordering by endedAt (relative positions survive any
    // other lanes' rows in the shared host listing)
    const newerIdx = rows.findIndex((r) => r.session.id === newer.sessionId);
    const olderIdx = rows.findIndex((r) => r.session.id === older.sessionId);
    expect(newerIdx).toBeLessThan(olderIdx);

    // host-scope law: a stranger's call returns only their own rooms —
    // none of the host's rows may appear (the stranger typically owns no
    // rooms at all, which is the empty case)
    const strangerView = await getStudioAs(OTHER);
    expect(strangerView.status).toBe(200);
    const strangerRows = strangerView.body.sessions as Array<any>;
    expect(strangerRows.some((r) => r.session.id === newer.sessionId)).toBe(false);
    expect(strangerRows.some((r) => r.session.id === older.sessionId)).toBe(false);
    expect(strangerRows.some((r) => r.room.id === newer.roomId)).toBe(false);
    expect(strangerRows.some((r) => r.room.id === older.roomId)).toBe(false);

    const anon = await getStudioAs(null);
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");
  });
});
