/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — lane 2-b SAFETY behavior pins.
 *
 * Moderation actions + moderator grants against the REAL route handlers
 * (called directly, no network — tests/live-helpers.ts law) on the shared
 * live-test.db. Pins: the full authorization matrix (anonymous 401, viewer
 * 403, moderator capability set, host-only policy actions, the untouchable
 * host), ledger-derived sanction state (timed mute expiry, unmute/unban),
 * delete-message tombstones (row survives, foreign room 404), validation
 * bounds, the exactly-one-audit-row law, the moderation 429, and the
 * newest-first audit list with resolved handles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRateLimits } from "@/lib/youtube/cache";
import { activeSanctions } from "@/lib/live/permissions";
import { shadowUserId } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import {
  POST as moderationPost,
  GET as moderationGet,
} from "@/app/api/live-rooms/[id]/moderation/route";
import {
  POST as moderatorsPost,
  DELETE as moderatorsDelete,
} from "@/app/api/live-rooms/[id]/moderators/route";
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

// The shadow ids (the live identity seam: every room-side id is wf-<sub>).
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
  // Ensure the shadow User rows exist up front so handle resolution is
  // deterministic in every test (handles resolve "" for missing rows).
  const { ensureShadowUser } = await import("@/lib/watch/local-comments");
  for (const claims of [HOST_CLAIMS, VIEWER_CLAIMS, MOD_CLAIMS, OTHER_CLAIMS]) {
    await ensureShadowUser(sessionUserOf(claims));
  }
});

// Rate-limit isolation between tests (the 429 test does its own hammering).
beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

// ── helpers ─────────────────────────────────────────────────────────
const modUrl = (roomId: string) => `http://localhost/api/live-rooms/${roomId}/moderation`;
const modsUrl = (roomId: string) => `http://localhost/api/live-rooms/${roomId}/moderators`;

async function freshRoom(): Promise<{ roomId: string; hostShadowId: string }> {
  return createRoomFixture(sessionUserOf(HOST_CLAIMS));
}

function modRequest(roomId: string, cookie: string, body: unknown): Promise<Response> {
  return moderationPost(
    reqWithCookie(modUrl(roomId), cookie, { method: "POST", body }),
    ctx(roomId),
  );
}

function auditRequest(roomId: string, cookie: string, query = ""): Promise<Response> {
  return moderationGet(
    reqWithCookie(`${modUrl(roomId)}${query}`, cookie, { method: "GET" }),
    ctx(roomId),
  );
}

function grantRequest(roomId: string, cookie: string, body: unknown): Promise<Response> {
  return moderatorsPost(
    reqWithCookie(modsUrl(roomId), cookie, { method: "POST", body }),
    ctx(roomId),
  );
}

function revokeRequest(roomId: string, cookie: string, body: unknown): Promise<Response> {
  return moderatorsDelete(
    reqWithCookie(modsUrl(roomId), cookie, { method: "DELETE", body }),
    ctx(roomId),
  );
}

async function grantMod(roomId: string): Promise<void> {
  const res = await grantRequest(roomId, host, { userId: MOD_ID });
  expect(res.status).toBe(200);
}

/** Insert a durable chat message directly (the lane-2-a row shape). */
async function insertMessage(roomId: string, senderId: string, body = "a chat message") {
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

async function roomRow(roomId: string) {
  return db.liveRoom.findUniqueOrThrow({ where: { id: roomId } });
}

// ── authorization matrix ────────────────────────────────────────────
describe("moderation authorization matrix", () => {
  test("anonymous POST is 401 unauthenticated", async () => {
    const { roomId } = await freshRoom();
    const res = await moderationPost(
      new Request(modUrl(roomId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mute", targetId: VIEWER_ID }),
      }),
      ctx(roomId),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, string>).error).toBe("unauthenticated");
  });

  test("anonymous GET (audit) is 401", async () => {
    const { roomId } = await freshRoom();
    const res = await moderationGet(new Request(modUrl(roomId)), ctx(roomId));
    expect(res.status).toBe(401);
  });

  test("viewer cannot moderate (403 forbidden)", async () => {
    const { roomId } = await freshRoom();
    const res = await modRequest(roomId, viewer, { action: "mute", targetId: OTHER_ID });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Record<string, string>).error).toBe("forbidden");
  });

  test("moderator CAN mute/unmute/ban/unban/delete-message", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);

    const mute = await modRequest(roomId, mod, {
      action: "mute",
      targetId: OTHER_ID,
      reason: "spamming",
      expiresInSeconds: 300,
    });
    expect(mute.status).toBe(200);
    const muteBody = (await mute.json()) as Record<string, Record<string, unknown>>;
    expect(muteBody.action.action).toBe("mute");
    expect(muteBody.action.targetId).toBe(OTHER_ID);
    expect(muteBody.action.actorId).toBe(MOD_ID);
    expect(muteBody.action.targetHandle).not.toBe("");
    expect(muteBody.action.actorHandle).not.toBe("");
    expect(muteBody.action.reason).toBe("spamming");
    expect(muteBody.action.expiresAt).not.toBeNull();

    expect(
      (await modRequest(roomId, mod, { action: "unmute", targetId: OTHER_ID })).status,
    ).toBe(200);
    expect(
      (await modRequest(roomId, mod, { action: "ban", targetId: OTHER_ID, reason: "raid" }))
        .status,
    ).toBe(200);
    expect((await modRequest(roomId, mod, { action: "unban", targetId: OTHER_ID })).status).toBe(
      200,
    );

    const message = await insertMessage(roomId, OTHER_ID);
    const del = await modRequest(roomId, mod, {
      action: "delete-message",
      messageId: message.id,
      reason: "abuse",
    });
    expect(del.status).toBe(200);
    expect(((await del.json()) as Record<string, Record<string, unknown>>).action.messageId).toBe(
      message.id,
    );
  });

  test("moderator CANNOT slow-mode / chat-disable / chat-enable (host-only, 403)", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    for (const body of [
      { action: "slow-mode", slowModeSeconds: 30 },
      { action: "chat-disable" },
      { action: "chat-enable" },
    ]) {
      const res = await modRequest(roomId, mod, body);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Record<string, string>).error).toBe("forbidden");
    }
    // policy untouched
    const room = await roomRow(roomId);
    expect(room.slowModeSeconds).toBe(0);
    expect(room.chatEnabled).toBe(true);
  });

  test("moderator CANNOT grant or revoke moderators (403)", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    expect((await grantRequest(roomId, mod, { userId: OTHER_ID })).status).toBe(403);
    expect((await revokeRequest(roomId, mod, { userId: OTHER_ID })).status).toBe(403);
  });

  test("nobody can mute or ban the host — 403 for host AND moderator actors", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    expect(
      (await modRequest(roomId, host, { action: "mute", targetId: HOST_ID })).status,
    ).toBe(403);
    expect(
      (await modRequest(roomId, mod, { action: "mute", targetId: HOST_ID })).status,
    ).toBe(403);
    expect((await modRequest(roomId, host, { action: "ban", targetId: HOST_ID })).status).toBe(
      403,
    );
    expect((await modRequest(roomId, mod, { action: "ban", targetId: HOST_ID })).status).toBe(
      403,
    );
  });

  test("unmute against the host succeeds as an idempotent no-op (the frozen guard list is mute/ban/unban)", async () => {
    // Judgment call, pinned: the contract guards mute + ban/unban against
    // the host; unmute is not in that list and can never create a sanction
    // (it only ever resolves to "not muted"), so it records intent.
    const { roomId } = await freshRoom();
    expect(
      (await modRequest(roomId, host, { action: "unmute", targetId: HOST_ID })).status,
    ).toBe(200);
  });
});

// ── sanction state derives from the ledger ──────────────────────────
describe("sanction state derives from the append-only ledger", () => {
  test("a 1s mute shows mutedUntil, then null after ~1.1s (timed expiry)", async () => {
    const { roomId } = await freshRoom();
    const res = await modRequest(roomId, host, {
      action: "mute",
      targetId: VIEWER_ID,
      expiresInSeconds: 1,
    });
    expect(res.status).toBe(200);

    const during = await activeSanctions(roomId, VIEWER_ID);
    expect(during.mutedUntil).not.toBeNull();
    expect(during.mutedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(during.banned).toBe(false);

    await Bun.sleep(1100);
    const after = await activeSanctions(roomId, VIEWER_ID);
    expect(after.mutedUntil).toBeNull();
    expect(after.banned).toBe(false);
  });

  test("unmute after a mute clears the derived state", async () => {
    const { roomId } = await freshRoom();
    expect(
      (
        await modRequest(roomId, host, {
          action: "mute",
          targetId: VIEWER_ID,
          expiresInSeconds: 600,
        })
      ).status,
    ).toBe(200);
    expect((await activeSanctions(roomId, VIEWER_ID)).mutedUntil).not.toBeNull();

    expect((await modRequest(roomId, host, { action: "unmute", targetId: VIEWER_ID })).status).toBe(
      200,
    );
    const s = await activeSanctions(roomId, VIEWER_ID);
    expect(s.mutedUntil).toBeNull();
    expect(s.banned).toBe(false);
  });

  test("ban then unban flips the derived ban state", async () => {
    const { roomId } = await freshRoom();
    expect((await modRequest(roomId, host, { action: "ban", targetId: OTHER_ID })).status).toBe(
      200,
    );
    const banned = await activeSanctions(roomId, OTHER_ID);
    expect(banned.banned).toBe(true);

    expect((await modRequest(roomId, host, { action: "unban", targetId: OTHER_ID })).status).toBe(
      200,
    );
    const unbanned = await activeSanctions(roomId, OTHER_ID);
    expect(unbanned.banned).toBe(false);
  });

  test("unmute/unban without a prior sanction still succeed and still append (ledger records intent)", async () => {
    const { roomId } = await freshRoom();
    const before = await db.liveModerationAction.count({ where: { roomId } });
    expect((await modRequest(roomId, host, { action: "unmute", targetId: VIEWER_ID })).status).toBe(
      200,
    );
    expect((await modRequest(roomId, host, { action: "unban", targetId: VIEWER_ID })).status).toBe(
      200,
    );
    expect(await db.liveModerationAction.count({ where: { roomId } })).toBe(before + 2);
    const s = await activeSanctions(roomId, VIEWER_ID);
    expect(s.banned).toBe(false);
    expect(s.mutedUntil).toBeNull();
  });
});

// ── validation bounds ───────────────────────────────────────────────
describe("moderation validation", () => {
  test("unknown kind → 400 invalid", async () => {
    const { roomId } = await freshRoom();
    const res = await modRequest(roomId, host, { action: "nuke-room" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, string>).error).toBe("invalid");
  });

  test("mute/ban without targetId → 400; delete-message without messageId → 400", async () => {
    const { roomId } = await freshRoom();
    expect((await modRequest(roomId, host, { action: "mute" })).status).toBe(400);
    expect((await modRequest(roomId, host, { action: "ban" })).status).toBe(400);
    expect((await modRequest(roomId, host, { action: "delete-message" })).status).toBe(400);
  });

  test("mute: default 600s applies; expiresInSeconds out of range → 400", async () => {
    const { roomId } = await freshRoom();
    const ok = await modRequest(roomId, host, { action: "mute", targetId: VIEWER_ID });
    expect(ok.status).toBe(200);
    const dto = ((await ok.json()) as Record<string, Record<string, unknown>>).action;
    const deltaMs = Date.parse(String(dto.expiresAt)) - Date.now();
    expect(deltaMs).toBeGreaterThan(590_000);
    expect(deltaMs).toBeLessThanOrEqual(600_500);

    for (const bad of [0, -5, 86_401]) {
      expect(
        (await modRequest(roomId, host, { action: "mute", targetId: OTHER_ID, expiresInSeconds: bad }))
          .status,
      ).toBe(400);
    }
  });

  test("slow-mode out of range → 400; in range 0..300 accepted", async () => {
    const { roomId } = await freshRoom();
    for (const bad of [-1, 301]) {
      expect(
        (await modRequest(roomId, host, { action: "slow-mode", slowModeSeconds: bad })).status,
      ).toBe(400);
    }
    expect((await modRequest(roomId, host, { action: "slow-mode" })).status).toBe(400);
    expect((await modRequest(roomId, host, { action: "slow-mode", slowModeSeconds: 300 })).status).toBe(
      200,
    );
    expect((await roomRow(roomId)).slowModeSeconds).toBe(300);
  });

  test("reason over 280 chars → 400", async () => {
    const { roomId } = await freshRoom();
    const res = await modRequest(roomId, host, {
      action: "ban",
      targetId: OTHER_ID,
      reason: "x".repeat(281),
    });
    expect(res.status).toBe(400);
  });
});

// ── room policy (host-only) ─────────────────────────────────────────
describe("room policy flips (host-only)", () => {
  test("slow-mode updates the room column; chat-disable/enable flip chatEnabled", async () => {
    const { roomId } = await freshRoom();
    expect((await modRequest(roomId, host, { action: "slow-mode", slowModeSeconds: 30 })).status).toBe(
      200,
    );
    expect((await roomRow(roomId)).slowModeSeconds).toBe(30);
    expect((await modRequest(roomId, host, { action: "slow-mode", slowModeSeconds: 0 })).status).toBe(
      200,
    );
    expect((await roomRow(roomId)).slowModeSeconds).toBe(0);

    expect((await modRequest(roomId, host, { action: "chat-disable", reason: "raid" })).status).toBe(
      200,
    );
    expect((await roomRow(roomId)).chatEnabled).toBe(false);
    expect((await modRequest(roomId, host, { action: "chat-enable" })).status).toBe(200);
    expect((await roomRow(roomId)).chatEnabled).toBe(true);
  });
});

// ── delete-message tombstones ───────────────────────────────────────
describe("delete-message tombstones", () => {
  test("tombstones the message — the row survives with body + deletedAt + deletedBy", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    const message = await insertMessage(roomId, VIEWER_ID, "very rude words");
    const res = await modRequest(roomId, mod, {
      action: "delete-message",
      messageId: message.id,
      reason: "rude",
    });
    expect(res.status).toBe(200);

    const row = await db.liveRoomMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.body).toBe("very rude words"); // body preserved (audit law)
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(MOD_ID);
  });

  test("a foreign-room messageId is 404 and stays untouched", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    const otherRoom = await freshRoom();
    const message = await insertMessage(otherRoom.roomId, VIEWER_ID, "not in this room");

    const res = await modRequest(roomId, mod, {
      action: "delete-message",
      messageId: message.id,
    });
    expect(res.status).toBe(404);

    const row = await db.liveRoomMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.deletedBy).toBeNull();
  });
});

// ── the append-only audit law ───────────────────────────────────────
describe("every successful call appends exactly one action row", () => {
  test("one row per successful moderation, never more", async () => {
    const { roomId } = await freshRoom();
    const count = () => db.liveModerationAction.count({ where: { roomId } });
    let expected = await count();

    const calls: Array<Record<string, unknown>> = [
      { action: "mute", targetId: VIEWER_ID, expiresInSeconds: 60 },
      { action: "unmute", targetId: VIEWER_ID },
      { action: "ban", targetId: VIEWER_ID },
      { action: "unban", targetId: VIEWER_ID },
      { action: "slow-mode", slowModeSeconds: 5 },
      { action: "chat-disable" },
      { action: "chat-enable" },
    ];
    for (const body of calls) {
      const res = await modRequest(roomId, host, body);
      expect(res.status).toBe(200);
      expected += 1;
      expect(await count()).toBe(expected);
    }

    const message = await insertMessage(roomId, VIEWER_ID);
    const del = await modRequest(roomId, host, {
      action: "delete-message",
      messageId: message.id,
    });
    expect(del.status).toBe(200);
    expected += 1;
    expect(await count()).toBe(expected);
  });

  test("failed calls append nothing", async () => {
    const { roomId } = await freshRoom();
    const count = () => db.liveModerationAction.count({ where: { roomId } });
    const before = await count();
    expect((await modRequest(roomId, viewer, { action: "ban", targetId: VIEWER_ID })).status).toBe(
      403,
    );
    expect((await modRequest(roomId, host, { action: "mute", targetId: HOST_ID })).status).toBe(
      403,
    );
    expect((await modRequest(roomId, host, { action: "nope" })).status).toBe(400);
    expect(await count()).toBe(before);
  });
});

// ── rate limit ──────────────────────────────────────────────────────
describe("moderation rate limit", () => {
  test("the 61st moderation call inside the window is 429 rate-limited", async () => {
    const { roomId } = await freshRoom();
    for (let i = 0; i < 60; i++) {
      const res = await modRequest(roomId, host, { action: "unmute", targetId: VIEWER_ID });
      expect(res.status).toBe(200);
    }
    const blocked = await modRequest(roomId, host, { action: "unmute", targetId: VIEWER_ID });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as Record<string, string>).error).toBe("rate-limited");
  });
});

// ── audit list ──────────────────────────────────────────────────────
describe("audit trail list", () => {
  test("newest first, handles resolved, limit clamps", async () => {
    const { roomId } = await freshRoom();
    await modRequest(roomId, host, { action: "mute", targetId: VIEWER_ID, reason: "first" });
    await Bun.sleep(15);
    await modRequest(roomId, host, { action: "unmute", targetId: VIEWER_ID, reason: "second" });
    await Bun.sleep(15);
    await modRequest(roomId, host, { action: "ban", targetId: OTHER_ID, reason: "third" });

    const list = await auditRequest(roomId, host);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { actions: Array<Record<string, unknown>> };
    expect(body.actions.map((a) => a.action)).toEqual(["ban", "unmute", "mute"]);
    expect(body.actions[0].actorId).toBe(HOST_ID);
    expect(body.actions[0].actorHandle).not.toBe("");
    expect(body.actions[0].targetId).toBe(OTHER_ID);
    expect(body.actions[0].targetHandle).not.toBe("");
    expect(body.actions[0].reason).toBe("third");

    const limited = await auditRequest(roomId, host, "?limit=2");
    expect(limited.status).toBe(200);
    const limitedBody = (await limited.json()) as { actions: Array<Record<string, unknown>> };
    expect(limitedBody.actions.map((a) => a.action)).toEqual(["ban", "unmute"]);
  });

  test("moderator can read the audit list; viewer cannot (403)", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    expect((await auditRequest(roomId, mod)).status).toBe(200);
    expect((await auditRequest(roomId, viewer)).status).toBe(403);
  });
});

// ── moderator grants ────────────────────────────────────────────────
describe("moderator grant ledger", () => {
  test("grant → re-grant (upsert) → revoke → capability drop → re-grant re-activates", async () => {
    const { roomId } = await freshRoom();
    const grantCount = () => db.liveRoomModerator.count({ where: { roomId, userId: MOD_ID } });

    const granted = (await (await grantRequest(roomId, host, { userId: MOD_ID })).json()) as {
      moderator: Record<string, unknown>;
    };
    expect(granted.moderator).toMatchObject({
      roomId,
      userId: MOD_ID,
      grantedBy: HOST_ID,
      revokedAt: null,
      revokedBy: null,
    });
    expect(typeof granted.moderator.createdAt).toBe("string");
    expect(await grantCount()).toBe(1);

    // re-grant while active → still exactly one row (upsert, not insert)
    expect((await grantRequest(roomId, host, { userId: MOD_ID })).status).toBe(200);
    expect(await grantCount()).toBe(1);

    // revoke — soft, the ledger row survives
    const revoked = (await (await revokeRequest(roomId, host, { userId: MOD_ID })).json()) as {
      moderator: Record<string, unknown>;
    };
    expect(revoked.moderator.revokedAt).not.toBeNull();
    expect(revoked.moderator.revokedBy).toBe(HOST_ID);
    expect(revoked.moderator.grantedBy).toBe(HOST_ID);
    expect(await grantCount()).toBe(1);

    // the revoked moderator loses the capability immediately
    expect((await modRequest(roomId, mod, { action: "mute", targetId: OTHER_ID })).status).toBe(
      403,
    );

    // double revoke → 404 (no active grant)
    expect((await revokeRequest(roomId, host, { userId: MOD_ID })).status).toBe(404);

    // re-grant re-activates the SAME row
    const reGrant = await grantRequest(roomId, host, { userId: MOD_ID });
    expect(reGrant.status).toBe(200);
    const reGrantBody = (await reGrant.json()) as { moderator: Record<string, unknown> };
    expect(reGrantBody.moderator.revokedAt).toBeNull();
    expect(reGrantBody.moderator.revokedBy).toBeNull();
    expect(await grantCount()).toBe(1);
    expect((await modRequest(roomId, mod, { action: "mute", targetId: OTHER_ID })).status).toBe(
      200,
    );
  });

  test("grant validation: unknown user 404, host target 403, missing userId 400; revoke of never-granted 404", async () => {
    const { roomId } = await freshRoom();
    expect((await grantRequest(roomId, host, { userId: "wf-no-such-user" })).status).toBe(404);
    expect((await grantRequest(roomId, host, { userId: HOST_ID })).status).toBe(403);
    expect((await grantRequest(roomId, host, {})).status).toBe(400);
    expect((await revokeRequest(roomId, host, { userId: OTHER_ID })).status).toBe(404);
  });

  test("DELETE accepts ?userId= as the curl-friendly fallback", async () => {
    const { roomId } = await freshRoom();
    await grantMod(roomId);
    const res = await moderatorsDelete(
      new Request(`${modsUrl(roomId)}?userId=${MOD_ID}`, {
        method: "DELETE",
        headers: { cookie: host },
      }),
      ctx(roomId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moderator: Record<string, unknown> };
    expect(body.moderator.userId).toBe(MOD_ID);
    expect(body.moderator.revokedAt).not.toBeNull();
  });
});
