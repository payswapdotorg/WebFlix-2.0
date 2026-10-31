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
  /**
   * Phase 2 (additive): the caller-scoped interaction policy — present on
   * the DETAIL endpoint (GET /api/live-rooms/[id]) for signed-in callers,
   * absent on discovery rows (per-room sanction queries don't belong in a
   * 24-room list).
   */
  policy?: LiveRoomPolicyDto;
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

// ═══════════════════════════════════════════════════════════════════
// WFX2-LIVE-PLATFORM-1 Phase 2 — interaction, safety, events (issue #2).
// Additive freeze (TL, 2026-10-31): everything below is additive to the
// Phase 1 contracts above. Same law — routes/UI speak THESE types only.
// ═══════════════════════════════════════════════════════════════════

/** LiveRoomMessage.kind — system/announcement rows are host/moderator-made. */
export type LiveChatKind = "chat" | "system" | "announcement";

/** Durable room chat message. `seq` is the strict ordering + replay cursor. */
export interface LiveChatMessageDto {
  id: string;
  seq: number;
  roomId: string;
  sessionId: string;
  senderId: string;
  senderHandle: string;
  senderName: string;
  kind: LiveChatKind;
  body: string;
  createdAt: string;
  /** Moderation tombstone: true renders "message removed", body is "". */
  deleted: boolean;
}

/** POST /api/live-rooms/[id]/chat body. clientMessageId = idempotency key. */
export interface SendLiveChatInput {
  body: string;
  clientMessageId: string;
  kind?: Exclude<LiveChatKind, "system">;
}

/** LiveReactionBatch.kind — Phase 2 v1 pins the heart rail. */
export type LiveReactionKind = "heart";

/** POST /api/live-rooms/[id]/reactions body (one client batching window). */
export interface SendLiveReactionBatchInput {
  clientBatchId: string;
  /** Taps coalesced in the window; server caps at REACTION_BATCH_MAX. */
  count: number;
  kind?: LiveReactionKind;
}

/** Server-computed cumulative total for a reaction kind on a session. */
export interface LiveReactionTotalDto {
  sessionId: string;
  kind: LiveReactionKind;
  total: number;
  lastBatchAt: string | null;
}

/** Presence heartbeat snapshot (viewer counts are approximate by law). */
export interface LivePresenceDto {
  sessionId: string;
  viewerCount: number;
}

/** Room policy as the client may see it — never provider state. */
export interface LiveRoomPolicyDto {
  chatEnabled: boolean;
  reactionsEnabled: boolean;
  slowModeSeconds: number;
  /** Phase 3 (additive): the guest-stage and gift gates. */
  guestsEnabled: boolean;
  giftsEnabled: boolean;
  /** The caller's effective role for this room. */
  actorRole: "host" | "moderator" | "guest" | "viewer" | "anonymous";
  /** Whether the CALLER may chat right now (policy + sanctions combined). */
  canChat: boolean;
  /** When canChat is false, the honest reason for THIS caller. */
  chatBlockedReason:
    | "chat-disabled"
    | "muted"
    | "banned"
    | "slow-mode"
    | null
    | "session-ended";
}

/** LiveModerationAction.action — the audited vocabulary. */
export type LiveModerationActionKind =
  | "delete-message"
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "slow-mode"
  | "chat-enable"
  | "chat-disable"
  /** Phase 3 (additive): the guest-stage and gift policy toggles. */
  | "guests-enable"
  | "guests-disable"
  | "gifts-enable"
  | "gifts-disable";

/** One audited moderation decision. Rows are immutable (append-only). */
export interface LiveModerationActionDto {
  id: string;
  roomId: string;
  actorId: string;
  actorHandle: string;
  targetId: string | null;
  targetHandle: string | null;
  action: LiveModerationActionKind;
  reason: string | null;
  messageId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** POST /api/live-rooms/[id]/moderation body. */
export interface PerformLiveModerationInput {
  action: LiveModerationActionKind;
  targetId?: string;
  messageId?: string;
  reason?: string;
  expiresInSeconds?: number;
  slowModeSeconds?: number;
}

/** LiveReport.reason — the report vocabulary. */
export type LiveReportReason = "spam" | "harassment" | "inappropriate" | "other";

export interface LiveReportDto {
  id: string;
  roomId: string;
  reporterId: string;
  reporterHandle: string;
  targetId: string | null;
  messageId: string | null;
  reason: LiveReportReason;
  detail: string | null;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
}

/** POST /api/live-rooms/[id]/reports body. */
export interface CreateLiveReportInput {
  reason: LiveReportReason;
  detail?: string;
  targetId?: string;
  messageId?: string;
}

/** Server-authoritative poll (counts computed by SUM over vote rows). */
export interface LivePollOptionDto {
  id: string;
  label: string;
  position: number;
  votes: number;
}

export interface LivePollDto {
  id: string;
  roomId: string;
  sessionId: string;
  question: string;
  status: "open" | "closed";
  createdById: string;
  options: LivePollOptionDto[];
  /** The caller's current vote option id, when any. */
  myVoteOptionId: string | null;
  createdAt: string;
  closedAt: string | null;
}

/** POST /api/live-rooms/[id]/polls body. */
export interface CreateLivePollInput {
  question: string;
  options: string[];
}

/** Q&A — viewers ask, host/moderators answer or hide. */
export interface LiveQuestionDto {
  id: string;
  roomId: string;
  askerId: string;
  askerHandle: string;
  body: string;
  answeredAt: string | null;
  hiddenAt: string | null;
  createdAt: string;
}

/** POST /api/live-rooms/[id]/questions body. */
export interface CreateLiveQuestionInput {
  body: string;
}

/** Scheduled WebFlix LIVE event (work order §4H). */
export interface LiveEventDto {
  id: string;
  creatorId: string;
  creatorHandle: string;
  creatorName: string;
  title: string;
  description: string | null;
  scheduledFor: string;
  status: "scheduled" | "canceled" | "completed";
  roomId: string | null;
  /** Row-derived registration count (never client-claimed). */
  registrationCount: number;
  /** Whether the CALLER is registered (null for anonymous). */
  registered: boolean | null;
  createdAt: string;
}

/** POST /api/live-events body. */
export interface CreateLiveEventInput {
  title: string;
  description?: string;
  scheduledFor: string;
}

/**
 * The realtime room stream envelope (GET /api/live-rooms/[id]/stream, SSE).
 * Every event carries eventId (dedupe key) + at. Delivery is at-least-once:
 * clients dedupe by eventId; chat additionally replays by seq cursor.
 */
export type LiveStreamEventKind =
  | "chat"
  | "reaction"
  | "presence"
  | "room"
  | "poll"
  | "question"
  | "moderation"
  /** Phase 3 (additive): invites, stage roster, matches, gifts. */
  | "invite"
  | "stage"
  | "match"
  | "gift";

export type LiveStreamEvent =
  | { kind: "chat"; eventId: string; at: string; message: LiveChatMessageDto }
  | { kind: "reaction"; eventId: string; at: string; total: LiveReactionTotalDto }
  | { kind: "presence"; eventId: string; at: string; presence: LivePresenceDto }
  | { kind: "room"; eventId: string; at: string; room: LiveRoomDto }
  | { kind: "poll"; eventId: string; at: string; poll: LivePollDto }
  | { kind: "question"; eventId: string; at: string; question: LiveQuestionDto }
  | {
      kind: "moderation";
      eventId: string;
      at: string;
      action: LiveModerationActionDto;
    }
  | { kind: "invite"; eventId: string; at: string; invite: LiveInviteDto }
  | { kind: "stage"; eventId: string; at: string; stage: LiveStageDto }
  | { kind: "match"; eventId: string; at: string; match: LiveMatchDto }
  | { kind: "gift"; eventId: string; at: string; gift: GiftEventDto };

/** GET /api/live-rooms/[id]/stream query params (the resume contract). */
export interface LiveStreamParams {
  /** Replay chat strictly after this seq (client resumes with its max). */
  chatCursor?: number;
  /** Include the initial chat backfill (default true). */
  backfill?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// WFX2-LIVE-PLATFORM-1 Phase 3 — guests, matches, non-monetary gifts
// (issue #2). Additive freeze (TL, 2026-11-04): everything below is
// additive to the Phase 1/2 contracts. Same law — routes/UI speak THESE
// types only; widening a union is a reviewed contract change.
// ═══════════════════════════════════════════════════════════════════

/** One host↔guest invitation/request row as the client may see it. */
export interface LiveInviteDto {
  id: string;
  roomId: string;
  inviteeId: string;
  inviteeHandle: string;
  inviteeName: string;
  /** Who created the row: the host (an invitation) or the invitee (a request). */
  inviterId: string;
  direction: "host-invite" | "guest-request";
  role: "guest";
  status: LiveInviteStatus;
  expiresAt: string;
  createdAt: string;
}

/**
 * POST /api/live-rooms/[id]/invites body. Host posts with `inviteeId`
 * (invitation); a signed-in viewer posts WITHOUT it (self-request).
 */
export interface CreateLiveInviteInput {
  inviteeId?: string;
}

/** POST /api/live-rooms/[id]/invites/[inviteId]/respond body. */
export interface RespondLiveInviteInput {
  action: "accept" | "decline";
}

/** One stage roster entry (host + guests ONLY — viewers never appear). */
export interface LiveStageParticipantDto {
  userId: string;
  handle: string;
  name: string;
  role: "host" | "guest";
  state: LiveParticipantState;
  joinedAt: string;
}

/** The stage layout contract (work order §4D) — roster-driven layout. */
export interface LiveStageDto {
  sessionId: string;
  guestsEnabled: boolean;
  /** The frozen stage cap: host + GUEST_SLOTS_MAX remote guests. */
  guestsMax: number;
  participants: LiveStageParticipantDto[];
}

export type LiveMatchKind = "solo" | "team";

export type LiveMatchStatus = "active" | "ended" | "cancelled";

export interface LiveMatchMemberDto {
  userId: string;
  handle: string;
  name: string;
  /** Set when the member left mid-match; banked scores stand. */
  leftAt: string | null;
}

/** Server-computed team standings (SUM over the append-only ScoreEvent). */
export interface LiveMatchTeamDto {
  id: string;
  label: string;
  position: number;
  members: LiveMatchMemberDto[];
  score: number;
}

/** The authoritative match snapshot. `serverNow` anchors countdowns. */
export interface LiveMatchDto {
  id: string;
  roomId: string;
  sessionId: string;
  kind: LiveMatchKind;
  status: LiveMatchStatus;
  durationSeconds: number;
  scoring: { reactions: boolean; gifts: boolean };
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  endReason: "host" | "timeout" | null;
  winnerTeamId: string | null;
  teams: LiveMatchTeamDto[];
  serverNow: string;
}

/** POST /api/live-rooms/[id]/matches body (host-only). */
export interface StartLiveMatchInput {
  kind: LiveMatchKind;
  /** Rosters of ACTIVE stage participant user ids; server-validated. */
  teamA: string[];
  teamB: string[];
  durationSeconds?: number;
  scoring?: { reactions?: boolean; gifts?: boolean };
}

/** One append-only scoring row as the client may render it. */
export interface LiveScoreEventDto {
  id: string;
  matchId: string;
  teamId: string;
  actorId: string;
  source: "reaction" | "gift";
  amount: number;
  createdAt: string;
}

/** The gift catalogue row (v1: NON-MONETARY dev gifts — zero cash value). */
export interface GiftCatalogItemDto {
  id: string;
  name: string;
  animationKind: "burst" | "float" | "sparkle" | "wave";
  priceCredits: number;
}

/** POST /api/live-rooms/[id]/gifts body. clientRequestId = idempotency key. */
export interface SendGiftInput {
  giftItemId: string;
  quantity: number;
  clientRequestId: string;
  /** When an ACTIVE match with gift scoring exists: the side to support. */
  matchTeamId?: string;
}

/** The durable gift event as the room feed renders it. */
export interface GiftEventDto {
  id: string;
  intentId: string;
  roomId: string;
  sessionId: string;
  senderId: string;
  senderHandle: string;
  senderName: string;
  recipientId: string;
  giftItemId: string;
  giftName: string;
  animationKind: string;
  quantity: number;
  /** Server-computed quantity × catalogue price (dev credits). */
  totalCredits: number;
  matchId: string | null;
  matchTeamId: string | null;
  createdAt: string;
}
