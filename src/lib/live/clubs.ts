/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 (lane 5-a) — the fan-club domain service.
 *
 * ADR-0010 non-monetary law: club points, levels, badges and missions are
 * ENTERTAINMENT facts — never money, never a wallet balance, never
 * convertible, never purchasable. No money gate surface exists behind any
 * function in this file.
 *
 * Server-authoritative law (the rooms.ts conventions):
 *   - identity: resolveLiveIdentity (the shadow-user seam) — the club's
 *     hostId and every member row's userId are LOCAL shadow ids, so the
 *     unique (clubId, userId) and unique hostId compare like with like.
 *   - authorization: re-derived per request from durable rows; clients
 *     claim nothing.
 *   - errors: LiveDomainError + liveErrorStatus (the shared HTTP contract).
 *
 * One club per creator: LiveFanClub carries a UNIQUE hostId — a second
 * create by the same creator is the domain "conflict" error (409), enforced
 * by the unique index at commit time (the gifts.ts P2002 law).
 *
 * Award law (frozen contracts §3, the ScoreEvent law): points derive ONLY
 * from durable server facts, keyed by the idempotencyKey table —
 *   watch → `watch:{sessionId}:{userId}`
 *   chat  → `chat:{messageId}`
 *   gift  → `gift:{giftEventId}`
 * Duplicate delivery can never double-award (the unique idempotencyKey).
 * awardClubPoints is BEST-EFFORT: it never throws, so it can ride the
 * server's own durable commits (participant row, chat message, gift event)
 * without ever failing the action that earned the points. Clients never
 * claim points — there is no client-facing award path at all.
 *
 * Missions are DERIVED read-only from durable rows (no mission tables, no
 * claimable state): first-steps (1 live-session join), voice (10 chat
 * messages), supporter (1 gift) — always scoped to the HOST'S rooms.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { opsRateLimit } from "./ops";
import {
  CLUB_LEVEL_MAX,
  CLUB_MEMBERS_MAX,
  CLUB_MEMBER_PREVIEW_MAX,
  CLUB_MEMBERS_PAGE,
  CLUB_MOTTO_MAX,
  CLUB_NAME_MAX,
  CLUB_POINT_AWARD_MAX,
  RATE_LIMITS,
  resolveHandles,
} from "./permissions";
import {
  LiveDomainError,
  mapRoom,
  resolveLiveIdentity,
  viewerCountsFor,
} from "./rooms";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import type {
  CreateLiveFanClubInput,
  LiveClubMissionDto,
  LiveFanClubDto,
  LiveFanClubMemberDto,
  LiveFanClubMembersDto,
  LiveFanClubOverviewDto,
  LiveRoomDto,
} from "./types";

type HandleMap = Map<string, { handle: string; name: string }>;

/** Raw club row shape (as Prisma returns it, before DTO mapping). */
type ClubRow = {
  id: string;
  hostId: string;
  name: string;
  motto: string | null;
  pointsPerLevel: number;
  createdAt: Date;
  host: { handle: string; name: string };
  _count: { members: number };
};

type MemberRow = {
  id: string;
  clubId: string;
  userId: string;
  points: number;
  joinedAt: Date;
  lastActiveAt: Date;
};

function clubInclude() {
  return {
    host: { select: { handle: true, name: true } },
    _count: { select: { members: true } },
  };
}

function mapClub(row: ClubRow): LiveFanClubDto {
  return {
    id: row.id,
    hostId: row.hostId,
    hostHandle: row.host.handle,
    hostName: row.host.name,
    name: row.name,
    motto: row.motto,
    memberCount: row._count.members,
    pointsPerLevel: row.pointsPerLevel,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapMember(row: MemberRow, pointsPerLevel: number, handles: HandleMap): LiveFanClubMemberDto {
  const identity = handles.get(row.userId);
  return {
    userId: row.userId,
    handle: identity?.handle ?? "unknown",
    name: identity?.name ?? "Unknown",
    points: row.points,
    level: deriveLevel(row.points, pointsPerLevel),
    joinedAt: row.joinedAt.toISOString(),
  };
}

/** The roster sort law: points desc, id asc — a stable total order so the
 * id cursor paginates deterministically across ties. */
const MEMBER_ORDER = [{ points: "desc" as const }, { id: "asc" as const }];

/**
 * The one server level formula (ADR-0010 §4):
 * `level = min(CLUB_LEVEL_MAX, floor(points / pointsPerLevel) + 1)`,
 * floored at 1. pointsPerLevel is schema-defaulted (500) and never
 * client-writable; a non-positive value falls back to 1 so the formula
 * can never divide by zero.
 */
export function deriveLevel(points: number, pointsPerLevel: number): number {
  const per = Number.isFinite(pointsPerLevel) && pointsPerLevel > 0 ? pointsPerLevel : 1;
  const level = Math.floor(points / per) + 1;
  return Math.max(1, Math.min(CLUB_LEVEL_MAX, level));
}

/** The three fixed non-monetary missions (ADR-0010 §7) — derived, never stored. */
const CLUB_MISSIONS = [
  { key: "first-steps", label: "Join a LIVE session", goal: 1 },
  { key: "voice", label: "Send chat messages", goal: 10 },
  { key: "supporter", label: "Send a gift", goal: 1 },
] as const;

/**
 * Derive the caller's mission progress from durable rows only, scoped to
 * the host's rooms. Read-only: no mission tables, no claimable state, no
 * client-side counters. An anonymous caller (null userId) derives honest
 * zero progress.
 */
export async function deriveMissions(hostId: string, userId: string | null): Promise<LiveClubMissionDto[]> {
  const progress = { "first-steps": 0, voice: 0, supporter: 0 };
  if (userId) {
    const rooms = await db.liveRoom.findMany({ where: { hostId }, select: { id: true } });
    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length > 0) {
      const [participant, chatRows, giftRows] = await Promise.all([
        // first-steps: a LiveParticipant row on ANY live session of the host's rooms
        db.liveParticipant.findFirst({
          where: { userId, session: { roomId: { in: roomIds } } },
          select: { id: true },
        }),
        // voice: durable chat rows sent in the host's rooms
        db.liveRoomMessage.count({ where: { senderId: userId, roomId: { in: roomIds } } }),
        // supporter: gift events sent in the host's rooms
        db.giftEvent.count({ where: { senderId: userId, roomId: { in: roomIds } } }),
      ]);
      progress["first-steps"] = participant ? 1 : 0;
      progress.voice = chatRows;
      progress.supporter = giftRows;
    }
  }
  return CLUB_MISSIONS.map((m) => ({
    key: m.key,
    label: m.label,
    goal: m.goal,
    progress: Math.min(progress[m.key], m.goal),
    done: progress[m.key] >= m.goal,
  }));
}

/**
 * The club join ban law: the sanction ledger (LiveModerationAction) is
 * authoritative — the LATEST ban-dimension action wins (the same
 * latest-wins law as permissions.activeSanctions). Scope: an active ban in
 * ANY room owned by the club's host bars the actor from THAT host's club —
 * a per-room sanction never becomes a platform-wide ban, but the host's
 * own rooms are the club's jurisdiction.
 */
async function bannedInHostRooms(hostId: string, userId: string): Promise<boolean> {
  if (!userId) return false;
  const hostRooms = await db.liveRoom.findMany({ where: { hostId }, select: { id: true } });
  if (hostRooms.length === 0) return false;
  const actions = await db.liveModerationAction.findMany({
    where: {
      targetId: userId,
      roomId: { in: hostRooms.map((r) => r.id) },
      action: { in: ["ban", "unban"] },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { action: true },
  });
  return actions[0]?.action === "ban";
}

async function clubForHost(hostId: string): Promise<ClubRow> {
  const club = await db.liveFanClub.findUnique({ where: { hostId }, include: clubInclude() });
  if (!club) throw new LiveDomainError("not-found", "no club for this host");
  return club;
}

/**
 * Create the caller's club. Signed-in creators only (the route 401s before
 * this); ONE club per creator (the unique hostId — a second create is the
 * domain conflict). name/motto are clamped to CLUB_NAME_MAX / CLUB_MOTTO_MAX
 * (the server never trusts client lengths); an empty name is invalid.
 * Rate-limited by RATE_LIMITS.clubCreate.
 */
export async function createClub(
  sessionUser: WebFlixSessionUser,
  input: CreateLiveFanClubInput,
): Promise<LiveFanClubDto> {
  const identity = await resolveLiveIdentity(sessionUser);
  if (
    !(await opsRateLimit(
      "club-create",
      `wf:live:clubs:create:${identity.id}`,
      RATE_LIMITS.clubCreate,
    ))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name.length < 1) throw new LiveDomainError("invalid", "name is required");
  const mottoRaw = typeof input?.motto === "string" ? input.motto.trim() : "";
  const club = await db.liveFanClub.create({
    data: {
      hostId: identity.id,
      name: name.slice(0, CLUB_NAME_MAX),
      motto: mottoRaw.length > 0 ? mottoRaw.slice(0, CLUB_MOTTO_MAX) : null,
    },
    include: clubInclude(),
  }).catch((err: unknown) => {
    // Concurrency net for the unique hostId: two in-flight creates by the
    // same creator resolve to ONE club — the loser gets the domain conflict.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new LiveDomainError("conflict", "one club per creator");
    }
    throw err;
  });
  return mapClub(club);
}

/** The caller's own club, or null when they have not created one. */
export async function getMyClub(sessionUser: WebFlixSessionUser): Promise<LiveFanClubDto | null> {
  const identity = await resolveLiveIdentity(sessionUser);
  const club = await db.liveFanClub.findUnique({
    where: { hostId: identity.id },
    include: clubInclude(),
  });
  return club ? mapClub(club) : null;
}

/**
 * The club overview for THIS caller (anonymous callers welcome — membership
 * derives as null). Bundle: club + caller membership + derived missions +
 * top members (CLUB_MEMBER_PREVIEW_MAX, points desc) + the host's current
 * LIVE room ONLY when the caller may see it: "public"/"unlisted" rooms are
 * link-open to the overview caller; a "members" room requires club
 * membership — except the host themselves (the platform's host-always
 * law, the same rung mintToken applies).
 */
export async function getClubOverview(
  callerSessionUser: WebFlixSessionUser | null,
  hostId: string,
): Promise<LiveFanClubOverviewDto> {
  const club = await clubForHost(hostId);
  const callerId = callerSessionUser ? (await resolveLiveIdentity(callerSessionUser)).id : null;
  const membership = callerId
    ? await db.liveFanClubMember.findUnique({
        where: { clubId_userId: { clubId: club.id, userId: callerId } },
      })
    : null;

  const [missions, topRows, liveRoomRaw] = await Promise.all([
    deriveMissions(hostId, callerId),
    db.liveFanClubMember.findMany({
      where: { clubId: club.id },
      orderBy: MEMBER_ORDER,
      take: CLUB_MEMBER_PREVIEW_MAX,
    }),
    db.liveRoom.findFirst({
      where: { hostId, status: "live" },
      orderBy: { createdAt: "desc" },
      include: {
        host: { select: { handle: true, name: true } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const handles = await resolveHandles(topRows.map((r) => r.userId));
  const topMembers = topRows.map((r) => mapMember(r, club.pointsPerLevel, handles));

  let liveRoom: LiveRoomDto | null = null;
  if (liveRoomRaw) {
    const maySee =
      liveRoomRaw.visibility !== "members" ||
      callerId === hostId ||
      membership !== null;
    if (maySee) {
      const counts = await viewerCountsFor(liveRoomRaw.sessions.map((s) => s.id));
      const dto = mapRoom(liveRoomRaw, counts, callerId);
      // mapRoom predates the "members" visibility rung (lane 5-b owns
      // rooms.ts) — patch the honest label here so the overview never
      // misreports a members room as public.
      liveRoom = liveRoomRaw.visibility === "members" ? { ...dto, visibility: "members" } : dto;
    }
  }

  return {
    club: mapClub(club),
    membership: membership
      ? {
          points: membership.points,
          level: deriveLevel(membership.points, club.pointsPerLevel),
          joinedAt: membership.joinedAt.toISOString(),
        }
      : null,
    missions,
    topMembers,
    liveRoom,
  };
}

/**
 * Join the host's club. Idempotent (already a member → no-op success);
 * enforces the documented CLUB_MEMBERS_MAX capacity law; a banned actor
 * (active ban sanction from the host's rooms) can never join.
 * Rate-limited by RATE_LIMITS.clubJoin.
 */
export async function joinClub(
  sessionUser: WebFlixSessionUser,
  hostId: string,
): Promise<{ ok: true }> {
  const identity = await resolveLiveIdentity(sessionUser);
  if (
    !(await opsRateLimit(
      "club-join",
      `wf:live:clubs:join:${hostId}:${identity.id}`,
      RATE_LIMITS.clubJoin,
    ))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const club = await clubForHost(hostId);
  const existing = await db.liveFanClubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId: identity.id } },
    select: { id: true },
  });
  if (existing) return { ok: true }; // idempotent: membership is a fact, not an error

  if (await bannedInHostRooms(hostId, identity.id)) {
    throw new LiveDomainError("forbidden", "banned");
  }
  const memberCount = await db.liveFanClubMember.count({ where: { clubId: club.id } });
  if (memberCount >= CLUB_MEMBERS_MAX) {
    throw new LiveDomainError("forbidden", "club-full");
  }
  try {
    await db.liveFanClubMember.create({
      data: { clubId: club.id, userId: identity.id, lastActiveAt: new Date() },
    });
  } catch (err) {
    // Concurrency net for the unique (clubId, userId): a concurrent join by
    // the same identity resolves to the ONE membership — still a success.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: true };
    }
    throw err;
  }
  return { ok: true };
}

/**
 * Leave the host's club. Idempotent (not a member → no-op success). The
 * append-only point ledger is history and is never rewritten; a re-join
 * starts a fresh membership projection (points 0) — the ledger rows of the
 * past membership remain the audit trail.
 * Rate-limited by RATE_LIMITS.clubLeave.
 */
export async function leaveClub(
  sessionUser: WebFlixSessionUser,
  hostId: string,
): Promise<{ ok: true }> {
  const identity = await resolveLiveIdentity(sessionUser);
  if (
    !(await opsRateLimit(
      "club-leave",
      `wf:live:clubs:leave:${hostId}:${identity.id}`,
      RATE_LIMITS.clubLeave,
    ))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  const club = await clubForHost(hostId);
  await db.liveFanClubMember.deleteMany({
    where: { clubId: club.id, userId: identity.id },
  });
  return { ok: true };
}

/**
 * The paged member roster — top by points (the stable MEMBER_ORDER), page
 * size CLUB_MEMBERS_PAGE. The cursor is the last member's id from the
 * previous page (opaque to callers); an unknown or foreign cursor is the
 * honest 400, not a silent page-one rewind.
 */
export async function listClubMembers(hostId: string, cursor?: string): Promise<LiveFanClubMembersDto> {
  const club = await clubForHost(hostId);
  let cursorId: string | undefined;
  if (cursor !== undefined && cursor !== "") {
    const row = await db.liveFanClubMember.findUnique({ where: { id: cursor }, select: { clubId: true } });
    if (!row || row.clubId !== club.id) {
      throw new LiveDomainError("invalid", "unknown cursor");
    }
    cursorId = cursor;
  }
  const rows = await db.liveFanClubMember.findMany({
    where: { clubId: club.id },
    orderBy: MEMBER_ORDER,
    take: CLUB_MEMBERS_PAGE + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });
  const hasMore = rows.length > CLUB_MEMBERS_PAGE;
  const page = hasMore ? rows.slice(0, CLUB_MEMBERS_PAGE) : rows;
  const handles = await resolveHandles(page.map((r) => r.userId));
  return {
    clubId: club.id,
    members: page.map((r) => mapMember(r, club.pointsPerLevel, handles)),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

/**
 * The idempotency-key law (frozen contracts §3): the key derives from the
 * DURABLE event that earned the points —
 *   watch → `watch:{sessionId}:{userId}` (sourceEventId carries sessionId)
 *   chat  → `chat:{messageId}`
 *   gift  → `gift:{giftEventId}`
 * An award without a durable sourceEventId can never be keyed and is
 * dropped (a synthesized key could dedupe unrelated future awards).
 */
function clubPointIdempotencyKey(
  source: "watch" | "chat" | "gift",
  sourceEventId: string,
  userId: string,
): string {
  if (source === "watch") return `watch:${sourceEventId}:${userId}`;
  if (source === "chat") return `chat:${sourceEventId}`;
  return `gift:${sourceEventId}`;
}

/**
 * Award club points — BEST-EFFORT by law (ADR-0010 §8): this never throws,
 * so it can ride the server's own durable commits (the participant row, the
 * chat message, the gift event) without ever failing the action that earned
 * the points. Gates: unknown club → no-op; non-member → no-op; amount is
 * re-clamped server-side to CLUB_POINT_AWARD_MAX (≤ 0 → no-op); a duplicate
 * idempotencyKey (replayed delivery) → no-op — the unique key makes double
 * delivery impossible, exactly the ScoreEvent law. The ledger row AND the
 * member.points projection increment in ONE interactive transaction; the
 * projection stays re-derivable from the ledger.
 */
export async function awardClubPoints(
  hostId: string,
  userId: string,
  ev: { source: "watch" | "chat" | "gift"; sourceEventId?: string; amount: number },
): Promise<void> {
  try {
    if (!hostId || !userId) return;
    const source = ev?.source;
    if (source !== "watch" && source !== "chat" && source !== "gift") return;
    const raw = Math.trunc(Number(ev?.amount));
    if (!Number.isFinite(raw) || raw <= 0) return; // negative/zero → no-op
    const amount = Math.min(raw, CLUB_POINT_AWARD_MAX);
    const sourceEventId = typeof ev?.sourceEventId === "string" ? ev.sourceEventId.trim() : "";
    if (!sourceEventId) {
      console.warn("club points: dropped an award without a durable sourceEventId", source);
      return;
    }
    const club = await db.liveFanClub.findUnique({ where: { hostId }, select: { id: true } });
    if (!club) return;
    const member = await db.liveFanClubMember.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { id: true },
    });
    if (!member) return; // not a member → no-op
    await db.$transaction(async (tx) => {
      await tx.liveClubPointEvent.create({
        data: {
          clubId: club.id,
          memberId: member.id,
          amount,
          source,
          sourceEventId,
          idempotencyKey: clubPointIdempotencyKey(source, sourceEventId, userId),
        },
      });
      await tx.liveFanClubMember.update({
        where: { id: member.id },
        data: { points: { increment: amount }, lastActiveAt: new Date() },
      });
    });
  } catch (err) {
    // The unique idempotencyKey made one delivery the committed original —
    // a duplicate delivery is a silent no-op; anything else is a best-effort
    // warn (the rider action must never fail because of club points).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.warn("club points award failed (best-effort)", err);
  }
}
