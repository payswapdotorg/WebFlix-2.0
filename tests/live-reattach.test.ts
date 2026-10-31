/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 P68 — the console re-attach pins.
 *
 * The gap this closes (recorded as an honest residual since the Phase 3
 * claims row): the studio console's 409 conflict copy promised "Reload the
 * page to re-attach" while a reload reset the form and orphaned the
 * running session. P68 makes re-attach REAL: a host-scoped probe route
 * (GET /api/studio/live-session) finds the caller's ACTIVE room (ANY
 * visibility — the host's unlisted/members rooms belong to their host
 * exactly as much as public ones), and the console re-takes it through the
 * EXISTING token route, whose host rung derives from the room's hostId —
 * nobody can claim it.
 *
 * Pins (route handlers called directly with a real minted cookie, the
 * house law):
 * - the probe: anonymous 401; signed-in with nothing live → { room: null };
 *   the host's ACTIVE unlisted room answers with currentSession live +
 *   isHost true; a second live host's probe answers THEIR room — a
 *   stranger's live room is never answered; the viewer (no rooms) gets
 *   null;
 * - the probe dies with the session: endSession → { room: null };
 * - the conflict path the console auto-recovers from: double Go-Live
 *   409s with { error: "conflict" } (the provider env is configured in
 *   THIS file — mintToken signs locally with zero network, so the real
 *   wall ordering is exercisable: provider check → host check → session
 *   check);
 * - the re-attach rung law: the token route mints playback.role "host"
 *   for the room's hostId and NOTHING ELSE (the exact fact the console
 *   verifies before flipping live); the same mint on an ENDED session is
 *   an honest 409 (no-live-session), never a stale token.
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
import { GET as getLiveSession } from "@/app/api/studio/live-session/route";
import { POST as postSessions } from "@/app/api/live-rooms/[id]/sessions/route";
import { POST as postToken } from "@/app/api/live-rooms/[id]/token/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";

setupLiveDb();

// The provider env is configured IN THIS FILE ONLY: mintToken signs the
// access token locally (zero network), so the REAL rung/conflict ordering
// (provider check → host check → session check) is exercisable in the
// lane battery — the same env-flip idiom the ops pins use for
// LIVEKIT_EGRESS_ENABLED. Restored in afterAll.
const ENV_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.LIVEKIT_URL = "wss://reattach-test.livekit.local";
  process.env.LIVEKIT_API_KEY = "devkey_reattach";
  process.env.LIVEKIT_API_SECRET = "devsecret_reattach_0123456789abcdef";
  HOST = await hostCookie();
  OTHER = await otherCookie();
  VIEWER = await viewerCookie();
  // Hermetic slate: the lane db PERSISTS across battery runs, and the
  // probe answers the host's NEWEST ACTIVE room — a live room left by a
  // previous run (or by a later test in this file) would defeat the
  // "nothing live answers null" pins. Close every live session/room this
  // file's three identities could own (the same closure the probe pins
  // read back; nothing outside these three shadows is touched).
  for (const claims of [HOST_CLAIMS, OTHER_CLAIMS, VIEWER_CLAIMS]) {
    const shadow = await ensureShadowUser(sessionUserOf(claims));
    await db.liveSession.updateMany({
      where: { status: { not: "ended" }, room: { hostId: shadow.id } },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    await db.liveRoom.updateMany({
      where: { hostId: shadow.id, status: "live" },
      data: { status: "ended" },
    });
  }
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  clearRateLimits();
});

let HOST = "";
let OTHER = "";
let VIEWER = "";

const PROBE_URL = "http://localhost/api/studio/live-session";
const sessionsUrl = (roomId: string) => `http://localhost/api/live-rooms/${roomId}/sessions`;
const tokenUrl = (roomId: string) => `http://localhost/api/live-rooms/${roomId}/token`;

interface ProbeRoomShape {
  id: string;
  isHost: boolean | null;
  visibility: "public" | "unlisted" | "members";
  currentSession: { status: string } | null;
}

describe("GET /api/studio/live-session — the re-attach probe", () => {
  test("anonymous is 401; signed-in with nothing live answers { room: null }", async () => {
    const anon = await getLiveSession(new Request(PROBE_URL));
    expect(anon.status).toBe(401);

    const res = await getLiveSession(reqWithCookie(PROBE_URL, HOST));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { room: unknown };
    expect(data.room).toBeNull();
  });

  test("the host's ACTIVE unlisted room answers (any visibility), host-scoped — a stranger's live room never answers", async () => {
    // The host's UNLISTED live room: the discovery route's public filter
    // must never leak into the host's own console probe.
    const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), "Reattach probe unlisted room");
    await (await import("@/lib/db")).db.liveRoom.update({
      where: { id: roomId },
      data: { visibility: "unlisted" },
    });
    await startSessionFixture(roomId);

    // A stranger's room is ALSO live right now.
    const { roomId: otherRoomId } = await createRoomFixture(
      sessionUserOf(OTHER_CLAIMS),
      "Other host live room",
    );
    await startSessionFixture(otherRoomId);

    const hostRes = await getLiveSession(reqWithCookie(PROBE_URL, HOST));
    expect(hostRes.status).toBe(200);
    const hostData = (await hostRes.json()) as { room: ProbeRoomShape | null };
    expect(hostData.room).not.toBeNull();
    expect(hostData.room!.id).toBe(roomId);
    expect(hostData.room!.visibility).toBe("unlisted");
    expect(hostData.room!.currentSession?.status).toBe("live");
    expect(hostData.room!.isHost).toBe(true);

    // The other live host's probe answers THEIR room — never the host's.
    const otherRes = await getLiveSession(reqWithCookie(PROBE_URL, OTHER));
    expect(otherRes.status).toBe(200);
    const otherData = (await otherRes.json()) as { room: { id: string } | null };
    expect(otherData.room?.id).toBe(otherRoomId);

    // The viewer owns no rooms: null — never a stranger's room.
    const viewerRes = await getLiveSession(reqWithCookie(PROBE_URL, VIEWER));
    expect(viewerRes.status).toBe(200);
    const viewerData = (await viewerRes.json()) as { room: unknown };
    expect(viewerData.room).toBeNull();
  });

  test("the probe dies with the session: endSession → { room: null }", async () => {
    // Hermetic start: close every session earlier tests left live — the
    // probe answers the host's NEWEST ACTIVE room, so a cross-test live
    // room would shadow this test's room and the null would never come.
    const hostShadow = await ensureShadowUser(sessionUserOf(HOST_CLAIMS));
    await db.liveSession.updateMany({
      where: { status: { not: "ended" }, room: { hostId: hostShadow.id } },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    await db.liveRoom.updateMany({
      where: { hostId: hostShadow.id, status: "live" },
      data: { status: "ended" },
    });

    const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), "Probe ends with session");
    await startSessionFixture(roomId);

    const before = await getLiveSession(reqWithCookie(PROBE_URL, HOST));
    const beforeData = (await before.json()) as { room: { id: string } | null };
    expect(beforeData.room?.id).toBe(roomId);

    await endSessionFixture(roomId);
    const after = await getLiveSession(reqWithCookie(PROBE_URL, HOST));
    const afterData = (await after.json()) as { room: unknown };
    expect(afterData.room).toBeNull();
  });
});

describe("the re-attach primitives", () => {
  test("double Go-Live still 409s with conflict — the path the console now auto-recovers from", async () => {
    const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), "Conflict path room");
    await startSessionFixture(roomId);

    const res = await postSessions(
      reqWithCookie(sessionsUrl(roomId), HOST, { method: "POST", body: {} }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("conflict");
  });

  test("the token route mints playback.role 'host' for the room's hostId — and an ended session is an honest 409", async () => {
    const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), "Host rung unlisted room");
    await (await import("@/lib/db")).db.liveRoom.update({
      where: { id: roomId },
      data: { visibility: "unlisted" },
    });
    await startSessionFixture(roomId);

    // THE rung fact the console verifies before flipping live: the host
    // identity derives from the room's hostId — the caller cannot claim it.
    const res = await postToken(
      reqWithCookie(tokenUrl(roomId), HOST, { method: "POST", body: {} }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { playback: { role: string; identity: string } };
    expect(data.playback.role).toBe("host");

    await endSessionFixture(roomId);
    // An ENDED session: the mint is an honest 409 (no-live-session),
    // never a stale token for a dead broadcast.
    const ended = await postToken(
      reqWithCookie(tokenUrl(roomId), HOST, { method: "POST", body: {} }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(ended.status).toBe(409);
    const endedData = (await ended.json()) as { error: string };
    expect(endedData.error).toBe("conflict");
  });
});
