/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes (lane E-a) — the supporter-emote pins.
 *
 * Covers: the EMOTE_CODE_RE slug law (mixed case REJECTED, not folded), the
 * host upsert law (create 201 / update 200, the requiredLevel + unicode
 * clamps, the EMOTES_PER_CLUB_MAX set cap on NEW codes only), the two-plane
 * host resolution, the entitlement stamp matrix (host all-true / member by
 * the level law / anonymous + non-member all-false), the delete
 * idempotency, validateEmoteUsage (the chat intake law: fast path,
 * scores/times stay literal, unknown codes never error, fail-closed
 * emote-locked), the route mapping (anon GET 200 / anon POST 401 / 400
 * guards / DELETE flow) and the emoteSave rate limit (the 21st op → 429) —
 * the same in-memory limiter seam the live-clubs 429 pin uses.
 *
 * IDENTITY PLAN: every group mints its OWN fresh identities (unique subs →
 * unique limiter keys + unique unique-hostId clubs), so groups never share
 * state. Run on the lane db:
 *   DATABASE_URL=file:../db/live-emotes-test.db bun test --isolate tests/live-emotes.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { reqWithCookie, sessionUserOf, setupLiveDb } from "./live-helpers";
import { mintSessionCookie } from "./helpers";
import { POST as postClubs } from "@/app/api/live-clubs/route";
import { POST as postJoin } from "@/app/api/live-clubs/[hostId]/join/route";
import {
  DELETE as deleteEmotesRoute,
  GET as getEmotesRoute,
  POST as postEmotesRoute,
} from "@/app/api/live-clubs/emotes/route";
import {
  EMOTE_CODE_RE,
  deleteClubEmote,
  listClubEmotesForHost,
  saveClubEmote,
  validateEmoteUsage,
} from "@/lib/live/emotes";
import { LiveDomainError } from "@/lib/live/rooms";
import { clearRateLimits } from "@/lib/youtube/cache";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import {
  EMOTE_REQUIRED_LEVEL_MAX,
  EMOTE_UNICODE_MAX,
  EMOTES_PER_CLUB_MAX,
  RATE_LIMITS,
} from "@/lib/live/permissions";
import type { LiveClubEmotesDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

// ── helpers ──────────────────────────────────────────────────────────
// The rerun law (the live-clubs identity plan): EVERY identity in this file
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
const sessionOf = (sub: string, name: string) => sessionUserOf(claims(sub, name));
const shadowOf = async (sub: string, name: string) =>
  (await ensureShadowUser(sessionOf(sub, name))).id;

const CLUBS_URL = "http://localhost/api/live-clubs";
const EMOTES_URL = "http://localhost/api/live-clubs/emotes";
const ANON = "next-auth.session-token=none";

type ErrBody = { error?: string; message?: string };

function emotesUrlFor(hostId: string): string {
  const url = new URL(EMOTES_URL);
  url.searchParams.set("hostId", hostId);
  return url.toString();
}

async function getAs(
  hostId: string,
  cookie?: string,
): Promise<{ status: number; body: unknown }> {
  const res = await getEmotesRoute(reqWithCookie(emotesUrlFor(hostId), cookie ?? ANON));
  return { status: res.status, body: await res.json() };
}

async function postAs(
  cookie: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await postEmotesRoute(
    reqWithCookie(EMOTES_URL, cookie, { method: "POST", body }),
  );
  return { status: res.status, body: await res.json() };
}

async function deleteAs(
  cookie: string,
  code: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(EMOTES_URL);
  url.searchParams.set("code", code);
  const res = await deleteEmotesRoute(
    reqWithCookie(url.toString(), cookie, { method: "DELETE" }),
  );
  return { status: res.status, body: await res.json() };
}

/** The club id behind a durable host id. */
async function clubIdOf(hostDurableId: string): Promise<string> {
  return db.liveFanClub.findUniqueOrThrow({ where: { hostId: hostDurableId } }).then((c) => c.id);
}

/** Create the caller's club through the real route (one per creator). */
async function createClubAs(
  sub: string,
  name: string,
): Promise<{ hostDurableId: string; cookie: string }> {
  const cookie = await cookieFor(sub, name);
  const res = await postClubs(
    reqWithCookie(CLUBS_URL, cookie, {
      method: "POST",
      body: { name: `${name} Club`, motto: "entertainment only" },
    }),
  );
  expect(res.status).toBe(201);
  return { hostDurableId: await shadowOf(sub, name), cookie };
}

/** Join the host's club through the real route; force the points projection. */
async function seedMember(
  sub: string,
  name: string,
  hostDurableId: string,
  points: number,
): Promise<string> {
  const cookie = await cookieFor(sub, name);
  const joined = await postJoin(
    reqWithCookie(`${CLUBS_URL}/${hostDurableId}/join`, cookie, { method: "POST" }),
    { params: Promise.resolve({ hostId: hostDurableId }) },
  );
  expect(joined.status).toBe(200);
  const userId = await shadowOf(sub, name);
  const clubId = await clubIdOf(hostDurableId);
  await db.liveFanClubMember.update({
    where: { clubId_userId: { clubId, userId } },
    data: { points },
  });
  return userId;
}

/** Seed emote rows directly (configuration fixtures, no limiter ops). */
async function seedEmotes(
  hostDurableId: string,
  rows: { code: string; unicode: string; requiredLevel: number }[],
): Promise<void> {
  const clubId = await clubIdOf(hostDurableId);
  await db.liveClubEmote.createMany({ data: rows.map((r) => ({ ...r, clubId })) });
}

/** Capture the LiveDomainError (code, message) or fail the test. */
async function domainErrorOf(
  run: Promise<unknown>,
): Promise<{ code: LiveDomainError["code"]; message: string }> {
  try {
    await run;
  } catch (err) {
    if (err instanceof LiveDomainError) return { code: err.code, message: err.message };
    throw err;
  }
  throw new Error("expected the call to throw LiveDomainError");
}

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — the code slug law (EMOTE_CODE_RE)", () => {
  test("lowercase slug [a-z0-9_-]{1,24}; mixed case REJECTED, not folded", () => {
    expect(EMOTE_CODE_RE.test("heart")).toBe(true);
    expect(EMOTE_CODE_RE.test("gg_wp")).toBe(true);
    expect(EMOTE_CODE_RE.test("v2-clip")).toBe(true);
    expect(EMOTE_CODE_RE.test("x".repeat(24))).toBe(true); // boundary ok
    expect(EMOTE_CODE_RE.test("Heart")).toBe(false); // mixed case rejected
    expect(EMOTE_CODE_RE.test("he art")).toBe(false); // space
    expect(EMOTE_CODE_RE.test("")).toBe(false); // empty
    expect(EMOTE_CODE_RE.test("x".repeat(25))).toBe(false); // over EMOTE_CODE_MAX
    expect(EMOTE_CODE_RE.test("h!")).toBe(false); // outside the charset
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — saveClubEmote (the host upsert law)", () => {
  const HOST_SUB = "u_em_up_host";
  const HOST_NAME = "Emote Upsert";
  let hostDurableId = "";
  let hostCookie = "";

  beforeAll(async () => {
    const fix = await createClubAs(HOST_SUB, HOST_NAME);
    hostDurableId = fix.hostDurableId;
    hostCookie = fix.cookie;
  });

  test("a creator without a club → not-found no-club", async () => {
    const err = await domainErrorOf(
      saveClubEmote(sessionOf("u_em_noclub", "No Club"), { code: "heart", unicode: "❤" }),
    );
    expect(err).toEqual({ code: "not-found", message: "no-club" });
  });

  test("POST creates (updated:false → 201) and GET reflects the default requiredLevel 1", async () => {
    const res = await postAs(hostCookie, { code: "heart", unicode: "❤" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, updated: false });
    const dto = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    const heart = dto.emotes.find((e) => e.code === "heart");
    expect(heart?.unicode).toBe("❤");
    expect(heart?.requiredLevel).toBe(1);
  });

  test("re-saving the same code UPDATES (updated:true → 200); the row count stays 1", async () => {
    const res = await postAs(hostCookie, { code: "heart", unicode: "💗", requiredLevel: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: true });
    const clubId = await clubIdOf(hostDurableId);
    expect(await db.liveClubEmote.count({ where: { clubId, code: "heart" } })).toBe(1);
    const dto = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    const heart = dto.emotes.find((e) => e.code === "heart");
    expect(heart?.unicode).toBe("💗");
    expect(heart?.requiredLevel).toBe(3);
  });

  test("requiredLevel clamps: 0→1, 999→EMOTE_REQUIRED_LEVEL_MAX, 2.7→2", async () => {
    const session = sessionOf(HOST_SUB, HOST_NAME);
    await saveClubEmote(session, { code: "rl_low", unicode: "a", requiredLevel: 0 });
    await saveClubEmote(session, { code: "rl_high", unicode: "b", requiredLevel: 999 });
    await saveClubEmote(session, { code: "rl_frac", unicode: "c", requiredLevel: 2.7 });
    const clubId = await clubIdOf(hostDurableId);
    const rows = await db.liveClubEmote.findMany({
      where: { clubId, code: { in: ["rl_low", "rl_high", "rl_frac"] } },
    });
    const byCode = new Map(rows.map((r) => [r.code, r.requiredLevel]));
    expect(byCode.get("rl_low")).toBe(1);
    expect(byCode.get("rl_high")).toBe(EMOTE_REQUIRED_LEVEL_MAX);
    expect(byCode.get("rl_frac")).toBe(2); // Math.trunc, not round
  });

  test("unicode law: empty rejected, over EMOTE_UNICODE_MAX rejected, the 16-char boundary saves", async () => {
    const session = sessionOf(HOST_SUB, HOST_NAME);
    const empty = await domainErrorOf(saveClubEmote(session, { code: "bad_empty", unicode: "   " }));
    expect(empty).toEqual({ code: "invalid", message: "emote-unicode" });
    const over = await domainErrorOf(
      saveClubEmote(session, { code: "bad_long", unicode: "■".repeat(EMOTE_UNICODE_MAX + 1) }),
    );
    expect(over).toEqual({ code: "invalid", message: "emote-unicode" });
    const ok = await saveClubEmote(session, {
      code: "ok16",
      unicode: "■".repeat(EMOTE_UNICODE_MAX),
    });
    expect(ok).toEqual({ ok: true, updated: false });
    const row = await db.liveClubEmote.findFirst({ where: { club: { hostId: hostDurableId }, code: "ok16" } });
    expect(row?.unicode).toHaveLength(EMOTE_UNICODE_MAX);
  });

  test("a mixed-case code is REJECTED, not folded (invalid emote-code); nothing stored", async () => {
    const clubId = await clubIdOf(hostDurableId);
    const before = await db.liveClubEmote.count({ where: { clubId } });
    const err = await domainErrorOf(
      saveClubEmote(sessionOf(HOST_SUB, HOST_NAME), { code: "Heart", unicode: "❤" }),
    );
    expect(err).toEqual({ code: "invalid", message: "emote-code" });
    expect(await db.liveClubEmote.count({ where: { clubId } })).toBe(before);
  });

  test("the set cap: EMOTES_PER_CLUB_MAX distinct codes → the 21st is 409 emote-set-full", async () => {
    const clubId = await clubIdOf(hostDurableId);
    // Top the set up to the cap (earlier pins in this group already stored some).
    const existing = await db.liveClubEmote.count({ where: { clubId } });
    await db.liveClubEmote.createMany({
      data: Array.from({ length: EMOTES_PER_CLUB_MAX - existing }, (_, i) => ({
        clubId,
        code: `cap_${String(existing + i).padStart(2, "0")}`,
        unicode: "◆",
        requiredLevel: 1,
      })),
    });
    const res = await postAs(hostCookie, { code: "cap_overflow", unicode: "◇" });
    expect(res.status).toBe(409);
    expect((res.body as ErrBody).error).toBe("conflict");
    expect((res.body as ErrBody).message).toBe("emote-set-full");
    expect(await db.liveClubEmote.count({ where: { clubId } })).toBe(EMOTES_PER_CLUB_MAX);
  });

  test("at the cap, re-saving an EXISTING code still updates (the cap gates new codes only)", async () => {
    const res = await postAs(hostCookie, { code: "heart", unicode: "✦", requiredLevel: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: true });
    const row = await db.liveClubEmote.findFirst({
      where: { club: { hostId: hostDurableId }, code: "heart" },
    });
    expect(row?.unicode).toBe("✦");
    expect(row?.requiredLevel).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — listClubEmotesForHost (two-plane + the stamp matrix)", () => {
  const HOST_SUB = "u_em_list_host";
  let hostDurableId = "";
  let hostCookie = "";
  let member1Id = "";
  let member2Id = "";

  beforeAll(async () => {
    const fix = await createClubAs(HOST_SUB, "Emote List");
    hostDurableId = fix.hostDurableId;
    hostCookie = fix.cookie;
    member1Id = await seedMember("u_em_member1", "Emote Member One", hostDurableId, 0); // level 1
    member2Id = await seedMember("u_em_member2", "Emote Member Two", hostDurableId, 500); // level 2
    // Seeded OUT of order on purpose — the stable picker order is pinned below.
    await seedEmotes(hostDurableId, [
      { code: "zz", unicode: "🅉", requiredLevel: 2 },
      { code: "aa", unicode: "🅰", requiredLevel: 2 },
      { code: "mm", unicode: "Ⓜ", requiredLevel: 1 },
      { code: "top", unicode: "🏆", requiredLevel: 3 },
    ]);
  });

  test("no club → the honest empty map (clubName null, no emotes, no error)", async () => {
    const ghost = `wf-u_em_ghost_${RUN}`;
    const dto = await listClubEmotesForHost(ghost, null);
    expect(dto).toEqual({ hostId: ghost, clubName: null, emotes: [] });
  });

  test("two-plane resolution: the session-plane sub and the durable wf-<sub> resolve the SAME club", async () => {
    const sessionPlaneParam = `${HOST_SUB}_${RUN}`; // the plain sub — no User row carries this id
    const sessionPlane = await listClubEmotesForHost(sessionPlaneParam, null);
    const durablePlane = await listClubEmotesForHost(hostDurableId, null);
    expect(sessionPlane.clubName).toBe("Emote List Club");
    expect(durablePlane.clubName).toBe("Emote List Club");
    expect(sessionPlane.emotes.map((e) => e.code)).toEqual(durablePlane.emotes.map((e) => e.code));
    expect(sessionPlane.emotes).toHaveLength(4);
  });

  test("anonymous GET → 200 with honest entitled:false on every emote, ordered level then code", async () => {
    const res = await getAs(hostDurableId);
    expect(res.status).toBe(200);
    const dto = res.body as LiveClubEmotesDto;
    expect(dto.hostId).toBe(hostDurableId);
    expect(dto.clubName).toBe("Emote List Club");
    expect(dto.emotes.map((e) => e.code)).toEqual(["mm", "aa", "zz", "top"]);
    expect(dto.emotes.every((e) => e.entitled === false)).toBe(true);
  });

  test("the host caller is entitled to EVERY emote of their own club", async () => {
    const dto = (await getAs(hostDurableId, hostCookie)).body as LiveClubEmotesDto;
    expect(dto.emotes).toHaveLength(4);
    expect(dto.emotes.every((e) => e.entitled === true)).toBe(true);
  });

  test("member level 2: requiredLevel 1 and 2 entitled, 3 locked", async () => {
    const dto = (await getAs(hostDurableId, await cookieFor("u_em_member2", "Emote Member Two")))
      .body as LiveClubEmotesDto;
    const byCode = new Map(dto.emotes.map((e) => [e.code, e.entitled]));
    expect(byCode.get("mm")).toBe(true);
    expect(byCode.get("aa")).toBe(true);
    expect(byCode.get("zz")).toBe(true);
    expect(byCode.get("top")).toBe(false);
  });

  test("member level 1: only the level-1 emote entitled", async () => {
    const dto = (await getAs(hostDurableId, await cookieFor("u_em_member1", "Emote Member One")))
      .body as LiveClubEmotesDto;
    const byCode = new Map(dto.emotes.map((e) => [e.code, e.entitled]));
    expect(byCode.get("mm")).toBe(true);
    expect(byCode.get("aa")).toBe(false);
    expect(byCode.get("zz")).toBe(false);
    expect(byCode.get("top")).toBe(false);
  });

  test("a signed-in NON-member is entitled to nothing; member projections stay distinct", async () => {
    const outsider = (await getAs(hostDurableId, await cookieFor("u_em_outsider", "Emote Outsider")))
      .body as LiveClubEmotesDto;
    expect(outsider.emotes.every((e) => e.entitled === false)).toBe(true);
    expect(member2Id).not.toBe(member1Id);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — deleteClubEmote (idempotent removal)", () => {
  const HOST_SUB = "u_em_del_host";
  let hostDurableId = "";
  let hostCookie = "";

  beforeAll(async () => {
    const fix = await createClubAs(HOST_SUB, "Emote Delete");
    hostDurableId = fix.hostDurableId;
    hostCookie = fix.cookie;
    await seedEmotes(hostDurableId, [
      { code: "gone_soon", unicode: "💨", requiredLevel: 1 },
      { code: "stays", unicode: "🧱", requiredLevel: 1 },
    ]);
  });

  test("the host deletes → the code disappears from the map and the rows", async () => {
    const res = await deleteAs(hostCookie, "gone_soon");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const dto = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    expect(dto.emotes.map((e) => e.code)).toEqual(["stays"]);
    expect(
      await db.liveClubEmote.count({ where: { club: { hostId: hostDurableId }, code: "gone_soon" } }),
    ).toBe(0);
  });

  test("an absent code deletes cleanly — idempotent on replays", async () => {
    const first = await deleteAs(hostCookie, "never_existed");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    const again = await deleteAs(hostCookie, "gone_soon"); // already deleted above
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true });
  });

  test("a signed-in user with no club of their own → not-found no-club (host-only)", async () => {
    const err = await domainErrorOf(
      deleteClubEmote(sessionOf("u_em_del_outsider", "Emote Del Outsider"), "stays"),
    );
    expect(err).toEqual({ code: "not-found", message: "no-club" });
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — validateEmoteUsage (the chat intake law)", () => {
  const HOST_SUB = "u_em_chat_host";
  let hostDurableId = "";
  let member1Id = "";
  let member2Id = "";

  beforeAll(async () => {
    const fix = await createClubAs(HOST_SUB, "Emote Chat");
    hostDurableId = fix.hostDurableId;
    member1Id = await seedMember("u_em_chat_m1", "Emote Chat One", hostDurableId, 0); // level 1
    member2Id = await seedMember("u_em_chat_m2", "Emote Chat Two", hostDurableId, 500); // level 2
    await seedEmotes(hostDurableId, [
      { code: "hello", unicode: "👋", requiredLevel: 1 },
      { code: "crown", unicode: "👑", requiredLevel: 2 },
    ]);
  });

  test("a body with no colon runs the zero-query fast path → resolves", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, member1Id, "hello there, no tokens"),
    ).resolves.toBeUndefined();
  });

  test("scores/times/smileys stay literal — tokens matching NO emote code never error", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, member1Id, "2:1 and 10:30 :)"),
    ).resolves.toBeUndefined();
  });

  test("a matched, entitled code resolves (member level 1 vs requiredLevel 1)", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, member1Id, "go :hello: go"),
    ).resolves.toBeUndefined();
  });

  test("a matched, unentitled code throws forbidden emote-locked (requiredLevel 2 vs member level 1)", async () => {
    const err = await domainErrorOf(validateEmoteUsage(hostDurableId, member1Id, ":crown:"));
    expect(err).toEqual({ code: "forbidden", message: "emote-locked" });
  });

  test("the level law re-derives per request: a level-2 member passes the level-2 emote", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, member2Id, ":crown: :hello:"),
    ).resolves.toBeUndefined();
  });

  test("a user with NO club membership + a matched code throws emote-locked (fail-closed)", async () => {
    const outsider = await shadowOf("u_em_chat_outsider", "Emote Chat Outsider");
    const err = await domainErrorOf(validateEmoteUsage(hostDurableId, outsider, ":hello:"));
    expect(err).toEqual({ code: "forbidden", message: "emote-locked" });
  });

  test("the host passes at any level (the host-always law)", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, hostDurableId, ":crown: :hello: :ghost:"),
    ).resolves.toBeUndefined();
  });

  test("an unknown-but-emote-like token (:ghost:) is ordinary punctuation → resolves", async () => {
    await expect(
      validateEmoteUsage(hostDurableId, member1Id, "wait :ghost: what"),
    ).resolves.toBeUndefined();
  });

  test("an empty userId resolves (anonymous bodies never hit the emote law)", async () => {
    await expect(validateEmoteUsage(hostDurableId, "", ":crown:")).resolves.toBeUndefined();
  });

  test("a host with no club resolves (no club → no emotes → nothing to validate)", async () => {
    await expect(
      validateEmoteUsage(`wf-u_em_chat_ghost_${RUN}`, member1Id, ":hello:"),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — the routes (GET/POST/DELETE /api/live-clubs/emotes)", () => {
  const HOST_SUB = "u_em_route_host";
  let hostDurableId = "";
  let hostCookie = "";

  beforeAll(async () => {
    const fix = await createClubAs(HOST_SUB, "Emote Route");
    hostDurableId = fix.hostDurableId;
    hostCookie = fix.cookie;
  });

  test("GET without hostId → 400 invalid", async () => {
    const res = await getEmotesRoute(reqWithCookie(EMOTES_URL, ANON));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrBody).error).toBe("invalid");
  });

  test("anonymous POST → 401 unauthenticated", async () => {
    const res = await postAs(ANON, { code: "wave", unicode: "👋" });
    expect(res.status).toBe(401);
    expect((res.body as ErrBody).error).toBe("unauthenticated");
  });

  test("POST valid → 201; the GET map reflects it (anon false, host true)", async () => {
    const created = await postAs(hostCookie, { code: "wave", unicode: "🌊", requiredLevel: 1 });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ ok: true, updated: false });
    const anon = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    expect(anon.clubName).toBe("Emote Route Club");
    expect(anon.emotes).toHaveLength(1);
    expect(anon.emotes[0]).toMatchObject({ code: "wave", unicode: "🌊", requiredLevel: 1, entitled: false });
    const host = (await getAs(hostDurableId, hostCookie)).body as LiveClubEmotesDto;
    expect(host.emotes[0]?.entitled).toBe(true);
  });

  test("POST the same code again → 200 updated:true (upsert, not a second row)", async () => {
    const res = await postAs(hostCookie, { code: "wave", unicode: "🌊🌊", requiredLevel: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: true });
    const dto = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    expect(dto.emotes).toHaveLength(1);
    expect(dto.emotes[0]).toMatchObject({ code: "wave", unicode: "🌊🌊", requiredLevel: 2 });
  });

  test("a malformed POST body → 400 invalid", async () => {
    const res = await postEmotesRoute(
      new Request(EMOTES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: hostCookie },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrBody).error).toBe("invalid");
  });

  test("the DELETE flow: anon 401, missing code 400, host 200 → the emote is gone", async () => {
    expect((await deleteAs(ANON, "wave")).status).toBe(401);
    const noCode = await deleteEmotesRoute(reqWithCookie(EMOTES_URL, hostCookie, { method: "DELETE" }));
    expect(noCode.status).toBe(400);
    expect(((await noCode.json()) as ErrBody).error).toBe("invalid");
    const removed = await deleteAs(hostCookie, "wave");
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });
    const dto = (await getAs(hostDurableId)).body as LiveClubEmotesDto;
    expect(dto.emotes.map((e) => e.code)).not.toContain("wave");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live emotes — the emoteSave rate limit (host CRUD)", () => {
  test("the op past RATE_LIMITS.emoteSave in-window → 429 rate-limited (20/60s)", async () => {
    clearRateLimits(); // isolate this key's window
    const fix = await createClubAs("u_em_rl_host", "Emote RL");
    const cookie = fix.cookie;
    // op 1 — the POST that mints the loop emote
    expect((await postAs(cookie, { code: "rl_loop", unicode: "🔁" })).status).toBe(201);
    // Each DELETE+POST pair burns 2 ops; run until the NEXT op exceeds the
    // budget — the loop's last POST is op RATE_LIMITS.emoteSave.limit + 1.
    const pairs = Math.ceil((RATE_LIMITS.emoteSave.limit - 1) / 2);
    for (let i = 0; i < pairs; i++) {
      const del = await deleteAs(cookie, "rl_loop"); // the even ops (2, 4, …)
      expect(del.status).toBe(200); // the last DELETE is exactly op `limit`
      const save = await postAs(cookie, { code: "rl_loop", unicode: "🔁" }); // the odd ops (3, 5, …)
      if (i < pairs - 1) {
        expect(save.status).toBe(201);
      } else {
        expect(save.status).toBe(429);
        expect((save.body as ErrBody).error).toBe("rate-limited");
      }
    }
    // the denied op committed nothing
    const clubId = await clubIdOf(fix.hostDurableId);
    expect(await db.liveClubEmote.count({ where: { clubId } })).toBe(0);
  });
});
