/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — lane 2-c Q&A behavior pins.
 *
 * Pins:
 *  - asking: anonymous 401; muted 403 "muted" (asking is SPEECH — mute
 *    blocks it, in contrast to polls where muted users may vote); banned
 *    403 "banned"; viewer ask 200 with a trimmed body; 0/281-char bodies
 *    400; no active session 403 "not-live".
 *  - listing: public list excludes hidden rows and orders newest first;
 *    limit honored; `includeHidden` is honored ONLY for host+moderators
 *    (a viewer passing it still gets the public list); anonymous reads OK.
 *  - moderation: answer/hide by a viewer 403; by a granted moderator OK;
 *    idempotent (re-answer does NOT reset answeredAt; re-hide does NOT
 *    re-stamp hiddenAt); hidden questions leave public lists.
 *  - 429 per RATE_LIMITS.questions (3 per window per room+user).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupLiveDb,
  hostCookie,
  viewerCookie,
  modCookie,
  otherCookie,
  reqWithCookie,
  createRoomFixture,
  startSessionFixture,
  HOST_CLAIMS,
  VIEWER_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  sessionUserOf,
} from "./live-helpers";
import { clearRateLimits } from "@/lib/youtube/cache";
import { ensureShadowUser } from "@/lib/watch/local-comments";

import { GET as listQuestionsRoute, POST as askRoute } from "@/app/api/live-rooms/[id]/questions/route";
import { POST as answerRoute } from "@/app/api/live-rooms/[id]/questions/[qid]/answer/route";
import { POST as hideRoute } from "@/app/api/live-rooms/[id]/questions/[qid]/hide/route";

setupLiveDb();

interface QuestionJson {
  question?: {
    id: string;
    roomId: string;
    askerId: string;
    askerHandle: string;
    body: string;
    answeredAt: string | null;
    hiddenAt: string | null;
  };
  questions?: Array<{
    id: string;
    askerHandle: string;
    body: string;
    answeredAt: string | null;
    hiddenAt: string | null;
  }>;
  error?: string;
  message?: string;
}

const questionsUrl = (roomId: string) => `http://test.local/api/live-rooms/${roomId}/questions`;
const answerUrl = (roomId: string, qid: string) =>
  `http://test.local/api/live-rooms/${roomId}/questions/${qid}/answer`;
const hideUrl = (roomId: string, qid: string) =>
  `http://test.local/api/live-rooms/${roomId}/questions/${qid}/hide`;

const LONG_BODY = "x".repeat(281);

let db: (typeof import("@/lib/db"))["db"];
let host = "";
let viewer = "";
let mod = "";
let other = "";
const hostUser = sessionUserOf(HOST_CLAIMS);
const viewerUser = sessionUserOf(VIEWER_CLAIMS);
const modUser = sessionUserOf(MOD_CLAIMS);
const otherUser = sessionUserOf(OTHER_CLAIMS);

/** A fresh room owned by the host, live unless asked otherwise. */
async function newLiveRoom(opts: { session?: boolean } = {}) {
  const room = await createRoomFixture(
    hostUser,
    `lane-2c questions ${crypto.randomUUID().slice(0, 8)}`,
  );
  if (opts.session !== false) await startSessionFixture(room.roomId);
  return room;
}

/** Grant the shared mod identity a LiveRoomModerator seat on the room. */
async function grantMod(roomId: string, hostShadowId: string) {
  const modShadowId = (await ensureShadowUser(modUser)).id;
  await db.liveRoomModerator.create({
    data: { roomId, userId: modShadowId, grantedBy: hostShadowId },
  });
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  host = await hostCookie();
  viewer = await viewerCookie();
  mod = await modCookie();
  other = await otherCookie();
});

beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

describe("lane 2-c questions", () => {
  test("anonymous ask → 401 unauthenticated", async () => {
    const room = await newLiveRoom();
    const res = await askRoute(reqWithCookie(questionsUrl(room.roomId), "", {
      method: "POST",
      body: { body: "hi" },
    }), { params: Promise.resolve({ id: room.roomId }) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as QuestionJson).error).toBe("unauthenticated");
  });

  test("muted viewer cannot ask → 403 'muted' (asking is speech)", async () => {
    const room = await newLiveRoom();
    const viewerShadowId = (await ensureShadowUser(viewerUser)).id;
    await db.liveModerationAction.create({
      data: {
        roomId: room.roomId,
        actorId: room.hostShadowId,
        targetId: viewerShadowId,
        action: "mute",
        expiresAt: new Date(Date.now() + 60_000), // timed mute — the core's vocabulary
      },
    });
    const res = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body: "still here?" } }),
      { params: Promise.resolve({ id: room.roomId }) },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as QuestionJson;
    expect(json.error).toBe("forbidden");
    expect(json.message).toBe("muted");
  });

  test("banned viewer cannot ask → 403 'banned'", async () => {
    const room = await newLiveRoom();
    const otherShadowId = (await ensureShadowUser(otherUser)).id;
    await db.liveModerationAction.create({
      data: {
        roomId: room.roomId,
        actorId: room.hostShadowId,
        targetId: otherShadowId,
        action: "ban",
      },
    });
    const res = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), other, { method: "POST", body: { body: "anyone?" } }),
      { params: Promise.resolve({ id: room.roomId }) },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as QuestionJson;
    expect(json.error).toBe("forbidden");
    expect(json.message).toBe("banned");
  });

  test("viewer ask OK (trimmed body, dto shape pinned)", async () => {
    const room = await newLiveRoom();
    const res = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, {
        method: "POST",
        body: { body: "  What is WebFlix LIVE?  " },
      }),
      { params: Promise.resolve({ id: room.roomId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as QuestionJson;
    expect(json.question?.body).toBe("What is WebFlix LIVE?");
    expect(json.question?.roomId).toBe(room.roomId);
    expect(json.question?.askerId).not.toBe("");
    expect(json.question?.askerHandle).not.toBe("");
    expect(json.question?.answeredAt).toBeNull();
    expect(json.question?.hiddenAt).toBeNull();
  });

  test("empty body → 400; 281-char body → 400 (QUESTION_BODY_MAX)", async () => {
    const room = await newLiveRoom();
    const ctx = { params: Promise.resolve({ id: room.roomId }) };
    const empty = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body: "   " } }),
      ctx,
    );
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as QuestionJson).error).toBe("invalid");
    const long = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body: LONG_BODY } }),
      ctx,
    );
    expect(long.status).toBe(400);
    expect(((await long.json()) as QuestionJson).error).toBe("invalid");
  });

  test("ask without an active session → 403 not-live", async () => {
    const room = await newLiveRoom({ session: false });
    const res = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body: "hello?" } }),
      { params: Promise.resolve({ id: room.roomId }) },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as QuestionJson;
    expect(json.error).toBe("forbidden");
    expect(json.message).toBe("not-live");
  });

  test("public list hides hidden rows; includeHidden only for host/mod", async () => {
    const room = await newLiveRoom();
    await grantMod(room.roomId, room.hostShadowId);
    const ctx = { params: Promise.resolve({ id: room.roomId }) };
    const ids: string[] = [];
    for (const body of ["question one", "question two", "question three"]) {
      const res = await askRoute(
        reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body } }),
        ctx,
      );
      expect(res.status).toBe(200);
      ids.push(((await res.json()) as QuestionJson).question?.id ?? "");
    }
    // the moderator hides the middle question (tombstone, not delete)
    const hiddenId = ids[1] ?? "";
    const hidden = await hideRoute(reqWithCookie(hideUrl(room.roomId, hiddenId), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid: hiddenId }) });
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as QuestionJson).question?.hiddenAt).not.toBeNull();

    // public (anonymous) list: non-hidden, newest first
    const pub = await listQuestionsRoute(reqWithCookie(questionsUrl(room.roomId), ""), ctx);
    expect(pub.status).toBe(200);
    const pubJson = (await pub.json()) as QuestionJson;
    const mine = (pubJson.questions ?? []).filter((q) => ids.includes(q.id));
    expect(mine.map((q) => q.id)).toEqual([ids[2], ids[0]]);
    expect(mine.every((q) => q.hiddenAt === null)).toBe(true);

    // a viewer passing includeHidden still gets the public list
    const viewerHidden = await listQuestionsRoute(
      reqWithCookie(`${questionsUrl(room.roomId)}?includeHidden=true`, viewer),
      ctx,
    );
    expect(viewerHidden.status).toBe(200);
    const viewerJson = (await viewerHidden.json()) as QuestionJson;
    expect((viewerJson.questions ?? []).filter((q) => ids.includes(q.id)).map((q) => q.id)).toEqual([
      ids[2],
      ids[0],
    ]);

    // the host gets hidden rows too
    const hostHidden = await listQuestionsRoute(
      reqWithCookie(`${questionsUrl(room.roomId)}?includeHidden=1`, host),
      ctx,
    );
    expect(hostHidden.status).toBe(200);
    const hostJson = (await hostHidden.json()) as QuestionJson;
    const hostMine = (hostJson.questions ?? []).filter((q) => ids.includes(q.id));
    expect(hostMine.map((q) => q.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(hostMine.find((q) => q.id === hiddenId)?.hiddenAt).not.toBeNull();

    // limit param honored (newest first)
    const limited = await listQuestionsRoute(
      reqWithCookie(`${questionsUrl(room.roomId)}?limit=1`, viewer),
      ctx,
    );
    const limitedJson = (await limited.json()) as QuestionJson;
    expect((limitedJson.questions ?? []).filter((q) => ids.includes(q.id)).map((q) => q.id)).toEqual([
      ids[2],
    ]);
  });

  test("list for a missing room → 404 not-found", async () => {
    const res = await listQuestionsRoute(reqWithCookie(questionsUrl("room-does-not-exist"), ""), {
      params: Promise.resolve({ id: "room-does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  test("answer/hide by viewer → 403; by moderator OK; idempotent", async () => {
    const room = await newLiveRoom();
    await grantMod(room.roomId, room.hostShadowId);
    const ctx = { params: Promise.resolve({ id: room.roomId }) };
    const asked = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, { method: "POST", body: { body: "answer me?" } }),
      ctx,
    );
    expect(asked.status).toBe(200);
    const qid = ((await asked.json()) as QuestionJson).question?.id ?? "";

    // viewer cannot answer or hide
    const viewerAnswer = await answerRoute(reqWithCookie(answerUrl(room.roomId, qid), viewer, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(viewerAnswer.status).toBe(403);
    expect(((await viewerAnswer.json()) as QuestionJson).error).toBe("forbidden");
    const viewerHide = await hideRoute(reqWithCookie(hideUrl(room.roomId, qid), viewer, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(viewerHide.status).toBe(403);

    // moderator answers; re-answer does NOT reset answeredAt
    const answered = await answerRoute(reqWithCookie(answerUrl(room.roomId, qid), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(answered.status).toBe(200);
    const answeredJson = (await answered.json()) as QuestionJson;
    expect(answeredJson.question?.answeredAt).not.toBeNull();
    expect(answeredJson.question?.hiddenAt).toBeNull();

    const reAnswered = await answerRoute(reqWithCookie(answerUrl(room.roomId, qid), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(reAnswered.status).toBe(200);
    expect(((await reAnswered.json()) as QuestionJson).question?.answeredAt).toBe(
      answeredJson.question?.answeredAt,
    );

    // moderator hides; hidden leaves the public list; re-hide is idempotent
    const hiddenAt = await hideRoute(reqWithCookie(hideUrl(room.roomId, qid), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(hiddenAt.status).toBe(200);
    const hiddenJson = (await hiddenAt.json()) as QuestionJson;
    expect(hiddenJson.question?.hiddenAt).not.toBeNull();

    const reHidden = await hideRoute(reqWithCookie(hideUrl(room.roomId, qid), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: room.roomId, qid }) });
    expect(reHidden.status).toBe(200);
    expect(((await reHidden.json()) as QuestionJson).question?.hiddenAt).toBe(
      hiddenJson.question?.hiddenAt,
    );

    const pub = await listQuestionsRoute(reqWithCookie(questionsUrl(room.roomId), ""), ctx);
    const pubJson = (await pub.json()) as QuestionJson;
    expect((pubJson.questions ?? []).some((q) => q.id === qid)).toBe(false);
  });

  test("answer for another room's question → 404 not-found", async () => {
    const roomA = await newLiveRoom();
    const roomB = await newLiveRoom();
    await grantMod(roomB.roomId, roomB.hostShadowId);
    const asked = await askRoute(
      reqWithCookie(questionsUrl(roomA.roomId), viewer, { method: "POST", body: { body: "cross-room?" } }),
      { params: Promise.resolve({ id: roomA.roomId }) },
    );
    const qid = ((await asked.json()) as QuestionJson).question?.id ?? "";
    const res = await answerRoute(reqWithCookie(answerUrl(roomB.roomId, qid), mod, {
      method: "POST",
    }), { params: Promise.resolve({ id: roomB.roomId, qid }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as QuestionJson).error).toBe("not-found");
  });

  test("ask rate limit → 429 (RATE_LIMITS.questions = 3)", async () => {
    const room = await newLiveRoom();
    const ctx = { params: Promise.resolve({ id: room.roomId }) };
    for (let i = 0; i < 3; i++) {
      const res = await askRoute(
        reqWithCookie(questionsUrl(room.roomId), viewer, {
          method: "POST",
          body: { body: `rate limit probe ${i}` },
        }),
        ctx,
      );
      expect(res.status).toBe(200);
    }
    const fourth = await askRoute(
      reqWithCookie(questionsUrl(room.roomId), viewer, {
        method: "POST",
        body: { body: "one too many" },
      }),
      ctx,
    );
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as QuestionJson).error).toBe("rate-limited");
  });
});
