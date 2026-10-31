/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — lane 2-b SAFETY behavior pins (reports).
 *
 * Viewer reports against the REAL route handler (called directly, no
 * network): anonymous 401, the frozen reason vocabulary, detail bounds,
 * in-room messageId law (foreign room → 404), the reporter rate limit 429,
 * the host-only report queue (moderator/viewer 403), resolved reporter
 * handles, and room scoping (another room's reports never leak).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRateLimits } from "@/lib/youtube/cache";
import { shadowUserId } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import {
  POST as reportsPost,
  GET as reportsGet,
} from "@/app/api/live-rooms/[id]/reports/route";
import { POST as moderatorsPost } from "@/app/api/live-rooms/[id]/moderators/route";
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

setupLiveDb();

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const HOST_ID = shadowUserId(HOST_CLAIMS.sub);
const VIEWER_ID = shadowUserId(VIEWER_CLAIMS.sub);
const MOD_ID = shadowUserId(MOD_CLAIMS.sub);
const OTHER_ID = shadowUserId(OTHER_CLAIMS.sub);

let host = "";
let viewer = "";
let mod = "";
let other = "";

beforeAll(async () => {
  host = await hostCookie();
  viewer = await viewerCookie();
  mod = await modCookie();
  other = await otherCookie();
  const { ensureShadowUser } = await import("@/lib/watch/local-comments");
  for (const claims of [HOST_CLAIMS, VIEWER_CLAIMS, MOD_CLAIMS, OTHER_CLAIMS]) {
    await ensureShadowUser(sessionUserOf(claims));
  }
});

// Report budget (5 / 10 min per room+reporter) resets between tests; the
// 429 test does its own hammering inside one test body.
beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

// ── helpers ─────────────────────────────────────────────────────────
const reportsUrl = (roomId: string) => `http://localhost/api/live-rooms/${roomId}/reports`;

async function freshRoom(): Promise<{ roomId: string; hostShadowId: string }> {
  return createRoomFixture(sessionUserOf(HOST_CLAIMS));
}

function reportRequest(roomId: string, cookie: string, body: unknown): Promise<Response> {
  return reportsPost(
    reqWithCookie(reportsUrl(roomId), cookie, { method: "POST", body }),
    ctx(roomId),
  );
}

function listRequest(roomId: string, cookie: string, query = ""): Promise<Response> {
  return reportsGet(
    reqWithCookie(`${reportsUrl(roomId)}${query}`, cookie, { method: "GET" }),
    ctx(roomId),
  );
}

async function insertMessage(roomId: string, senderId: string, body = "reportable words") {
  const session = await startSessionFixture(roomId);
  return db.liveRoomMessage.create({
    data: {
      roomId,
      sessionId: session.sessionId,
      senderId,
      clientMessageId: `cm-${crypto.randomUUID()}`,
      body,
      kind: "chat",
    },
  });
}

// ── create ──────────────────────────────────────────────────────────
describe("create report", () => {
  test("anonymous POST is 401 unauthenticated", async () => {
    const { roomId } = await freshRoom();
    const res = await reportsPost(
      new Request(reportsUrl(roomId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "spam" }),
      }),
      ctx(roomId),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, string>).error).toBe("unauthenticated");
  });

  test("invalid reason → 400 (vocabulary is exact-match)", async () => {
    const { roomId } = await freshRoom();
    for (const reason of ["violence", "Spam", ""]) {
      const res = await reportRequest(roomId, viewer, { reason });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Record<string, string>).error).toBe("invalid");
    }
    expect((await reportRequest(roomId, viewer, {})).status).toBe(400);
  });

  test("detail over 1000 chars → 400", async () => {
    const { roomId } = await freshRoom();
    const res = await reportRequest(roomId, viewer, {
      reason: "spam",
      detail: "x".repeat(1001),
    });
    expect(res.status).toBe(400);
  });

  test("valid create → DTO with status open, trimmed detail, resolved reporter handle", async () => {
    const { roomId } = await freshRoom();
    const res = await reportRequest(roomId, viewer, {
      reason: "spam",
      detail: "  flooding the chat with links  ",
      targetId: OTHER_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: Record<string, unknown> };
    expect(body.report.id).toBeTruthy();
    expect(body.report.roomId).toBe(roomId);
    expect(body.report.reporterId).toBe(VIEWER_ID);
    expect(body.report.reporterHandle).not.toBe("");
    expect(body.report.targetId).toBe(OTHER_ID);
    expect(body.report.reason).toBe("spam");
    expect(body.report.detail).toBe("flooding the chat with links");
    expect(body.report.status).toBe("open");
    expect(typeof body.report.createdAt).toBe("string");
    // the row is on disk as "open"
    const row = await db.liveReport.findUniqueOrThrow({
      where: { id: String(body.report.id) },
    });
    expect(row.status).toBe("open");
    expect(row.reporterId).toBe(VIEWER_ID);
  });

  test("reporting an off-platform (non-existent) targetId is allowed", async () => {
    const { roomId } = await freshRoom();
    const res = await reportRequest(roomId, viewer, {
      reason: "other",
      targetId: "ext-some-off-platform-actor",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: Record<string, unknown> };
    expect(body.report.targetId).toBe("ext-some-off-platform-actor");
  });

  test("messageId must belong to THIS room: in-room 200, foreign room 404", async () => {
    const { roomId } = await freshRoom();
    const otherRoom = await freshRoom();
    const inRoom = await insertMessage(roomId, OTHER_ID, "spam link");
    const foreign = await insertMessage(otherRoom.roomId, OTHER_ID, "not here");

    const ok = await reportRequest(roomId, viewer, { reason: "spam", messageId: inRoom.id });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { report: Record<string, unknown> }).report.messageId).toBe(
      inRoom.id,
    );

    const bad = await reportRequest(roomId, viewer, { reason: "spam", messageId: foreign.id });
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as Record<string, string>).error).toBe("not-found");
  });

  test("reporter rate limit: the 6th report in the window is 429 rate-limited", async () => {
    const { roomId } = await freshRoom();
    for (let i = 0; i < 5; i++) {
      const res = await reportRequest(roomId, other, { reason: "other", detail: `report ${i}` });
      expect(res.status).toBe(200);
    }
    const blocked = await reportRequest(roomId, other, { reason: "other", detail: "one too many" });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as Record<string, string>).error).toBe("rate-limited");
  });
});

// ── host-only list ──────────────────────────────────────────────────
describe("report queue (host-only)", () => {
  test("moderator 403, viewer 403, host 200", async () => {
    const { roomId } = await freshRoom();
    // grant the moderator via the moderators route
    const granted = await moderatorsPost(
      reqWithCookie(
        `http://localhost/api/live-rooms/${roomId}/moderators`,
        host,
        { method: "POST", body: { userId: MOD_ID } },
      ),
      ctx(roomId),
    );
    expect(granted.status).toBe(200);

    expect((await listRequest(roomId, mod)).status).toBe(403);
    expect((await listRequest(roomId, viewer)).status).toBe(403);
    expect((await listRequest(roomId, host)).status).toBe(200);
  });

  test("list is newest first, resolves reporter handles, honors limit", async () => {
    const { roomId } = await freshRoom();
    const first = await reportRequest(roomId, viewer, { reason: "spam", detail: "first" });
    expect(first.status).toBe(200);
    await Bun.sleep(15);
    const second = await reportRequest(roomId, other, { reason: "harassment", detail: "second" });
    expect(second.status).toBe(200);

    const list = await listRequest(roomId, host);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { reports: Array<Record<string, unknown>> };
    expect(body.reports).toHaveLength(2);
    expect(body.reports.map((r) => r.reason)).toEqual(["harassment", "spam"]);
    expect(body.reports[0].detail).toBe("second");
    expect(body.reports[0].reporterId).toBe(OTHER_ID);
    expect(body.reports[0].reporterHandle).not.toBe("");
    expect(body.reports[1].reporterId).toBe(VIEWER_ID);
    expect(body.reports[1].reporterHandle).not.toBe("");

    const limited = await listRequest(roomId, host, "?limit=1");
    const limitedBody = (await limited.json()) as { reports: Array<Record<string, unknown>> };
    expect(limitedBody.reports).toHaveLength(1);
    expect(limitedBody.reports[0].reason).toBe("harassment");
  });

  test("another room's reports never leak into this room's queue", async () => {
    const { roomId } = await freshRoom();
    const otherRoom = await freshRoom();
    expect((await reportRequest(roomId, viewer, { reason: "spam" })).status).toBe(200);
    expect((await reportRequest(roomId, other, { reason: "inappropriate" })).status).toBe(200);
    expect((await reportRequest(otherRoom.roomId, viewer, { reason: "other" })).status).toBe(200);

    const list = await listRequest(roomId, host);
    const body = (await list.json()) as { reports: Array<Record<string, unknown>> };
    expect(body.reports).toHaveLength(2);
    for (const report of body.reports) {
      expect(report.roomId).toBe(roomId);
    }
    // the other room's host sees only its own report
    const otherList = await listRequest(otherRoom.roomId, host);
    const otherBody = (await otherList.json()) as { reports: Array<Record<string, unknown>> };
    expect(otherBody.reports).toHaveLength(1);
    expect(otherBody.reports[0].roomId).toBe(otherRoom.roomId);
    expect(otherBody.reports[0].reason).toBe("other");
  });
});
