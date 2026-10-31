/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 (lane 5-a) — the non-monetary fan-club pins.
 *
 * Covers: create (auth 401 / malformed 400 / clamp / one-per-creator 409 /
 * second-creator OK / rate-limit 429), join (401 / 404 / idempotency / the
 * ban law via the LiveModerationAction ledger / CLUB_MEMBERS_MAX cap),
 * leave (idempotency + the fresh-projection-on-rejoin law), the award law
 * (idempotencyKey formats `watch:{sessionId}:{userId}` / `chat:{messageId}` /
 * `gift:{giftEventId}`, double delivery → single increment, clamp, ≤0 no-op,
 * non-member no-op, unknown-club no-op, lastActiveAt bump), the level
 * formula edges, mission derivation truth (durable rows only), the overview
 * (caller-membership honesty, missions, top members order, live-room
 * visibility law incl. "members"), the paged roster (cursor + tiebreak)
 * and mine (both route spellings).
 *
 * Rate-limit pin: without Upstash the shared adapter falls back to the
 * in-memory fixed-window limiter (rateLimitFixedLocal) — the same seam the
 * live-gifts 429 pin uses — so clubCreate's 2/10min budget IS testable.
 *
 * IDENTITY PLAN: every group mints its OWN fresh identities (unique subs →
 * unique limiter keys + unique unique-hostId clubs), so groups never share
 * state. Run on a lane db:
 *   DATABASE_URL=file:../db/live-clubs-5a-test.db bun test --isolate tests/live-clubs.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  MOD_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
} from "./live-helpers";
import { mintSessionCookie } from "./helpers";
import { GET as getMineCollection, POST as postClubs } from "@/app/api/live-clubs/route";
import { GET as getMine } from "@/app/api/live-clubs/mine/route";
import { GET as getOverview } from "@/app/api/live-clubs/[hostId]/route";
import { POST as postJoin } from "@/app/api/live-clubs/[hostId]/join/route";
import { POST as postLeave } from "@/app/api/live-clubs/[hostId]/leave/route";
import { GET as getMembers } from "@/app/api/live-clubs/[hostId]/members/route";
import { awardClubPoints, deriveLevel, deriveMissions } from "@/lib/live/clubs";
import { clearRateLimits } from "@/lib/youtube/cache";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import {
  CLUB_LEVEL_MAX,
  CLUB_MEMBER_PREVIEW_MAX,
  CLUB_MEMBERS_MAX,
  CLUB_MEMBERS_PAGE,
  CLUB_MOTTO_MAX,
  CLUB_NAME_MAX,
  CLUB_POINT_AWARD_MAX,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import type {
  LiveFanClubDto,
  LiveFanClubMembersDto,
  LiveFanClubOverviewDto,
} from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

// ── helpers ──────────────────────────────────────────────────────────
// The rerun law (the live-gifts identity plan): EVERY identity in this file
// mints with a run-unique sub (shared-claim names kept), so a rerun against
// the same lane db never inherits a previous run's one-per-creator club or
// limiter window.
const RUN = crypto.randomUUID().slice(0, 8);
const claims = (sub: string, name: string) => ({
  sub: `${sub}_${RUN}`,
  name,
  email: `${sub}_${RUN}@webflix.test`,
});
const cookieFor = (sub: string, name: string) => mintSessionCookie(claims(sub, name));
const shadowOf = async (sub: string, name: string) =>
  (await ensureShadowUser(sessionUserOf(claims(sub, name)))).id;

const CLUBS_URL = "http://localhost/api/live-clubs";
const hostUrl = (hostId: string) => `${CLUBS_URL}/${hostId}`;
const ANON = "next-auth.session-token=none";

async function createAs(cookie: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await postClubs(reqWithCookie(CLUBS_URL, cookie, { method: "POST", body }));
  return { status: res.status, body: await res.json() };
}
async function mineAs(
  route: typeof getMine,
  cookie?: string,
): Promise<{ status: number; body: any }> {
  const res = await route(reqWithCookie(CLUBS_URL, cookie ?? ANON));
  return { status: res.status, body: await res.json() };
}
async function overviewAs(
  hostId: string,
  cookie?: string,
): Promise<{ status: number; body: any }> {
  const res = await getOverview(reqWithCookie(hostUrl(hostId), cookie ?? ANON), {
    params: Promise.resolve({ hostId }),
  });
  return { status: res.status, body: await res.json() };
}
async function joinAs(
  cookie: string,
  hostId: string,
): Promise<{ status: number; body: any }> {
  const res = await postJoin(reqWithCookie(hostUrl(hostId), cookie, { method: "POST" }), {
    params: Promise.resolve({ hostId }),
  });
  return { status: res.status, body: await res.json() };
}
async function leaveAs(
  cookie: string,
  hostId: string,
): Promise<{ status: number; body: any }> {
  const res = await postLeave(reqWithCookie(hostUrl(hostId), cookie, { method: "POST" }), {
    params: Promise.resolve({ hostId }),
  });
  return { status: res.status, body: await res.json() };
}
async function membersAs(
  hostId: string,
  cursor?: string,
): Promise<{ status: number; body: any }> {
  const url = new URL(hostUrl(hostId) + "/members");
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  const res = await getMembers(reqWithCookie(url.toString(), ANON), {
    params: Promise.resolve({ hostId }),
  });
  return { status: res.status, body: await res.json() };
}
async function createClubFixture(sub: string, name: string): Promise<{ hostShadowId: string; cookie: string; club: LiveFanClubDto }> {
  const cookie = await cookieFor(sub, name);
  const res = await createAs(cookie, { name: `${name} Club`, motto: "entertainment only" });
  expect(res.status).toBe(201);
  return { hostShadowId: await shadowOf(sub, name), cookie, club: res.body.club as LiveFanClubDto };
}

// ── shared identities (route-level main flow) ────────────────────────
let HOST = "";
let VIEWER = "";
let OTHER = "";
let MOD = "";

beforeAll(async () => {
  HOST = await cookieFor("u_wfx2_live_host", HOST_CLAIMS.name);
  VIEWER = await cookieFor("u_wfx2_live_viewer", VIEWER_CLAIMS.name);
  OTHER = await cookieFor("u_wfx2_live_other", OTHER_CLAIMS.name);
  MOD = await cookieFor("u_wfx2_live_mod", MOD_CLAIMS.name);
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — create (POST /api/live-clubs)", () => {
  test("anonymous create → 401", async () => {
    const res = await createAs(ANON, { name: "Ghost Club" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthenticated");
  });

  test("malformed body → 400", async () => {
    const bad = await postClubs(
      new Request(CLUBS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: HOST },
        body: "{not json",
      }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid");
  });

  test("clamps name to CLUB_NAME_MAX and motto to CLUB_MOTTO_MAX", async () => {
    const cookie = await cookieFor("u_fc_clamp_host", "FC Clamp");
    const res = await createAs(cookie, { name: "N".repeat(60), motto: "M".repeat(300) });
    expect(res.status).toBe(201);
    expect(res.body.club.name).toHaveLength(CLUB_NAME_MAX);
    expect(res.body.club.motto).toHaveLength(CLUB_MOTTO_MAX);
  });

  test("one club per creator — the second create is a 409 conflict", async () => {
    const first = await createAs(HOST, { name: "Host FC One" });
    expect(first.status).toBe(201);
    const second = await createAs(HOST, { name: "Host FC Two" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("conflict");
  });

  test("a second creator creates their own club — 201", async () => {
    const res = await createAs(VIEWER, { name: "Viewer FC" });
    expect(res.status).toBe(201);
    expect(res.body.club.hostHandle).not.toBe("unknown");
    expect(res.body.club.pointsPerLevel).toBe(500);
  });

  test("rate limit: the 3rd create burst by one creator → 429 (clubCreate 2/10min)", async () => {
    clearRateLimits(); // isolate this key's window
    const cookie = await cookieFor("u_fc_rl_host", "FC RL Host");
    expect((await createAs(cookie, { name: "RL One" })).status).toBe(201);
    // the 2nd call passes the limiter (budget 2) and hits the domain conflict
    const second = await createAs(cookie, { name: "RL Two" });
    expect(second.status).toBe(409);
    const third = await createAs(cookie, { name: "RL Three" });
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("rate-limited");
    expect(
      await db.liveFanClub.count({ where: { hostId: await shadowOf("u_fc_rl_host", "FC RL Host") } }),
    ).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — GET mine (collection + /mine spellings)", () => {
  test("anonymous mine → 401 on both spellings", async () => {
    expect((await mineAs(getMineCollection)).status).toBe(401);
    expect((await mineAs(getMine)).status).toBe(401);
  });

  test("creator's own club on both spellings; a non-creator gets null", async () => {
    const mine = await mineAs(getMineCollection, HOST);
    expect(mine.status).toBe(200);
    expect((mine.body.club as LiveFanClubDto | null)?.name).toBe("Host FC One");
    const alias = await mineAs(getMine, HOST);
    expect((alias.body.club as LiveFanClubDto | null)?.id).toBe(mine.body.club.id);
    const nobody = await mineAs(getMine, MOD);
    expect(nobody.status).toBe(200);
    expect(nobody.body.club).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — join / leave", () => {
  const HOST_SUB = "u_fc_jl_host";
  let hostId = "";
  let hostShadowId = "";
  let viewerShadowId = "";

  beforeAll(async () => {
    const fix = await createClubFixture(HOST_SUB, "FC JoinLeave");
    hostId = fix.hostShadowId;
    hostShadowId = fix.hostShadowId;
    viewerShadowId = await shadowOf("u_wfx2_live_viewer", VIEWER_CLAIMS.name);
  });

  test("anonymous join → 401; unknown host → 404", async () => {
    expect((await joinAs(ANON, hostId)).status).toBe(401);
    const ghost = await joinAs(VIEWER, "wf-u_fc_ghost_host");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");
  });

  test("join is idempotent — a replayed join is one row, still 200", async () => {
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId } });
    const first = await joinAs(VIEWER, hostId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    const again = await joinAs(VIEWER, hostId);
    expect(again.status).toBe(200);
    expect(
      await db.liveFanClubMember.count({ where: { clubId: club.id, userId: viewerShadowId } }),
    ).toBe(1);
    await joinAs(OTHER, hostId);
    expect(await db.liveFanClubMember.count({ where: { clubId: club.id } })).toBe(2);
  });

  test("leave is idempotent; a non-member leave is a no-op success", async () => {
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId } });
    expect((await leaveAs(MOD, hostId)).status).toBe(200); // never a member
    expect(await db.liveFanClubMember.count({ where: { clubId: club.id } })).toBe(2);
    expect((await leaveAs(VIEWER, hostId)).status).toBe(200);
    expect(await db.liveFanClubMember.count({ where: { clubId: club.id } })).toBe(1);
  });

  test("rejoin starts a fresh points projection; the append-only ledger remains", async () => {
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId } });
    await joinAs(VIEWER, hostId);
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "chat",
      sourceEventId: `jl-msg-1-${RUN}`,
      amount: 5,
    });
    const before = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId: club.id, userId: viewerShadowId } },
    });
    expect(before.points).toBe(5);
    await leaveAs(VIEWER, hostId);
    await joinAs(VIEWER, hostId);
    const after = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId: club.id, userId: viewerShadowId } },
    });
    expect(after.id).not.toBe(before.id); // a fresh membership row…
    expect(after.points).toBe(0); // …with a fresh projection
    // the ledger is history: the old award row is never rewritten
    expect(
      await db.liveClubPointEvent.count({ where: { idempotencyKey: `chat:jl-msg-1-${RUN}` } }),
    ).toBe(1);
  });

  test("the ban law: an active ban sanction in a host room bars joining; latest action wins", async () => {
    const { roomId } = await createRoomFixture(
      sessionUserOf(claims(HOST_SUB, "FC JoinLeave")),
      "5a-ban-room",
    );
    const banSub = "u_fc_ban_viewer";
    const banCookie = await cookieFor(banSub, "FC Ban Viewer");
    const banShadow = await shadowOf(banSub, "FC Ban Viewer");
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId } });

    // baseline: joins fine, then leaves (so the ban is what blocks below)
    expect((await joinAs(banCookie, hostId)).status).toBe(200);
    expect((await leaveAs(banCookie, hostId)).status).toBe(200);

    await db.liveModerationAction.create({
      data: { roomId, actorId: hostShadowId, targetId: banShadow, action: "ban", reason: "5a-test" },
    });
    const blocked = await joinAs(banCookie, hostId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("forbidden");
    expect(blocked.body.message).toBe("banned");
    expect(await db.liveFanClubMember.count({ where: { clubId: club.id, userId: banShadow } })).toBe(0);

    // the ledger is the state: an appended unban resolves the dimension
    await db.liveModerationAction.create({
      data: { roomId, actorId: hostShadowId, targetId: banShadow, action: "unban", reason: "5a-test" },
    });
    expect((await joinAs(banCookie, hostId)).status).toBe(200);
  });

  test("the capacity law: CLUB_MEMBERS_MAX members → the next join is 403 club-full", async () => {
    const capHost = await createClubFixture("u_fc_cap_host", "FC Cap");
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId: capHost.hostShadowId } });
    await db.liveFanClubMember.createMany({
      data: Array.from({ length: CLUB_MEMBERS_MAX }, (_, i) => ({
        clubId: club.id,
        userId: `u_fc_synth_cap_${i}`,
      })),
    });
    const late = await joinAs(await cookieFor("u_fc_cap_late", "FC Late"), capHost.hostShadowId);
    expect(late.status).toBe(403);
    expect(late.body.message).toBe("club-full");
    expect(await db.liveFanClubMember.count({ where: { clubId: club.id } })).toBe(CLUB_MEMBERS_MAX);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — the award law (best-effort, idempotency-keyed)", () => {
  const HOST_SUB = "u_fc_pts_host";
  let hostShadowId = "";
  let viewerShadowId = "";

  beforeAll(async () => {
    const fix = await createClubFixture(HOST_SUB, "FC Points");
    hostShadowId = fix.hostShadowId;
    viewerShadowId = await shadowOf("u_wfx2_live_viewer", VIEWER_CLAIMS.name);
    await joinAs(VIEWER, hostShadowId);
  });

  test("chat award keyed `chat:{messageId}` — double delivery awards ONCE", async () => {
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "chat",
      sourceEventId: `pts-msg-1-${RUN}`,
      amount: 5,
    });
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "chat",
      sourceEventId: `pts-msg-1-${RUN}`,
      amount: 5,
    });
    const row = await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: `chat:pts-msg-1-${RUN}` } });
    expect(row?.amount).toBe(5);
    expect(row?.source).toBe("chat");
    expect(row?.sourceEventId).toBe(`pts-msg-1-${RUN}`);
    const member = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId: row!.clubId, userId: viewerShadowId } },
    });
    expect(member.points).toBe(5);
  });

  test("watch award keyed `watch:{sessionId}:{userId}`", async () => {
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "watch",
      sourceEventId: `pts-session-1-${RUN}`,
      amount: 2,
    });
    const row = await db.liveClubPointEvent.findUnique({
      where: { idempotencyKey: `watch:pts-session-1-${RUN}:${viewerShadowId}` },
    });
    expect(row?.amount).toBe(2);
  });

  test("gift award keyed `gift:{giftEventId}`", async () => {
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "gift",
      sourceEventId: `pts-gift-1-${RUN}`,
      amount: 30,
    });
    const row = await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: `gift:pts-gift-1-${RUN}` } });
    expect(row?.amount).toBe(30);
    expect(row?.source).toBe("gift");
  });

  test("amount re-clamps server-side to CLUB_POINT_AWARD_MAX; ≤0 and keyless are no-ops", async () => {
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "gift",
      sourceEventId: `pts-gift-2-${RUN}`,
      amount: 500,
    });
    expect(
      (await db.liveClubPointEvent.findUnique({ where: { idempotencyKey: `gift:pts-gift-2-${RUN}` } }))?.amount,
    ).toBe(CLUB_POINT_AWARD_MAX);
    await awardClubPoints(hostShadowId, viewerShadowId, { source: "chat", sourceEventId: `pts-zero-${RUN}`, amount: 0 });
    await awardClubPoints(hostShadowId, viewerShadowId, { source: "chat", sourceEventId: `pts-neg-${RUN}`, amount: -5 });
    await awardClubPoints(hostShadowId, viewerShadowId, { source: "chat", amount: 5 }); // no durable event
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: `chat:pts-zero-${RUN}` } })).toBe(0);
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: `chat:pts-neg-${RUN}` } })).toBe(0);
    const member = await db.liveFanClubMember.findFirstOrThrow({
      where: { userId: viewerShadowId, club: { hostId: hostShadowId } },
    });
    expect(member.points).toBe(5 + 2 + 30 + CLUB_POINT_AWARD_MAX);
  });

  test("non-member and unknown-club awards are silent no-ops (best-effort never throws)", async () => {
    const outsider = await shadowOf("u_fc_pts_outsider", "FC Outsider");
    await expect(
      awardClubPoints(hostShadowId, outsider, { source: "chat", sourceEventId: `pts-nm-1-${RUN}`, amount: 5 }),
    ).resolves.toBeUndefined();
    expect(await db.liveFanClubMember.count({ where: { userId: outsider } })).toBe(0);
    await expect(
      awardClubPoints("wf-u_fc_noclub_host", viewerShadowId, {
        source: "chat",
        sourceEventId: `pts-nc-1-${RUN}`,
        amount: 5,
      }),
    ).resolves.toBeUndefined();
    expect(await db.liveClubPointEvent.count({ where: { idempotencyKey: `chat:pts-nc-1-${RUN}` } })).toBe(0);
  });

  test("the award bumps lastActiveAt", async () => {
    const club = await db.liveFanClub.findUniqueOrThrow({ where: { hostId: hostShadowId } });
    const stale = new Date(Date.now() - 60_000);
    await db.liveFanClubMember.update({
      where: { clubId_userId: { clubId: club.id, userId: viewerShadowId } },
      data: { lastActiveAt: stale },
    });
    await awardClubPoints(hostShadowId, viewerShadowId, {
      source: "chat",
      sourceEventId: `pts-active-1-${RUN}`,
      amount: 1,
    });
    const member = await db.liveFanClubMember.findUniqueOrThrow({
      where: { clubId_userId: { clubId: club.id, userId: viewerShadowId } },
    });
    expect(member.lastActiveAt.getTime()).toBeGreaterThan(stale.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — the level formula (one server law)", () => {
  test("level = min(CLUB_LEVEL_MAX, floor(points / pointsPerLevel) + 1), floored at 1", () => {
    expect(deriveLevel(0, 500)).toBe(1);
    expect(deriveLevel(499, 500)).toBe(1);
    expect(deriveLevel(500, 500)).toBe(2);
    expect(deriveLevel(1001, 500)).toBe(3);
    expect(deriveLevel(10_000_000, 500)).toBe(CLUB_LEVEL_MAX);
    expect(deriveLevel(50, 1)).toBe(CLUB_LEVEL_MAX); // capped, never 51
    expect(deriveLevel(-10, 500)).toBe(1); // floors at 1
    expect(deriveLevel(10, 0)).toBe(11); // degenerate knob falls back to per=1
    expect(deriveLevel(10, -5)).toBe(11);
    expect(deriveLevel(0, 0)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — missions derive from durable rows only", () => {
  const HOST_SUB = "u_fc_ms_host";
  let hostShadowId = "";
  let viewerShadowId = "";
  let roomId = "";
  let sessionId = "";

  beforeAll(async () => {
    const fix = await createClubFixture(HOST_SUB, "FC Missions");
    hostShadowId = fix.hostShadowId;
    viewerShadowId = await shadowOf("u_wfx2_live_viewer", VIEWER_CLAIMS.name);
    const room = await createRoomFixture(sessionUserOf(claims(HOST_SUB, "FC Missions")), "5a-missions-room");
    roomId = room.roomId;
    const session = await startSessionFixture(roomId);
    sessionId = session.sessionId;
  });

  test("the fixed three missions; anonymous caller derives honest zero progress", async () => {
    const none = await deriveMissions(hostShadowId, null);
    expect(none.map((m) => m.key)).toEqual(["first-steps", "voice", "supporter"]);
    expect(none.map((m) => m.goal)).toEqual([1, 10, 1]);
    expect(none.every((m) => !m.done && m.progress === 0)).toBe(true);
  });

  test("first-steps: a LiveParticipant row on a host live session completes it", async () => {
    await db.liveParticipant.create({
      data: { sessionId, userId: viewerShadowId, role: "viewer", state: "connected" },
    });
    const missions = await deriveMissions(hostShadowId, viewerShadowId);
    const first = missions.find((m) => m.key === "first-steps")!;
    expect(first.done).toBe(true);
    expect(first.progress).toBe(1);
    expect(missions.find((m) => m.key === "voice")!.done).toBe(false);
  });

  test("voice: 9 durable chat rows miss the goal; 10 complete it", async () => {
    for (let i = 0; i < 9; i++) {
      await db.liveRoomMessage.create({
        data: {
          roomId,
          sessionId,
          senderId: viewerShadowId,
          clientMessageId: `ms-${i}`,
          body: "hello",
          kind: "chat",
        },
      });
    }
    const nine = await deriveMissions(hostShadowId, viewerShadowId);
    const voice9 = nine.find((m) => m.key === "voice")!;
    expect(voice9.progress).toBe(9);
    expect(voice9.done).toBe(false);
    await db.liveRoomMessage.create({
      data: { roomId, sessionId, senderId: viewerShadowId, clientMessageId: "ms-9", body: "ten", kind: "chat" },
    });
    const ten = await deriveMissions(hostShadowId, viewerShadowId);
    const voice10 = ten.find((m) => m.key === "voice")!;
    expect(voice10.progress).toBe(10);
    expect(voice10.done).toBe(true);
  });

  test("supporter: a gift event in a host room completes it", async () => {
    await db.giftEvent.create({
      data: {
        intentId: `intent-${crypto.randomUUID()}`,
        roomId,
        sessionId,
        senderId: viewerShadowId,
        recipientId: hostShadowId,
        giftItemId: "wave-hello",
        giftName: "Wave Hello",
        quantity: 1,
        totalCredits: 1,
      },
    });
    const missions = await deriveMissions(hostShadowId, viewerShadowId);
    const supporter = missions.find((m) => m.key === "supporter")!;
    expect(supporter.done).toBe(true);
    expect(supporter.progress).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — the overview (GET /api/live-clubs/[hostId])", () => {
  const HOST_SUB = "u_fc_ov_host";
  let hostShadowId = "";
  let viewerShadowId = "";
  let roomId = "";

  beforeAll(async () => {
    const fix = await createClubFixture(HOST_SUB, "FC Overview");
    hostShadowId = fix.hostShadowId;
    viewerShadowId = await shadowOf("u_wfx2_live_viewer", VIEWER_CLAIMS.name);
    await joinAs(VIEWER, hostShadowId);
    await joinAs(OTHER, hostShadowId);
    await joinAs(MOD, hostShadowId);
    await awardClubPoints(hostShadowId, viewerShadowId, { source: "gift", sourceEventId: `ov-v-1-${RUN}`, amount: 30 });
    await awardClubPoints(hostShadowId, await shadowOf("u_wfx2_live_mod", MOD_CLAIMS.name), {
      source: "gift",
      sourceEventId: `ov-m-1-${RUN}`,
      amount: 20,
    });
    await awardClubPoints(hostShadowId, await shadowOf("u_wfx2_live_other", OTHER_CLAIMS.name), {
      source: "gift",
      sourceEventId: `ov-o-1-${RUN}`,
      amount: 10,
    });
    const room = await createRoomFixture(sessionUserOf(claims(HOST_SUB, "FC Overview")), "5a-overview-room");
    roomId = room.roomId;
    await startSessionFixture(roomId);
    await db.liveParticipant.create({
      data: { sessionId: (await db.liveSession.findFirstOrThrow({ where: { roomId } })).id, userId: viewerShadowId, role: "viewer" },
    });
  });

  test("unknown host → 404", async () => {
    const res = await overviewAs("wf-u_fc_ov_ghost");
    expect(res.status).toBe(404);
  });

  test("anonymous overview: membership null, missions present, top members ordered", async () => {
    const res = await overviewAs(hostShadowId);
    expect(res.status).toBe(200);
    const ov = res.body.overview as LiveFanClubOverviewDto;
    expect(ov.club.hostId).toBe(hostShadowId);
    expect(ov.club.memberCount).toBe(3);
    expect(ov.membership).toBeNull();
    expect(ov.missions).toHaveLength(3);
    expect(ov.missions.every((m) => m.progress === 0)).toBe(true);
    expect(ov.topMembers).toHaveLength(3);
    expect(ov.topMembers.map((m) => m.points)).toEqual([30, 20, 10]);
    expect(ov.topMembers.map((m) => m.level)).toEqual([1, 1, 1]);
    expect(ov.topMembers[0].name).toBe(VIEWER_CLAIMS.name);
  });

  test("member overview: honest caller membership + derived missions", async () => {
    const res = await overviewAs(hostShadowId, VIEWER);
    expect(res.status).toBe(200);
    const ov = res.body.overview as LiveFanClubOverviewDto;
    expect(ov.membership).not.toBeNull();
    expect(ov.membership!.points).toBe(30);
    expect(ov.membership!.level).toBe(1);
    expect(new Date(ov.membership!.joinedAt).getTime()).toBeGreaterThan(0);
    expect(ov.missions.find((m) => m.key === "first-steps")!.done).toBe(true);
  });

  test("live room visibility: public live room is link-open, even anonymously", async () => {
    const anon = (await overviewAs(hostShadowId)).body.overview as LiveFanClubOverviewDto;
    expect(anon.liveRoom).not.toBeNull();
    expect(anon.liveRoom!.id).toBe(roomId);
    expect(anon.liveRoom!.visibility).toBe("public");
    expect(anon.liveRoom!.currentSession).not.toBeNull();
  });

  test("a members-visibility room shows for members and the host, never outsiders", async () => {
    await db.liveRoom.update({ where: { id: roomId }, data: { visibility: "members" } });
    const member = (await overviewAs(hostShadowId, VIEWER)).body.overview as LiveFanClubOverviewDto;
    expect(member.liveRoom).not.toBeNull();
    expect(member.liveRoom!.visibility).toBe("members");
    const host = (await overviewAs(hostShadowId, await cookieFor(HOST_SUB, "FC Overview"))).body
      .overview as LiveFanClubOverviewDto;
    expect(host.liveRoom).not.toBeNull(); // the host-always law
    expect(host.liveRoom!.isHost).toBe(true);
    const outsider = await overviewAs(hostShadowId, await cookieFor("u_fc_ov_outsider", "FC Outsider"));
    expect((outsider.body.overview as LiveFanClubOverviewDto).liveRoom).toBeNull();
    const anon = await overviewAs(hostShadowId);
    expect((anon.body.overview as LiveFanClubOverviewDto).liveRoom).toBeNull();
    await db.liveRoom.update({ where: { id: roomId }, data: { visibility: "public" } });
  });

  test("when the host's room is not live, liveRoom is null", async () => {
    await db.liveSession.updateMany({
      where: { roomId },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    await db.liveRoom.update({ where: { id: roomId }, data: { status: "ended" } });
    const res = await overviewAs(hostShadowId, VIEWER);
    expect((res.body.overview as LiveFanClubOverviewDto).liveRoom).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live clubs — the paged roster (GET /api/live-clubs/[hostId]/members)", () => {
  const HOST_SUB = "u_fc_pg_host";
  let hostShadowId = "";
  let clubId = "";

  beforeAll(async () => {
    const fix = await createClubFixture(HOST_SUB, "FC Roster");
    hostShadowId = fix.hostShadowId;
    clubId = fix.club.id;
    // 55 synthetic members: points descending, with a three-way tie pinned at the top
    const data = Array.from({ length: 55 }, (_, i) => ({
      clubId: clubId,
      userId: `u_fc_synth_pg_${i}`,
      points: 1000 - i,
    }));
    for (const offset of [0, 1, 2]) data[offset].points = 2000;
    await db.liveFanClubMember.createMany({ data });
  });

  test("page one: CLUB_MEMBERS_PAGE rows, points desc, nextCursor set", async () => {
    const res = await membersAs(hostShadowId);
    expect(res.status).toBe(200);
    const page = res.body as LiveFanClubMembersDto;
    expect(page.clubId).toBe(clubId);
    expect(page.members).toHaveLength(CLUB_MEMBERS_PAGE);
    const points = page.members.map((m) => m.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points); // descending
    expect(page.nextCursor).not.toBeNull();
  });

  test("the tie trio stays adjacent at the top, ordered by the stable id tiebreak", async () => {
    const page = (await membersAs(hostShadowId)).body as LiveFanClubMembersDto;
    const tie = page.members.slice(0, 3);
    expect(tie.map((m) => m.points)).toEqual([2000, 2000, 2000]);
    expect([...tie.map((m) => m.userId)].sort()).toEqual(tie.map((m) => m.userId)); // id asc
    expect(page.members[3].points).toBeLessThan(2000);
  });

  test("the cursor walks the whole roster; the last page has nextCursor null", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = (await membersAs(hostShadowId, cursor)).body as LiveFanClubMembersDto;
      seen.push(...page.members.map((m) => m.userId));
      pages++;
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10); // no pagination loop
    }
    expect(pages).toBe(2);
    expect(seen).toHaveLength(55);
    expect(new Set(seen).size).toBe(55); // no duplicates across pages
  });

  test("an unknown cursor is an honest 400; unknown host is 404", async () => {
    expect((await membersAs(hostShadowId, "does-not-exist")).status).toBe(400);
    expect((await membersAs("wf-u_fc_pg_ghost")).status).toBe(404);
  });

  test("the roster cap preview on the overview never exceeds CLUB_MEMBER_PREVIEW_MAX", async () => {
    const ov = (await overviewAs(hostShadowId)).body.overview as LiveFanClubOverviewDto;
    expect(ov.topMembers.length).toBeLessThanOrEqual(CLUB_MEMBER_PREVIEW_MAX);
    expect(ov.topMembers[0].points).toBe(2000); // top by points
  });
});
