/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes (lane E-b) — the chat intake-gate
 * pins (ADR-0011 §3; frozen contracts §3/§6 lane E-b).
 *
 * sendChat's emote intake gate sits AFTER the members-only gate and BEFORE
 * slow-mode. These pins exercise it at the DOMAIN layer (the layer this
 * lane edited) on a dedicated live-emotes-chat-test.db:
 *   - entitled emote send passes and the body stores AS SENT (ADR-0011 §4)
 *   - locked emote (member level < requiredLevel) → forbidden "emote-locked"
 *   - the host is always entitled (staff of their own club identity)
 *   - tokens matching NO emote code are ordinary punctuation ("2:1",
 *     "10:30", ":)", ":ghost:") — literal text, never an error
 *   - the no-colon body resolves silently (the validator's fast path)
 *   - gate-order precedence: unauthenticated / banned / muted /
 *     chat-disabled / members-only all reject BEFORE the emote gate;
 *     staff still bypass chat-disabled and members-only
 *   - idempotency + tombstone laws untouched by the hook (duplicate:true
 *     returns the ORIGINAL body; replay never throws from the hook;
 *     tombstoned emote rows render deleted:true body "")
 *   - entitlement is per-caller: a non-member viewer gets emote-locked on
 *     the same code a member sends freely
 *
 * The club/emote/member rows are seeded DIRECTLY via db.liveFanClub /
 * liveFanClubMember / liveClubEmote (the rows the gate authorizes
 * against). pointsPerLevel=1 keeps levels exact (level = points + 1);
 * beforeEach re-pins the member's points to 0 because every durable chat
 * commit awards CLUB_POINTS_CHAT (the ADR-0010 §3 award law rides the
 * same send).
 *
 * Run: DATABASE_URL=file:../db/live-emotes-chat-test.db bun test --isolate tests/live-emotes-chat.test.ts
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
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
} from "./live-helpers";
import { listChat, sendChat } from "@/lib/live/chat";
import { validateEmoteUsage } from "@/lib/live/emotes";
import { performModeration } from "@/lib/live/moderation";
import { LiveDomainError } from "@/lib/live/rooms";

setupLiveDb();
beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

// The shadow ids (the live identity seam: every room-side id is wf-<sub>).
const HOST_ID = shadowUserId(HOST_CLAIMS.sub);
const MEMBER_ID = shadowUserId(OTHER_CLAIMS.sub);
const MOD_ID = shadowUserId(MOD_CLAIMS.sub);

const HOST = sessionUserOf(HOST_CLAIMS);
const VIEWER = sessionUserOf(VIEWER_CLAIMS);
const MEMBER = sessionUserOf(OTHER_CLAIMS);
const MOD = sessionUserOf(MOD_CLAIMS);

const CLUB_NAME = "E-b Emote Fan Club";

let clubId = "";

beforeAll(async () => {
  for (const claims of [HOST_CLAIMS, VIEWER_CLAIMS, MOD_CLAIMS, OTHER_CLAIMS]) {
    await ensureShadowUser(sessionUserOf(claims));
  }
  // The host's one club at pointsPerLevel=1 → level = floor(points/1)+1 is
  // exactly controllable (points 0 → level 1).
  const club = await db.liveFanClub.upsert({
    where: { hostId: HOST_ID },
    create: { hostId: HOST_ID, name: CLUB_NAME, pointsPerLevel: 1 },
    update: { name: CLUB_NAME, pointsPerLevel: 1 },
  });
  clubId = club.id;
  // The emote set (frozen pins): heart at level 1, crown at level 5.
  await db.liveClubEmote.upsert({
    where: { clubId_code: { clubId, code: "heart" } },
    create: { clubId, code: "heart", unicode: "❤️", requiredLevel: 1 },
    update: { unicode: "❤️", requiredLevel: 1 },
  });
  await db.liveClubEmote.upsert({
    where: { clubId_code: { clubId, code: "crown" } },
    create: { clubId, code: "crown", unicode: "👑", requiredLevel: 5 },
    update: { unicode: "👑", requiredLevel: 5 },
  });
  // The club member at exactly level 1.
  await db.liveFanClubMember.upsert({
    where: { clubId_userId: { clubId, userId: MEMBER_ID } },
    create: { clubId, userId: MEMBER_ID, points: 0 },
    update: { points: 0 },
  });
});

beforeEach(async () => {
  // pointsPerLevel=1 makes every durable chat award (+CLUB_POINTS_CHAT)
  // bump the member's level; re-pin points 0 → level 1 per test so the
  // exact-level emote entitlements stay deterministic.
  await db.liveFanClubMember.update({
    where: { clubId_userId: { clubId, userId: MEMBER_ID } },
    data: { points: 0 },
  });
});

/** A fresh public room with a live session (sendChat's not-live gate passes). */
async function liveRoom(
  policy: { chatEnabled?: boolean; slowModeSeconds?: number } = {},
): Promise<{ roomId: string }> {
  const { roomId } = await createRoomFixture(
    HOST,
    `e-b-emotes-${crypto.randomUUID().slice(0, 8)}`,
  );
  if (Object.keys(policy).length > 0) {
    await db.liveRoom.update({ where: { id: roomId }, data: policy });
  }
  await startSessionFixture(roomId);
  return { roomId };
}

/** A members-only-chat room via the audited moderation action. */
async function membersChatRoom(): Promise<{ roomId: string }> {
  const { roomId } = await liveRoom();
  await performModeration(roomId, HOST, { action: "members-chat-enable" });
  return { roomId };
}

/** Assert the call throws LiveDomainError with the exact code (+message). */
async function expectDomainError(
  run: () => Promise<unknown>,
  code: LiveDomainError["code"],
  message?: string,
): Promise<void> {
  try {
    await run();
    throw new Error(`expected LiveDomainError ${code}${message ? `/${message}` : ""}`);
  } catch (err) {
    expect(err).toBeInstanceOf(LiveDomainError);
    expect((err as LiveDomainError).code).toBe(code);
    if (message !== undefined) expect((err as LiveDomainError).message).toBe(message);
  }
}

// ═════════════════════════════════════════════════════════════════════
// The intake law: entitled / locked / unknown / fast-path
// ═════════════════════════════════════════════════════════════════════

describe("emote intake law (chat.ts × emotes.ts, ADR-0011 §3)", () => {
  test("entitled member's :heart: passes — body stored EXACTLY as sent", async () => {
    const { roomId } = await liveRoom();
    const { message } = await sendChat(roomId, MEMBER, {
      body: "hello :heart: world",
      clientMessageId: "emote-send-001",
    });
    expect(message.body).toBe("hello :heart: world");
    const row = await db.liveRoomMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.body).toBe("hello :heart: world"); // the storage law (no rewrite)
  });

  test("locked emote: level-1 member's :crown: (requiredLevel 5) → forbidden 'emote-locked'", async () => {
    const { roomId } = await liveRoom();
    await expectDomainError(
      () => sendChat(roomId, MEMBER, { body: ":crown:", clientMessageId: "emote-lock-01" }),
      "forbidden",
      "emote-locked",
    );
  });

  test("the host is always entitled — :crown: passes for the host", async () => {
    const { roomId } = await liveRoom();
    const { message } = await sendChat(roomId, HOST, {
      body: ":crown:",
      clientMessageId: "emote-host-01",
    });
    expect(message.body).toBe(":crown:");
  });

  test("tokens matching no emote code are ordinary punctuation — body as sent", async () => {
    const { roomId } = await liveRoom();
    const { message } = await sendChat(roomId, MEMBER, {
      body: "score 2:1 time 10:30 :) :ghost:",
      clientMessageId: "emote-punct-01",
    });
    expect(message.body).toBe("score 2:1 time 10:30 :) :ghost:");
  });

  test("no-colon body resolves on the validator's fast path (no throw, send lands)", async () => {
    const { roomId } = await liveRoom();
    const { message } = await sendChat(roomId, MEMBER, {
      body: "plain body no colons",
      clientMessageId: "emote-plain-01",
    });
    expect(message.body).toBe("plain body no colons");
  });

  test("the frozen validator signature resolves a no-colon body directly (fast path)", async () => {
    // The direct seam the hook uses — no colon → resolves without queries.
    await expect(validateEmoteUsage(HOST_ID, MEMBER_ID, "plain body no colons")).resolves.toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// Gate-order precedence: the emote gate sits after sanctions/policy/members
// ═════════════════════════════════════════════════════════════════════

describe("gate-order precedence (emote gate after members-only, before slow-mode)", () => {
  test("anonymous caller → 'unauthenticated' (the emote gate is never reached)", async () => {
    const { roomId } = await liveRoom();
    await expectDomainError(
      () => sendChat(roomId, null, { body: ":heart:", clientMessageId: "emote-anon-01" }),
      "unauthenticated",
    );
  });

  test("banned member → 'banned', NOT 'emote-locked' (sanction precedence)", async () => {
    const { roomId } = await liveRoom();
    await db.liveModerationAction.create({
      data: { roomId, actorId: HOST_ID, targetId: MEMBER_ID, action: "ban" },
    });
    await expectDomainError(
      () => sendChat(roomId, MEMBER, { body: ":heart:", clientMessageId: "emote-ban-001" }),
      "forbidden",
      "banned",
    );
  });

  test("muted member → 'muted' precedence", async () => {
    const { roomId } = await liveRoom();
    await db.liveModerationAction.create({
      data: {
        roomId,
        actorId: HOST_ID,
        targetId: MEMBER_ID,
        action: "mute",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expectDomainError(
      () => sendChat(roomId, MEMBER, { body: ":heart:", clientMessageId: "emote-mute-01" }),
      "forbidden",
      "muted",
    );
  });

  test("chat-disabled room blocks a member before the emote gate; the host's emote still lands", async () => {
    const { roomId } = await liveRoom({ chatEnabled: false });
    await expectDomainError(
      () => sendChat(roomId, MEMBER, { body: ":heart:", clientMessageId: "emote-dis-001" }),
      "forbidden",
      "chat-disabled",
    );
    // The staff bypass: the host speaks (and emotes) with chat disabled.
    const { message } = await sendChat(roomId, HOST, {
      body: ":crown:",
      clientMessageId: "emote-dis-h1",
    });
    expect(message.body).toBe(":crown:");
  });

  test("members-only chat blocks a NON-member before the emote gate; the club member passes it", async () => {
    const { roomId } = await membersChatRoom();
    await expectDomainError(
      () => sendChat(roomId, VIEWER, { body: ":heart:", clientMessageId: "emote-memb-01" }),
      "forbidden",
      "members-only",
    );
    const { message } = await sendChat(roomId, MEMBER, {
      body: ":heart:",
      clientMessageId: "emote-memb-02",
    });
    expect(message.body).toBe(":heart:");
  });

  test("entitlement is per-caller: a non-member viewer's :heart: → 'emote-locked'", async () => {
    const { roomId } = await liveRoom();
    await expectDomainError(
      () => sendChat(roomId, VIEWER, { body: ":heart: go host", clientMessageId: "emote-nonm-01" }),
      "forbidden",
      "emote-locked",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════
// Idempotency + tombstone laws untouched by the hook
// ═════════════════════════════════════════════════════════════════════

describe("idempotency + tombstone laws (untouched by the emote hook)", () => {
  test("duplicate clientMessageId returns duplicate:true with the ORIGINAL body", async () => {
    const { roomId } = await liveRoom();
    const first = await sendChat(roomId, MEMBER, {
      body: "hello :heart: world",
      clientMessageId: "emote-dup-0001",
    });
    expect(first.duplicate).toBeUndefined();
    // The retry body must itself pass the intake gate (the validator runs
    // before the insert) — then the P2002 path returns the ORIGINAL row.
    const retry = await sendChat(roomId, MEMBER, {
      body: "edited :heart: body",
      clientMessageId: "emote-dup-0001",
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    expect(retry.message.body).toBe("hello :heart: world");
  });

  test("idempotent replay of an emote message does not throw from the intake hook", async () => {
    const { roomId } = await liveRoom();
    const first = await sendChat(roomId, MEMBER, {
      body: ":heart: once",
      clientMessageId: "emote-replay-1",
    });
    expect(first.duplicate).toBeUndefined();
    const replay = await sendChat(roomId, MEMBER, {
      body: ":heart: once",
      clientMessageId: "emote-replay-1",
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.message.body).toBe(":heart: once");
    const rows = await db.liveRoomMessage.findMany({
      where: { roomId, senderId: MEMBER_ID, clientMessageId: "emote-replay-1" },
    });
    expect(rows.length).toBe(1);
  });

  test("a moderator tombstone renders the emote message deleted:true body ''", async () => {
    const { roomId } = await liveRoom();
    await db.liveRoomModerator.create({
      data: { roomId, userId: MOD_ID, grantedBy: HOST_ID },
    });
    const { message } = await sendChat(roomId, MEMBER, {
      body: ":heart: hello",
      clientMessageId: "emote-tomb-01",
    });
    await performModeration(roomId, MOD, { action: "delete-message", messageId: message.id });
    const history = await listChat(roomId);
    const row = history.find((m) => m.id === message.id);
    expect(row?.deleted).toBe(true);
    expect(row?.body).toBe("");
  });
});
