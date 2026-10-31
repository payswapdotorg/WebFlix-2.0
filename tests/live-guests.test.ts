/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 lane 3-a — the guest-stage pins.
 *
 * Pins (docs/plans/wfx2-live-phase-3-contracts.md, work order §4D): the
 * create gates (unauthenticated/forbidden/guests-disabled/banned/429), the
 * pair dedupe (invite-pending), the stage cap (stage-full, removed rows
 * never occupy), the lazy expiry sweep (list + respond), the responder law
 * (host-invites answered by the invitee, guest-requests by the host), the
 * accept flow (participant rung upsert + acceptedGuestInvite seam), cancel
 * authority, the public stage board (host tile → guest tile → removed
 * state), and honest idle/not-live behavior. Every room is fresh (unique
 * titles), so no cross-file or cross-lane state is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  endSessionFixture,
  hostCookie,
  modCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { GET as getInvites, POST as postInvites } from "@/app/api/live-rooms/[id]/invites/route";
import { POST as postRespond } from "@/app/api/live-rooms/[id]/invites/[inviteId]/respond/route";
import { DELETE as deleteInvite } from "@/app/api/live-rooms/[id]/invites/[inviteId]/route";
import { GET as getStage } from "@/app/api/live-rooms/[id]/stage/route";
import { DELETE as deleteStageUser } from "@/app/api/live-rooms/[id]/stage/[userId]/route";
import { acceptedGuestInvite } from "@/lib/live/guests";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { GUEST_SLOTS_MAX, RATE_LIMITS } from "@/lib/live/permissions";
import type { LiveInviteDto, LiveStageDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let OTHER = "";
let MOD = "";
let hostShadowId = "";
let viewerShadowId = "";
let otherShadowId = "";
let modShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  OTHER = await otherCookie();
  MOD = await modCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
  otherShadowId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
  modShadowId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
});

// ── call helpers (route handlers invoked directly, no network) ──

const BASE = "http://localhost";
const ANON_COOKIE = "next-auth.session-token=none";

function invitesUrl(roomId: string): string {
  return `${BASE}/api/live-rooms/${roomId}/invites`;
}
function respondUrl(roomId: string, inviteId: string): string {
  return `${BASE}/api/live-rooms/${roomId}/invites/${inviteId}/respond`;
}
function inviteUrl(roomId: string, inviteId: string): string {
  return `${BASE}/api/live-rooms/${roomId}/invites/${inviteId}`;
}
function stageUrl(roomId: string): string {
  return `${BASE}/api/live-rooms/${roomId}/stage`;
}
function stageUserUrl(roomId: string, userId: string): string {
  return `${BASE}/api/live-rooms/${roomId}/stage/${userId}`;
}

async function createInviteAs(cookie: string, roomId: string, body: unknown) {
  const res = await postInvites(
    reqWithCookie(invitesUrl(roomId), cookie, { method: "POST", body }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function listInvitesAs(cookie: string, roomId: string) {
  const res = await getInvites(reqWithCookie(invitesUrl(roomId), cookie), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

async function respondAs(cookie: string, roomId: string, inviteId: string, body: unknown) {
  const res = await postRespond(
    reqWithCookie(respondUrl(roomId, inviteId), cookie, { method: "POST", body }),
    { params: Promise.resolve({ id: roomId, inviteId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function cancelAs(cookie: string, roomId: string, inviteId: string) {
  const res = await deleteInvite(
    reqWithCookie(inviteUrl(roomId, inviteId), cookie, { method: "DELETE" }),
    { params: Promise.resolve({ id: roomId, inviteId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function stageAs(roomId: string, cookie?: string) {
  const req = cookie
    ? reqWithCookie(stageUrl(roomId), cookie)
    : new Request(stageUrl(roomId));
  const res = await getStage(req, { params: Promise.resolve({ id: roomId }) });
  return { status: res.status, body: await res.json() };
}

async function removeAs(cookie: string, roomId: string, userId: string) {
  const res = await deleteStageUser(
    reqWithCookie(stageUserUrl(roomId, userId), cookie, { method: "DELETE" }),
    { params: Promise.resolve({ id: roomId, userId }) },
  );
  return { status: res.status, body: await res.json() };
}

// ── fixtures (unique room titles per test — lanes share only the pattern) ──

const FILE_PREFIX = `3a-guests-${crypto.randomUUID().slice(0, 8)}`;
let roomSeq = 0;
function nextTitle(): string {
  roomSeq += 1;
  return `${FILE_PREFIX}-${roomSeq}`;
}

function applyPolicy(roomId: string, policy: { guestsEnabled?: boolean }) {
  if (policy.guestsEnabled === false) {
    return db.liveRoom.update({ where: { id: roomId }, data: { guestsEnabled: false } });
  }
  return Promise.resolve();
}

/** Live room owned by HOST, with the host participant tile (as startSession lands one). */
async function liveRoom(policy: { guestsEnabled?: boolean } = {}) {
  const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), nextTitle());
  await applyPolicy(roomId, policy);
  const { sessionId } = await startSessionFixture(roomId);
  await db.liveParticipant.create({
    data: { sessionId, userId: hostShadowId, role: "host", state: "connected" },
  });
  return { roomId, sessionId };
}

/** Idle room owned by HOST — no session ever started. */
async function idleRoom(policy: { guestsEnabled?: boolean } = {}) {
  const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), nextTitle());
  await applyPolicy(roomId, policy);
  return { roomId };
}

function inviteOf(res: { body: { invite?: LiveInviteDto } }): LiveInviteDto {
  expect(res.body.invite).toBeTruthy();
  return res.body.invite as LiveInviteDto;
}

// ══════════════════════════════════════════════════════════════════

describe("live guests — invite creation gates", () => {
  test("host invite creates a pending row (direction, role, DTO fields)", async () => {
    const { roomId } = await liveRoom();
    const res = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(res.status).toBe(200);

    const invite = inviteOf(res);
    expect(invite.roomId).toBe(roomId);
    expect(invite.inviteeId).toBe(viewerShadowId);
    expect(invite.inviterId).toBe(hostShadowId);
    expect(invite.direction).toBe("host-invite");
    expect(invite.role).toBe("guest");
    expect(invite.status).toBe("pending");
    expect(invite.inviteeHandle.length).toBeGreaterThan(0);
    expect(invite.inviteeName.length).toBeGreaterThan(0);
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = await db.liveInvite.findUnique({ where: { id: invite.id } });
    expect(row?.status).toBe("pending");
    expect(row?.role).toBe("guest");
  });

  test("viewer self-request works — inviter = invitee = caller, direction guest-request", async () => {
    const { roomId } = await liveRoom();
    const res = await createInviteAs(VIEWER, roomId, {});
    expect(res.status).toBe(200);

    const invite = inviteOf(res);
    expect(invite.direction).toBe("guest-request");
    expect(invite.inviteeId).toBe(viewerShadowId);
    expect(invite.inviterId).toBe(viewerShadowId);
    expect(invite.status).toBe("pending");
  });

  test("anonymous POST and GET are 401 unauthenticated", async () => {
    const { roomId } = await liveRoom();

    const anonPost = await createInviteAs(ANON_COOKIE, roomId, {});
    expect(anonPost.status).toBe(401);
    expect(anonPost.body.error).toBe("unauthenticated");

    const anonList = await listInvitesAs(ANON_COOKIE, roomId);
    expect(anonList.status).toBe(401);
    expect(anonList.body.error).toBe("unauthenticated");
  });

  test("a non-host cannot invite a third user (403 forbidden)", async () => {
    const { roomId } = await liveRoom();

    const viewerTry = await createInviteAs(VIEWER, roomId, { inviteeId: otherShadowId });
    expect(viewerTry.status).toBe(403);
    expect(viewerTry.body.error).toBe("forbidden");

    const modTry = await createInviteAs(MOD, roomId, { inviteeId: otherShadowId });
    expect(modTry.status).toBe(403);
  });

  test("guests-disabled room → 403 guests-disabled for host invites AND self-requests", async () => {
    const disabled = await liveRoom({ guestsEnabled: false });

    const hostTry = await createInviteAs(HOST, disabled.roomId, { inviteeId: viewerShadowId });
    expect(hostTry.status).toBe(403);
    expect(hostTry.body.error).toBe("forbidden");
    expect(hostTry.body.message).toBe("guests-disabled");

    const selfTry = await createInviteAs(VIEWER, disabled.roomId, {});
    expect(selfTry.status).toBe(403);
    expect(selfTry.body.message).toBe("guests-disabled");
  });

  test("a banned actor is 403 banned", async () => {
    const banned = await liveRoom();
    await db.liveModerationAction.create({
      data: {
        roomId: banned.roomId,
        actorId: hostShadowId,
        targetId: viewerShadowId,
        action: "ban",
      },
    });
    const res = await createInviteAs(VIEWER, banned.roomId, {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.message).toBe("banned");
  });

  test("unknown room is 404 not-found", async () => {
    const res = await createInviteAs(HOST, "room-does-not-exist", {});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not-found");
  });

  test("a room without a live session is 403 not-live", async () => {
    const idle = await idleRoom();
    const res = await createInviteAs(HOST, idle.roomId, { inviteeId: viewerShadowId });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("not-live");
  });

  test("duplicate pending pair is 409 invite-pending — the pair is (roomId, invitee) regardless of direction", async () => {
    const { roomId } = await liveRoom();

    const first = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(first.status).toBe(200);

    const dupHost = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(dupHost.status).toBe(409);
    expect(dupHost.body.message).toBe("invite-pending");

    // the invitee cannot stack a self-request onto the same pending pair
    const stack = await createInviteAs(VIEWER, roomId, {});
    expect(stack.status).toBe(409);
    expect(stack.body.message).toBe("invite-pending");

    // a different invitee pair is unaffected (and duplicates too)
    const modReq = await createInviteAs(MOD, roomId, {});
    expect(modReq.status).toBe(200);
    const modDup = await createInviteAs(MOD, roomId, {});
    expect(modDup.status).toBe(409);
  });

  test("stage-full: GUEST_SLOTS_MAX connected guests block a host invite (409)", async () => {
    const { roomId, sessionId } = await liveRoom();
    for (let i = 0; i < GUEST_SLOTS_MAX; i++) {
      await db.liveParticipant.create({
        data: {
          sessionId,
          userId: `u_wfx2_ga3a_full_${crypto.randomUUID().slice(0, 8)}_${i}`,
          role: "guest",
          state: "connected",
        },
      });
    }
    const res = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("stage-full");
  });

  test("removed guests never occupy a slot — the occupancy law counts state != removed", async () => {
    const { roomId, sessionId } = await liveRoom();
    for (let i = 0; i < GUEST_SLOTS_MAX - 1; i++) {
      await db.liveParticipant.create({
        data: {
          sessionId,
          userId: `u_wfx2_ga3a_occ_${crypto.randomUUID().slice(0, 8)}_${i}`,
          role: "guest",
          state: "connected",
        },
      });
    }
    await db.liveParticipant.create({
      data: {
        sessionId,
        userId: `u_wfx2_ga3a_gone_${crypto.randomUUID().slice(0, 8)}`,
        role: "guest",
        state: "removed",
      },
    });
    const res = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(res.status).toBe(200);
  });
});

describe("live guests — lazy expiry sweep + list visibility", () => {
  test("backdated pending sweeps to expired on host list (idempotent in the DB)", async () => {
    const { roomId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(created.status).toBe(200);
    const inviteId = inviteOf(created).id;

    await db.liveInvite.update({
      where: { id: inviteId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const hostList = await listInvitesAs(HOST, roomId);
    expect(hostList.status).toBe(200);
    const swept = (hostList.body.invites as LiveInviteDto[]).find((i) => i.id === inviteId);
    expect(swept?.status).toBe("expired");

    const row = await db.liveInvite.findUnique({ where: { id: inviteId } });
    expect(row?.status).toBe("expired");
  });

  test("host sees the room queue; others see only their own rows", async () => {
    const { roomId } = await liveRoom();
    const toViewer = inviteOf(await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId }));
    const toOther = inviteOf(await createInviteAs(HOST, roomId, { inviteeId: otherShadowId }));

    const hostList = await listInvitesAs(HOST, roomId);
    expect(hostList.status).toBe(200);
    const hostIds = (hostList.body.invites as LiveInviteDto[]).map((i) => i.id);
    expect(hostIds).toContain(toViewer.id);
    expect(hostIds).toContain(toOther.id);

    const viewerList = await listInvitesAs(VIEWER, roomId);
    const viewerInvites = viewerList.body.invites as LiveInviteDto[];
    expect(viewerInvites.some((i) => i.id === toOther.id)).toBe(false);
    expect(viewerInvites.every((i) => i.inviteeId === viewerShadowId)).toBe(true);
    expect(viewerInvites.some((i) => i.id === toViewer.id)).toBe(true);
  });
});

describe("live guests — the responder law", () => {
  test("host-invite: answered by the invitee only; accept lands the guest rung", async () => {
    const { roomId, sessionId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: otherShadowId });
    expect(created.status).toBe(200);
    const inviteId = inviteOf(created).id;
    expect(await acceptedGuestInvite(roomId, otherShadowId)).toBe(false);

    // a bystander cannot answer someone else's row
    const wrong = await respondAs(VIEWER, roomId, inviteId, { action: "accept" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe("forbidden");

    // an unknown action is 400 invalid
    const badAction = await respondAs(OTHER, roomId, inviteId, { action: "party" });
    expect(badAction.status).toBe(400);
    expect(badAction.body.error).toBe("invalid");

    // the invitee accepts → status flip + participant rung
    const ok = await respondAs(OTHER, roomId, inviteId, { action: "accept" });
    expect(ok.status).toBe(200);
    expect(inviteOf(ok).status).toBe("accepted");

    const participant = await db.liveParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: otherShadowId } },
    });
    expect(participant?.role).toBe("guest");
    expect(participant?.state).toBe("connected");

    // the seam the token mint rung calls
    expect(await acceptedGuestInvite(roomId, otherShadowId)).toBe(true);
    expect(await acceptedGuestInvite(roomId, viewerShadowId)).toBe(false);

    // already resolved → 409 invite-resolved
    const again = await respondAs(OTHER, roomId, inviteId, { action: "accept" });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("invite-resolved");
  });

  test("guest-request: answered by the HOST and not by the requester; decline works", async () => {
    const { roomId, sessionId } = await liveRoom();
    const created = await createInviteAs(VIEWER, roomId, {});
    expect(created.status).toBe(200);
    const inviteId = inviteOf(created).id;
    expect(inviteOf(created).direction).toBe("guest-request");

    // the requester cannot wave their own request through
    const self = await respondAs(VIEWER, roomId, inviteId, { action: "accept" });
    expect(self.status).toBe(403);

    const ok = await respondAs(HOST, roomId, inviteId, { action: "accept" });
    expect(ok.status).toBe(200);
    expect(inviteOf(ok).status).toBe("accepted");
    const participant = await db.liveParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: viewerShadowId } },
    });
    expect(participant?.role).toBe("guest");

    // decline path: the host declines a fresh request
    const second = await createInviteAs(MOD, roomId, {});
    expect(second.status).toBe(200);
    const declined = await respondAs(HOST, roomId, inviteOf(second).id, { action: "decline" });
    expect(declined.status).toBe(200);
    expect(inviteOf(declined).status).toBe("declined");
  });

  test("accept with no live session is 403 not-live (room that never started)", async () => {
    const idle = await idleRoom();
    const row = await db.liveInvite.create({
      data: {
        roomId: idle.roomId,
        inviteeId: viewerShadowId,
        inviterId: hostShadowId,
        role: "guest",
        status: "pending",
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    const res = await respondAs(VIEWER, idle.roomId, row.id, { action: "accept" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.message).toBe("not-live");
  });

  test("accept after the session ended is 403 not-live", async () => {
    const { roomId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    const inviteId = inviteOf(created).id;
    await endSessionFixture(roomId);
    const res = await respondAs(VIEWER, roomId, inviteId, { action: "accept" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("not-live");
  });

  test("accept into a full stage is 409 stage-full and the row stays pending", async () => {
    const { roomId, sessionId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    expect(created.status).toBe(200);
    const inviteId = inviteOf(created).id;

    for (let i = 0; i < GUEST_SLOTS_MAX; i++) {
      await db.liveParticipant.create({
        data: {
          sessionId,
          userId: `u_wfx2_ga3a_acc_${crypto.randomUUID().slice(0, 8)}_${i}`,
          role: "guest",
          state: "connected",
        },
      });
    }
    const res = await respondAs(VIEWER, roomId, inviteId, { action: "accept" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("stage-full");

    const row = await db.liveInvite.findUnique({ where: { id: inviteId } });
    expect(row?.status).toBe("pending");
  });

  test("an expired pending is 409 invite-expired (swept on respond)", async () => {
    const { roomId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId });
    const inviteId = inviteOf(created).id;
    await db.liveInvite.update({
      where: { id: inviteId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await respondAs(VIEWER, roomId, inviteId, { action: "accept" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("invite-expired");
  });
});

describe("live guests — cancel", () => {
  test("cancel by the creator (host) and by the creator (requester); host may retract any pending row", async () => {
    const { roomId } = await liveRoom();

    const hostInvite = inviteOf(await createInviteAs(HOST, roomId, { inviteeId: viewerShadowId }));
    const cancelled = await cancelAs(HOST, roomId, hostInvite.id);
    expect(cancelled.status).toBe(200);
    expect(inviteOf(cancelled).status).toBe("cancelled");
    const again = await cancelAs(HOST, roomId, hostInvite.id);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("invite-resolved");

    // the pair is free again once cancelled — a self-request can land
    const request = inviteOf(await createInviteAs(VIEWER, roomId, {}));
    const selfCancel = await cancelAs(VIEWER, roomId, request.id);
    expect(selfCancel.status).toBe(200);
    expect(inviteOf(selfCancel).status).toBe("cancelled");

    // the host may retract a row they did not create
    const modRequest = inviteOf(await createInviteAs(MOD, roomId, {}));
    const hostCancel = await cancelAs(HOST, roomId, modRequest.id);
    expect(hostCancel.status).toBe(200);
    expect(inviteOf(hostCancel).status).toBe("cancelled");
  });

  test("cancel by a bystander is 403", async () => {
    const { roomId } = await liveRoom();
    const created = await createInviteAs(VIEWER, roomId, {});
    const inviteId = inviteOf(created).id;
    const res = await cancelAs(OTHER, roomId, inviteId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });
});

describe("live guests — the stage board", () => {
  test("anonymous on a public room sees the host tile; idle rooms answer honestly empty", async () => {
    const { roomId } = await liveRoom();
    const res = await stageAs(roomId);
    expect(res.status).toBe(200);
    const stage = res.body.stage as LiveStageDto;
    expect(stage.sessionId).not.toBe("");
    expect(stage.guestsMax).toBe(GUEST_SLOTS_MAX);
    expect(stage.guestsEnabled).toBe(true);
    expect(stage.participants.length).toBe(1);
    expect(stage.participants[0]?.role).toBe("host");
    expect(stage.participants[0]?.userId).toBe(hostShadowId);
    expect(stage.participants[0]?.handle.length).toBeGreaterThan(0);

    const idle = await idleRoom();
    const idleRes = await stageAs(idle.roomId);
    expect(idleRes.status).toBe(200);
    const idleStage = idleRes.body.stage as LiveStageDto;
    expect(idleStage.sessionId).toBe("");
    expect(idleStage.participants).toEqual([]);
  });

  test("unknown room is 404; after an accept the guest tile appears for anonymous viewers", async () => {
    const ghost = await stageAs("room-does-not-exist");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");

    const { roomId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: otherShadowId });
    expect(created.status).toBe(200);
    const ok = await respondAs(OTHER, roomId, inviteOf(created).id, { action: "accept" });
    expect(ok.status).toBe(200);

    const res = await stageAs(roomId);
    const stage = res.body.stage as LiveStageDto;
    expect(stage.participants.length).toBe(2);
    expect(stage.participants[0]?.role).toBe("host");
    const guest = stage.participants.find((p) => p.userId === otherShadowId);
    expect(guest?.role).toBe("guest");
    expect(guest?.state).toBe("connected");
  });

  test("host removal: state removed (row kept), stage shows the removed state", async () => {
    const { roomId, sessionId } = await liveRoom();
    const created = await createInviteAs(HOST, roomId, { inviteeId: otherShadowId });
    const ok = await respondAs(OTHER, roomId, inviteOf(created).id, { action: "accept" });
    expect(ok.status).toBe(200);

    // non-host removal is 403; removing the host identity is 403; an
    // identity that is not a current guest participant is 404
    const notHost = await removeAs(VIEWER, roomId, otherShadowId);
    expect(notHost.status).toBe(403);
    const selfRemoval = await removeAs(HOST, roomId, hostShadowId);
    expect(selfRemoval.status).toBe(403);
    const ghost = await removeAs(HOST, roomId, "u_wfx2_ga3a_ghost_user");
    expect(ghost.status).toBe(404);

    const removed = await removeAs(HOST, roomId, otherShadowId);
    expect(removed.status).toBe(200);
    const stage = removed.body.stage as LiveStageDto;
    expect(stage.sessionId).not.toBe("");
    const tile = stage.participants.find((p) => p.userId === otherShadowId);
    expect(tile?.state).toBe("removed");

    // the row itself is kept — removal is a state, not a deletion
    const participant = await db.liveParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: otherShadowId } },
    });
    expect(participant?.role).toBe("guest");
    expect(participant?.state).toBe("removed");

    // a subsequent stage read shows the same honest roster
    const after = await stageAs(roomId);
    const afterTile = (after.body.stage as LiveStageDto).participants.find(
      (p) => p.userId === otherShadowId,
    );
    expect(afterTile?.state).toBe("removed");
  });
});

describe("live guests — rate limits", () => {
  test("createInvite hammered past RATE_LIMITS.inviteCreate within the window → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.inviteCreate.limit;

    // fresh invitee identities so every call is a legitimate new invite
    const invitees: string[] = [];
    for (let i = 0; i < limit + 2; i++) {
      const claims = {
        sub: `u_wfx2_ga3a_rl_${crypto.randomUUID().slice(0, 8)}_${i}`,
        name: `Guest Lane RL ${i}`,
        email: `ga3a-rl-${crypto.randomUUID().slice(0, 8)}@webflix.test`,
      };
      invitees.push((await ensureShadowUser(sessionUserOf(claims))).id);
    }

    for (let i = 0; i < limit + 2; i++) {
      const { status } = await createInviteAs(HOST, roomId, { inviteeId: invitees[i] });
      if (i < limit) expect(status).toBe(200);
      else expect(status).toBe(429);
    }
  });
});
