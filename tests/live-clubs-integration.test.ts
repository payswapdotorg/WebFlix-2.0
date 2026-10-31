/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 (lane 5-b) — the LIVE integration pins for
 * the non-monetary fan clubs (ADR-0010; frozen contracts §3/§4).
 *
 * Lane 5-b owns the members-only GATES inside the existing LIVE domain
 * files (rooms/chat/moderation/replays/gifts); the club domain itself is
 * lane 5-a's clubs.ts. These pins exercise the gates at the DOMAIN layer
 * (the layer this lane edited) on a dedicated live-clubs-5b-test.db:
 *   - room create accepts visibility "members" (+ honest default/fallback)
 *   - discovery (listRooms) excludes members rooms from public listing
 *   - the mintJoinToken members gate: non-member forbidden / member past
 *     the gate / host always allowed
 *   - membersOnlyChat: policy DTO law (member true / non-member false +
 *     "members-only" / fail-closed undefined), the send gate (non-member
 *     blocked with the honest reason, member allowed, staff bypass)
 *   - the two audited toggles (members-chat-enable/disable): room column
 *     persists + exactly-one audit row each + host-only enforcement
 *   - replay members gate: inherit-on-members-room and explicit "members"
 *     assets admit host + club members only; setReplayVisibility accepts
 *     "members"
 *   - badge derivation: ONE batched lookup — member maps to
 *     { clubName, level }, non-member absent, no badges → null
 *   - the award law (§3): watch/chat/gift durable commits earn EXACTLY ONE
 *     point event per idempotency key on duplicate delivery; non-members
 *     are a no-op; the host's own participant row never awards
 *
 * Membership rows are seeded DIRECTLY via db.liveFanClub/liveFanClubMember
 * (the same rows the gates authorize against) — the gate never depends on
 * a clubs.ts helper by law. Award pins DO depend on clubs.ts awardClubPoints
 * (frozen contracts §5) — they assert the ledger exactly-once law.
 *
 * Run: DATABASE_URL=file:../db/live-clubs-5b-test.db bun test tests/live-clubs-integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRateLimits } from "@/lib/youtube/cache";
import { db } from "@/lib/db";
import { ensureShadowUser, shadowUserId } from "@/lib/watch/local-comments";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  endSessionFixture,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
} from "./live-helpers";
import {
  LiveDomainError,
  createRoom,
  listRooms,
  mintJoinToken,
  reconcileWebhookEvent,
} from "@/lib/live/rooms";
import { badgesFor, listChat, mapChatMessage, sendChat } from "@/lib/live/chat";
import { performModeration } from "@/lib/live/moderation";
import { getReplayFor, setReplayVisibility } from "@/lib/live/replays";
import { sendGift } from "@/lib/live/gifts";
import { buildPolicyDto } from "@/lib/live/policy";
import type { LiveWebhookEvent } from "@/lib/live/types";

setupLiveDb();
beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

// The shadow ids (the live identity seam: every room-side id is wf-<sub>).
const HOST_ID = shadowUserId(HOST_CLAIMS.sub);
const VIEWER_ID = shadowUserId(VIEWER_CLAIMS.sub);
const MOD_ID = shadowUserId(MOD_CLAIMS.sub);
const OTHER_ID = shadowUserId(OTHER_CLAIMS.sub);

const HOST = sessionUserOf(HOST_CLAIMS);
const VIEWER = sessionUserOf(VIEWER_CLAIMS);
const MOD = sessionUserOf(MOD_CLAIMS);
const OTHER = sessionUserOf(OTHER_CLAIMS);

const CLUB_NAME = "5B Host Fan Club";

/**
 * The shared club fixture (idempotent across runs): the HOST's one club,
 * OTHER as a member at 1200 points (level 3 at the 500/level default), a
 * dedicated badge-probe member (never awarded — deterministic level pin),
 * and the shadow User rows for handle resolution.
 */
let clubId = "";
beforeAll(async () => {
  for (const claims of [HOST_CLAIMS, VIEWER_CLAIMS, MOD_CLAIMS, OTHER_CLAIMS]) {
    await ensureShadowUser(sessionUserOf(claims));
  }
  const club = await db.liveFanClub.upsert({
    where: { hostId: HOST_ID },
    create: { hostId: HOST_ID, name: CLUB_NAME },
    update: { name: CLUB_NAME },
  });
  clubId = club.id;
  await db.liveFanClubMember.upsert({
    where: { clubId_userId: { clubId, userId: OTHER_ID } },
    create: { clubId, userId: OTHER_ID, points: 1200 },
    update: { points: 1200 },
  });
  // Badge-probe member: never sends/awards — the exact-level pin stays fixed.
  await db.liveFanClubMember.upsert({
    where: { clubId_userId: { clubId, userId: "wf-badge-probe-5b" } },
    create: { clubId, userId: "wf-badge-probe-5b", points: 1200 },
    update: { points: 1200 },
  });
});

async function membersRoom(): Promise<{ roomId: string }> {
  const room = await createRoom(HOST, {
    title: `Members room ${crypto.randomUUID().slice(0, 8)}`,
    visibility: "members",
  });
  return { roomId: room.id };
}

/**
 * A room with the members-only CHAT toggle ON (via the audited moderation
 * action — room visibility and chat gating are independent laws).
 */
async function membersChatRoom(): Promise<{ roomId: string }> {
  const { roomId } = await membersRoom();
  await performModeration(roomId, HOST, { action: "members-chat-enable" });
  const room = await db.liveRoom.findUniqueOrThrow({ where: { id: roomId } });
  expect(room.membersOnlyChat).toBe(true);
  return { roomId };
}

/** Seed a ready replay asset on the room's newest (given) session. */
async function seedReadyReplay(
  roomId: string,
  sessionId: string,
  visibility: "inherit" | "public" | "unlisted" | "hidden" | "members",
) {
  return db.liveReplayAsset.create({
    data: {
      sessionId,
      roomId,
      sink: "host-capture",
      status: "ready",
      requestedById: HOST_ID,
      storageKey: `replay-${sessionId}.webm`,
      mimeType: "video/webm",
      sizeBytes: 128,
      durationMs: 1_000,
      visibility,
      recordingStartedAt: new Date(),
      readyAt: new Date(),
      retentionExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

function joinWebhook(providerRoomId: string, identity: string): LiveWebhookEvent {
  return {
    eventId: crypto.randomUUID(),
    kind: "participant_joined",
    provider: "livekit",
    roomName: providerRoomId,
    participantIdentity: identity,
    at: new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════
// Room visibility "members": create + discovery + join/token gate
// ═════════════════════════════════════════════════════════════════════

describe("members room create + discovery (rooms.ts)", () => {
  test("createRoom accepts visibility 'members' and the DTO surfaces it honestly", async () => {
    const room = await createRoom(HOST, {
      title: `Members create ${crypto.randomUUID().slice(0, 6)}`,
      visibility: "members",
    });
    expect(room.visibility).toBe("members");
  });

  test("createRoom defaults/falls back honestly (undefined → public, garbage → public)", async () => {
    const def = await createRoom(HOST, { title: `Default vis ${crypto.randomUUID().slice(0, 6)}` });
    expect(def.visibility).toBe("public");
    const garbage = await createRoom(HOST, {
      title: `Garbage vis ${crypto.randomUUID().slice(0, 6)}`,
      visibility: "sekrit" as unknown as "members",
    });
    expect(garbage.visibility).toBe("public");
  });

  test("discovery (listRooms) excludes members rooms from the public listing", async () => {
    const members = await createRoom(HOST, {
      title: `Hidden from discovery ${crypto.randomUUID().slice(0, 6)}`,
      visibility: "members",
    });
    const pub = await createRoom(HOST, {
      title: `Public live ${crypto.randomUUID().slice(0, 6)}`,
    });
    await startSessionFixture(members.id);
    await startSessionFixture(pub.id);
    const listed = await listRooms({ status: "live", sessionUser: null, limit: 48 });
    const ids = listed.map((r) => r.id);
    expect(ids).not.toContain(members.id);
    expect(ids).toContain(pub.id);
    // the members room that IS listed (if any stale row exists) never lies
    expect(listed.find((r) => r.id === members.id)).toBeUndefined();
  });
});

describe("mintJoinToken members gate (rooms.ts)", () => {
  test("non-member on a members room → forbidden (authorization before provider)", async () => {
    const { roomId } = await membersRoom();
    try {
      await mintJoinToken(roomId, VIEWER, "viewer");
      throw new Error("expected forbidden");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDomainError);
      expect((err as LiveDomainError).code).toBe("forbidden");
    }
  });

  test("club member passes the gate (reaches the honest provider-not-configured rung)", async () => {
    const { roomId } = await membersRoom();
    try {
      await mintJoinToken(roomId, OTHER, "viewer");
      throw new Error("expected provider-not-configured (sandbox has no LiveKit)");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDomainError);
      expect((err as LiveDomainError).code).toBe("provider-not-configured");
    }
  });

  test("host is always allowed through the members gate", async () => {
    const { roomId } = await membersRoom();
    try {
      await mintJoinToken(roomId, HOST, "viewer");
      throw new Error("expected provider-not-configured (sandbox has no LiveKit)");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDomainError);
      expect((err as LiveDomainError).code).toBe("provider-not-configured");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// membersOnlyChat: the policy law + the send gate + audited toggles
// ═════════════════════════════════════════════════════════════════════

describe("membersOnlyChat policy + send gate (policy.ts × chat.ts)", () => {
  test("policy DTO: member canChat true; non-member false + 'members-only'; undefined fails closed", () => {
    const base = {
      id: "room-policy-probe",
      hostId: HOST_ID,
      status: "live" as const,
      chatEnabled: true,
      reactionsEnabled: true,
      slowModeSeconds: 0,
      guestsEnabled: true,
      giftsEnabled: true,
      membersOnlyChat: true,
    };
    const actor = { id: VIEWER_ID, handle: "v", name: "V", role: "viewer" as const };
    const sanctions = { banned: false, mutedUntil: null };
    const member = buildPolicyDto({
      room: base,
      actor: { ...actor, id: OTHER_ID },
      sanctions,
      sessionLive: true,
      callerIsClubMember: true,
    });
    expect(member.canChat).toBe(true);
    expect(member.chatBlockedReason).toBeNull();
    const nonMember = buildPolicyDto({ room: base, actor, sanctions, sessionLive: true, callerIsClubMember: false });
    expect(nonMember.canChat).toBe(false);
    expect(nonMember.chatBlockedReason).toBe("members-only");
    const unevaluated = buildPolicyDto({ room: base, actor, sanctions, sessionLive: true });
    expect(unevaluated.canChat).toBe(false);
    expect(unevaluated.chatBlockedReason).toBe("members-only");
  });

  test("sendChat blocks a non-member with the honest 'members-only' reason", async () => {
    const { roomId } = await membersChatRoom();
    await startSessionFixture(roomId);
    try {
      await sendChat(roomId, VIEWER, { body: "let me in", clientMessageId: "nonmember-01" });
      throw new Error("expected forbidden members-only");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDomainError);
      expect((err as LiveDomainError).code).toBe("forbidden");
      expect((err as LiveDomainError).message).toBe("members-only");
    }
  });

  test("sendChat allows a club member (badge derived) and the host (staff bypass)", async () => {
    const { roomId } = await membersChatRoom();
    await startSessionFixture(roomId);
    const memberSend = await sendChat(roomId, OTHER, {
      body: "members can speak",
      clientMessageId: "member-send-01",
    });
    expect(memberSend.duplicate).toBeUndefined();
    expect(memberSend.message.senderClubBadge?.clubName).toBe(CLUB_NAME);
    expect(memberSend.message.senderClubBadge?.level).toBeGreaterThanOrEqual(1);
    const hostSend = await sendChat(roomId, HOST, {
      body: "host always speaks",
      clientMessageId: "host-send-01",
    });
    expect(hostSend.message.body).toBe("host always speaks");
  });

  test("granted moderator bypasses the members-only chat gate", async () => {
    const { roomId } = await membersChatRoom();
    await startSessionFixture(roomId);
    await db.liveRoomModerator.upsert({
      where: { roomId_userId: { roomId, userId: MOD_ID } },
      create: { roomId, userId: MOD_ID, grantedBy: HOST_ID },
      update: { revokedAt: null, revokedBy: null },
    });
    const modSend = await sendChat(roomId, MOD, {
      body: "staff bypass",
      clientMessageId: "mod-send-001",
    });
    expect(modSend.message.body).toBe("staff bypass");
    expect(modSend.message.senderClubBadge).toBeNull();
  });
});

describe("audited members-chat toggles (moderation.ts)", () => {
  test("members-chat-enable/disable persist the column and append exactly one audit row each", async () => {
    const { roomId } = await membersRoom();
    const enable = await performModeration(roomId, HOST, { action: "members-chat-enable" });
    expect(enable.action.action).toBe("members-chat-enable");
    const afterEnable = await db.liveRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(afterEnable.membersOnlyChat).toBe(true);
    const disable = await performModeration(roomId, HOST, { action: "members-chat-disable" });
    expect(disable.action.action).toBe("members-chat-disable");
    const afterDisable = await db.liveRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(afterDisable.membersOnlyChat).toBe(false);
    const rows = await db.liveModerationAction.findMany({
      where: { roomId, action: { in: ["members-chat-enable", "members-chat-disable"] } },
    });
    expect(rows.length).toBe(2);
  });

  test("members-chat toggles are HOST-ONLY (a granted moderator is forbidden)", async () => {
    const { roomId } = await membersRoom();
    await db.liveRoomModerator.upsert({
      where: { roomId_userId: { roomId, userId: MOD_ID } },
      create: { roomId, userId: MOD_ID, grantedBy: HOST_ID },
      update: { revokedAt: null, revokedBy: null },
    });
    try {
      await performModeration(roomId, MOD, { action: "members-chat-enable" });
      throw new Error("expected forbidden host-only action");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDomainError);
      expect((err as LiveDomainError).code).toBe("forbidden");
      expect((err as LiveDomainError).message).toBe("host-only action");
    }
    const room = await db.liveRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.membersOnlyChat).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Replay members gate (replays.ts)
// ═════════════════════════════════════════════════════════════════════

describe("replay members gate (replays.ts)", () => {
  test("'inherit' on a members room: non-member denied, member admitted, host admitted", async () => {
    const { roomId } = await membersRoom();
    const { sessionId } = await startSessionFixture(roomId);
    await seedReadyReplay(roomId, sessionId, "inherit");
    expect(await getReplayFor(roomId, VIEWER)).toBeNull();
    const memberView = await getReplayFor(roomId, OTHER);
    expect(memberView).not.toBeNull();
    expect(memberView?.asset.visibility).toBe("inherit");
    expect(memberView?.playbackUrl).toBe(`/api/live-rooms/${roomId}/replay/stream`);
    const hostView = await getReplayFor(roomId, HOST);
    expect(hostView).not.toBeNull();
    await endSessionFixture(roomId);
  });

  test("explicit 'members' asset visibility gates the same way on a public room", async () => {
    const { roomId } = await createRoomFixture(HOST, `Public room w/ members replay ${crypto.randomUUID().slice(0, 6)}`);
    const { sessionId } = await startSessionFixture(roomId);
    await seedReadyReplay(roomId, sessionId, "members");
    expect(await getReplayFor(roomId, VIEWER)).toBeNull();
    expect(await getReplayFor(roomId, OTHER)).not.toBeNull();
    expect(await getReplayFor(roomId, HOST)).not.toBeNull();
    await endSessionFixture(roomId);
  });

  test("setReplayVisibility accepts 'members' (host-only PATCH)", async () => {
    const { roomId } = await membersRoom();
    const { sessionId } = await startSessionFixture(roomId);
    await seedReadyReplay(roomId, sessionId, "public");
    const updated = await setReplayVisibility(roomId, HOST, "members");
    expect(updated.visibility).toBe("members");
    await endSessionFixture(roomId);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Badge derivation (chat.ts badgesFor — ONE batched lookup)
// ═════════════════════════════════════════════════════════════════════

describe("chat badge derivation (chat.ts)", () => {
  test("badgesFor maps a member to { clubName, level } (exact level formula) and omits non-members", async () => {
    const badges = await badgesFor(HOST_ID, [OTHER_ID, VIEWER_ID, "wf-badge-probe-5b"]);
    // 1200 points / 500 per level → floor(2.4) + 1 = 3
    expect(badges.get("wf-badge-probe-5b")).toEqual({ clubName: CLUB_NAME, level: 3 });
    expect(badges.get(OTHER_ID)?.clubName).toBe(CLUB_NAME);
    expect(badges.get(OTHER_ID)?.level).toBeGreaterThanOrEqual(1);
    expect(badges.has(VIEWER_ID)).toBe(false);
  });

  test("listChat stamps senderClubBadge for members and null for non-members (read-derived)", async () => {
    const { roomId } = await createRoomFixture(HOST, `Badge transcript room ${crypto.randomUUID().slice(0, 6)}`);
    await startSessionFixture(roomId);
    await sendChat(roomId, OTHER, { body: "member speaks", clientMessageId: "badge-member-1" });
    await sendChat(roomId, VIEWER, { body: "viewer speaks", clientMessageId: "badge-viewer-1" });
    const history = await listChat(roomId);
    const memberRow = history.find((m) => m.senderId === OTHER_ID);
    const viewerRow = history.find((m) => m.senderId === VIEWER_ID);
    expect(memberRow?.senderClubBadge?.clubName).toBe(CLUB_NAME);
    expect(typeof memberRow?.senderClubBadge?.level).toBe("number");
    expect(viewerRow?.senderClubBadge).toBeNull();
  });

  test("mapChatMessage without a badge map stamps null (badge failure renders no badge)", () => {
    const row = {
      id: "m1",
      seq: 1,
      roomId: "r1",
      sessionId: "s1",
      senderId: OTHER_ID,
      clientMessageId: "client-1",
      body: "hello",
      kind: "chat",
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
    };
    const dto = mapChatMessage(row, new Map([[OTHER_ID, { handle: "o", name: "O" }]]));
    expect(dto.senderClubBadge).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════
// The award law (§3): exactly one point event per idempotency key
// ═════════════════════════════════════════════════════════════════════

describe("club point awards ride the durable commits exactly once", () => {
  test("chat: one 'chat:{messageId}' event; duplicate clientMessageId never double-awards", async () => {
    const { roomId } = await createRoomFixture(HOST, `Chat award room ${crypto.randomUUID().slice(0, 6)}`);
    await startSessionFixture(roomId);
    const before = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId, userId: OTHER_ID } },
      select: { points: true },
    });
    const first = await sendChat(roomId, OTHER, {
      body: "award me once",
      clientMessageId: "award-dup-0001",
    });
    expect(first.duplicate).toBeUndefined();
    const key = `chat:${first.message.id}`;
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    const replay = await sendChat(roomId, OTHER, {
      body: "award me once",
      clientMessageId: "award-dup-0001",
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.message.id).toBe(first.message.id);
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    const event = await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: key } });
    expect(event?.source).toBe("chat");
    expect(event?.amount).toBe(1);
    expect(event?.sourceEventId).toBe(first.message.id);
    const after = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId, userId: OTHER_ID } },
      select: { points: true },
    });
    expect(after.points).toBe(before.points + 1);
  });

  test("chat: a non-member's send awards NOTHING (no-op law)", async () => {
    const { roomId } = await createRoomFixture(HOST, `Chat nonmember room ${crypto.randomUUID().slice(0, 6)}`);
    await startSessionFixture(roomId);
    const sent = await sendChat(roomId, VIEWER, {
      body: "no club, no points",
      clientMessageId: "nonmember-aw-1",
    });
    expect(
      await db.liveClubPointEvent.count({ where: { idempotencyKey: `chat:${sent.message.id}` } }),
    ).toBe(0);
  });

  test("watch: webhook participant_joined creates the row + exactly one 'watch:{sessionId}:{userId}' event; redelivery and host rows never double-award", async () => {
    const { roomId } = await createRoomFixture(HOST, `Watch award room ${crypto.randomUUID().slice(0, 6)}`);
    const { sessionId, providerRoomId } = await startSessionFixture(roomId);
    const key = `watch:${sessionId}:${OTHER_ID}`;
    const reconciled = await reconcileWebhookEvent(joinWebhook(providerRoomId, OTHER_ID));
    expect(reconciled.reconciled).toBe(true);
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    const event = await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: key } });
    expect(event?.source).toBe("watch");
    expect(event?.amount).toBe(2);
    expect(event?.sourceEventId).toBe(sessionId);
    // duplicate delivery — the row exists, the award must not re-enter
    await reconcileWebhookEvent(joinWebhook(providerRoomId, OTHER_ID));
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    // the HOST's own participant row never awards
    await reconcileWebhookEvent(joinWebhook(providerRoomId, HOST_ID));
    expect(
      await db.liveClubPointEvent.count({ where: { idempotencyKey: `watch:${sessionId}:${HOST_ID}` } }),
    ).toBe(0);
  });

  test("gift: one 'gift:{giftEventId}' event with the raw credit amount", async () => {
    const { roomId } = await createRoomFixture(HOST, `Gift award room ${crypto.randomUUID().slice(0, 6)}`);
    await startSessionFixture(roomId);
    const sent = await sendGift(roomId, OTHER, {
      giftItemId: "wave-hello",
      quantity: 5,
      clientRequestId: "gift-award-0001",
    });
    expect(sent.duplicate).toBeUndefined();
    const key = `gift:${sent.gift.id}`;
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    const event = await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: key } });
    expect(event?.source).toBe("gift");
    expect(event?.amount).toBe(sent.gift.totalCredits);
    expect(event?.amount).toBe(5);
    expect(event?.sourceEventId).toBe(sent.gift.id);
  });
});
