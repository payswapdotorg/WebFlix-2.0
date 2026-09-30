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
] as const;

export type BrokerActionKind = (typeof ACTION_KINDS)[number];

/** Where the action applies. At least one id must be present (per kind). */
export interface BrokerTarget {
  videoId?: string;
  channelId?: string;
  commentId?: string;
  playlistId?: string;
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
