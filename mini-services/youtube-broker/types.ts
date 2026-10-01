/**
 * WFX2-A-W Session Broker — shared types.
 */

export const ACTION_KINDS = [
  "like",
  "dislike",
  "remove-rating",
  "subscribe",
  "unsubscribe",
  "bell",
  "comment-create",
  "comment-reply",
  "comment-like",
  "playlist-add",
  "watch-later",
  "not-interested",
  // WFX2-B-B (personal surfaces) — additive
  "history-remove",
  "history-clear-all",
  "history-pause",
  "search-history-pause",
  "playlist-remove-item",
  "playlist-create",
  "playlist-delete",
  "notifications-mark-read",
  // WFX2-B-S (comment writes) — additive
  "comment-edit",
  "comment-delete",
  "comment-heart",
  "comment-pin",
  "comment-report",
  // WFX2-P2-SO (community posts) — additive
  "community-read",
  "post-like",
  "post-comment-create",
  "post-comment-like",
  "post-create",
  // WFX2-P3 (upload execution + live chat send) — additive; the executor
  // bodies live in kinds/upload.ts + kinds/livechat.ts (lane-owned modules)
  "upload-execute",
  "live-chat-send",
] as const;

export type BrokerActionKind = (typeof ACTION_KINDS)[number];

/** Where the action applies. At least one id must be present (per kind). */
export interface BrokerTarget {
  videoId?: string;
  channelId?: string;
  commentId?: string;
  playlistId?: string;
  /** WFX2-P2-SO: the community post the action applies to */
  postId?: string;
}

/**
 * Optional per-kind payload.
 *  - bell:                 pref: "all" | "personalized" | "none" (notification
 *                          level) — "off" is accepted and unsubscribes.
 *  - comment-create:       text (required), videoId (in target).
 *  - comment-reply:        text (required), commentId (in target),
 *                          commentText? — the parent comment's text, enables
 *                          the DOM-locator UI path (100% fidelity).
 *  - comment-like:         commentId (in target), commentText? same as above,
 *                          mode: "set" (default) | "toggle".
 *  - playlist-add:         playlistId (in target), title? (row label match).
 *  - watch-later:          mode: "toggle" (default) | "add" | "remove".
 *  - like/dislike/
 *    subscribe/unsubscribe: mode: "set" (default) | "toggle" | "on" | "off".
 *  - history-pause /
 *    search-history-pause:  paused: boolean — desired end state (default:
 *                          true = paused; false = resume).
 *  - playlist-remove-item: videoId (in target or payload), playlistId (in
 *                          target).
 *  - playlist-create:      title (required), visibility: "private" |
 *                          "unlisted" | "public" (default private).
 *  - notifications-mark-read: (no payload — opens the bell menu in the
 *                          logged-in tab and re-reads the unseen count).
 *  WFX2-B-S (comment writes — DOM path only; the read layer carries no
 *  edit tokens, so payload.commentText locates the comment in the
 *  logged-in tab's DOM):
 *  - comment-edit:         text (the NEW body), commentId (in target),
 *                          commentText? (the CURRENT body — the locator),
 *                          videoId (in target).
 *  - comment-delete:       commentId (in target), commentText? (locator),
 *                          videoId (in target).
 *  - comment-heart:        commentId (in target), commentText? (locator),
 *                          videoId (in target) — creator heart toggle.
 *  - comment-pin:          commentId (in target), commentText? (locator),
 *                          videoId (in target) — pin/unpin toggle.
 *  - comment-report:       commentId (in target), commentText? (locator),
 *                          videoId (in target), reason? (label substring
 *                          matched against YouTube's report-dialog rows;
 *                          default: the first row).
 *  WFX2-P2-SO (community posts) — additive:
 *  - community-read:       payload.handle (required — the @handle whose
 *                          community tab the browser reads); channelId (in
 *                          target) when the app knows it. A READ: the
 *                          executor navigates the logged-in tab to
 *                          youtube.com/@<handle>/community and returns the
 *                          page's own window.ytInitialData RAW in
 *                          detail.data (the app maps it — one mapper, two
 *                          transports).
 *  - post-like:            postId (in target), action: "like" |
 *                          "dislike" | "remove" (desired end state).
 *  - post-comment-create:  postId (in target), text (required).
 *  - post-comment-like:    postId + commentId (in target), commentText?
 *                          (the comment's text — the DOM locator), mode:
 *                          "set" (default) | "toggle" | "remove".
 *  - post-create:          payload.handle (required — the OWN channel's
 *                          community tab hosts the composer), channelId (in
 *                          target) when known; text (required unless an
 *                          image or poll carries the post), imageUrl?
 *                          (fetched into the real composer's file input),
 *                          pollOptions? (2–5 non-empty option texts).
 */
export interface BrokerPayload {
  text?: string;
  pref?: string;
  mode?: string;
  commentText?: string;
  title?: string;
  add?: boolean;
  videoId?: string;
  visibility?: string;
  paused?: boolean;
  reason?: string;
  /** WFX2-P2-SO */
  handle?: string;
  action?: string;
  imageUrl?: string;
  pollOptions?: string[];
  /** WFX2-P3-UP: upload-execute staged-drive fields */
  fileName?: string;
  /** WFX2-P3-LC: live-chat-send message text */
  message?: string;
}

export interface BrokerActionRequest {
  kind: BrokerActionKind;
  target: BrokerTarget;
  payload?: BrokerPayload;
}

/** "ui" = DOM click in the logged-in tab (preferred), "fetch" = page-context
 * InnerTube fetch fallback, "none" = neither path was available. */
export type ExecutionPath = "ui" | "fetch" | "none";

export interface BrokerActionResponse {
  ok: boolean;
  /** the effect was re-read from the DOM after acting (true only when seen) */
  verified?: boolean;
  /** action was a no-op because the desired state already held */
  already?: boolean;
  path?: ExecutionPath;
  detail?: Record<string, unknown>;
  error?: string;
  /** DOM state observed when verification failed (honest failure report) */
  dom?: Record<string, unknown>;
}

export interface HealthResponse {
  ok: boolean;
  tabFound: boolean;
  tabUrl: string | null;
  lastActionAt: string | null;
}

export interface JournalEntry {
  ts: string;
  kind: string;
  target: BrokerTarget;
  result: { ok: boolean; verified?: boolean; already?: boolean; path?: string; error?: string };
}
