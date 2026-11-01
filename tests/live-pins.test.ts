/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Parity P71 — the room-richness pins (ADR-0012).
 *
 * Pins: the pin gates (anon 401 / viewer 403 / host+mod 200), the
 * message-must-exist-in-room law (foreign message 404), the tombstone law
 * (pinning a tombstoned message 400; a TOMBSTONED PIN is deleted lazily on
 * read), the one-pin-per-room REPLACE law, the ledger rows (the additive
 * pin/unpin kinds), the null-pin envelope on unpin, the idempotent unpin,
 * the announcement gates + char law (280) + the honest clearing (nulling),
 * the room-DTO announcement ride, and the LOYALTY derivation (XP =
 * 2×chat + 1×reaction + 1×gift credits since the room's first session;
 * level = the ROOM_LEVELS table; the level chip stamps on chat DTOs and
 * never client-claims).
 *
 * Run: DATABASE_URL=file:../db/live-pins-test.db bun test --isolate tests/live-pins.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
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
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { RATE_LIMITS, ROOM_LEVELS, ROOM_XP_WEIGHTS } from "@/lib/live/permissions";
import { subscribeLiveRoom } from "@/lib/live/hub";
import { sendChat } from "@/lib/live/chat";
import { performModeration } from "@/lib/live/moderation";
import { levelForXp, roomLevelsFor } from "@/lib/live/pins";
import type { LiveChatMessageDto, LiveRoomDto, LiveStreamEvent } from "@/lib/live/types";

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

function pinUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/pin`;
}

function announcementUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/announcement`;
}

async function pinAs(
  cookie: string,
  roomId: string,
  messageId: string | null,
): Promise<{ status: number; body: any }> {
  const { POST } = await import("@/app/api/live-rooms/[id]/pin/route");
  const res = await POST(
    reqWithCookie(pinUrl(roomId), cookie, {
      method: "POST",
      body: { messageId },
    }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function unpinAs(
  cookie: string,
  roomId: string,
): Promise<{ status: number; body: any }> {
  const { DELETE } = await import("@/app/api/live-rooms/[id]/pin/route");
  const res = await DELETE(reqWithCookie(pinUrl(roomId), cookie, { method: "DELETE" }), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

async function getPin(roomId: string): Promise<{ status: number; body: any }> {
  const { GET } = await import("@/app/api/live-rooms/[id]/pin/route");
  const res = await GET(
    reqWithCookie(pinUrl(roomId), "next-auth.session-token=none"),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function setAnnouncementAs(
  cookie: string,
  roomId: string,
  body: string,
): Promise<{ status: number; body: any }> {
  const { POST } = await import("@/app/api/live-rooms/[id]/announcement/route");
  const res = await POST(
    reqWithCookie(announcementUrl(roomId), cookie, { method: "POST", body: { body } }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function clearAnnouncementAs(
  cookie: string,
  roomId: string,
): Promise<{ status: number; body: any }> {
  const { DELETE } = await import("@/app/api/live-rooms/[id]/announcement/route");
  const res = await DELETE(
    reqWithCookie(announcementUrl(roomId), cookie, { method: "DELETE" }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function liveRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `p71-pin-${crypto.randomUUID().slice(0, 8)}`,
  );
  // Grant the mod identity (the LiveRoomModerator row — the host-ladder
  // law: a moderator is whoever has an un-revoked grant, never a claim).
  const modShadowId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
  await db.liveRoomModerator.create({
    data: { roomId, userId: modShadowId, grantedBy: hostShadowId },
  });
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

function recordEnvelopes(roomId: string): { events: LiveStreamEvent[]; stop: () => void } {
  const events: LiveStreamEvent[] = [];
  const stop = subscribeLiveRoom(roomId, (event) => events.push(event));
  return { events, stop };
}

// ─────────────────────────────────────────────────────────────────────
describe("live pins — the gates + validation", () => {
  test("anon 401 · viewer 403 · mod 200 · host 200", async () => {
    const { roomId } = await liveRoom();
    const sent = await sendChat(roomId, sessionUserOf(VIEWER_CLAIMS), {
      body: "pin me",
      clientMessageId: "pingate0001",
    });
    expect(sent.message.id).toBeTruthy();
    const anon = await pinAs("next-auth.session-token=none", roomId, sent.message.id);
    expect(anon.status).toBe(401);
    const viewer = await pinAs(VIEWER, roomId, sent.message.id);
    expect(viewer.status).toBe(403);
    const mod = await pinAs(MOD, roomId, sent.message.id);
    expect(mod.status).toBe(200);
    expect(mod.body.pin.messageId).toBe(sent.message.id);
    // REPLACE law: the host's pin on ANOTHER message replaces the mod's.
    const hostMsg = await sendChat(roomId, sessionUserOf(HOST_CLAIMS), {
      body: "host words",
      clientMessageId: "pingate0002",
    });
    const hostPin = await pinAs(HOST, roomId, hostMsg.message.id);
    expect(hostPin.status).toBe(200);
    expect(hostPin.body.pin.messageId).toBe(hostMsg.message.id);
    const room = await db.livePinnedMessage.findUnique({ where: { roomId } });
    expect(room?.messageId).toBe(hostMsg.message.id);
  });

  test("a message from ANOTHER room never pins (404 message-not-in-room); a ghost id 404s", async () => {
    const { roomId } = await liveRoom();
    const otherRoom = await liveRoom();
    const foreign = await sendChat(otherRoom.roomId, sessionUserOf(VIEWER_CLAIMS), {
      body: "foreign",
      clientMessageId: "pinforeign1",
    });
    const res = await pinAs(HOST, roomId, foreign.message.id);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("message-not-in-room");
    const ghost = await pinAs(HOST, roomId, "message-does-not-exist");
    expect(ghost.status).toBe(404);
  });

  test("a tombstoned message never pins (400); a TOMBSTONED PIN is deleted lazily on read", async () => {
    const { roomId } = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    const sent = await sendChat(roomId, viewer, {
      body: "to be deleted",
      clientMessageId: "pintombst01",
    });
    // Tombstone the message through the audited moderation route.
    await performModeration(roomId, sessionUserOf(HOST_CLAIMS), {
      action: "delete-message",
      messageId: sent.message.id,
    });
    const pinTombstoned = await pinAs(HOST, roomId, sent.message.id);
    expect(pinTombstoned.status).toBe(400);
    expect(pinTombstoned.body.message).toBe("message-tombstoned");

    // A pin that EXISTS then gets tombstoned is deleted lazily on read.
    const ok = await sendChat(roomId, viewer, {
      body: "pinned then deleted",
      clientMessageId: "pintombst02",
    });
    const pinned = await pinAs(HOST, roomId, ok.message.id);
    expect(pinned.status).toBe(200);
    await performModeration(roomId, sessionUserOf(HOST_CLAIMS), {
      action: "delete-message",
      messageId: ok.message.id,
    });
    const read = await getPin(roomId);
    expect(read.status).toBe(200);
    expect(read.body.pin).toBeNull();
    const row = await db.livePinnedMessage.findUnique({ where: { roomId } });
    expect(row).toBeNull();
  });

  test("unpin: clears + publishes the null-pin envelope; idempotent (no pin → still 200)", async () => {
    const { roomId } = await liveRoom();
    const { events, stop } = recordEnvelopes(roomId);
    const sent = await sendChat(roomId, sessionUserOf(VIEWER_CLAIMS), {
      body: "unpin me",
      clientMessageId: "pinunpin001",
    });
    await pinAs(HOST, roomId, sent.message.id);
    const first = await unpinAs(HOST, roomId);
    expect(first.status).toBe(200);
    expect(first.body.cleared).toBe(true);
    const again = await unpinAs(HOST, roomId);
    expect(again.status).toBe(200);
    expect(again.body.cleared).toBe(false);
    const pinEvents = events.filter((e) => e.kind === "pin") as Extract<
      LiveStreamEvent,
      { kind: "pin" }
    >[];
    stop();
    expect(pinEvents.some((e) => e.pin !== null)).toBe(true);
    expect(pinEvents.some((e) => e.pin === null)).toBe(true);
    // The ledger records BOTH intents (the additive kinds).
    const ledger = await db.liveModerationAction.findMany({
      where: { roomId, action: { in: ["pin", "unpin"] } },
    });
    expect(ledger.filter((r) => r.action === "pin").length).toBeGreaterThanOrEqual(1);
    expect(ledger.filter((r) => r.action === "unpin").length).toBe(2);
  });

  test("the pin GET is anonymous OK and a foreign room 404s", async () => {
    const { roomId } = await liveRoom();
    const anon = await getPin(roomId);
    expect(anon.status).toBe(200);
    expect(anon.body.pin).toBeNull();
    const ghost = await getPin("room-does-not-exist");
    expect(ghost.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live announcements — the setter law", () => {
  test("anon 401 · viewer 403 · host 200; the room DTO carries body + updatedAt; char law 280", async () => {
    const { roomId } = await liveRoom();
    const anon = await setAnnouncementAs("next-auth.session-token=none", roomId, "hello");
    expect(anon.status).toBe(401);
    const viewer = await setAnnouncementAs(VIEWER, roomId, "hello");
    expect(viewer.status).toBe(403);
    const host = await setAnnouncementAs(HOST, roomId, "Rules: be kind");
    expect(host.status).toBe(200);
    const roomDto = host.body.room as LiveRoomDto;
    expect(roomDto.announcementBody).toBe("Rules: be kind");
    expect(roomDto.announcementUpdatedAt).toBeTruthy();
    // The row carries it too.
    const row = await db.liveRoom.findUnique({ where: { id: roomId } });
    expect(row?.announcementBody).toBe("Rules: be kind");
    // Over the cap → 400; empty → 400.
    const tooLong = await setAnnouncementAs(HOST, roomId, "x".repeat(281));
    expect(tooLong.status).toBe(400);
    const empty = await setAnnouncementAs(HOST, roomId, "   ");
    expect(empty.status).toBe(400);
  });

  test("DELETE clears by NULLING (the honest empty state) and republishes the room", async () => {
    const { roomId } = await liveRoom();
    const { events, stop } = recordEnvelopes(roomId);
    await setAnnouncementAs(HOST, roomId, "gone soon");
    const cleared = await clearAnnouncementAs(HOST, roomId);
    expect(cleared.status).toBe(200);
    expect((cleared.body.room as LiveRoomDto).announcementBody).toBeNull();
    expect((cleared.body.room as LiveRoomDto).announcementUpdatedAt).toBeNull();
    const row = await db.liveRoom.findUnique({ where: { id: roomId } });
    expect(row?.announcementBody).toBeNull();
    expect(row?.announcementUpdatedAt).toBeNull();
    const roomEvents = events.filter((e) => e.kind === "room");
    stop();
    expect(roomEvents.length).toBeGreaterThanOrEqual(2); // set + clear republishes
  });

  test("a moderator may set one too (the staff capability)", async () => {
    const { roomId } = await liveRoom();
    const mod = await setAnnouncementAs(MOD, roomId, "from the mod desk");
    expect(mod.status).toBe(200);
    expect((mod.body.room as LiveRoomDto).announcementBody).toBe("from the mod desk");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live loyalty levels — the read-time derivation law (P71-3)", () => {
  test("XP = 2×chat + 1×reaction + 1×gift credits since the room's FIRST session; the level table pins", async () => {
    expect(ROOM_XP_WEIGHTS).toEqual({ chat: 2, reaction: 1, gift: 1 });
    expect(ROOM_LEVELS).toEqual([0, 50, 150, 400, 1000, 2500, 6000, 15000]);
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(49)).toBe(0);
    expect(levelForXp(50)).toBe(1);
    expect(levelForXp(399)).toBe(2);
    expect(levelForXp(15000)).toBe(7);
    expect(levelForXp(1_000_000)).toBe(7); // capped at the table's last entry

    const { roomId } = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    // 8 chat messages (the chat limiter's 8/10s budget exactly) = 16 XP;
    // + 34 reaction hearts = 34 XP → 50 XP = LV1 (the 50 threshold).
    for (let i = 0; i < 8; i++) {
      await sendChat(roomId, viewer, {
        body: `level grind ${i}`,
        clientMessageId: `lvlgrind${String(i).padStart(4, "0")}`,
      });
    }
    const { sendReactionBatch } = await import("@/lib/live/reactions");
    await sendReactionBatch(roomId, viewer, { clientBatchId: "lvlbatch001", count: 34 });
    const levels = await roomLevelsFor(roomId, [viewerShadowId]);
    expect(levels.get(viewerShadowId)).toBe(1);

    // The chat DTO carries the level (bounded derivation over the page).
    const listChat = await (await import("@/lib/live/chat")).listChat(roomId, { limit: 5 });
    const mine = listChat.filter((m) => m.senderId === viewerShadowId) as LiveChatMessageDto[];
    expect(mine.length).toBeGreaterThan(0);
    for (const m of mine) expect(m.senderRoomLevel).toBe(1);
  });

  test("a sender with zero activity answers level 0; the map is bounded to the asked ids", async () => {
    const { roomId } = await liveRoom();
    const levels = await roomLevelsFor(roomId, [hostShadowId, viewerShadowId]);
    expect(levels.get(hostShadowId)).toBe(0);
    expect(levels.size).toBe(2);
    const empty = await roomLevelsFor(roomId, []);
    expect(empty.size).toBe(0);
  });

  test("the rate-limit budget exists for pins and announcements", () => {
    expect(RATE_LIMITS.pinManage).toEqual({ limit: 20, windowMs: 60_000 });
    expect(RATE_LIMITS.announcementManage).toEqual({ limit: 20, windowMs: 60_000 });
  });
});
