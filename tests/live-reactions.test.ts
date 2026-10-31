/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 lane 2-a — the reaction batch pins.
 *
 * Pins: the server clamp (count 1000 → 60 stored, 0 → 1), server-computed
 * totals (SUM over accepted batches), the clientBatchId idempotency law
 * (no double count, one row), the policy/sanction matrix (disabled → 403,
 * banned → 403, and the documented law that a timed mute does NOT block
 * reactions), validation (400) and the 429 budget.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
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
import { POST as postReactions } from "@/app/api/live-rooms/[id]/reactions/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { RATE_LIMITS, REACTION_BATCH_MAX } from "@/lib/live/permissions";
import type { LiveReactionTotalDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let OTHER = "";
let hostShadowId = "";
let viewerShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  OTHER = await otherCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
});

function reactionsUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/reactions`;
}

async function reactAs(
  cookie: string,
  roomId: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await postReactions(reqWithCookie(reactionsUrl(roomId), cookie, {
    method: "POST",
    body,
  }), { params: Promise.resolve({ id: roomId }) });
  return { status: res.status, body: await res.json() };
}

async function liveRoom(policy: { reactionsEnabled?: boolean } = {}): Promise<{
  roomId: string;
  sessionId: string;
}> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `2a-react-${crypto.randomUUID().slice(0, 8)}`,
  );
  if (Object.keys(policy).length > 0) {
    await db.liveRoom.update({ where: { id: roomId }, data: policy });
  }
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

describe("live reactions — gates", () => {
  test("anonymous POST is 401; unknown room is 404; no session is 403 not-live", async () => {
    const { roomId } = await liveRoom();

    const anon = await reactAs("next-auth.session-token=none", roomId, {
      clientBatchId: "anonbatch1",
      count: 1,
    });
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const ghost = await reactAs(VIEWER, "room-does-not-exist", {
      clientBatchId: "ghostbatc1",
      count: 1,
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");

    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `2a-react-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const notLive = await reactAs(VIEWER, idle.roomId, {
      clientBatchId: "idlebatch1",
      count: 1,
    });
    expect(notLive.status).toBe(403);
    expect(notLive.body.error).toBe("forbidden");
    expect(notLive.body.message).toBe("not-live");
  });

  test("reactions disabled is 403 reactions-disabled", async () => {
    const { roomId } = await liveRoom({ reactionsEnabled: false });
    const { status, body } = await reactAs(VIEWER, roomId, {
      clientBatchId: "disabledrc1",
      count: 5,
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.message).toBe("reactions-disabled");
  });

  test("banned is 403 banned — but a timed mute does NOT block reactions", async () => {
    const banned = await liveRoom();
    await db.liveModerationAction.create({
      data: { roomId: banned.roomId, actorId: hostShadowId, targetId: viewerShadowId, action: "ban" },
    });
    const bannedTry = await reactAs(VIEWER, banned.roomId, {
      clientBatchId: "bannedre01",
      count: 3,
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
    const mutedReact = await reactAs(VIEWER, muted.roomId, {
      clientBatchId: "mutedreac1",
      count: 3,
    });
    // THE LAW: mute is a chat sanction — applause still works.
    expect(mutedReact.status).toBe(200);
    expect(mutedReact.body.total.total).toBe(3);
  });
});

describe("live reactions — validation", () => {
  test("bad clientBatchId / count / kind is 400 invalid", async () => {
    const { roomId } = await liveRoom();

    const shortBatch = await reactAs(VIEWER, roomId, { clientBatchId: "short", count: 1 });
    expect(shortBatch.status).toBe(400);
    expect(shortBatch.body.error).toBe("invalid");

    const noCount = await reactAs(VIEWER, roomId, { clientBatchId: "nocount001" });
    expect(noCount.status).toBe(400);
    expect(noCount.body.error).toBe("invalid");

    const stringCount = await reactAs(VIEWER, roomId, {
      clientBatchId: "strcount1",
      count: "lots",
    });
    expect(stringCount.status).toBe(400);
    expect(stringCount.body.error).toBe("invalid");

    const badKind = await reactAs(VIEWER, roomId, {
      clientBatchId: "badkind001",
      count: 1,
      kind: "fire",
    });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toBe("invalid");
  });
});

describe("live reactions — server-authoritative clamp + totals", () => {
  test("count 1000 is clamped to REACTION_BATCH_MAX (60) in the stored row", async () => {
    const { roomId, sessionId } = await liveRoom();
    const { status, body } = await reactAs(VIEWER, roomId, {
      clientBatchId: "clampbig01",
      count: 1000,
    });
    expect(status).toBe(200);
    const total = body.total as LiveReactionTotalDto;
    expect(total.total).toBe(REACTION_BATCH_MAX);
    expect(total.kind).toBe("heart");
    expect(total.sessionId).toBe(sessionId);
    expect(total.lastBatchAt).not.toBeNull();
    const rows = await db.liveReactionBatch.findMany({ where: { sessionId } });
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(REACTION_BATCH_MAX);
  });

  test("count 0 floors to 1 — the server clamps, never trusts the client", async () => {
    const { roomId, sessionId } = await liveRoom();
    const { status } = await reactAs(VIEWER, roomId, { clientBatchId: "floorzero1", count: 0 });
    expect(status).toBe(200);
    const rows = await db.liveReactionBatch.findMany({ where: { sessionId } });
    expect(rows[0]?.count).toBe(1);
  });

  test("total equals the SUM of accepted batches (server-computed)", async () => {
    const { roomId } = await liveRoom();
    const a = await reactAs(VIEWER, roomId, { clientBatchId: "sumbatch01", count: 5 });
    expect(a.status).toBe(200);
    expect(a.body.total.total).toBe(5);
    const b = await reactAs(OTHER, roomId, { clientBatchId: "sumbatch02", count: 7 });
    expect(b.status).toBe(200);
    expect(b.body.total.total).toBe(12);
    const c = await reactAs(VIEWER, roomId, { clientBatchId: "sumbatch03", count: 2 });
    expect(c.body.total.total).toBe(14);
  });

  test("duplicate clientBatchId does not double count — one row, current total", async () => {
    const { roomId, sessionId } = await liveRoom();
    const first = await reactAs(VIEWER, roomId, { clientBatchId: "dupebatch1", count: 5 });
    expect(first.status).toBe(200);
    expect(first.body.total.total).toBe(5);
    const retry = await reactAs(VIEWER, roomId, { clientBatchId: "dupebatch1", count: 999 });
    expect(retry.status).toBe(200);
    expect(retry.body.total.total).toBe(5);
    const rows = await db.liveReactionBatch.findMany({
      where: { sessionId, senderId: viewerShadowId, clientBatchId: "dupebatch1" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(5);
  });
});

describe("live reactions — rate limit (429)", () => {
  test("fire > RATE_LIMITS.reactions with distinct ids → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.reactions.limit;
    for (let i = 0; i < limit + 2; i++) {
      const { status } = await reactAs(VIEWER, roomId, {
        clientBatchId: `burst-${crypto.randomUUID().slice(0, 8)}-${i}`,
        count: 1,
      });
      if (i < limit) expect(status).toBe(200);
      else expect(status).toBe(429);
    }
  });
});
