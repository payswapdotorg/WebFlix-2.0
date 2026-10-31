/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 lane 3-b — the match + scoring-law pins.
 *
 * Pins: the start gate matrix (anonymous 401, non-host 403, no-session 403
 * not-live), roster validation (arity, overlap, unknown/non-stage members),
 * the solo happy path (2 sides A/B, exact endsAt math, serverNow), the
 * match-active conflict, the scoring law (membership-derived reaction
 * teams, (matchId, clientEventId) idempotency, policy gates, gift team
 * validation, amount audit bounds), the frozen late rule (lazy wall-clock
 * timeout: endReason "timeout", winner derivation, finals snapshots,
 * idempotent re-reads, match-closed ingestion), the host end derivation
 * (endReason "host", finals written once) and cancel (no winner, no
 * finals, banked events stand), and the 429 budget.
 *
 * Stage participants are created DIRECTLY via the db (role "guest", state
 * "connected" on the fixture session) — no invites, no provider calls.
 * ingestScore is exercised at the service seam (the same entry point lane
 * 3-c's gifts service and the TL's reactions hook call).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  hostCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { POST as postMatchStart } from "@/app/api/live-rooms/[id]/matches/route";
import { GET as getCurrentMatch } from "@/app/api/live-rooms/[id]/matches/current/route";
import { POST as postMatchEnd } from "@/app/api/live-rooms/[id]/matches/[matchId]/end/route";
import { POST as postMatchCancel } from "@/app/api/live-rooms/[id]/matches/[matchId]/cancel/route";
import { ingestScore } from "@/lib/live/matches";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import {
  GIFT_PRICE_MAX,
  GIFT_QTY_MAX,
  MATCH_DURATION_MAX,
  MATCH_DURATION_MIN,
  MATCH_TEAM_SIZE_MAX,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import type { LiveMatchDto, LiveMatchTeamDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

// extra roster identities (shadow rows only — no cookies needed for these)
const P3_CLAIMS = { sub: "u_wfx2_live_match_p3", name: "Match P3", email: "match-p3@webflix.test" };
const P4_CLAIMS = { sub: "u_wfx2_live_match_p4", name: "Match P4", email: "match-p4@webflix.test" };

let HOST = "";
let VIEWER = "";
let hostId = "";
let viewerId = "";
let otherId = "";
let modId = "";
let p3 = "";
let p4 = "";
let viewerHandle = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  hostId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  const viewer = await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS));
  viewerId = viewer.id;
  viewerHandle = viewer.handle;
  otherId = (await ensureShadowUser(sessionUserOf(OTHER_CLAIMS))).id;
  modId = (await ensureShadowUser(sessionUserOf(MOD_CLAIMS))).id;
  p3 = (await ensureShadowUser(sessionUserOf(P3_CLAIMS))).id;
  p4 = (await ensureShadowUser(sessionUserOf(P4_CLAIMS))).id;
});

// ── fixtures ───────────────────────────────────────────────────────────

function matchesUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/matches`;
}
function currentUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/matches/current`;
}
function endUrl(roomId: string, matchId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/matches/${matchId}/end`;
}
function cancelUrl(roomId: string, matchId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/matches/${matchId}/cancel`;
}

async function startAs(cookie: string, roomId: string, body: unknown) {
  const res = await postMatchStart(
    reqWithCookie(matchesUrl(roomId), cookie, { method: "POST", body }),
    { params: Promise.resolve({ id: roomId }) },
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function currentAs(cookie: string | null, roomId: string) {
  const req = cookie ? reqWithCookie(currentUrl(roomId), cookie) : new Request(currentUrl(roomId));
  const res = await getCurrentMatch(req, { params: Promise.resolve({ id: roomId }) });
  return { status: res.status, body: (await res.json()) as any };
}

async function endAs(cookie: string, roomId: string, matchId: string) {
  const res = await postMatchEnd(
    reqWithCookie(endUrl(roomId, matchId), cookie, { method: "POST" }),
    { params: Promise.resolve({ id: roomId, matchId }) },
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function cancelAs(cookie: string, roomId: string, matchId: string) {
  const res = await postMatchCancel(
    reqWithCookie(cancelUrl(roomId, matchId), cookie, { method: "POST" }),
    { params: Promise.resolve({ id: roomId, matchId }) },
  );
  return { status: res.status, body: (await res.json()) as any };
}

/** Live room owned by HOST with a running session (unique title per call). */
async function matchRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `3b-match-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

/** Stage the given users directly (role "guest", state "connected"). */
async function stageGuests(sessionId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.liveParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      create: { sessionId, userId, role: "guest", state: "connected" },
      update: { role: "guest", state: "connected" },
    });
  }
}

/** Fresh input per call — the roster ids resolve in beforeAll. */
const soloInput = () => ({ kind: "solo", teamA: [viewerId], teamB: [otherId] });

async function startSolo(roomId: string, sessionId: string, extra: Record<string, unknown> = {}) {
  await stageGuests(sessionId, [viewerId, otherId, modId]);
  const { status, body } = await startAs(HOST, roomId, { ...soloInput(), ...extra });
  expect(status).toBe(200);
  return body.match as LiveMatchDto;
}

function teamOf(match: LiveMatchDto, position: number): LiveMatchTeamDto {
  const team = match.teams.find((t) => t.position === position);
  expect(team).toBeDefined();
  return team as LiveMatchTeamDto;
}

// ── gates ──────────────────────────────────────────────────────────────

describe("live matches — start gates", () => {
  test("anonymous is 401; non-host is 403; no live session is 403 not-live; unknown room is 404", async () => {
    const { roomId } = await matchRoom();
    await stageGuests((await startSessionFixture(roomId)).sessionId, [viewerId, otherId]);

    const anon = await startAs("next-auth.session-token=none", roomId, soloInput());
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const viewerTry = await startAs(VIEWER, roomId, soloInput());
    expect(viewerTry.status).toBe(403);
    expect(viewerTry.body.error).toBe("forbidden");

    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `3b-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const notLive = await startAs(HOST, idle.roomId, soloInput());
    expect(notLive.status).toBe(403);
    expect(notLive.body.error).toBe("forbidden");
    expect(notLive.body.message).toBe("not-live");

    const ghost = await startAs(HOST, "room-missing-3b", soloInput());
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");
  });

  test("malformed input is 400 invalid (kind / rosters / duration)", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId]);

    const badKind = await startAs(HOST, roomId, { ...soloInput(), kind: "duel" });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toBe("invalid");

    const badRoster = await startAs(HOST, roomId, { kind: "solo", teamA: "me", teamB: [otherId] });
    expect(badRoster.status).toBe(400);
    expect(badRoster.body.error).toBe("invalid");

    const badDuration = await startAs(HOST, roomId, {
      ...soloInput(),
      durationSeconds: "forever",
    });
    expect(badDuration.status).toBe(400);
    expect(badDuration.body.error).toBe("invalid");
  });
});

// ── roster validation ──────────────────────────────────────────────────

describe("live matches — roster validation (409 invalid-roster)", () => {
  test("solo with a 2-member side is rejected", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId, modId]);
    const { status, body } = await startAs(HOST, roomId, {
      kind: "solo",
      teamA: [viewerId, modId],
      teamB: [otherId],
    });
    expect(status).toBe(409);
    expect(body.error).toBe("conflict");
    expect(body.message).toBe("invalid-roster");
  });

  test("team match with 3 per side exceeds MATCH_TEAM_SIZE_MAX and is rejected", async () => {
    expect(MATCH_TEAM_SIZE_MAX).toBe(2);
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId, modId, p3, p4]);
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, otherId, modId],
      teamB: [p3, p4, hostId],
    });
    expect(status).toBe(409);
    expect(body.message).toBe("invalid-roster");
  });

  test("overlapping rosters are rejected", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId, modId]);
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, otherId],
      teamB: [otherId, modId],
    });
    expect(status).toBe(409);
    expect(body.message).toBe("invalid-roster");
  });

  test("an unknown id in a roster is rejected", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId]);
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, "u_wfx2_live_match_ghost"],
      teamB: [otherId, p3],
    });
    expect(status).toBe(409);
    expect(body.message).toBe("invalid-roster");
  });

  test("a known user who is NOT an active stage participant of THIS session is rejected", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId]); // modId deliberately NOT staged
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, modId],
      teamB: [otherId, p3],
    });
    expect(status).toBe(409);
    expect(body.message).toBe("invalid-roster");
  });

  test("a removed stage participant is no longer eligible", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId, modId]);
    await db.liveParticipant.update({
      where: { sessionId_userId: { sessionId, userId: modId } },
      data: { state: "removed" },
    });
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, modId],
      teamB: [otherId, p3],
    });
    expect(status).toBe(409);
    expect(body.message).toBe("invalid-roster");
  });
});

// ── happy path + current ───────────────────────────────────────────────

describe("live matches — solo happy path + current", () => {
  test("solo start returns the full snapshot; second start is 409 match-active; anonymous current works", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);

    expect(match.id).toBeTruthy();
    expect(match.roomId).toBe(roomId);
    expect(match.sessionId).toBe(sessionId);
    expect(match.kind).toBe("solo");
    expect(match.status).toBe("active");
    expect(match.durationSeconds).toBe(120);
    expect(match.scoring).toEqual({ reactions: true, gifts: true });
    expect(match.teams.length).toBe(2);
    const a = teamOf(match, 0);
    const b = teamOf(match, 1);
    expect(a.label).toBe("A");
    expect(b.label).toBe("B");
    expect(a.members.map((m) => m.userId)).toEqual([viewerId]);
    expect(b.members.map((m) => m.userId)).toEqual([otherId]);
    expect(a.members[0].handle).toBe(viewerHandle); // resolved handles
    expect(a.members[0].leftAt).toBeNull();
    expect(a.score).toBe(0);
    expect(b.score).toBe(0);
    const started = new Date(match.startedAt).getTime();
    const ends = new Date(match.endsAt).getTime();
    expect(ends - started).toBe(120_000);
    expect(typeof match.serverNow).toBe("string");
    expect(match.endReason).toBeNull();
    expect(match.winnerTeamId).toBeNull();

    const again = await startAs(HOST, roomId, soloInput());
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("match-active");

    const anonCurrent = await currentAs(null, roomId);
    expect(anonCurrent.status).toBe(200);
    expect((anonCurrent.body.match as LiveMatchDto).id).toBe(match.id);
  });

  test("durationSeconds clamps to the frozen bounds; scoring overrides land on the row", async () => {
    const low = await matchRoom();
    const lowMatch = await startSolo(low.roomId, low.sessionId, { durationSeconds: 5 });
    expect(lowMatch.durationSeconds).toBe(MATCH_DURATION_MIN); // 30

    const high = await matchRoom();
    const highMatch = await startSolo(high.roomId, high.sessionId, { durationSeconds: 100_000 });
    expect(highMatch.durationSeconds).toBe(MATCH_DURATION_MAX); // 600
    expect(new Date(highMatch.endsAt).getTime() - new Date(highMatch.startedAt).getTime()).toBe(
      600_000,
    );

    const policy = await matchRoom();
    const policyMatch = await startSolo(policy.roomId, policy.sessionId, {
      scoring: { gifts: false },
    });
    expect(policyMatch.scoring).toEqual({ reactions: true, gifts: false });
    const row = await db.liveMatch.findUniqueOrThrow({ where: { id: policyMatch.id } });
    expect(row.giftsScore).toBe(false);
    expect(row.reactionsScore).toBe(true);
  });

  test("current is null before any match and on an idle room; terminal matches still surface", async () => {
    const { roomId, sessionId } = await matchRoom();
    const none = await currentAs(null, roomId);
    expect(none.status).toBe(200);
    expect(none.body.match).toBeNull();

    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `3b-idle-cur-${crypto.randomUUID().slice(0, 8)}`,
    );
    const idleCurrent = await currentAs(null, idle.roomId);
    expect(idleCurrent.status).toBe(200);
    expect(idleCurrent.body.match).toBeNull();

    const match = await startSolo(roomId, sessionId);
    await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 2,
      clientEventId: "cur-bank-a1",
    });
    const ended = await endAs(HOST, roomId, match.id);
    expect(ended.status).toBe(200);
    expect(ended.body.match.status).toBe("ended");

    const after = await currentAs(null, roomId);
    expect(after.status).toBe(200);
    const terminal = after.body.match as LiveMatchDto;
    expect(terminal.id).toBe(match.id);
    expect(terminal.status).toBe("ended");
    expect(terminal.teams.find((t) => t.position === 0)?.score).toBe(2);
  });
});

// ── the scoring law (ingestScore) ──────────────────────────────────────

describe("live matches — scoring law (ingestScore)", () => {
  test("reaction scoring derives the team from membership; duplicates never double-score", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);
    const a = teamOf(match, 0);
    const b = teamOf(match, 1);

    const first = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 5,
      clientEventId: "evt-dup-test-0001",
    });
    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBeUndefined();
    expect(first.teamId).toBe(a.id);
    expect(first.teamScore).toBe(5);

    // same clientEventId replay → the existing row, no second row, same SUM
    const replay = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 5,
      clientEventId: "evt-dup-test-0001",
    });
    expect(replay.accepted).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(replay.teamId).toBe(a.id);
    expect(replay.teamScore).toBe(5);
    const rows = await db.liveScoreEvent.findMany({
      where: { matchId: match.id, clientEventId: "evt-dup-test-0001" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.amount).toBe(5);

    // a distinct batch accumulates; the B-side member banks into B
    const second = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 3,
      clientEventId: "evt-dup-test-0002",
    });
    expect(second.accepted).toBe(true);
    expect(second.teamScore).toBe(8);
    const other = await ingestScore(match.id, {
      source: "reaction",
      actorId: otherId,
      amount: 2,
      clientEventId: "evt-dup-test-0003",
    });
    expect(other.teamId).toBe(b.id);
    expect(other.teamScore).toBe(2);

    const standings = await db.liveScoreEvent.groupBy({
      by: ["teamId"],
      where: { matchId: match.id },
      _sum: { amount: true },
    });
    expect(standings.length).toBe(2);
    expect(standings.find((s) => s.teamId === a.id)?._sum.amount).toBe(8);
    expect(standings.find((s) => s.teamId === b.id)?._sum.amount).toBe(2);
  });

  test("a rostered member who left mid-match stops scoring; banked rows stand", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);
    const a = teamOf(match, 0);

    const banked = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 4,
      clientEventId: "left-bank-0001",
    });
    expect(banked.accepted).toBe(true);
    expect(banked.teamScore).toBe(4);

    await db.liveMatchMember.updateMany({
      where: { matchId: match.id, userId: viewerId },
      data: { leftAt: new Date() },
    });
    const after = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 9,
      clientEventId: "left-after-001",
    });
    expect(after.accepted).toBe(false);
    expect(after.reason).toBe("not-member");
    // the ledger is append-only — the banked score still stands
    const still = await db.liveScoreEvent.aggregate({
      where: { matchId: match.id, teamId: a.id },
      _sum: { amount: true },
    });
    expect(still._sum.amount).toBe(4);
  });

  test("a staged-but-unrostered actor (or unknown id) is not-member", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId); // modId staged, NOT rostered

    const bystander = await ingestScore(match.id, {
      source: "reaction",
      actorId: modId,
      amount: 1,
      clientEventId: "nonmember-001",
    });
    expect(bystander.accepted).toBe(false);
    expect(bystander.reason).toBe("not-member");

    const ghost = await ingestScore(match.id, {
      source: "reaction",
      actorId: "u_wfx2_live_match_ghost",
      amount: 1,
      clientEventId: "nonmember-002",
    });
    expect(ghost.accepted).toBe(false);
    expect(ghost.reason).toBe("not-member");
    expect(await db.liveScoreEvent.count({ where: { matchId: match.id } })).toBe(0);
  });

  test("policy gates: giftsScore=false match → gift ingest is policy-off; reactionsScore=false → reaction ingest is policy-off", async () => {
    const giftsOff = await matchRoom();
    const giftsOffMatch = await startSolo(giftsOff.roomId, giftsOff.sessionId, {
      scoring: { gifts: false },
    });
    const gift = await ingestScore(giftsOffMatch.id, {
      source: "gift",
      actorId: modId,
      teamId: teamOf(giftsOffMatch, 1).id,
      amount: 10,
      clientEventId: "gift-policy-001",
    });
    expect(gift.accepted).toBe(false);
    expect(gift.reason).toBe("policy-off");

    const reactionsOff = await matchRoom();
    const reactionsOffMatch = await startSolo(reactionsOff.roomId, reactionsOff.sessionId, {
      scoring: { reactions: false },
    });
    const reaction = await ingestScore(reactionsOffMatch.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 3,
      clientEventId: "react-policy-01",
    });
    expect(reaction.accepted).toBe(false);
    expect(reaction.reason).toBe("policy-off");
  });

  test("gift scoring: valid team banks; foreign teamId is invalid-team; the amount audit bound holds", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);
    const a = teamOf(match, 0);
    const cap = GIFT_QTY_MAX * GIFT_PRICE_MAX; // 10 × 100 = 1000

    const sent = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: a.id,
      amount: 25,
      clientEventId: "gift-intent-0001",
      linkId: "giftevent-0001",
    });
    expect(sent.accepted).toBe(true);
    expect(sent.teamId).toBe(a.id);
    expect(sent.teamScore).toBe(25);

    const foreign = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: "team-does-not-exist",
      amount: 25,
      clientEventId: "gift-intent-0002",
    });
    expect(foreign.accepted).toBe(false);
    expect(foreign.reason).toBe("invalid-team");

    const missingTeam = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      amount: 25,
      clientEventId: "gift-intent-0003",
    });
    expect(missingTeam.accepted).toBe(false);
    expect(missingTeam.reason).toBe("invalid-team");

    const zero = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: a.id,
      amount: 0,
      clientEventId: "gift-intent-0004",
    });
    expect(zero.accepted).toBe(false);
    expect(zero.reason).toBe("policy-off");

    const fractional = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: a.id,
      amount: 2.5,
      clientEventId: "gift-intent-0005",
    });
    expect(fractional.accepted).toBe(false);
    expect(fractional.reason).toBe("policy-off");

    const overCap = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: a.id,
      amount: cap + 1,
      clientEventId: "gift-intent-0006",
    });
    expect(overCap.accepted).toBe(false);
    expect(overCap.reason).toBe("policy-off");

    const atCap = await ingestScore(match.id, {
      source: "gift",
      actorId: modId,
      teamId: a.id,
      amount: cap,
      clientEventId: "gift-intent-0007",
    });
    expect(atCap.accepted).toBe(true);
    expect(atCap.teamScore).toBe(25 + cap);
  });

  test("team match with 2 per side: members score into their own side", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId, p3, p4]);
    const { status, body } = await startAs(HOST, roomId, {
      kind: "team",
      teamA: [viewerId, otherId],
      teamB: [p3, p4],
    });
    expect(status).toBe(200);
    const match = body.match as LiveMatchDto;
    expect(match.kind).toBe("team");
    const a = teamOf(match, 0);
    const b = teamOf(match, 1);
    expect(a.members.length).toBe(2);
    expect(b.members.length).toBe(2);
    expect(a.members.every((m) => m.handle.length > 0)).toBe(true);

    const fromP3 = await ingestScore(match.id, {
      source: "reaction",
      actorId: p3,
      amount: 6,
      clientEventId: "team-sc-0001",
    });
    expect(fromP3.accepted).toBe(true);
    expect(fromP3.teamId).toBe(b.id);
    expect(fromP3.teamScore).toBe(6);
    const fromViewer = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 4,
      clientEventId: "team-sc-0002",
    });
    expect(fromViewer.teamId).toBe(a.id);
    expect(fromViewer.teamScore).toBe(4);
  });
});

// ── the frozen late rule (lazy wall-clock timeout) ─────────────────────

describe("live matches — late rule (lazy timeout)", () => {
  test("an expired active match lazily ends: endReason timeout, winner derived, finals written once; ingestion then answers match-closed", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId, { durationSeconds: 60 });
    const a = teamOf(match, 0);
    const b = teamOf(match, 1);

    await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 4,
      clientEventId: "late-bank-a1",
    });
    await ingestScore(match.id, {
      source: "reaction",
      actorId: otherId,
      amount: 1,
      clientEventId: "late-bank-b1",
    });

    // backdate past the wall clock, then a PUBLIC read performs the settle
    await db.liveMatch.update({
      where: { id: match.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });

    const cur = await currentAs(null, roomId);
    expect(cur.status).toBe(200);
    const late = cur.body.match as LiveMatchDto;
    expect(late.id).toBe(match.id);
    expect(late.status).toBe("ended");
    expect(late.endReason).toBe("timeout");
    expect(late.winnerTeamId).toBe(a.id);
    expect(late.endedAt).not.toBeNull();
    expect(late.teams.find((t) => t.id === a.id)?.score).toBe(4);
    expect(late.teams.find((t) => t.id === b.id)?.score).toBe(1);

    const finals = await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } });
    expect(finals.length).toBe(2);
    expect(finals.every((f) => f.kind === "final")).toBe(true);
    expect(finals.find((f) => f.teamId === a.id)?.amount).toBe(4);
    expect(finals.find((f) => f.teamId === a.id)?.teamLabel).toBe("A");
    expect(finals.find((f) => f.teamId === b.id)?.amount).toBe(1);

    // idempotent: a second read re-derives the SAME result, never re-writes
    const again = await currentAs(null, roomId);
    const late2 = again.body.match as LiveMatchDto;
    expect(late2.status).toBe("ended");
    expect(late2.endReason).toBe("timeout");
    expect(late2.winnerTeamId).toBe(a.id);
    expect((await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } })).length).toBe(2);

    const closed = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 2,
      clientEventId: "late-after-close",
    });
    expect(closed.accepted).toBe(false);
    expect(closed.reason).toBe("match-closed");

    // and the host cannot re-end a match the wall clock already settled
    const hostEnd = await endAs(HOST, roomId, match.id);
    expect(hostEnd.status).toBe(409);
    expect((await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } })).length).toBe(2);
  });

  test("a tie derives no winner (winnerTeamId null) but still writes finals", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);
    await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 2,
      clientEventId: "tie-bank-a1",
    });
    await ingestScore(match.id, {
      source: "reaction",
      actorId: otherId,
      amount: 2,
      clientEventId: "tie-bank-b1",
    });

    await db.liveMatch.update({
      where: { id: match.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    const cur = await currentAs(null, roomId);
    const tie = cur.body.match as LiveMatchDto;
    expect(tie.status).toBe("ended");
    expect(tie.endReason).toBe("timeout");
    expect(tie.winnerTeamId).toBeNull();
    const finals = await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } });
    expect(finals.length).toBe(2);
    expect(finals.every((f) => f.amount === 2)).toBe(true);
  });
});

// ── host end + cancel ──────────────────────────────────────────────────

describe("live matches — host end + cancel", () => {
  test("host end early: endReason host, winner = higher score, finals written once; second end is 409", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);
    const a = teamOf(match, 0);
    const b = teamOf(match, 1);

    await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 5,
      clientEventId: "end-bank-a1",
    });
    await ingestScore(match.id, {
      source: "reaction",
      actorId: otherId,
      amount: 2,
      clientEventId: "end-bank-b1",
    });

    const { status, body } = await endAs(HOST, roomId, match.id);
    expect(status).toBe(200);
    const ended = body.match as LiveMatchDto;
    expect(ended.id).toBe(match.id);
    expect(ended.status).toBe("ended");
    expect(ended.endReason).toBe("host");
    expect(ended.winnerTeamId).toBe(a.id);
    expect(ended.endedAt).not.toBeNull();
    expect(ended.teams.find((t) => t.id === a.id)?.score).toBe(5);
    expect(ended.teams.find((t) => t.id === b.id)?.score).toBe(2);

    const finals = await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } });
    expect(finals.length).toBe(2);
    expect(finals.find((f) => f.teamId === a.id)?.amount).toBe(5);
    expect(finals.find((f) => f.teamId === b.id)?.amount).toBe(2);

    const second = await endAs(HOST, roomId, match.id);
    expect(second.status).toBe(409);
    expect((await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } })).length).toBe(2);

    // a cancelled/ended match can no longer be cancelled either
    const lateCancel = await cancelAs(HOST, roomId, match.id);
    expect(lateCancel.status).toBe(409);
  });

  test("non-host end is 403; a foreign matchId is 404", async () => {
    const other = await matchRoom();
    const otherMatch = await startSolo(other.roomId, other.sessionId);

    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId]);

    const forbidden = await endAs(VIEWER, roomId, "match-whatever");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("forbidden");

    const foreign = await endAs(HOST, roomId, otherMatch.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("not-found");

    const foreignCancel = await cancelAs(HOST, roomId, otherMatch.id);
    expect(foreignCancel.status).toBe(404);
  });

  test("cancel: no winner, no finals, banked events stand; re-cancel is 409; ingestion is closed", async () => {
    const { roomId, sessionId } = await matchRoom();
    const match = await startSolo(roomId, sessionId);

    await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 7,
      clientEventId: "cancel-bank-1",
    });

    const { status, body } = await cancelAs(HOST, roomId, match.id);
    expect(status).toBe(200);
    const cancelled = body.match as LiveMatchDto;
    expect(cancelled.id).toBe(match.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.winnerTeamId).toBeNull();
    expect(cancelled.endedAt).not.toBeNull();
    expect(cancelled.endReason).toBe("host");

    expect((await db.liveScoreSnapshot.findMany({ where: { matchId: match.id } })).length).toBe(0);
    expect((await db.liveScoreEvent.findMany({ where: { matchId: match.id } })).length).toBe(1);

    const again = await cancelAs(HOST, roomId, match.id);
    expect(again.status).toBe(409);

    const closed = await ingestScore(match.id, {
      source: "reaction",
      actorId: viewerId,
      amount: 1,
      clientEventId: "cancel-after-1",
    });
    expect(closed.accepted).toBe(false);
    expect(closed.reason).toBe("match-closed");
  });
});

// ── rate limit on start ────────────────────────────────────────────────

describe("live matches — rate limit (429)", () => {
  test("start is 429 after RATE_LIMITS.matchStart calls in the window (conflicts still burn budget)", async () => {
    const { roomId, sessionId } = await matchRoom();
    await stageGuests(sessionId, [viewerId, otherId]);
    const limit = RATE_LIMITS.matchStart.limit; // 3 / 60s per room+actor
    for (let i = 0; i < limit + 1; i++) {
      const { status, body } = await startAs(HOST, roomId, soloInput());
      if (i === 0) {
        expect(status).toBe(200);
      } else if (i < limit) {
        expect(status).toBe(409); // match-active — but the budget was consumed
        expect(body.message).toBe("match-active");
      } else {
        expect(status).toBe(429);
        expect(body.error).toBe("rate-limited");
      }
    }
  });
});
