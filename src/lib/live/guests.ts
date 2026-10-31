/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 (lane 3-a) — the guest-stage domain service.
 *
 * The LiveInvite ledger (host invitations + viewer self-requests), the stage
 * roster read model, host removal, and the `acceptedGuestInvite()` seam the
 * TL's mintJoinToken rung calls. Laws (docs/plans/wfx2-live-phase-3-contracts.md,
 * work order §4D — frozen):
 *   - the host posts { inviteeId } (an invitation); any signed-in non-host
 *     posts {} (a self-request). inviterId is always the row's creator, so
 *     direction is derived: inviterId === room.hostId → "host-invite".
 *   - pending rows expire by a lazy wall-clock sweep (idempotent on read);
 *     ACCEPTED invites never expire — they are the publisher-right deed.
 *   - responder law: host-invite rows are answered by the invitee,
 *     guest-request rows by the host; no one else.
 *   - accept = invite status flip + participant upsert (role "guest", state
 *     "connected") on the ACTIVE session, in one flow, behind the stage cap.
 *   - durable commit first: publishLiveEvent runs only after the row lands.
 *   - provider coupling is ONLY adapter().removeParticipant (best-effort,
 *     never fatal) — no LiveKit SDKs here (work order §3.2).
 */
import { db } from "@/lib/db";
import type { LiveInvite } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import { opsRateLimit } from "./ops";
import {
  activeSanctions,
  activeSessionFor,
  GUEST_SLOTS_MAX,
  INVITE_TTL_SECONDS,
  liveActorFor,
  RATE_LIMITS,
  resolveHandles,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { adapter, LiveDomainError } from "./rooms";
import type {
  CreateLiveInviteInput,
  LiveInviteDto,
  LiveInviteStatus,
  LiveParticipantState,
  LiveStageDto,
  LiveStageParticipantDto,
  RespondLiveInviteInput,
} from "./types";

// ── DTO mapping (the §Phase 3 vocabulary, nothing invented) ──

function rawInviteDto(
  row: LiveInvite,
  hostId: string,
  invitee: { handle: string; name: string } | undefined,
): LiveInviteDto {
  return {
    id: row.id,
    roomId: row.roomId,
    inviteeId: row.inviteeId,
    inviteeHandle: invitee?.handle ?? "",
    inviteeName: invitee?.name ?? "",
    inviterId: row.inviterId,
    direction: row.inviterId === hostId ? "host-invite" : "guest-request",
    role: "guest",
    status: row.status as LiveInviteStatus,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function inviteToDto(row: LiveInvite, hostId: string): Promise<LiveInviteDto> {
  const handles = await resolveHandles([row.inviteeId]);
  return rawInviteDto(row, hostId, handles.get(row.inviteeId));
}

async function invitesToDtos(rows: LiveInvite[], hostId: string): Promise<LiveInviteDto[]> {
  const handles = await resolveHandles(rows.map((r) => r.inviteeId));
  return rows.map((r) => rawInviteDto(r, hostId, handles.get(r.inviteeId)));
}

// ── shared law helpers ──

/**
 * The lazy expiry sweep: every pending row past its TTL flips to "expired".
 * Idempotent by construction — a swept sweep writes nothing.
 */
async function sweepExpiredInvites(roomId: string): Promise<void> {
  await db.liveInvite.updateMany({
    where: { roomId, status: "pending", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
}

/** Guests occupying stage slots: role "guest", state != "removed", on the session. */
async function occupiedGuestSlots(sessionId: string): Promise<number> {
  return db.liveParticipant.count({
    where: { sessionId, role: "guest", state: { not: "removed" } },
  });
}

function publishInvite(roomId: string, invite: LiveInviteDto): void {
  publishLiveEvent(roomId, {
    kind: "invite",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    invite,
  });
}

// ── invites ──

/**
 * Create one invite/request row. Gates in the frozen order: unauthenticated
 * → not-found → not-live → guests-disabled → banned → rate-limited →
 * validation (invitee/pending/stage-full) → durable insert → publish.
 */
export async function createInvite(
  roomId: string,
  sessionUser: WebFlixSessionUser,
  input: CreateLiveInviteInput,
): Promise<LiveInviteDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  if (!room.guestsEnabled) throw new LiveDomainError("forbidden", "guests-disabled");

  const actor = await liveActorFor(roomId, sessionUser);
  const sanctions = await activeSanctions(roomId, actor.id);
  if (sanctions.banned) throw new LiveDomainError("forbidden", "banned");

  if (!(await opsRateLimit(
        "inviteCreate",
        `wf:live:invites:${roomId}:${actor.id}`,
        RATE_LIMITS.inviteCreate,
      ))) {
    throw new LiveDomainError("rate-limited");
  }

  // The host posts WITH inviteeId (an invitation); a signed-in non-host
  // posts WITHOUT it (a self-request). A non-host naming a third user is
  // plain 403 — only the host invites others.
  const requested = typeof input.inviteeId === "string" ? input.inviteeId.trim() : "";
  if (requested && actor.role !== "host") throw new LiveDomainError("forbidden");
  const inviteeId = requested || actor.id;

  // Sweep-before-validate keeps the pending dedupe honest: an expired row
  // must never block a re-invite.
  await sweepExpiredInvites(roomId);

  // The invitee must be a real shadow identity and never the host (the host
  // is the stage by definition — this also answers a host "self-request").
  if (inviteeId === room.hostId) throw new LiveDomainError("conflict", "invalid-invitee");
  const invitee = await db.user.findUnique({ where: { id: inviteeId }, select: { id: true } });
  if (!invitee) throw new LiveDomainError("conflict", "invalid-invitee");

  const duplicate = await db.liveInvite.findFirst({
    where: { roomId, inviteeId, status: "pending" },
    select: { id: true },
  });
  if (duplicate) throw new LiveDomainError("conflict", "invite-pending");

  if (requested) {
    // Only host invitations consume a stage slot at creation; self-requests
    // queue and face the same cap at accept time.
    if ((await occupiedGuestSlots(session.id)) >= GUEST_SLOTS_MAX) {
      throw new LiveDomainError("conflict", "stage-full");
    }
  }

  const row = await db.liveInvite.create({
    data: {
      roomId,
      inviteeId,
      inviterId: actor.id,
      role: "guest",
      status: "pending",
      expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000),
    },
  });

  const dto = await inviteToDto(row, room.hostId);
  publishInvite(roomId, dto); // after the durable commit — never before
  return dto;
}

/**
 * The room's invite rows. Host caller: pending first (newest first), then
 * recently resolved rows, capped at 50 — the stage queue. Everyone else:
 * only their own rows (as invitee), newest first. Expired pendings sweep to
 * "expired" on read (lazy, idempotent).
 */
export async function listInvites(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<LiveInviteDto[]> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  await sweepExpiredInvites(roomId);

  const actor = await liveActorFor(roomId, sessionUser);
  let rows: LiveInvite[];
  if (actor.role === "host") {
    const pending = await db.liveInvite.findMany({
      where: { roomId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const recent =
      pending.length < 50
        ? await db.liveInvite.findMany({
            where: { roomId, status: { not: "pending" } },
            orderBy: { createdAt: "desc" },
            take: 50 - pending.length,
          })
        : [];
    rows = [...pending, ...recent];
  } else {
    rows = await db.liveInvite.findMany({
      where: { roomId, inviteeId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
  return invitesToDtos(rows, room.hostId);
}

/**
 * Accept or decline one invite. Gates: unauthenticated → not-found →
 * expiry sweep (invite-expired) → responder law (403) → invite-resolved →
 * rate-limited → validation. Accept additionally requires a live session
 * (not-live) and a free guest slot (stage-full), then flips the row AND
 * upserts the invitee's participant rung in one flow.
 */
export async function respondInvite(
  roomId: string,
  inviteId: string,
  sessionUser: WebFlixSessionUser,
  input: RespondLiveInviteInput,
): Promise<LiveInviteDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const found = await db.liveInvite.findFirst({ where: { id: inviteId, roomId } });
  if (!found) throw new LiveDomainError("not-found");

  // Expiry first: a pending row past its TTL sweeps to "expired" and every
  // later answer is the honest 409 invite-expired.
  let row = found;
  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    row = await db.liveInvite.update({ where: { id: row.id }, data: { status: "expired" } });
  }
  if (row.status === "expired") throw new LiveDomainError("conflict", "invite-expired");

  // Responder law: host-invite rows belong to the invitee; guest-request
  // rows to the host. Anyone else — including a requester waving through
  // their own request — is 403.
  const actor = await liveActorFor(roomId, sessionUser);
  const responderId = row.inviterId === room.hostId ? row.inviteeId : room.hostId;
  if (actor.id !== responderId) throw new LiveDomainError("forbidden");

  // TL ruling (the contracts law §2: bans block the invite surface): a
  // banned actor never answers an invite — accepting would grant publish
  // rights the ban exists to prevent. (The host can never be banned, so
  // this guards the invitee side in practice.)
  const responderSanctions = await activeSanctions(roomId, actor.id);
  if (responderSanctions.banned) throw new LiveDomainError("forbidden", "banned");

  if (row.status !== "pending") throw new LiveDomainError("conflict", "invite-resolved");

  if (
    !(await opsRateLimit(
        "inviteRespond",
        `wf:live:invite-respond:${roomId}:${actor.id}`,
        RATE_LIMITS.inviteRespond,
      ))
  ) {
    throw new LiveDomainError("rate-limited");
  }

  if (input.action !== "accept" && input.action !== "decline") {
    throw new LiveDomainError("invalid", "action must be accept or decline");
  }

  if (input.action === "decline") {
    row = await db.liveInvite.update({ where: { id: row.id }, data: { status: "declined" } });
    const dto = await inviteToDto(row, room.hostId);
    publishInvite(roomId, dto);
    return dto;
  }

  // accept — requires a live session and a free guest slot, then the status
  // flip and the participant rung upsert land together in one flow.
  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");
  if ((await occupiedGuestSlots(session.id)) >= GUEST_SLOTS_MAX) {
    throw new LiveDomainError("conflict", "stage-full");
  }
  row = await db.liveInvite.update({ where: { id: row.id }, data: { status: "accepted" } });
  await db.liveParticipant.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: row.inviteeId } },
    create: { sessionId: session.id, userId: row.inviteeId, role: "guest", state: "connected" },
    update: { role: "guest", state: "connected", lastSeenAt: new Date() },
  });

  const dto = await inviteToDto(row, room.hostId);
  publishInvite(roomId, dto);
  // The stage roster changed — fan out the fresh snapshot too.
  const stage = await stageFor(roomId, null);
  publishLiveEvent(roomId, {
    kind: "stage",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    stage,
  });
  return dto;
}

/**
 * Retract one pending row. Only the row's creator (inviterId) or the room
 * host; already-resolved rows are 409 invite-resolved.
 */
export async function cancelInvite(
  roomId: string,
  inviteId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LiveInviteDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const row = await db.liveInvite.findFirst({ where: { id: inviteId, roomId } });
  if (!row) throw new LiveDomainError("not-found");

  const actor = await liveActorFor(roomId, sessionUser);
  if (row.inviterId !== actor.id && actor.id !== room.hostId) {
    throw new LiveDomainError("forbidden");
  }
  if (row.status !== "pending") throw new LiveDomainError("conflict", "invite-resolved");

  const cancelled = await db.liveInvite.update({
    where: { id: row.id },
    data: { status: "cancelled" },
  });
  const dto = await inviteToDto(cancelled, room.hostId);
  publishInvite(roomId, dto);
  return dto;
}

// ── stage ──

/**
 * The stage roster (host + guests ONLY — viewers never appear). Public and
 * caller-independent: anonymous callers on public rooms get the full board,
 * and unlisted rooms still answer anyone holding the link (Phase 1
 * link-share semantics). No session yet → an honest empty stage.
 */
export async function stageFor(
  roomId: string,
  _sessionUser: WebFlixSessionUser | null,
): Promise<LiveStageDto> {
  // Signature symmetry only — the roster is identical for every caller.
  void _sessionUser;

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) {
    return {
      sessionId: "",
      guestsEnabled: room.guestsEnabled,
      guestsMax: GUEST_SLOTS_MAX,
      participants: [],
    };
  }

  const rows = await db.liveParticipant.findMany({
    where: { sessionId: session.id, role: { in: ["host", "guest"] } },
  });
  // Host first, then stage order = joined order. "removed" rows STAY on the
  // roster with their state — the honest audit of who was booted.
  rows.sort(
    (a, b) =>
      (a.role === "host" ? 0 : 1) - (b.role === "host" ? 0 : 1) ||
      a.joinedAt.getTime() - b.joinedAt.getTime(),
  );
  const handles = await resolveHandles(rows.map((r) => r.userId));
  const participants: LiveStageParticipantDto[] = rows.map((r) => ({
    userId: r.userId,
    handle: handles.get(r.userId)?.handle ?? "",
    name: handles.get(r.userId)?.name ?? "",
    role: r.role === "host" ? "host" : "guest",
    state: r.state as LiveParticipantState,
    joinedAt: r.joinedAt.toISOString(),
  }));
  // Phase 4 consent law: the stage carries the recording fact so EVERY
  // stage participant (and the viewer room) can render the REC indicator.
  // Absent/failed read renders false — the flag itself is stamped by the
  // replay routes and re-published through the stage envelope on change.
  let recording = false;
  try {
    const asset = await db.liveReplayAsset.findUnique({
      where: { sessionId: session.id },
      select: { status: true },
    });
    recording = asset?.status === "recording";
  } catch {
    recording = false;
  }
  return {
    sessionId: session.id,
    guestsEnabled: room.guestsEnabled,
    guestsMax: GUEST_SLOTS_MAX,
    participants,
    recording,
  };
}

/**
 * Host removes one guest: the participant row flips to state "removed" (the
 * row is kept — removal is a STATE, not a deletion), the provider boot is
 * best-effort (never fatal), and the fresh stage is re-published. Removing
 * the host identity is 403; anything that is not a current guest
 * participant is 404.
 */
export async function removeGuest(
  roomId: string,
  userId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LiveStageDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const actor = await liveActorFor(roomId, sessionUser);
  if (actor.role !== "host") throw new LiveDomainError("forbidden");

  if (userId === room.hostId) throw new LiveDomainError("forbidden", "cannot-remove-host");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("not-found", "guest-not-on-stage");

  const participant = await db.liveParticipant.findUnique({
    where: { sessionId_userId: { sessionId: session.id, userId } },
  });
  if (!participant || participant.role !== "guest") {
    throw new LiveDomainError("not-found", "guest-not-on-stage");
  }

  await db.liveParticipant.update({ where: { id: participant.id }, data: { state: "removed" } });

  // Best-effort provider boot: the app-level "removed" state stays the
  // authorization truth; a provider failure must never fail the removal.
  const s = await activeSessionFor(roomId);
  if (s) {
    try {
      await adapter().removeParticipant(s.providerRoomId, userId);
    } catch {
      /* never fatal */
    }
  }

  const stage = await stageFor(roomId, sessionUser);
  publishLiveEvent(roomId, {
    kind: "stage",
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    stage,
  });
  return stage;
}

/**
 * The TL integration seam (mintJoinToken guest rung): true iff an ACCEPTED
 * invite exists for this (room, user). Accepted invites never expire — any
 * expiry is irrelevant to the deed. One findFirst, no more.
 */
export async function acceptedGuestInvite(roomId: string, userId: string): Promise<boolean> {
  const row = await db.liveInvite.findFirst({
    where: { roomId, inviteeId: userId, status: "accepted" },
    select: { id: true },
  });
  return row !== null;
}
