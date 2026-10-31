/**
 * WFX2-LIVE-PLATFORM-1 — the LIVE domain service (server-authoritative).
 *
 * The state machine owns every room/session transition. Clients send
 * validated intent; THIS layer authorizes and derives the result (work
 * order principle #4). Authorization rules:
 *   - create room: any signed-in user
 *   - start session: room.hostId === caller (403 otherwise)
 *   - mint token: session must be live; host rung requires host identity;
 *     every non-host gets the viewer rung (guest rung arrives with Phase 3)
 *   - end: room.hostId === caller
 * Idempotency laws:
 *   - one non-ended session per room (start while live → conflict)
 *   - end on an already-ended session is a no-op success
 *   - webhook reconcile dedupes by eventId + tolerates late/out-of-order
 *     deliveries (an ended session is terminal; nothing un-ends it)
 */
import { db } from "@/lib/db";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { livekitAdapter } from "./livekit-adapter";
import type { LiveProviderAdapter } from "./provider";
import {
  liveProviderConfig,
} from "./config";
import { PRESENCE_WINDOW_MS } from "./permissions";
import type {
  CreateLiveRoomInput,
  LivePlaybackPlan,
  LiveRoomDto,
  LiveRoomStatus,
  LiveSessionDto,
  LiveSessionStatus,
  LiveTokenRole,
  LiveWebhookEvent,
} from "./types";
import type { WebFlixSessionUser } from "@/lib/auth/types";

/**
 * The canonical LIVE identity: the shadow User row (the app-wide seam —
 * /api/me and the watch lanes resolve identities through the same
 * ensureShadowUser law). The auth session (Upstash-backed) is a separate
 * identity plane; EVERY LiveRoom/LiveParticipant/LiveKit identity below is
 * the LOCAL shadow id, so FKs hold and host checks compare like with like.
 */
export async function resolveLiveIdentity(sessionUser: WebFlixSessionUser): Promise<{
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}> {
  return ensureShadowUser(sessionUser);
}

/** Token TTLs (seconds) — short-lived by law; clients re-mint on reconnect. */
export const TOKEN_TTL_SECONDS = {
  host: 60 * 60 * 2,
  guest: 60 * 60 * 2,
  viewer: 60 * 60,
} as const;

export class LiveDomainError extends Error {
  constructor(
    public readonly code:
      | "unauthenticated"
      | "not-found"
      | "forbidden"
      | "invalid"
      | "conflict"
      | "provider-not-configured"
      | "provider-failed"
      | "rate-limited",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LiveDomainError";
  }
}

/** The adapter seam — overridable in tests; LiveKit in every real path. */
export function adapter(): LiveProviderAdapter {
  return livekitAdapter;
}

type RoomWithSession = Awaited<ReturnType<typeof db.liveRoom.findFirstOrThrow>>;

function mapSession(s: {
  id: string;
  roomId: string;
  provider: string;
  providerRoomId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
}): LiveSessionDto {
  return {
    id: s.id,
    roomId: s.roomId,
    provider: s.provider as LiveSessionDto["provider"],
    providerRoomId: s.providerRoomId,
    status: s.status as LiveSessionStatus,
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    endReason: (s.endReason as LiveSessionDto["endReason"]) ?? null,
  };
}

/** Raw provider row shapes (as Prisma returns them, before DTO mapping). */
type RawSession = {
  id: string;
  roomId: string;
  provider: string;
  providerRoomId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
};

type RawRoom = {
  id: string;
  hostId: string;
  title: string;
  status: string;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  host: { handle: string; name: string };
  sessions: RawSession[];
};

export function mapRoom(
  room: RawRoom,
  viewerCounts: Map<string, number>,
  callerId: string | null,
): LiveRoomDto {
  const sessions = [...room.sessions]
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
    .map(mapSession);
  const current = sessions[0] ?? null;
  return {
    id: room.id,
    hostId: room.hostId,
    hostHandle: room.host.handle,
    hostName: room.host.name,
    title: room.title,
    status: room.status as LiveRoomStatus,
    visibility: room.visibility === "unlisted" ? "unlisted" : "public",
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    currentSession: current,
    viewerCount: current ? viewerCounts.get(current.id) ?? 0 : 0,
    isHost: callerId === null ? null : room.hostId === callerId,
  };
}

/**
 * Approximate viewer counts — the Phase 2 presence law: only VIEWER-role
 * participants inside the freshness window (PRESENCE_WINDOW_MS) count.
 * Heartbeats keep rows fresh; a closed tab decays out of the count within
 * one window. Host rows never count as viewers. Still APPROXIMATE by law —
 * never a billing/financial fact.
 */
export async function viewerCountsFor(sessionIds: string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
  const rows = await db.liveParticipant.groupBy({
    by: ["sessionId"],
    where: {
      sessionId: { in: sessionIds },
      state: "connected",
      role: "viewer",
      lastSeenAt: { gt: cutoff },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.sessionId, r._count._all]));
}

function roomInclude() {
  return {
    host: { select: { handle: true, name: true } },
    sessions: { orderBy: { createdAt: "desc" as const }, take: 1 },
  };
}

export async function createRoom(
  sessionUser: WebFlixSessionUser,
  input: CreateLiveRoomInput,
): Promise<LiveRoomDto> {
  const title = input.title?.trim() ?? "";
  if (title.length < 1 || title.length > 140) {
    throw new LiveDomainError("invalid", "title must be 1..140 chars");
  }
  const visibility = input.visibility === "unlisted" ? "unlisted" : "public";
  const identity = await resolveLiveIdentity(sessionUser);
  const room = await db.liveRoom.create({
    data: { hostId: identity.id, title, visibility, status: "idle" },
    include: roomInclude(),
  });
  return mapRoom(room, new Map(), identity.id);
}

export async function getRoom(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<LiveRoomDto | null> {
  const callerId = sessionUser ? (await resolveLiveIdentity(sessionUser)).id : null;
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, include: roomInclude() });
  if (!room) return null;
  // Unlisted rooms are visible to their host and to anyone who already has
  // the id (link-sharing semantics) — a guessed id still finds nothing public.
  if (room.visibility === "unlisted" && callerId !== room.hostId) {
    // reachable only by direct link; discovery never lists it
  }
  const counts = await viewerCountsFor(room.sessions.map((s) => s.id));
  return mapRoom(room, counts, callerId);
}

export async function listRooms(opts: {
  status?: LiveRoomStatus;
  sessionUser: WebFlixSessionUser | null;
  limit?: number;
}): Promise<LiveRoomDto[]> {
  const status = opts.status ?? "live";
  const callerId = opts.sessionUser ? (await resolveLiveIdentity(opts.sessionUser)).id : null;
  const rooms = await db.liveRoom.findMany({
    where: { visibility: "public", status },
    include: roomInclude(),
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 24, 1), 48),
  });
  const counts = await viewerCountsFor(rooms.flatMap((r) => r.sessions.map((s) => s.id)));
  return rooms.map((r) => mapRoom(r, counts, callerId));
}

export async function startSession(
  roomId: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ room: LiveRoomDto; playback: LivePlaybackPlan }> {
  const ad = adapter();
  if (!ad.isConfigured()) {
    throw new LiveDomainError("provider-not-configured");
  }
  const identity = await resolveLiveIdentity(sessionUser);
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, include: roomInclude() });
  if (!room) throw new LiveDomainError("not-found");
  if (room.hostId !== identity.id) throw new LiveDomainError("forbidden");

  const active = await db.liveSession.findFirst({
    where: { roomId, status: { not: "ended" } },
  });
  if (active) throw new LiveDomainError("conflict", "session-active");

  // Opaque provider room name — unique per session, carries no user data.
  const providerRoomId = `wfl-${crypto.randomUUID()}`;
  let session;
  try {
    session = await db.liveSession.create({
      data: { roomId, providerRoomId, provider: ad.provider, status: "live", startedAt: new Date() },
    });
    await db.liveRoom.update({ where: { id: roomId }, data: { status: "live" } });
  } catch (err) {
    // The provider room was never joined (token not yet minted) — no
    // provider-side cleanup is needed for a failed create.
    throw err instanceof LiveDomainError
      ? err
      : new LiveDomainError("provider-failed", "could not create session");
  }

  const playback = await (async () => {
    try {
      return await ad.mintToken({
        roomName: providerRoomId,
        identity: identity.id,
        role: "host",
        ttlSeconds: TOKEN_TTL_SECONDS.host,
      });
    } catch (err) {
      // Phase 4-OPS: a provider failure at go-live is an OPERATIONS fact —
      // recorded best-effort (never replaces the honest domain error).
      const { recordOpsEvent } = await import("./ops");
      void recordOpsEvent({
        kind: "provider_error",
        roomId,
        surface: "start-session",
        code: err instanceof Error ? err.message : "mint-failed",
      });
      throw err;
    }
  })();

  const fresh = await db.liveRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude(),
  });
  await db.liveParticipant.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: identity.id } },
    create: { sessionId: session.id, userId: identity.id, role: "host", state: "connected" },
    update: { role: "host", state: "connected", lastSeenAt: new Date() },
  });
  return { room: mapRoom(fresh, new Map([[session.id, 0]]), identity.id), playback };
}

export async function mintJoinToken(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  requestedRole: LiveTokenRole,
): Promise<LivePlaybackPlan> {
  const ad = adapter();
  if (!ad.isConfigured()) {
    throw new LiveDomainError("provider-not-configured");
  }
  const identity = await resolveLiveIdentity(sessionUser);
  const room = await db.liveRoom.findUnique({
    where: { id: roomId },
    include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!room) throw new LiveDomainError("not-found");
  const session = room.sessions[0];
  if (!session || session.status === "ended") {
    throw new LiveDomainError("conflict", "no-live-session");
  }
  // Phase 1 rung law: the host proves identity by being the room's hostId.
  // Phase 3 guest rung: a publisher token requires an ACCEPTED invite on
  // this room (guests.acceptedGuestInvite) AND a non-removed participant
  // row — a host-removed guest can never re-publish. Everything else
  // degrades honestly to the subscribe-only viewer rung.
  let role: LiveTokenRole = "viewer";
  const existingParticipant = await db.liveParticipant.findUnique({
    where: { sessionId_userId: { sessionId: session.id, userId: identity.id } },
    select: { state: true },
  });
  const wasRemoved = existingParticipant?.state === "removed";
  if (room.hostId === identity.id) {
    role = "host";
  } else if (requestedRole === "guest" && !wasRemoved) {
    // Dynamic import: guests.ts sits on top of rooms.ts (LiveDomainError +
    // adapter); the static edge would be a module cycle.
    const { acceptedGuestInvite } = await import("./guests");
    if (await acceptedGuestInvite(roomId, identity.id)) {
      role = "guest";
    }
  }
  const plan = await ad.mintToken({
    roomName: session.providerRoomId,
    identity: identity.id,
    role,
    ttlSeconds:
      role === "host"
        ? TOKEN_TTL_SECONDS.host
        : role === "guest"
          ? TOKEN_TTL_SECONDS.guest
          : TOKEN_TTL_SECONDS.viewer,
  });
  await db.liveParticipant.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: identity.id } },
    create: {
      sessionId: session.id,
      userId: identity.id,
      role: role === "host" ? "host" : role === "guest" ? "guest" : "viewer",
      state: wasRemoved ? "removed" : "connected",
    },
    // A host-removed identity keeps its removed marker (the stage roster
    // and future mint decisions read it) — only lastSeenAt refreshes.
    update: wasRemoved
      ? { lastSeenAt: new Date() }
      : { state: "connected", lastSeenAt: new Date() },
  });
  return plan;
}

export async function endRoom(roomId: string, sessionUser: WebFlixSessionUser): Promise<LiveRoomDto> {
  const identity = await resolveLiveIdentity(sessionUser);
  const room = await db.liveRoom.findUnique({
    where: { id: roomId },
    include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!room) throw new LiveDomainError("not-found");
  if (room.hostId !== identity.id) throw new LiveDomainError("forbidden");

  const session = room.sessions[0];
  const alreadyEnded =
    !session ||
    session.status === "ended" ||
    room.status === "ended";

  if (!alreadyEnded && session) {
    const ad = adapter();
    if (!ad.isConfigured()) throw new LiveDomainError("provider-not-configured");
    // Provider teardown FIRST — if the provider is unreachable the app state
    // stays live and the caller sees the honest failure (no fake success);
    // the provider webhook remains the reconciliation backstop.
    // (RoomCompositeEgress, when operator-declared, ends with the room.)
    try {
      await ad.destroyRoom(session.providerRoomId);
    } catch (err) {
      // Phase 4-OPS: a failed teardown is an OPERATIONS fact (best-effort;
      // the honest failure still surfaces unchanged).
      const { recordOpsEvent } = await import("./ops");
      void recordOpsEvent({
        kind: "provider_error",
        roomId,
        sessionId: session.id,
        surface: "end-room",
        code: err instanceof Error ? err.message : "destroy-failed",
      });
      throw err;
    }
    await db.liveSession.update({
      where: { id: session.id },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    await runEndSideEffects(session.id, roomId);
  }
  const done = await db.liveRoom.update({
    where: { id: roomId },
    data: { status: "ended" },
    include: roomInclude(),
  });
  const counts = await viewerCountsFor(done.sessions.map((s) => s.id));
  return mapRoom(done, counts, identity.id);
}

/**
 * Phase 4 end-hook (integration lane): the analytics snapshot + the replay
 * finalize BOTH run best-effort — neither may block or fail the end
 * reconcile (the host analytics read always re-derives = self-healing; a
 * recording still in flight flips to the honest "failed" row). Dynamic
 * imports keep the rooms→{analytics,replays} edges acyclic.
 */
async function runEndSideEffects(sessionId: string, roomId: string): Promise<void> {
  // Phase 4-OPS: the end reconcile itself is an observation (ADR-0009) —
  // valueMs is the session's derived duration (both callers set endedAt
  // BEFORE this hook runs). Best-effort like everything in this hook.
  try {
    const { recordOpsEvent } = await import("./ops");
    const session = await db.liveSession.findUnique({
      where: { id: sessionId },
      select: { startedAt: true, endedAt: true },
    });
    const durationMs =
      session?.startedAt && session?.endedAt
        ? Math.max(0, session.endedAt.getTime() - session.startedAt.getTime())
        : null;
    await recordOpsEvent({ kind: "end_reconcile", roomId, sessionId, valueMs: durationMs });
  } catch (err) {
    console.error("live end-hook ops fact failed", err);
  }
  try {
    const { recordSessionAnalytics } = await import("./analytics");
    await recordSessionAnalytics(sessionId, roomId);
  } catch (err) {
    console.error("live end-hook analytics failed", err);
  }
  try {
    const { finalizeRecordingOnEnd } = await import("./replays");
    await finalizeRecordingOnEnd(sessionId, roomId);
  } catch (err) {
    console.error("live end-hook replay finalize failed", err);
  }
}

/**
 * Webhook reconciliation — idempotent by construction:
 * - signature-invalid events never reach here (route answers 401)
 * - an ended session is terminal; every late/duplicate delivery no-ops
 * - participant events upsert membership rows (viewer-count basis)
 */
export async function reconcileWebhookEvent(event: LiveWebhookEvent): Promise<{ reconciled: boolean }> {
  if (!event.roomName) return { reconciled: false };
  const session = await db.liveSession.findUnique({
    where: { provider_providerRoomId: { provider: event.provider, providerRoomId: event.roomName } },
    include: { room: true },
  });
  if (!session) return { reconciled: false };

  switch (event.kind) {
    case "room_started": {
      if (session.status === "starting") {
        await db.liveSession.update({ where: { id: session.id }, data: { status: "live" } });
        return { reconciled: true };
      }
      return { reconciled: false };
    }
    case "room_finished": {
      if (session.status !== "ended") {
        await db.liveSession.update({
          where: { id: session.id },
          data: { status: "ended", endedAt: new Date(), endReason: "provider-webhook" },
        });
        await db.liveRoom.update({ where: { id: session.roomId }, data: { status: "ended" } });
        await runEndSideEffects(session.id, session.roomId);
        return { reconciled: true };
      }
      return { reconciled: false };
    }
    case "participant_joined": {
      if (!event.participantIdentity) return { reconciled: false };
      const isHost = session.room.hostId === event.participantIdentity;
      await db.liveParticipant.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId: event.participantIdentity } },
        create: {
          sessionId: session.id,
          userId: event.participantIdentity,
          role: isHost ? "host" : "viewer",
          state: "connected",
        },
        update: { state: "connected", lastSeenAt: new Date() },
      });
      return { reconciled: true };
    }
    case "participant_left": {
      if (!event.participantIdentity) return { reconciled: false };
      await db.liveParticipant.updateMany({
        where: { sessionId: session.id, userId: event.participantIdentity },
        data: { state: "disconnected", lastSeenAt: new Date() },
      });
      return { reconciled: true };
    }
    default:
      return { reconciled: false };
  }
}

/** Guard for route handlers: map domain errors to the honest HTTP contract. */
export function liveErrorStatus(code: LiveDomainError["code"]): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "not-found":
      return 404;
    case "forbidden":
      return 403;
    case "invalid":
      return 400;
    case "conflict":
      return 409;
    case "provider-not-configured":
      return 503;
    case "provider-failed":
      return 502;
    case "rate-limited":
      return 429;
  }
}

export type { RoomWithSession };
export { liveProviderConfig };
