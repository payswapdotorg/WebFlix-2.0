/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 lane 2-a — the presence heartbeat pins.
 *
 * Pins: heartbeat creates/refreshes the caller's LiveParticipant row
 * (viewer role, connected), the host row never counts as a viewer, the
 * PRESENCE_WINDOW_MS staleness law (rows past the window drop out of the
 * count), the not-live/404/401 gates and the 429 budget.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  hostCookie,
  modCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { POST as postPresence } from "@/app/api/live-rooms/[id]/presence/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { PRESENCE_WINDOW_MS, RATE_LIMITS } from "@/lib/live/permissions";
import type { LivePresenceDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let hostShadowId = "";
let viewerShadowId = "";
let otherShadowId = "";
let modShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
  otherShadowId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
  modShadowId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
});

function presenceUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/presence`;
}

async function heartbeatAs(
  cookie: string,
  roomId: string,
): Promise<{ status: number; body: any }> {
  const res = await postPresence(
    reqWithCookie(presenceUrl(roomId), cookie, { method: "POST", body: {} }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function liveRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `2a-present-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

describe("live presence — gates", () => {
  test("anonymous is 401; unknown room 404; no active session 403 not-live", async () => {
    const { roomId } = await liveRoom();

    const anon = await heartbeatAs("next-auth.session-token=none", roomId);
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const ghost = await heartbeatAs(VIEWER, "room-does-not-exist");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");

    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `2a-present-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const notLive = await heartbeatAs(VIEWER, idle.roomId);
    expect(notLive.status).toBe(403);
    expect(notLive.body.error).toBe("forbidden");
    expect(notLive.body.message).toBe("not-live");
  });
});

describe("live presence — heartbeat + viewer count laws", () => {
  test("heartbeat creates a connected viewer participant and reports the count", async () => {
    const { roomId, sessionId } = await liveRoom();
    const { status, body } = await heartbeatAs(VIEWER, roomId);
    expect(status).toBe(200);
    const presence = body.presence as LivePresenceDto;
    expect(presence.sessionId).toBe(sessionId);
    expect(presence.viewerCount).toBe(1);

    const row = await db.liveParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: viewerShadowId } },
    });
    expect(row?.role).toBe("viewer");
    expect(row?.state).toBe("connected");
  });

  test("a host heartbeat does NOT raise the viewer count", async () => {
    const { roomId, sessionId } = await liveRoom();
    await heartbeatAs(VIEWER, roomId); // one viewer present

    const hostBeat = await heartbeatAs(HOST, roomId);
    expect(hostBeat.status).toBe(200);
    expect((hostBeat.body.presence as LivePresenceDto).viewerCount).toBe(1);

    const hostRow = await db.liveParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: hostShadowId } },
    });
    expect(hostRow?.role).toBe("host");
    expect(hostRow?.state).toBe("connected");
  });

  test("viewerCount counts only rows inside PRESENCE_WINDOW_MS", async () => {
    const { roomId, sessionId } = await liveRoom();
    const first = await heartbeatAs(VIEWER, roomId);
    expect((first.body.presence as LivePresenceDto).viewerCount).toBe(1);

    // Two synthetic viewers: one fresh, one backdated beyond the window.
    await db.liveParticipant.create({
      data: {
        sessionId,
        userId: otherShadowId,
        role: "viewer",
        state: "connected",
        lastSeenAt: new Date(),
      },
    });
    await db.liveParticipant.create({
      data: {
        sessionId,
        userId: modShadowId,
        role: "viewer",
        state: "connected",
        lastSeenAt: new Date(Date.now() - PRESENCE_WINDOW_MS * 2),
      },
    });

    const withFresh = await heartbeatAs(VIEWER, roomId);
    expect((withFresh.body.presence as LivePresenceDto).viewerCount).toBe(2);

    // The fresh one goes stale too — only the beating viewer remains.
    await db.liveParticipant.updateMany({
      where: { sessionId, userId: otherShadowId },
      data: { lastSeenAt: new Date(Date.now() - PRESENCE_WINDOW_MS * 2) },
    });
    const afterStale = await heartbeatAs(VIEWER, roomId);
    expect((afterStale.body.presence as LivePresenceDto).viewerCount).toBe(1);
  });
});

describe("live presence — rate limit (429)", () => {
  test("fire > RATE_LIMITS.presence heartbeats → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.presence.limit;
    for (let i = 0; i < limit + 1; i++) {
      const { status } = await heartbeatAs(VIEWER, roomId);
      if (i < limit) expect(status).toBe(200);
      else expect(status).toBe(429);
    }
  });
});
