/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes (lane E-a) — the supporter-emote
 * domain service (ADR-0011).
 *
 * The non-monetary law (ADR-0011 §2, extends ADR-0010 verbatim): an emote
 * is an ENTERTAINMENT/IDENTITY fact — never money, never a wallet item,
 * never purchasable, never convertible, never transferable. Nothing in this
 * file reads or writes a balance and no purchase path exists anywhere in
 * the emote surface.
 *
 * The entitlement law (ADR-0011 §3, fail-closed): entitlement re-derives
 * PER REQUEST from durable rows — clients claim nothing. The room host is
 * entitled to every emote of their own club; a club member is entitled to
 * an emote iff their derived member level (ADR-0010 §4 formula) ≥ the
 * emote's requiredLevel; everyone else — anonymous viewers, signed-out,
 * non-member viewers, and moderators WITHOUT club membership — is entitled
 * to nothing (a moderator capability is a moderation fact, not a
 * club-identity fact).
 *
 * The two-plane identity seam: emote reads carry the room DTO's DURABLE
 * shadow id (`wf-<sub>`, the viewer panel) while writes resolve the session
 * surface through resolveLiveIdentity (the studio manager's sub) —
 * listClubEmotesForHost resolves the host param across BOTH planes exactly
 * like clubs.ts clubForHost (the row's durable id wins).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { opsRateLimit } from "./ops";
import { deriveLevel } from "./clubs";
import {
  EMOTE_REQUIRED_LEVEL_MAX,
  EMOTE_UNICODE_MAX,
  EMOTES_PER_CLUB_MAX,
  RATE_LIMITS,
} from "./permissions";
import { LiveDomainError, resolveLiveIdentity } from "./rooms";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import type {
  LiveClubEmoteDto,
  LiveClubEmotesDto,
  SaveLiveClubEmoteInput,
} from "./types";

/** The code slug law: 1..24 lowercase chars [a-z0-9_-]. Mixed-case input is
 * REJECTED, not folded (ADR-0011 §6); EMOTE_CODE_MAX pins the 24. */
export const EMOTE_CODE_RE = /^[a-z0-9_-]{1,24}$/;

/**
 * GET map — the room-host emote set with the CALLER'S entitlement stamped
 * server-side (ADR-0011 §3; the stamp is a display hint, never authority —
 * the send path re-derives via validateEmoteUsage). Anonymous-friendly and
 * honest: no club → `{ clubName: null, emotes: [] }`, NOT an error (a GET
 * never creates identities). Ordered requiredLevel asc then code asc (the
 * stable picker order). Two-plane host param resolution EXACTLY like
 * clubs.ts clubForHost.
 */
export async function listClubEmotesForHost(
  hostIdParam: string,
  callerSessionUser: WebFlixSessionUser | null,
): Promise<LiveClubEmotesDto> {
  // The identity-plane seam: resolve the param to the DURABLE owner id —
  // the row as-is first, then the shadow mapping of the session plane.
  const owner = await db.user.findUnique({ where: { id: hostIdParam }, select: { id: true } });
  const durableId = owner ? hostIdParam : `wf-${hostIdParam}`;
  const club = await db.liveFanClub.findUnique({
    where: { hostId: durableId },
    select: { id: true, hostId: true, name: true, pointsPerLevel: true },
  });
  if (!club) {
    // Anonymous-friendly honest empty — the picker shows no set, no error.
    return { hostId: hostIdParam, clubName: null, emotes: [] };
  }
  const rows = await db.liveClubEmote.findMany({
    where: { clubId: club.id },
    orderBy: [{ requiredLevel: "asc" }, { code: "asc" }],
  });

  // Entitlement derives per request from durable rows (fail-closed):
  // anonymous → nothing; host → everything; member → by the level law.
  let callerId: string | null = null;
  let isHostCaller = false;
  let memberLevel: number | null = null;
  if (callerSessionUser) {
    const identity = await resolveLiveIdentity(callerSessionUser);
    callerId = identity.id;
    if (callerId === club.hostId) {
      isHostCaller = true;
    } else {
      const member = await db.liveFanClubMember.findUnique({
        where: { clubId_userId: { clubId: club.id, userId: callerId } },
        select: { points: true },
      });
      if (member) memberLevel = deriveLevel(member.points, club.pointsPerLevel);
    }
  }

  const emotes = rows.map(
    (row): LiveClubEmoteDto & { entitled: boolean } => ({
      code: row.code,
      unicode: row.unicode,
      requiredLevel: row.requiredLevel,
      entitled: isHostCaller || (memberLevel !== null && memberLevel >= row.requiredLevel),
    }),
  );
  return { hostId: hostIdParam, clubName: club.name, emotes };
}

/**
 * Host-only upsert by code (the unique (clubId, code)) — the caller's OWN
 * club (a creator without a club is the honest 404 no-club). Server-side
 * clamps: code must match the slug law (mixed case REJECTED, not folded),
 * unicode is 1..EMOTE_UNICODE_MAX chars, requiredLevel truncates and clamps
 * 1..EMOTE_REQUIRED_LEVEL_MAX (undefined → 1). The EMOTES_PER_CLUB_MAX set
 * cap applies to NEW codes only (re-saves never blocked by the cap).
 * Rate-limited by RATE_LIMITS.emoteSave (host CRUD; usage rides the chat
 * limiter — an emote send IS a chat send).
 */
export async function saveClubEmote(
  sessionUser: WebFlixSessionUser,
  input: SaveLiveClubEmoteInput,
): Promise<{ ok: true; updated: boolean }> {
  const identity = await resolveLiveIdentity(sessionUser);
  if (
    !(await opsRateLimit(
      "emote-save",
      `wf:live:emotes:${identity.id}`,
      RATE_LIMITS.emoteSave,
    ))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const club = await db.liveFanClub.findUnique({
    where: { hostId: identity.id },
    select: { id: true },
  });
  if (!club) throw new LiveDomainError("not-found", "no-club");

  const code = typeof input?.code === "string" ? input.code.trim() : "";
  if (!EMOTE_CODE_RE.test(code)) throw new LiveDomainError("invalid", "emote-code");
  const unicode = typeof input?.unicode === "string" ? input.unicode.trim() : "";
  if (unicode.length < 1 || unicode.length > EMOTE_UNICODE_MAX) {
    throw new LiveDomainError("invalid", "emote-unicode");
  }
  let requiredLevel = 1;
  if (input?.requiredLevel !== undefined) {
    const raw = Math.trunc(Number(input.requiredLevel));
    // A non-numeric value falls back to the default 1 — never NaN into the row.
    requiredLevel = Number.isFinite(raw)
      ? Math.max(1, Math.min(EMOTE_REQUIRED_LEVEL_MAX, raw))
      : 1;
  }

  const existing = await db.liveClubEmote.findUnique({
    where: { clubId_code: { clubId: club.id, code } },
    select: { id: true },
  });
  if (!existing) {
    const count = await db.liveClubEmote.count({ where: { clubId: club.id } });
    if (count >= EMOTES_PER_CLUB_MAX) {
      throw new LiveDomainError("conflict", "emote-set-full");
    }
  }
  if (existing) {
    await db.liveClubEmote.update({
      where: { id: existing.id },
      data: { unicode, requiredLevel },
    });
    return { ok: true, updated: true };
  }
  try {
    await db.liveClubEmote.create({
      data: { clubId: club.id, code, unicode, requiredLevel },
    });
    return { ok: true, updated: false };
  } catch (err) {
    // Concurrency net for the unique (clubId, code): a concurrent save of
    // the same code resolves to ONE row — re-fetch and update (the
    // clubs.ts P2002 law).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.liveClubEmote.findUnique({
        where: { clubId_code: { clubId: club.id, code } },
        select: { id: true },
      });
      if (raced) {
        await db.liveClubEmote.update({
          where: { id: raced.id },
          data: { unicode, requiredLevel },
        });
        return { ok: true, updated: true };
      }
    }
    throw err;
  }
}

/**
 * Host-only idempotent removal (absent code → still ok). Emotes are
 * CONFIGURATION, not history: deleting never rewrites past messages — their
 * codes render as plain text (ADR-0011 §4). Rate-limited on the same
 * emote-save surface key.
 */
export async function deleteClubEmote(
  sessionUser: WebFlixSessionUser,
  code: string,
): Promise<{ ok: true }> {
  const identity = await resolveLiveIdentity(sessionUser);
  if (
    !(await opsRateLimit(
      "emote-save",
      `wf:live:emotes:${identity.id}`,
      RATE_LIMITS.emoteSave,
    ))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const club = await db.liveFanClub.findUnique({
    where: { hostId: identity.id },
    select: { id: true },
  });
  if (!club) throw new LiveDomainError("not-found", "no-club");
  await db.liveClubEmote.deleteMany({
    where: { clubId: club.id, code: code.trim() },
  });
  return { ok: true };
}

/**
 * The chat intake law (ADR-0011 §3) — called from the chat send path after
 * the existing gates. Every `:code:` token in the body that MATCHES an
 * emote code of the host's club must be entitled, else the forbidden
 * `emote-locked` LiveDomainError. A token matching NO emote code is
 * ordinary punctuation (scores "2:1", times "10:30", ":)") — it stays
 * literal text and never errors. A body with no `:` runs the zero-query
 * fast path. Unknown codes never error; this function throws ONLY the
 * emote-locked entitlement failure.
 */
export async function validateEmoteUsage(hostId: string, userId: string, body: string): Promise<void> {
  // FAST PATH: no colon → zero queries (the overwhelmingly common chat body).
  if (!body.includes(":")) return;
  if (!userId) return;
  const club = await db.liveFanClub.findUnique({
    where: { hostId },
    select: { id: true, pointsPerLevel: true },
  });
  if (!club) return; // no club → no emotes → nothing to validate
  const tokenCodes = [
    ...new Set([...body.matchAll(/:([a-z0-9_-]{1,24}):/g)].map((m) => m[1])),
  ];
  if (tokenCodes.length === 0) return; // all colons ordinary punctuation
  const rows = await db.liveClubEmote.findMany({
    where: { clubId: club.id, code: { in: tokenCodes } },
    select: { code: true, requiredLevel: true },
  });
  if (rows.length === 0) return; // tokens match no emote code → literal text
  if (userId === hostId) return; // the host-always law (at any level)
  const member = await db.liveFanClubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId } },
    select: { points: true },
  });
  if (!member) throw new LiveDomainError("forbidden", "emote-locked");
  const level = deriveLevel(member.points, club.pointsPerLevel);
  if (rows.some((r) => r.requiredLevel > level)) {
    throw new LiveDomainError("forbidden", "emote-locked");
  }
}
