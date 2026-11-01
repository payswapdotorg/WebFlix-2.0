/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Parity P70-3 — the LIVE Goals pins (ADR-0012).
 *
 * Pins: the host-only gate (403 for viewer/mod/anonymous), the validation
 * matrix (kind/target/title), the ONE-OPEN-GOAL-PER-ROOM law (409
 * goal-open), the DERIVED progress laws per kind (hearts = Σ batch counts,
 * giftCredits = Σ totalCredits, chat = non-tombstoned messages — all
 * strictly since the goal's createdAt, room-scoped; pre-goal activity NEVER
 * counts), the LAZY reach flip (progress >= target stamps reached +
 * reachedAt + the goal envelope), the close law (terminal; a closed goal is
 * frozen; the room may start the next), the envelope fan-out on
 * create/flip/close, the activity hooks (a gift/chat/reaction commit flips
 * a crossed goal without any explicit read), the 404 for a foreign room and
 * the 429 budget.
 *
 * Run: DATABASE_URL=file:../db/live-goals-test.db bun test --isolate tests/live-goals.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
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
import {
  GOAL_TARGET_MAX,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import { subscribeLiveRoom } from "@/lib/live/hub";
import { sendChat } from "@/lib/live/chat";
import { sendReactionBatch } from "@/lib/live/reactions";
import { sendGift } from "@/lib/live/gifts";
import type { LiveGoalDto, LiveStreamEvent } from "@/lib/live/types";

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

function goalsUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/goals`;
}

async function postGoal(
  cookie: string,
  roomId: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const { POST } = await import("@/app/api/live-rooms/[id]/goals/route");
  const res = await POST(reqWithCookie(goalsUrl(roomId), cookie, { method: "POST", body }), {
    params: Promise.resolve({ id: roomId }),
  });
  return { status: res.status, body: await res.json() };
}

async function getGoals(
  roomId: string,
  cookie?: string,
): Promise<{ status: number; body: any }> {
  const { GET } = await import("@/app/api/live-rooms/[id]/goals/route");
  const res = await GET(
    reqWithCookie(goalsUrl(roomId), cookie ?? "next-auth.session-token=none"),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function deleteGoal(
  cookie: string,
  roomId: string,
  goalId: string,
): Promise<{ status: number; body: any }> {
  const { DELETE } = await import("@/app/api/live-rooms/[id]/goals/route");
  const res = await DELETE(
    reqWithCookie(`${goalsUrl(roomId)}?goalId=${encodeURIComponent(goalId)}`, cookie, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function liveRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `p70-goal-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

/** A collect-all envelope recorder on the room topic (the publish pin). */
function recordEnvelopes(roomId: string): { events: LiveStreamEvent[]; stop: () => void } {
  const events: LiveStreamEvent[] = [];
  const stop = subscribeLiveRoom(roomId, (event) => events.push(event));
  return { events, stop };
}

// ─────────────────────────────────────────────────────────────────────
describe("live goals — the host-only gate + validation", () => {
  test("anonymous 401 · viewer 403 · mod 403 · host 201", async () => {
    const { roomId } = await liveRoom();
    const anon = await postGoal("next-auth.session-token=none", roomId, {
      kind: "hearts",
      target: 10,
    });
    expect(anon.status).toBe(401);
    const viewer = await postGoal(VIEWER, roomId, { kind: "hearts", target: 10 });
    expect(viewer.status).toBe(403);
    const mod = await postGoal(MOD, roomId, { kind: "hearts", target: 10 });
    expect(mod.status).toBe(403);
    const host = await postGoal(HOST, roomId, { kind: "hearts", target: 10 });
    expect(host.status).toBe(201);
    expect(host.body.goal.status).toBe("open");
    expect(host.body.goal.progress).toBe(0);
  });

  test("validation: unknown kind 400 · target bounds 400 · title clamped to GOAL_TITLE_MAX", async () => {
    const { roomId } = await liveRoom();
    const badKind = await postGoal(HOST, roomId, { kind: "sparkles", target: 10 });
    expect(badKind.status).toBe(400);
    const zero = await postGoal(HOST, roomId, { kind: "hearts", target: 0 });
    expect(zero.status).toBe(400);
    const over = await postGoal(HOST, roomId, { kind: "hearts", target: GOAL_TARGET_MAX + 1 });
    expect(over.status).toBe(400);
    const fractional = await postGoal(HOST, roomId, { kind: "hearts", target: 2.5 });
    expect(fractional.status).toBe(400);
    const titled = await postGoal(HOST, roomId, {
      kind: "chat",
      target: 5,
      title: "x".repeat(200),
    });
    expect(titled.status).toBe(201);
    expect(titled.body.goal.title).toHaveLength(80);
  });

  test("the ONE-OPEN-GOAL-PER-ROOM law: a second open create is 409 goal-open", async () => {
    const { roomId } = await liveRoom();
    const first = await postGoal(HOST, roomId, { kind: "hearts", target: 10 });
    expect(first.status).toBe(201);
    const second = await postGoal(HOST, roomId, { kind: "chat", target: 5 });
    expect(second.status).toBe(409);
    expect(second.body.message).toBe("goal-open");
  });

  test("unknown room 404", async () => {
    const res = await postGoal(HOST, "room-does-not-exist", { kind: "hearts", target: 10 });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live goals — the derived progress laws (ADR-0008/0009)", () => {
  test("hearts: Σ batch counts since createdAt (room-scoped) — pre-goal rows never count", async () => {
    const { roomId, sessionId } = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    // Pre-goal activity: 5 hearts BEFORE the goal exists.
    await sendReactionBatch(roomId, viewer, {
      clientBatchId: "pre-goal-0001",
      count: 5,
    });
    const created = await postGoal(HOST, roomId, { kind: "hearts", target: 50 });
    expect(created.status).toBe(201);
    // Post-goal activity: 2 more batches = 7 hearts.
    await sendReactionBatch(roomId, viewer, { clientBatchId: "post-goal-001", count: 4 });
    await sendReactionBatch(roomId, viewer, { clientBatchId: "post-goal-002", count: 3 });
    const read = await getGoals(roomId);
    expect(read.status).toBe(200);
    const goal = (read.body.goals as LiveGoalDto[]).find((g) => g.id === created.body.goal.id);
    expect(goal?.progress).toBe(7); // the 5 pre-goal hearts are excluded
    expect(goal?.status).toBe("open");
    void sessionId;
  });

  test("giftCredits: Σ totalCredits since createdAt; chat: non-tombstoned messages since createdAt", async () => {
    const { roomId } = await liveRoom();
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    const g1 = await sendGift(roomId, viewer, {
      giftItemId: "spark-cheer",
      quantity: 2,
      clientRequestId: "goal-gift-0001",
    });
    expect(g1.gift.totalCredits).toBe(10);
    const goalGift = await postGoal(HOST, roomId, { kind: "giftCredits", target: 100 });
    await sendGift(roomId, viewer, {
      giftItemId: "burst-applause",
      quantity: 1,
      clientRequestId: "goal-gift-0002",
    });
    const goalChat = await postGoal(HOST, roomId, { kind: "chat", target: 100 });
    // Wait — the one-open law: the gift goal above is still open... the
    // create above must have failed. Assert the law instead.
    expect(goalChat.status).toBe(409);

    // Close the gift goal, then open a chat goal (the documented lifecycle).
    const closed = await deleteGoal(HOST, roomId, goalGift.body.goal.id);
    expect(closed.status).toBe(200);
    expect(closed.body.goal.status).toBe("closed");
    const chat2 = await postGoal(HOST, roomId, { kind: "chat", target: 100 });
    expect(chat2.status).toBe(201);
    await sendChat(roomId, viewer, { body: "goal chat one", clientMessageId: "goalchat001" });
    await sendChat(roomId, viewer, { body: "goal chat two", clientMessageId: "goalchat002" });
    const read = await getGoals(roomId);
    const goals = read.body.goals as LiveGoalDto[];
    const gift = goals.find((g) => g.id === goalGift.body.goal.id);
    const chat = goals.find((g) => g.id === chat2.body.goal.id);
    // The gift goal closed at 10 (the pre-goal send never counted).
    expect(gift?.progress).toBe(10);
    expect(chat?.progress).toBe(2);
  });

  test("the LAZY REACH FLIP: crossing the target stamps reached + reachedAt + publishes the envelope", async () => {
    const { roomId } = await liveRoom();
    const { events, stop } = recordEnvelopes(roomId);
    const created = await postGoal(HOST, roomId, { kind: "chat", target: 2 });
    expect(created.status).toBe(201);
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    await sendChat(roomId, viewer, { body: "flip one", clientMessageId: "flipone0001" });
    await sendChat(roomId, viewer, { body: "flip two", clientMessageId: "fliptwo0002" });
    const read = await getGoals(roomId);
    const goal = (read.body.goals as LiveGoalDto[]).find((g) => g.id === created.body.goal.id);
    expect(goal?.status).toBe("reached");
    expect(goal?.reachedAt).not.toBeNull();
    expect(goal?.progress).toBeGreaterThanOrEqual(2);
    // The envelope: the create + the activity-hook flip (chat writes carry
    // onRoomActivity) — at least one `goal` envelope with status reached.
    const goalEvents = events.filter((e) => e.kind === "goal") as Extract<
      LiveStreamEvent,
      { kind: "goal" }
    >[];
    stop();
    expect(goalEvents.length).toBeGreaterThanOrEqual(2);
    expect(goalEvents.some((e) => e.goal.status === "reached" && e.goal.progress >= 2)).toBe(
      true,
    );
  });

  test("the ACTIVITY HOOK flips a crossed goal without any explicit read (gift kind)", async () => {
    const { roomId } = await liveRoom();
    const { events, stop } = recordEnvelopes(roomId);
    const created = await postGoal(HOST, roomId, { kind: "giftCredits", target: 5 });
    expect(created.status).toBe(201);
    const viewer = sessionUserOf(VIEWER_CLAIMS);
    // ONE send crossing the target — the hook runs inside sendGift.
    const send = await sendGift(roomId, viewer, {
      giftItemId: "spark-cheer",
      quantity: 1,
      clientRequestId: "hook-gift-0001",
    });
    expect(send.gift.totalCredits).toBe(5);
    const row = await db.liveRoomGoal.findUnique({ where: { id: created.body.goal.id } });
    expect(row?.status).toBe("reached");
    expect(row?.reachedAt).not.toBeNull();
    const goalEvents = events.filter((e) => e.kind === "goal") as Extract<
      LiveStreamEvent,
      { kind: "goal" }
    >[];
    stop();
    expect(goalEvents.some((e) => e.goal.status === "reached")).toBe(true);
  });

  test("close: terminal + frozen; the room may start the next goal after", async () => {
    const { roomId } = await liveRoom();
    const created = await postGoal(HOST, roomId, { kind: "hearts", target: 10 });
    const closed = await deleteGoal(HOST, roomId, created.body.goal.id);
    expect(closed.status).toBe(200);
    expect(closed.body.goal.status).toBe("closed");
    expect(closed.body.goal.closedAt).not.toBeNull();
    const again = await deleteGoal(HOST, roomId, created.body.goal.id);
    expect(again.status).toBe(409);
    const next = await postGoal(HOST, roomId, { kind: "hearts", target: 20 });
    expect(next.status).toBe(201);
    // Foreign goalId / foreign room both 404; viewer close 403.
    const viewerClose = await deleteGoal(VIEWER, roomId, next.body.goal.id);
    expect(viewerClose.status).toBe(403);
    const ghost = await deleteGoal(HOST, roomId, "goal-does-not-exist");
    expect(ghost.status).toBe(404);
  });

  test("the read is anonymous OK and a foreign room 404s", async () => {
    const { roomId } = await liveRoom();
    await postGoal(HOST, roomId, { kind: "hearts", target: 10 });
    const anon = await getGoals(roomId);
    expect(anon.status).toBe(200);
    expect(anon.body.goals as LiveGoalDto[]).toHaveLength(1);
    const ghost = await getGoals("room-does-not-exist");
    expect(ghost.status).toBe(404);
  });

  test("the 429 budget: > RATE_LIMITS.goalManage mutating calls in the window → 429", async () => {
    const { roomId } = await liveRoom();
    const limit = RATE_LIMITS.goalManage.limit;
    let saw429 = false;
    for (let i = 0; i < limit + 3; i++) {
      const res = await postGoal(HOST, roomId, { kind: "hearts", target: 10 + i });
      // The one-open law 409s the ones that slip through while one is open —
      // close each accepted goal so the loop probes the RATE LIMIT only.
      if (res.status === 201) await deleteGoal(HOST, roomId, res.body.goal.id);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
