/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Parity P73 — the safety/discovery/retention pins
 * (ADR-0012).
 *
 * KEYWORD FILTER: the staff gate (anon 401 / viewer 403 on the manager
 * reads), the pattern laws (trim+lowercase, 1..60, cap 50 → 409, idempotent
 * duplicate add), the audited keyword-add/keyword-remove ledger rows, the
 * ENFORCEMENT law (a body containing an active pattern answers the honest
 * 422 flagged — pre-insert, so NOTHING is written; staff bypass does NOT
 * apply; case-insensitive) and the link policy (blockLinks on → any
 * http/https/www body flags; the PATCH toggle is audited).
 * TRENDING: the engagement derivation (reactions + gifts + non-tombstoned
 * chat over the last 24h), top TRENDING_MAX, zero-engagement excluded.
 * GO-LIVE NOTIFY: the fan-out writes kind "live" rows for the host's club
 * members (oldest-first, cap law, host excluded), the (userId, liveRoomId)
 * dedupe on a re-go-live, and the center/bell merge reader answers the
 * rows with the liveRoomId deep link (DB trouble → broker-feed-only).
 *
 * Run: DATABASE_URL=file:../db/live-p73-test.db bun test --isolate tests/live-keywords.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
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
  MOD_CLAIMS,
  OTHER_CLAIMS,
} from "./live-helpers";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import {
  KEYWORDS_PER_ROOM_MAX,
  KEYWORD_MAX,
  TRENDING_MAX,
  TRENDING_WINDOW_MS,
  LIVE_NOTIFY_FANOUT_MAX,
} from "@/lib/live/permissions";
import { sendChat } from "@/lib/live/chat";
import { sendReactionBatch } from "@/lib/live/reactions";
import { sendGift } from "@/lib/live/gifts";
import { flagForBody, URL_PATTERN } from "@/lib/live/keywords";
import { trendingRooms } from "@/lib/live/rooms";
import { fanOutGoLive } from "@/lib/live/notify";
import type { LiveRoomDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let MOD = "";
let OTHER = "";
let hostShadowId = "";
let viewerShadowId = "";
let modShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  MOD = await modCookie();
  OTHER = await otherCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
  modShadowId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
});

function kwUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/keywords`;
}

async function kwRequest(
  cookie: string,
  roomId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  query = "",
): Promise<{ status: number; body: any }> {
  const route = await import("@/app/api/live-rooms/[id]/keywords/route");
  const handler =
    method === "GET"
      ? route.GET
      : method === "POST"
        ? route.POST
        : method === "PATCH"
          ? route.PATCH
          : route.DELETE;
  const res = await handler(
    reqWithCookie(`${kwUrl(roomId)}${query}`, cookie, { method, body }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function liveRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `p73-kw-${crypto.randomUUID().slice(0, 8)}`,
  );
  const modId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
  await db.liveRoomModerator.create({
    data: { roomId, userId: modId, grantedBy: hostShadowId },
  });
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

// ─────────────────────────────────────────────────────────────────────
describe("live keywords — the manager laws", () => {
  test("constants pin", () => {
    expect(KEYWORD_MAX).toBe(60);
    expect(KEYWORDS_PER_ROOM_MAX).toBe(50);
    expect(TRENDING_MAX).toBe(6);
    expect(TRENDING_WINDOW_MS).toBe(24 * 3_600_000);
    expect(LIVE_NOTIFY_FANOUT_MAX).toBe(200);
    expect(URL_PATTERN.test("see http://x.test")).toBe(true);
    expect(URL_PATTERN.test("see https://x.test")).toBe(true);
    expect(URL_PATTERN.test("see www.x.test")).toBe(true);
    expect(URL_PATTERN.test("no link here")).toBe(false);
  });

  test("anon 401 · viewer 403 (manager read) · host adds (trimmed+lowercased) · dup add idempotent", async () => {
    const { roomId } = await liveRoom();
    const anon = await kwRequest("next-auth.session-token=none", roomId, "GET");
    expect(anon.status).toBe(401);
    const viewer = await kwRequest(VIEWER, roomId, "GET");
    expect(viewer.status).toBe(403);
    const added = await kwRequest(HOST, roomId, "POST", { pattern: "  FreeMoney  " });
    expect(added.status).toBe(200);
    expect(added.body.keyword.pattern).toBe("freemoney");
    const dup = await kwRequest(HOST, roomId, "POST", { pattern: "freemoney" });
    expect(dup.status).toBe(200);
    const list = await kwRequest(HOST, roomId, "GET");
    expect(list.body.keywords).toHaveLength(1);
    // Over the char cap → 400; empty → 400.
    const long = await kwRequest(HOST, roomId, "POST", { pattern: "x".repeat(61) });
    expect(long.status).toBe(400);
    const empty = await kwRequest(HOST, roomId, "POST", { pattern: "   " });
    expect(empty.status).toBe(400);
  });

  test("the 50-cap is domain law (409 keyword-cap) and remove is audited", async () => {
    const { roomId } = await liveRoom();
    for (let i = 0; i < KEYWORDS_PER_ROOM_MAX; i++) {
      // The keywordManage budget (30/60s) is a SEPARATE law from the cap —
      // clear it mid-loop so THIS test probes the CAP, not the limiter.
      if (i > 0 && i % 20 === 0) clearRateLimits();
      const res = await kwRequest(HOST, roomId, "POST", {
        pattern: `pattern-${String(i).padStart(2, "0")}`,
      });
      expect(res.status).toBe(200);
    }
    const over = await kwRequest(HOST, roomId, "POST", { pattern: "one-too-many" });
    expect(over.status).toBe(409);
    expect(over.body.message).toBe("keyword-cap");
    // Remove one (audited), then the next add passes.
    const list = await kwRequest(HOST, roomId, "GET");
    const first = list.body.keywords[0];
    const removed = await kwRequest(HOST, roomId, "DELETE", undefined, `?id=${first.id}`);
    expect(removed.status).toBe(200);
    const after = await kwRequest(HOST, roomId, "POST", { pattern: "one-too-many" });
    expect(after.status).toBe(200);
    const ledger = await db.liveModerationAction.findMany({
      where: { roomId, action: { in: ["keyword-add", "keyword-remove"] } },
    });
    expect(ledger.filter((r) => r.action === "keyword-add").length).toBeGreaterThanOrEqual(51);
    expect(ledger.filter((r) => r.action === "keyword-remove")).toHaveLength(1);
  });

  test("blockLinks toggles via PATCH (audited) and rides the policy DTO", async () => {
    const { roomId } = await liveRoom();
    const on = await kwRequest(HOST, roomId, "PATCH", { blockLinks: true });
    expect(on.status).toBe(200);
    expect(on.body.blockLinks).toBe(true);
    const row = await db.liveRoom.findUnique({ where: { id: roomId } });
    expect(row?.blockLinks).toBe(true);
    const off = await kwRequest(HOST, roomId, "PATCH", { blockLinks: false });
    expect(off.body.blockLinks).toBe(false);
    // A non-boolean body → 400.
    const bad = await kwRequest(HOST, roomId, "PATCH", { blockLinks: "yes" });
    expect(bad.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live keywords — the enforcement law (the honest 422)", () => {
  test("a pattern match answers 422 flagged and writes NOTHING (pre-insert); staff included", async () => {
    const { roomId } = await liveRoom();
    await kwRequest(HOST, roomId, "POST", { pattern: "freesomething" });
    const before = await db.liveRoomMessage.count({ where: { roomId } });
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    const flagged = await sendChat(roomId, viewer, {
      body: "check FREEsomething now",
      clientMessageId: "kwflag0001",
    }).catch((err) => err);
    expect(flagged).toBeInstanceOf(Error);
    expect((flagged as Error).message).toContain("flagged by the room's keyword filter");
    // Nothing written — the pre-insert law.
    expect(await db.liveRoomMessage.count({ where: { roomId } })).toBe(before);
    // Staff bypass does NOT apply (they wrote the filter).
    const hostFlagged = await sendChat(roomId, sessionUserOf(HOST_CLAIMS), {
      body: "FreeSomething",
      clientMessageId: "kwflag0002",
    }).catch((err) => err);
    expect(hostFlagged).toBeInstanceOf(Error);
    // A clean body passes and lands.
    const ok = await sendChat(roomId, viewer, {
      body: "clean message",
      clientMessageId: "kwok00001",
    });
    expect(ok.message.body).toBe("clean message");
  });

  test("blockLinks on → any http/https/www body flags; off → links pass", async () => {
    const { roomId } = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    const pass = await sendChat(roomId, viewer, {
      body: "look at https://example.test/video",
      clientMessageId: "linkpass001",
    });
    expect(pass.message.body).toContain("https://");
    await kwRequest(HOST, roomId, "PATCH", { blockLinks: true });
    const flagged = await sendChat(roomId, viewer, {
      body: "look at https://example.test/video",
      clientMessageId: "linkflag001",
    }).catch((err) => err);
    expect(flagged).toBeInstanceOf(Error);
    expect((flagged as Error).message).toContain("links are blocked");
    const www = await sendChat(roomId, viewer, {
      body: "go to www.example.test now",
      clientMessageId: "linkflag002",
    }).catch((err) => err);
    expect(www).toBeInstanceOf(Error);
  });

  test("flagForBody is a pure function: case-insensitive substring, no patterns → pass", () => {
    expect(flagForBody("Hello FREE money", ["free money"], false)).toBe(
      "flagged by the room's keyword filter",
    );
    expect(flagForBody("hello", [], false)).toBeNull();
    expect(flagForBody("hello http://x", [], true)).toBe("links are blocked in this room");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live trending — the engagement derivation", () => {
  test("ranks by 24h engagement, excludes zero-engagement rooms, caps at TRENDING_MAX", async () => {
    const hot = await liveRoom();
    const mid = await liveRoom();
    const quiet = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    // hot: 100 hearts + 10 credits + 2 chat = 112 engagement
    await sendReactionBatch(hot.roomId, viewer, { clientBatchId: "trend-h0001", count: 100 });
    await sendGift(hot.roomId, viewer, {
      giftItemId: "spark-cheer",
      quantity: 2,
      clientRequestId: "trend-hgift1",
    });
    await sendChat(hot.roomId, viewer, { body: "hot one", clientMessageId: "trend-hc0001" });
    await sendChat(hot.roomId, viewer, { body: "hot two", clientMessageId: "trend-hc0002" });
    // mid: 40 hearts only
    await sendReactionBatch(mid.roomId, viewer, { clientBatchId: "trend-m0001", count: 40 });
    // quiet: NOTHING (must be excluded even though it is live+public)
    const { rooms } = await trendingRooms(null);
    const ids = rooms.map((r: LiveRoomDto) => r.id);
    expect(ids.indexOf(hot.roomId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(mid.roomId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(quiet.roomId)).toBe(-1);
    expect(ids.indexOf(hot.roomId)).toBeLessThan(ids.indexOf(mid.roomId));
    expect(rooms.length).toBeLessThanOrEqual(TRENDING_MAX);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live notify — the go-live fan-out + the merge reader", () => {
  test("fans out kind-live rows to the host's club members (host excluded, dedupe on re-go-live)", async () => {
    // The host needs a club with members.
    const { roomId } = await liveRoom();
    const { createClub, joinClub } = await import("@/lib/live/clubs");
    const host = sessionUserOf(HOST_CLAIMS);
    try {
      await createClub(host, { name: `Notify Club ${crypto.randomUUID().slice(0, 6)}` });
    } catch {
      // The host identity may already own a club from an earlier run — fine.
    }
    await joinClub(sessionUserOf(VIEWER_CLAIMS), hostShadowId);
    await joinClub(sessionUserOf(MOD_CLAIMS), hostShadowId);
    await joinClub(sessionUserOf(OTHER_CLAIMS), hostShadowId);
    const created = await fanOutGoLive(roomId, hostShadowId);
    expect(created).toBe(3); // viewer + mod + other; the host never notifies self
    const rows = await db.notification.findMany({ where: { liveRoomId: roomId } });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.kind).toBe("live");
      expect(row.read).toBe(false);
      expect(row.userId).not.toBe(hostShadowId);
    }
    // The re-go-live dedupe: zero new rows.
    const again = await fanOutGoLive(roomId, hostShadowId);
    expect(again).toBe(0);
    expect(await db.notification.findMany({ where: { liveRoomId: roomId } })).toHaveLength(3);
  });

  test("the merge reader answers the caller's unread rows with the liveRoomId deep link", async () => {
    const { roomId } = await liveRoom();
    await fanOutGoLive(roomId, hostShadowId);
    const { localLiveNotifications } = await import("@/lib/notifications/live-merge");
    const local = await localLiveNotifications(viewerShadowId);
    expect(local.length).toBeGreaterThanOrEqual(1);
    const mine = local.find((n) => n.liveRoomId === roomId);
    expect(mine).toBeTruthy();
    expect(mine?.kind).toBe("live");
    expect(mine?.videoId).toBeNull();
    expect(mine?.channel.handle.length).toBeGreaterThan(0);
    // Mark read → the reader stops answering them (the honest unread law).
    await db.notification.updateMany({
      where: { liveRoomId: roomId, userId: viewerShadowId },
      data: { read: true },
    });
    const after = await localLiveNotifications(viewerShadowId);
    expect(after.find((n) => n.liveRoomId === roomId)).toBeUndefined();
  });

  test("a host without a club fans out honestly zero (no community to notify)", async () => {
    const { roomId } = await createRoomFixture(
      sessionUserOf(OTHER_CLAIMS),
      `p73-noclub-${crypto.randomUUID().slice(0, 6)}`,
    );
    const otherHostShadowId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
    const created = await fanOutGoLive(roomId, otherHostShadowId);
    expect(created).toBe(0);
  });
});
