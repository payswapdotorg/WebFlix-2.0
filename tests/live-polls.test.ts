/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — lane 2-c POLL behavior pins.
 *
 * Routes are exercised by calling their handlers DIRECTLY with Requests
 * that carry a real minted session cookie (tests/live-helpers.ts law — no
 * network, no fake auth). Pins:
 *  - authorization: viewer cannot create/close; anonymous cannot vote;
 *    muted viewers CAN vote (mute is a chat sanction, not a ballot one).
 *  - validation: 1 option / 7 options / blank label / duplicate labels
 *    (case-insensitive) → 400 invalid.
 *  - THE ONE-OPEN-POLL LAW: a second create closes the room's previous
 *    open poll (closedAt stamped in the db).
 *  - THE ONE-VOTE LAW: re-voting MOVES the vote (old option count drops,
 *    new one rises — counts are server SUMs); same-option re-vote is a
 *    no-op success; client-injected count fields are ignored.
 *  - live-room law: poll writes 403 "not-live" without an active session.
 *  - idempotent close (closedAt never bumped), 409 on closed-poll votes,
 *    404 for polls of another room, 429 per RATE_LIMITS.pollCreate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupLiveDb,
  hostCookie,
  viewerCookie,
  reqWithCookie,
  createRoomFixture,
  startSessionFixture,
  endSessionFixture,
  HOST_CLAIMS,
  VIEWER_CLAIMS,
  sessionUserOf,
} from "./live-helpers";
import { clearRateLimits } from "@/lib/youtube/cache";
import { ensureShadowUser } from "@/lib/watch/local-comments";

import { POST as createPollRoute } from "@/app/api/live-rooms/[id]/polls/route";
import { POST as voteRoute } from "@/app/api/live-rooms/[id]/polls/[pollId]/vote/route";
import { POST as closeRoute } from "@/app/api/live-rooms/[id]/polls/[pollId]/close/route";

setupLiveDb();

interface PollOptionJson {
  id: string;
  label: string;
  position: number;
  votes: number;
}
interface PollJson {
  poll?: {
    id: string;
    roomId: string;
    sessionId: string;
    question: string;
    status: string;
    createdById: string;
    options: PollOptionJson[];
    myVoteOptionId: string | null;
    closedAt: string | null;
  };
  error?: string;
  message?: string;
}
type PollPayload = { method: string; body: unknown };

const pollsUrl = (roomId: string) => `http://test.local/api/live-rooms/${roomId}/polls`;
const voteUrl = (roomId: string, pollId: string) =>
  `http://test.local/api/live-rooms/${roomId}/polls/${pollId}/vote`;
const closeUrl = (roomId: string, pollId: string) =>
  `http://test.local/api/live-rooms/${roomId}/polls/${pollId}/close`;

/** Server-computed counts, keyed by option label (readable assertions). */
function countsByLabel(poll: { options: PollOptionJson[] }): Record<string, number> {
  return Object.fromEntries(poll.options.map((o) => [o.label, o.votes]));
}

let db: (typeof import("@/lib/db"))["db"];
let host = "";
let viewer = "";
const hostUser = sessionUserOf(HOST_CLAIMS);
const viewerUser = sessionUserOf(VIEWER_CLAIMS);

let roomId = "";
let pollAId = "";
let pollAOption = "";
let pollBId = "";
let pollBOptionA = "";
let pollBOptionB = "";

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  host = await hostCookie();
  viewer = await viewerCookie();
  const room = await createRoomFixture(hostUser, "lane-2c polls main");
  roomId = room.roomId;
  await startSessionFixture(roomId);
});

beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

describe("lane 2-c polls", () => {
  test("viewer cannot create a poll (403 forbidden)", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), viewer, {
        method: "POST",
        body: { question: "Viewer poll?", options: ["a", "b"] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as PollJson;
    expect(json.error).toBe("forbidden");
  });

  test("host creates a poll (200, open, zero counts, myVote null)", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Best lane?", options: ["polls", "events"] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.status).toBe("open");
    expect(json.poll?.question).toBe("Best lane?");
    expect(json.poll?.options.map((o) => o.label)).toEqual(["polls", "events"]);
    expect(json.poll?.options.every((o) => o.votes === 0)).toBe(true);
    expect(json.poll?.myVoteOptionId).toBeNull();
    pollAId = json.poll?.id ?? "";
    pollAOption = json.poll?.options[0]?.id ?? "";
    expect(pollAId).not.toBe("");
  });

  test("1 option → 400 invalid", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Too few?", options: ["only"] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PollJson).error).toBe("invalid");
  });

  test("7 options → 400 invalid", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Too many?", options: ["1", "2", "3", "4", "5", "6", "7"] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PollJson).error).toBe("invalid");
  });

  test("blank option label → 400 invalid", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Blank?", options: ["real", "   "] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PollJson).error).toBe("invalid");
  });

  test("duplicate labels (case-insensitive) → 400 invalid", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Dupes?", options: ["Alpha", "  ALPHA "] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PollJson).error).toBe("invalid");
  });

  test("SECOND create auto-closes the first poll (one-open-poll law)", async () => {
    const res = await createPollRoute(
      reqWithCookie(pollsUrl(roomId), host, {
        method: "POST",
        body: { question: "Second?", options: ["x", "y"] },
      }),
      { params: Promise.resolve({ id: roomId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.status).toBe("open");
    pollBId = json.poll?.id ?? "";
    pollBOptionA = json.poll?.options[0]?.id ?? "";
    pollBOptionB = json.poll?.options[1]?.id ?? "";
    expect(pollBId).not.toBe(pollAId);

    const first = await db.livePoll.findUnique({ where: { id: pollAId } });
    expect(first?.status).toBe("closed");
    expect(first?.closedAt).not.toBeNull();
  });

  test("viewer votes (200; counts + myVoteOptionId server-derived)", async () => {
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollBOptionA },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.myVoteOptionId).toBe(pollBOptionA);
    expect(countsByLabel(json.poll!)).toEqual({ x: 1, y: 0 });
  });

  test("vote for a foreign optionId → 400 invalid", async () => {
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollAOption },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PollJson).error).toBe("invalid");
  });

  test("re-vote MOVES the count (A drops, B rises — server-side)", async () => {
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollBOptionB },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.myVoteOptionId).toBe(pollBOptionB);
    expect(countsByLabel(json.poll!)).toEqual({ x: 0, y: 1 });
  });

  test("same-option re-vote is a no-op success", async () => {
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollBOptionB },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.myVoteOptionId).toBe(pollBOptionB);
    expect(countsByLabel(json.poll!)).toEqual({ x: 0, y: 1 });
  });

  test("counts NEVER trust the client (injected votes field ignored)", async () => {
    const payload: PollPayload = {
      method: "POST",
      body: { optionId: pollBOptionA, votes: 999 },
    };
    const res = await voteRoute(reqWithCookie(voteUrl(roomId, pollBId), viewer, payload), {
      params: Promise.resolve({ id: roomId, pollId: pollBId }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(countsByLabel(json.poll!)).toEqual({ x: 1, y: 0 });
    expect(json.poll?.myVoteOptionId).toBe(pollBOptionA);
  });

  test("anonymous vote → 401 unauthenticated", async () => {
    const res = await voteRoute(reqWithCookie(voteUrl(roomId, pollBId), "", {
      method: "POST",
      body: { optionId: pollBOptionA },
    }), { params: Promise.resolve({ id: roomId, pollId: pollBId }) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as PollJson).error).toBe("unauthenticated");
  });

  test("vote without an active session → 403 not-live (live-room law)", async () => {
    await endSessionFixture(roomId);
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollBOptionB },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as PollJson;
    expect(json.error).toBe("forbidden");
    expect(json.message).toBe("not-live");
    await startSessionFixture(roomId); // back to live for the pins below
  });

  test("muted viewer CAN vote (mute is a chat sanction, not a ballot one)", async () => {
    const room2 = await createRoomFixture(hostUser, "lane-2c polls muted-vote");
    await startSessionFixture(room2.roomId);
    const viewerShadowId = (await ensureShadowUser(viewerUser)).id;
    await db.liveModerationAction.create({
      data: {
        roomId: room2.roomId,
        actorId: room2.hostShadowId,
        targetId: viewerShadowId,
        action: "mute",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const created = await createPollRoute(
      reqWithCookie(pollsUrl(room2.roomId), host, {
        method: "POST",
        body: { question: "Muted can vote?", options: ["yes", "no"] },
      }),
      { params: Promise.resolve({ id: room2.roomId }) },
    );
    expect(created.status).toBe(200);
    const pollJson = (await created.json()) as PollJson;
    const yesId = pollJson.poll?.options[0]?.id ?? "";
    const res = await voteRoute(
      reqWithCookie(voteUrl(room2.roomId, pollJson.poll?.id ?? ""), viewer, {
        method: "POST",
        body: { optionId: yesId },
      }),
      { params: Promise.resolve({ id: room2.roomId, pollId: pollJson.poll?.id ?? "" }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as PollJson;
    expect(json.poll?.myVoteOptionId).toBe(yesId);
    expect(countsByLabel(json.poll!)).toEqual({ yes: 1, no: 0 });
  });

  test("viewer cannot close a poll (403 forbidden)", async () => {
    const res = await closeRoute(reqWithCookie(closeUrl(roomId, pollBId), viewer, {
      method: "POST",
    }), { params: Promise.resolve({ id: roomId, pollId: pollBId }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as PollJson).error).toBe("forbidden");
  });

  test("host closes (200) — idempotent, closedAt never bumped", async () => {
    const first = await closeRoute(reqWithCookie(closeUrl(roomId, pollBId), host, {
      method: "POST",
    }), { params: Promise.resolve({ id: roomId, pollId: pollBId }) });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as PollJson;
    expect(firstJson.poll?.status).toBe("closed");
    expect(firstJson.poll?.closedAt).not.toBeNull();

    const again = await closeRoute(reqWithCookie(closeUrl(roomId, pollBId), host, {
      method: "POST",
    }), { params: Promise.resolve({ id: roomId, pollId: pollBId }) });
    expect(again.status).toBe(200);
    const againJson = (await again.json()) as PollJson;
    expect(againJson.poll?.closedAt).toBe(firstJson.poll?.closedAt);
  });

  test("vote on a closed poll → 409 conflict", async () => {
    const res = await voteRoute(
      reqWithCookie(voteUrl(roomId, pollBId), viewer, {
        method: "POST",
        body: { optionId: pollBOptionA },
      }),
      { params: Promise.resolve({ id: roomId, pollId: pollBId }) },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as PollJson).error).toBe("conflict");
  });

  test("closing another room's poll → 404 not-found", async () => {
    const room3 = await createRoomFixture(hostUser, "lane-2c polls foreign-room");
    await startSessionFixture(room3.roomId);
    const res = await closeRoute(reqWithCookie(closeUrl(room3.roomId, pollAId), host, {
      method: "POST",
    }), { params: Promise.resolve({ id: room3.roomId, pollId: pollAId }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as PollJson).error).toBe("not-found");
  });

  test("poll create rate limit → 429 (RATE_LIMITS.pollCreate = 2)", async () => {
    const roomRl = await createRoomFixture(hostUser, "lane-2c polls ratelimit");
    await startSessionFixture(roomRl.roomId);
    const body = { question: "RL?", options: ["a", "b"] };
    const ctx = { params: Promise.resolve({ id: roomRl.roomId }) };
    const r1 = await createPollRoute(reqWithCookie(pollsUrl(roomRl.roomId), host, { method: "POST", body }), ctx);
    expect(r1.status).toBe(200);
    const r2 = await createPollRoute(reqWithCookie(pollsUrl(roomRl.roomId), host, { method: "POST", body }), ctx);
    expect(r2.status).toBe(200);
    const r3 = await createPollRoute(reqWithCookie(pollsUrl(roomRl.roomId), host, { method: "POST", body }), ctx);
    expect(r3.status).toBe(429);
    expect(((await r3.json()) as PollJson).error).toBe("rate-limited");
  });
});
