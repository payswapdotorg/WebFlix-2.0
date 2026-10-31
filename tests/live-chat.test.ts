/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 lane 2-a — the chat behavior pins.
 *
 * Route handlers are called DIRECTLY with minted session cookies (the
 * live-helpers law — no network). Pins: the authorization matrix (401/403
 * muted|banned|chat-disabled|slow-mode|not-live), input validation (400),
 * the 429 budget, the clientMessageId idempotency law (one row, original
 * body wins, duplicate: true), durable replay (seq asc, strictly-after
 * cursor, tombstone rendering) and the announcement/system kind rules.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  hostCookie,
  modCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { GET as getChat, POST as postChat } from "@/app/api/live-rooms/[id]/chat/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { CHAT_BODY_MAX, RATE_LIMITS } from "@/lib/live/permissions";
import type { LiveChatMessageDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let MOD = "";
let hostShadowId = "";
let viewerShadowId = "";
let modShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  MOD = await modCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
  modShadowId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
});

function chatUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/chat`;
}

async function postChatAs(
  cookie: string,
  roomId: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const req =
    body === null
      ? new Request(chatUrl(roomId), {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: "{definitely not json",
        })
      : reqWithCookie(chatUrl(roomId), cookie, { method: "POST", body });
  const res = await postChat(req, { params: Promise.resolve({ id: roomId }) });
  return { status: res.status, body: await res.json() };
}

async function getChatAs(
  cookie: string,
  roomId: string,
  query = "",
): Promise<{ status: number; body: any }> {
  const res = await getChat(reqWithCookie(chatUrl(roomId) + query, cookie), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

/** A fresh room (policy overrides applied) with a live session. */
async function liveRoom(
  policy: {
    chatEnabled?: boolean;
    reactionsEnabled?: boolean;
    slowModeSeconds?: number;
  } = {},
): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `2a-chat-${crypto.randomUUID().slice(0, 8)}`,
  );
  if (Object.keys(policy).length > 0) {
    await db.liveRoom.update({ where: { id: roomId }, data: policy });
  }
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

async function sendOk(
  cookie: string,
  roomId: string,
  body: string,
  clientMessageId: string,
  kind?: "chat" | "announcement",
): Promise<LiveChatMessageDto> {
  const { status, body: payload } = await postChatAs(cookie, roomId, {
    body,
    clientMessageId,
    ...(kind ? { kind } : {}),
  });
  expect(status).toBe(200);
  expect(payload.message).toBeDefined();
  return payload.message as LiveChatMessageDto;
}

describe("live chat — auth + existence gates", () => {
  test("anonymous POST is 401 unauthenticated", async () => {
    const { roomId } = await liveRoom();
    const { status, body } = await postChatAs("next-auth.session-token=none", roomId, {
      body: "hi",
      clientMessageId: "anonmsg01",
    });
    expect(status).toBe(401);
    expect(body.error).toBe("unauthenticated");
  });

  test("unknown room is 404 not-found (POST + GET)", async () => {
    const { status, body } = await postChatAs(VIEWER, "room-does-not-exist", {
      body: "hi",
      clientMessageId: "ghostmsg01",
    });
    expect(status).toBe(404);
    expect(body.error).toBe("not-found");
    const got = await getChatAs(VIEWER, "room-does-not-exist");
    expect(got.status).toBe(404);
    expect(got.body.error).toBe("not-found");
  });

  test("no active session is 403 not-live", async () => {
    const { roomId } = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `2a-chat-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const { status, body } = await postChatAs(VIEWER, roomId, {
      body: "hi",
      clientMessageId: "idlemsg01",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.message).toBe("not-live");
  });
});

describe("live chat — validation (400 invalid)", () => {
  test("empty body, over-long body, bad clientMessageId, system kind, invalid JSON", async () => {
    const { roomId } = await liveRoom();

    const empty = await postChatAs(VIEWER, roomId, { body: "   ", clientMessageId: "validid01" });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("invalid");

    const long = await postChatAs(VIEWER, roomId, {
      body: "x".repeat(CHAT_BODY_MAX + 1),
      clientMessageId: "validid02",
    });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe("invalid");

    const shortId = await postChatAs(VIEWER, roomId, { body: "hi", clientMessageId: "short" });
    expect(shortId.status).toBe(400);
    expect(shortId.body.error).toBe("invalid");

    const longId = await postChatAs(VIEWER, roomId, {
      body: "hi",
      clientMessageId: "x".repeat(65),
    });
    expect(longId.status).toBe(400);
    expect(longId.body.error).toBe("invalid");

    const missingId = await postChatAs(VIEWER, roomId, { body: "hi" });
    expect(missingId.status).toBe(400);
    expect(missingId.body.error).toBe("invalid");

    const systemKind = await postChatAs(HOST, roomId, {
      body: "server says",
      clientMessageId: "systemkind",
      kind: "system",
    });
    expect(systemKind.status).toBe(400);
    expect(systemKind.body.error).toBe("invalid");

    const badJson = await postChatAs(VIEWER, roomId, null);
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toBe("invalid");
  });
});

describe("live chat — sanctions (403 muted / banned)", () => {
  test("a timed mute blocks chat with 403 muted", async () => {
    const { roomId, sessionId } = await liveRoom();
    await db.liveModerationAction.create({
      data: {
        roomId,
        sessionId,
        actorId: hostShadowId,
        targetId: viewerShadowId,
        action: "mute",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const { status, body } = await postChatAs(VIEWER, roomId, {
      body: "let me speak",
      clientMessageId: "mutedmsg01",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.message).toBe("muted");
  });

  test("a ban blocks chat with 403 banned", async () => {
    const { roomId } = await liveRoom();
    await db.liveModerationAction.create({
      data: { roomId, actorId: hostShadowId, targetId: viewerShadowId, action: "ban" },
    });
    const { status, body } = await postChatAs(VIEWER, roomId, {
      body: "let me in",
      clientMessageId: "bannedmsg1",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.message).toBe("banned");
  });
});

describe("live chat — policy (chat-disabled + bypass)", () => {
  test("viewer is blocked when chatEnabled=false; the host can still chat", async () => {
    const { roomId } = await liveRoom({ chatEnabled: false });
    const viewerTry = await postChatAs(VIEWER, roomId, {
      body: "hi",
      clientMessageId: "disabled01",
    });
    expect(viewerTry.status).toBe(403);
    expect(viewerTry.body.error).toBe("forbidden");
    expect(viewerTry.body.message).toBe("chat-disabled");

    // The staff bypass: the host speaks even with chat disabled.
    const hostMsg = await sendOk(HOST, roomId, "host speaks", "hostdisable1");
    expect(hostMsg.kind).toBe("chat");
    expect(hostMsg.seq).toBeGreaterThan(0);
  });
});

describe("live chat — slow-mode", () => {
  test("viewer's 2nd message inside the window is 403 slow-mode; host bypasses", async () => {
    const { roomId } = await liveRoom({ slowModeSeconds: 60 });

    const first = await sendOk(VIEWER, roomId, "first", "slowviewer1");
    expect(first.seq).toBeGreaterThan(0);

    const second = await postChatAs(VIEWER, roomId, {
      body: "too soon",
      clientMessageId: "slowviewer2",
    });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("forbidden");
    expect(second.body.message).toBe("slow-mode");

    // Host/moderator bypass — two quick messages both land.
    const h1 = await sendOk(HOST, roomId, "host one", "slowhost01");
    const h2 = await sendOk(HOST, roomId, "host two", "slowhost02");
    expect(h2.seq).toBeGreaterThan(h1.seq);
  });
});

describe("live chat — rate limit (429)", () => {
  test("fire > RATE_LIMITS.chat with distinct ids → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.chat.limit;
    for (let i = 0; i < limit + 2; i++) {
      const { status } = await postChatAs(VIEWER, roomId, {
        body: `burst ${i}`,
        clientMessageId: `burst-${crypto.randomUUID().slice(0, 8)}-${i}`,
      });
      if (i < limit) expect(status).toBe(200);
      else expect(status).toBe(429);
    }
  });
});

describe("live chat — idempotency law", () => {
  test("duplicate clientMessageId returns the ORIGINAL message with duplicate: true — one row", async () => {
    const { roomId, sessionId } = await liveRoom();
    const first = await sendOk(VIEWER, roomId, "original text", "dupesame01");
    const retry = await postChatAs(VIEWER, roomId, {
      body: "edited text",
      clientMessageId: "dupesame01",
    });
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.message?.id).toBe(first.id);
    expect(retry.body.message?.body).toBe("original text");
    const rows = await db.liveRoomMessage.findMany({
      where: { sessionId, senderId: viewerShadowId, clientMessageId: "dupesame01" },
    });
    expect(rows.length).toBe(1);
  });
});

describe("live chat — durable replay (GET)", () => {
  test("seq-asc ordering, strictly-after cursor, tombstone rendering, limit", async () => {
    const { roomId } = await liveRoom();
    const m1 = await sendOk(HOST, roomId, "one", "replaymsg01");
    const m2 = await sendOk(VIEWER, roomId, "two", "replaymsg02");
    const m3 = await sendOk(HOST, roomId, "three", "replaymsg03");

    const all = await getChatAs("next-auth.session-token=none", roomId); // anonymous read is lawful
    expect(all.status).toBe(200);
    expect(all.body.messages.map((m: LiveChatMessageDto) => m.seq)).toEqual([
      m1.seq,
      m2.seq,
      m3.seq,
    ]);

    const after = await getChatAs(VIEWER, roomId, `?after=${m1.seq}`);
    expect(after.body.messages.map((m: LiveChatMessageDto) => m.seq)).toEqual([m2.seq, m3.seq]);

    const limited = await getChatAs(VIEWER, roomId, `?after=${m1.seq}&limit=1`);
    expect(limited.body.messages.map((m: LiveChatMessageDto) => m.seq)).toEqual([m2.seq]);

    // Tombstone: the row stays in the transcript but renders removed.
    await db.liveRoomMessage.update({
      where: { id: m2.id },
      data: { deletedAt: new Date() },
    });
    const tombs = await getChatAs(VIEWER, roomId, `?after=${m1.seq}`);
    const rendered = tombs.body.messages as LiveChatMessageDto[];
    expect(rendered.map((m) => m.seq)).toEqual([m2.seq, m3.seq]);
    const tomb = rendered.find((m) => m.id === m2.id);
    expect(tomb?.deleted).toBe(true);
    expect(tomb?.body).toBe("");
    const survivor = rendered.find((m) => m.id === m3.id);
    expect(survivor?.deleted).toBe(false);
    expect(survivor?.body).toBe("three");
  });

  test("sender handles resolve through the shadow-user seam", async () => {
    const { roomId } = await liveRoom();
    const msg = await sendOk(VIEWER, roomId, "who am i", "handlesm1");
    const got = await getChatAs(HOST, roomId, `?after=${msg.seq - 1}`);
    const mine = (got.body.messages as LiveChatMessageDto[]).find((m) => m.id === msg.id);
    expect(mine?.senderId).toBe(viewerShadowId);
    expect(mine?.senderName).toBe("Live Viewer");
    expect((mine?.senderHandle ?? "").length).toBeGreaterThan(0);
  });
});

describe("live chat — announcement + system kinds", () => {
  test("announcement: host + moderator allowed, viewer 403, system 400", async () => {
    const { roomId } = await liveRoom();
    await db.liveRoomModerator.create({
      data: { roomId, userId: modShadowId, grantedBy: hostShadowId },
    });

    const hostAnn = await sendOk(HOST, roomId, "stream starting", "annchost01", "announcement");
    expect(hostAnn.kind).toBe("announcement");

    const modAnn = await sendOk(MOD, roomId, "mod note", "annmod001", "announcement");
    expect(modAnn.kind).toBe("announcement");

    const viewerTry = await postChatAs(VIEWER, roomId, {
      body: "fake announcement",
      clientMessageId: "annviewer1",
      kind: "announcement",
    });
    expect(viewerTry.status).toBe(403);
    expect(viewerTry.body.error).toBe("forbidden");

    const system = await postChatAs(MOD, roomId, {
      body: "spoofed system",
      clientMessageId: "sysmod001",
      kind: "system",
    });
    expect(system.status).toBe(400);
    expect(system.body.error).toBe("invalid");
  });
});
