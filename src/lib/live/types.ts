/**
 * WFX2-LIVE-PLATFORM-1 — the frozen shared contracts (work order §6).
 *
 * Every WebFlix LIVE surface (API routes, viewer room, creator console)
 * speaks THESE types and nothing provider-specific. The allowed string
 * unions mirror the Prisma schema comments (the no-enum SQLite law). This
 * file is additive-frozen: widening a union is a reviewed contract change,
 * not a lane-local edit.
 */

/** LiveRoom.status — "idle" (created, not broadcasting) | "live" | "ended". */
export type LiveRoomStatus = "idle" | "live" | "ended";

/** LiveSession.status — the transport lifecycle under a room. */
export type LiveSessionStatus = "starting" | "live" | "reconnecting" | "ended";

/** LiveParticipant.role — guests are Phase 3; the contract freezes now. */
export type LiveParticipantRole = "host" | "guest" | "viewer";

/** LiveParticipant.state — connected viewers count toward (approximate) totals. */
export type LiveParticipantState = "connected" | "disconnected" | "removed";

/** LiveInvite.status — publisher invitations/requests (guests, Phase 3). */
export type LiveInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

/** The media provider behind a session. Phase 1 pins "livekit" (ADR-0005). */
export type LiveProvider = "livekit";

/** The requested publisher capability a token may carry. */
export type LiveTokenRole = "host" | "guest" | "viewer";

/** Room identity + policy + fresh state. Never carries provider secrets. */
export interface LiveRoomDto {
  id: string;
  hostId: string;
  hostHandle: string;
  hostName: string;
  title: string;
  status: LiveRoomStatus;
  visibility: "public" | "unlisted";
  createdAt: string;
  updatedAt: string;
  /** The one active/most-recent session, freshest first. */
  currentSession: LiveSessionDto | null;
  /** Approximate connected participants on the active session. */
  viewerCount: number;
  /** True when the requesting identity is this room's host (or null for guests). */
  isHost: boolean | null;
}

/** Broadcast lifecycle row. providerRoomId is a routing name, NOT a secret. */
export interface LiveSessionDto {
  id: string;
  roomId: string;
  provider: LiveProvider;
  providerRoomId: string;
  status: LiveSessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  endReason: "host" | "provider-webhook" | "timeout" | null;
}

/**
 * Provider-neutral playback/ingest plan (work order §6
 * LiveMediaEndpoint/LivePlaybackPlan). The token is short-lived and
 * room-scoped; the server mints it, the renderer holds it only in memory.
 */
export interface LivePlaybackPlan {
  provider: LiveProvider;
  /** The realtime server URL the browser connects to (public edge URL). */
  url: string;
  /** The provider room NAME (routing identity, not a secret). */
  roomName: string;
  token: string;
  identity: string;
  role: LiveTokenRole;
  /** Epoch seconds when the token dies. */
  expiresAt: number;
}

/** POST /api/live-rooms body. */
export interface CreateLiveRoomInput {
  title: string;
  visibility?: "public" | "unlisted";
}

/** POST /api/live-rooms/[id]/token body. */
export interface MintLiveTokenInput {
  role?: Exclude<LiveTokenRole, "host">;
}

/**
 * Provider-neutral webhook event. `eventId` is the idempotency key for
 * reconciliation (retry-safe: the same event may deliver more than once).
 */
export type LiveWebhookEventKind =
  | "room_started"
  | "room_finished"
  | "participant_joined"
  | "participant_left"
  | "unknown";

export interface LiveWebhookEvent {
  eventId: string;
  kind: LiveWebhookEventKind;
  provider: LiveProvider;
  /** The provider room NAME (routing identity). */
  roomName: string;
  /** The WebFlix identity for participant events, when present. */
  participantIdentity: string | null;
  at: string;
}

/** The honest error contract every LIVE route answers with. */
export type LiveApiError = {
  error:
    | "unauthenticated"
    | "not-found"
    | "forbidden"
    | "invalid"
    | "conflict"
    | "provider-not-configured"
    | "provider-failed"
    | "rate-limited";
  message?: string;
};
