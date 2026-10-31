/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — the shared LIVE permission + sanction core.
 *
 * Frozen by the TL before the Phase 2 lanes dispatched (work order §7: the
 * TL owns shared contracts). Every interaction route resolves its caller
 * through THIS file and nothing else:
 *   - liveActorFor(): the effective role for a room (host > moderator >
 *     guest > viewer > anonymous), resolved against the shadow-user seam.
 *   - activeSanctions(): mute/ban STATE derived from the append-only
 *     LiveModerationAction table (latest action wins) so state and the
 *     audit trail can never drift. Timed mutes expire by their expiresAt.
 *   - resolveHandles(): batched display-name resolution for read paths
 *     (interaction rows carry bare shadow ids — no FKs by design).
 *   - the numeric laws (caps + rate-limit windows) every lane shares.
 *
 * Server-authoritative law: clients may CLAIM nothing here. A moderator
 * is whoever has an un-revoked LiveRoomModerator row; a host is whoever
 * LiveRoom.hostId points at — checked per request, never from payloads.
 */
import { db } from "@/lib/db";
import type { LiveSession, LiveRoom } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { ensureShadowUser } from "@/lib/watch/local-comments";

/** Effective actor role for a room. "anonymous" = signed out. */
export type LiveActorRole = "host" | "moderator" | "guest" | "viewer" | "anonymous";

export interface LiveActor {
  id: string;
  handle: string;
  name: string;
  role: LiveActorRole;
}

/** Derived mute/ban state. mutedUntil is null when not muted. */
export interface LiveSanctions {
  banned: boolean;
  mutedUntil: Date | null;
}

// ── The shared numeric laws (every lane reads THESE, not local copies) ──
/** Heartbeat staleness window — viewer counts are approximate by law. */
export const PRESENCE_WINDOW_MS = 45_000;
/** Max chat body length (chars). */
export const CHAT_BODY_MAX = 280;
/** Max Q&A body length (chars). */
export const QUESTION_BODY_MAX = 280;
/** Server cap on taps inside ONE accepted reaction batch. */
export const REACTION_BATCH_MAX = 60;
/** Poll option bounds. */
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
/** Max title/description bounds for scheduled events. */
export const EVENT_TITLE_MAX = 140;
export const EVENT_DESCRIPTION_MAX = 1000;
/** Slow-mode ceiling (seconds between messages per sender). */
export const SLOW_MODE_MAX_SECONDS = 300;

// ── Phase 3 numeric laws (guests, matches, gifts — every lane reads THESE) ──
/** Stage cap: host + up to N remote guests (work order §4D suggests 4). */
export const GUEST_SLOTS_MAX = 4;
/** Pending invite/request TTL (seconds) — expiry is a wall-clock sweep. */
export const INVITE_TTL_SECONDS = 300;
/** Match duration bounds (seconds) + the default when unspecified. */
export const MATCH_DURATION_MIN = 30;
export const MATCH_DURATION_MAX = 600;
export const MATCH_DURATION_DEFAULT = 120;
/** Per-side roster cap for "team" matches ("solo" is exactly 1 per side). */
export const MATCH_TEAM_SIZE_MAX = 2;
/** Gift quantity clamp per send intent. */
export const GIFT_QTY_MAX = 10;
/** Catalogue price bound (dev credits) — catalogue is server-seeded anyway. */
export const GIFT_PRICE_MAX = 100;
/** Rolling per-sender gift spend cap (dev credits). This is the v1 abuse
 * bound; the balance/wallet ledger arrives only with the money gate. */
export const GIFT_SPEND_WINDOW_MS = 60_000;
export const GIFT_SPEND_WINDOW_MAX = 500;
/** Gift feed page cap. */
export const GIFT_FEED_MAX = 50;

// ── Phase 4 numeric laws (replays + analytics, §4H — every lane reads THESE) ──
/** The host-capture upload cap (the honest dev-sink bound; R2 arrives later). */
export const REPLAY_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** A recorder claiming a longer take is lying — the finalize guard. */
export const REPLAY_DURATION_MAX_MS = 4 * 60 * 60 * 1000;
/** The retention law: ready replays expire (lazy sweep on read) after this. */
export const REPLAY_RETENTION_DAYS = 30;
/** The discovery replay-shelf size. */
export const REPLAY_LIST_MAX = 12;
/** Accepted container types for the upload (checked against the header). */
export const REPLAY_MIME_TYPES = ["video/webm", "video/x-webm", "video/mp4"];

// ── Phase 4-OPS numeric laws (§4H operations telemetry, ADR-0009) ──
/** The kinds a CLIENT may beacon — the server kinds are never client-claimable. */
export const OPS_BEACON_KINDS = [
  "ttff",
  "reconnect",
  "join_error",
  "media_error",
  "chat_latency",
] as const;
/** Char clamps on the observation fields (frozen contracts §1). */
export const OPS_CODE_MAX = 80;
export const OPS_SURFACE_MAX = 60;
/** The serialized meta blob clamp — never identity-bearing keys. */
export const OPS_META_MAX = 512;
/** Any sampled duration clamps to one hour. */
export const OPS_VALUE_MS_MAX = 3_600_000;
/** Overview window clamp: 1h..30d, default 24h. */
export const OPS_WINDOW_MS_MIN = 3_600_000;
export const OPS_WINDOW_MS_MAX = 30 * 24 * 3_600_000;
export const OPS_WINDOW_MS_DEFAULT = 24 * 3_600_000;

/** The per-surface rate limits (the app-wide rateLimit() adapter). */
export const RATE_LIMITS = {
  chat: { limit: 8, windowMs: 10_000 },
  reactions: { limit: 12, windowMs: 10_000 },
  presence: { limit: 5, windowMs: 20_000 },
  reports: { limit: 5, windowMs: 10 * 60_000 },
  questions: { limit: 3, windowMs: 10 * 60_000 },
  pollCreate: { limit: 2, windowMs: 10 * 60_000 },
  pollVote: { limit: 30, windowMs: 60_000 },
  moderation: { limit: 60, windowMs: 60_000 },
  moderatorGrant: { limit: 10, windowMs: 60_000 },
  eventCreate: { limit: 4, windowMs: 10 * 60_000 },
  eventRegister: { limit: 20, windowMs: 60_000 },
  // ── Phase 3 ──
  gifts: { limit: 5, windowMs: 10_000 },
  inviteCreate: { limit: 6, windowMs: 60_000 },
  inviteRespond: { limit: 20, windowMs: 60_000 },
  matchStart: { limit: 3, windowMs: 60_000 },
  // ── Phase 4 ──
  replayStart: { limit: 5, windowMs: 5 * 60_000 },
  replayStop: { limit: 10, windowMs: 60_000 },
  replayVisibility: { limit: 20, windowMs: 60_000 },
  analytics: { limit: 60, windowMs: 60_000 },
  // ── Phase 4-OPS ──
  beacon: { limit: 30, windowMs: 60_000 },
  opsOverview: { limit: 30, windowMs: 60_000 },
} as const;

/** Host and granted moderators share the moderation capability set. */
export function canModerate(role: LiveActorRole): boolean {
  return role === "host" || role === "moderator";
}

/** Host-only capabilities (grants/revocations, kill-switch class actions). */
export function isHost(role: LiveActorRole): boolean {
  return role === "host";
}

/**
 * Resolve the caller's shadow identity + effective role for the room.
 * The shadow-user seam is the app-wide identity law (same as Phase 1's
 * resolveLiveIdentity) — role comparisons are always like-with-like.
 */
export async function liveActorFor(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<LiveActor> {
  if (!sessionUser) {
    return { id: "", handle: "", name: "", role: "anonymous" };
  }
  const identity = await ensureShadowUser(sessionUser);
  const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { hostId: true } });
  if (room && room.hostId === identity.id) {
    return { ...identity, role: "host" };
  }
  if (room) {
    const grant = await db.liveRoomModerator.findFirst({
      where: { roomId, userId: identity.id, revokedAt: null },
      select: { id: true },
    });
    if (grant) return { ...identity, role: "moderator" };
    const session = await db.liveSession.findFirst({
      where: { roomId, status: { not: "ended" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (session) {
      const participant = await db.liveParticipant.findUnique({
        where: { sessionId_userId: { sessionId: session.id, userId: identity.id } },
        select: { role: true },
      });
      if (participant?.role === "guest") return { ...identity, role: "guest" };
    }
  }
  return { ...identity, role: "viewer" };
}

/**
 * Derive the caller's mute/ban state from the append-only action ledger.
 * THE LAW (documented in the schema): the LATEST action per dimension wins.
 * Walk newest→oldest once; the first mute/unmute resolves the mute
 * dimension (an expired timed mute = not muted), the first ban/unban
 * resolves the ban dimension. Predictable, honest, and state can never
 * drift from the audit trail because state IS the trail.
 */
export async function activeSanctions(roomId: string, userId: string): Promise<LiveSanctions> {
  if (!userId) return { banned: false, mutedUntil: null };
  const actions = await db.liveModerationAction.findMany({
    where: { roomId, targetId: userId, action: { in: ["mute", "unmute", "ban", "unban"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { action: true, expiresAt: true },
  });
  const out: LiveSanctions = { banned: false, mutedUntil: null };
  let banResolved = false;
  let muteResolved = false;
  for (const a of actions) {
    if (!banResolved && (a.action === "ban" || a.action === "unban")) {
      out.banned = a.action === "ban";
      banResolved = true;
    } else if (!muteResolved && (a.action === "mute" || a.action === "unmute")) {
      if (a.action === "mute" && a.expiresAt && a.expiresAt.getTime() > Date.now()) {
        out.mutedUntil = a.expiresAt;
      }
      // an unmute, or a mute whose window already passed, resolves as
      // "not muted" — mutedUntil stays null either way
      muteResolved = true;
    }
    if (banResolved && muteResolved) break;
  }
  return out;
}

/**
 * The room's active (non-ended) session, or null. Every interaction write
 * requires an active session — chat/reactions/polls/questions are LIVE-room
 * state, not room-forever state.
 */
export async function activeSessionFor(roomId: string): Promise<LiveSession | null> {
  return db.liveSession.findFirst({
    where: { roomId, status: { not: "ended" } },
    orderBy: { createdAt: "desc" },
  });
}

/** Batched display resolution for read paths (no FKs on interaction rows). */
export async function resolveHandles(
  userIds: string[],
): Promise<Map<string, { handle: string; name: string }>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, handle: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, { handle: r.handle, name: r.name }]));
}

/** Narrow room shape the gates need (policy columns included). */
export type LiveRoomPolicy = Pick<
  LiveRoom,
  | "id"
  | "hostId"
  | "status"
  | "chatEnabled"
  | "reactionsEnabled"
  | "slowModeSeconds"
  | "guestsEnabled"
  | "giftsEnabled"
>;

export async function roomPolicyFor(roomId: string): Promise<LiveRoomPolicy | null> {
  return db.liveRoom.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      hostId: true,
      status: true,
      chatEnabled: true,
      reactionsEnabled: true,
      slowModeSeconds: true,
      guestsEnabled: true,
      giftsEnabled: true,
    },
  });
}
