/**
 * WFX2-A-W action proxy — maps the UI's action request/response shapes onto
 * the live Tier-2 write paths (broker + direct SAPISIDHASH) while keeping
 * the response contracts the WebFlix UI already consumes.
 *
 * Order of execution (architecture doc): direct-first for endpoints known
 * direct (subscribe/unsubscribe — verification log §16/§17), broker for
 * everything else (the `_u` attestation tier — §18/§19).
 */
import { ApiError } from "./api";
import type { CommentAuthorDto, CommentDto, CommentVideoSnapshotDto, LikeValue } from "./types";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import {
  BROKER_OFFLINE_MESSAGE,
  BrokerError,
  brokerAction,
  type BrokerActionSuccess,
} from "@/lib/broker";
import {
  createComment,
  createReply,
  subscribeChannel,
  getSubscribedState,
  directAuthConfigured,
} from "@/lib/youtube-direct";
import { writeLocalComment } from "./local-comments";

export { BROKER_OFFLINE_MESSAGE };

const OFFLINE = () => new ApiError(502, BROKER_OFFLINE_MESSAGE);

/** Map a broker failure to an honest ApiError for the routes. */
function fail(err: BrokerError): ApiError {
  if (err.kind === "offline") return OFFLINE();
  if (err.kind === "bad-request") return new ApiError(400, err.message);
  // unauthorized / action-failed: surface honestly as 502 with detail
  return new ApiError(502, err.message);
}

function ok(result: BrokerActionSuccess | BrokerError): result is BrokerActionSuccess {
  return !(result instanceof BrokerError);
}

/** Parse a compact count label ("2.4M" / "1,234") into a number. */
export function parseCompactCount(label: string | undefined | null): number | null {
  if (!label) return null;
  const m = label.replace(/,/g, "").match(/([\d.]+)\s*(K|M|B)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

export interface LikeRequest {
  /** legacy UI shape: "like"|"dislike" (toggle semantics — same value unsets) */
  value?: LikeValue;
  /** canonical shape: "like"|"dislike"|"none" (set semantics) */
  action?: "like" | "dislike" | "none";
  /** the UI's current counts (keeps the displayed numbers honest) */
  baseline?: { likes?: number; dislikes?: number; yourLike?: LikeValue | null };
}

export interface LikeResult {
  ok: true;
  effect: string;
  likes: number;
  dislikes: number;
  yourLike: LikeValue | null;
  already?: boolean;
  path?: string;
}

/**
 * Video like/dislike — broker tier (like is `_u`-attested, §18).
 * - action: like|dislike|none → set semantics (idempotent)
 * - value: like|dislike → YouTube toggle semantics (same value unsets)
 */
export async function proxyVideoLike(videoId: string, req: LikeRequest): Promise<LikeResult> {
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  const base = {
    likes: Math.max(0, req.baseline?.likes ?? 0),
    dislikes: Math.max(0, req.baseline?.dislikes ?? 0),
    yourLike: req.baseline?.yourLike ?? null,
  };

  if (action === "none") {
    const r = await brokerAction("remove-rating", { videoId });
    if (!ok(r)) throw fail(r);
    return {
      ok: true,
      effect: "rating-removed",
      likes: base.likes,
      dislikes: base.dislikes,
      yourLike: null,
      already: r.already,
      path: r.path,
    };
  }

  // set (and detect the toggle-off case via the broker's pre-click state check)
  const r = await brokerAction(action, { videoId });
  if (!ok(r)) throw fail(r);
  const domLikes = parseCompactCount(r.detail?.["likesLabel"] as string | undefined);
  const baseYour = base.yourLike;
  let yourLike: LikeValue | null = action;
  let effect = action === "like" ? "liked" : "disliked";
  let already = r.already;
  if (r.already && req.value && !req.action) {
    // legacy toggle semantics: same value again → remove the rating
    const r2 = await brokerAction("remove-rating", { videoId });
    if (!ok(r2)) throw fail(r2);
    yourLike = null;
    effect = "rating-removed";
    already = false;
  }
  // honest count deltas from (baseYour → yourLike); DOM-observed count wins
  const likes =
    domLikes ??
    (yourLike === "like" && baseYour !== "like"
      ? base.likes + 1
      : yourLike !== "like" && baseYour === "like"
        ? Math.max(0, base.likes - 1)
        : base.likes);
  const dislikes =
    yourLike === "dislike" && baseYour !== "dislike"
      ? base.dislikes + 1
      : yourLike !== "dislike" && baseYour === "dislike"
        ? Math.max(0, base.dislikes - 1)
        : base.dislikes;
  return { ok: true, effect, likes, dislikes, yourLike, already, path: r.path };
}

export interface SubscribeResult {
  ok: true;
  effect: string;
  subscribed: boolean;
  path: string;
  bell?: "all" | "personalized" | "none" | null;
}

/**
 * Subscribe/unsubscribe — direct-first (verified §16/§17), broker fallback.
 * `on === null` → toggle (state read, then direct; broker toggle fallback).
 */
export async function proxySubscribe(
  channelId: string,
  on: boolean | null
): Promise<SubscribeResult> {
  const doDirect = async (want: boolean): Promise<SubscribeResult | null> => {
    if (!directAuthConfigured()) return null;
    const r = await subscribeChannel(channelId, want);
    return r.ok
      ? { ok: true, effect: want ? "subscribed" : "unsubscribed", subscribed: want, path: "direct" }
      : null;
  };

  if (on === true || on === false) {
    const direct = await doDirect(on);
    if (direct) return direct;
    const r = await brokerAction(on ? "subscribe" : "unsubscribe", { channelId });
    if (!ok(r)) throw fail(r);
    return {
      ok: true,
      effect: on ? "subscribed" : "unsubscribed",
      subscribed: on,
      path: "broker",
      already: r.already,
    } as SubscribeResult;
  }

  // toggle: need the current state
  const current = await getSubscribedState(channelId);
  if (current !== null) {
    const direct = await doDirect(!current);
    if (direct) return direct;
  }
  const r = await brokerAction("subscribe", { channelId }, { mode: "toggle" });
  if (!ok(r)) throw fail(r);
  const subscribed = typeof r.detail?.["subscribed"] === "boolean" ? r.detail.subscribed : true;
  return {
    ok: true,
    effect: subscribed ? "subscribed" : "unsubscribed",
    subscribed,
    path: "broker",
  };
}

/** Bell preference — broker tier (UI state machine: off = unsubscribe). */
export async function proxyBell(
  channelId: string,
  pref: "all" | "personalized" | "none" | "off"
): Promise<{ ok: true; effect: string; bell: "all" | "personalized" | "none" | null }> {
  if (pref === "off") {
    const r = await proxySubscribe(channelId, false);
    return { ok: true, effect: r.effect, bell: null };
  }
  const r = await brokerAction("bell", { channelId }, { pref });
  if (!ok(r)) throw fail(r);
  return { ok: true, effect: `bell-${pref}`, bell: pref };
}

/**
 * The watch page subscribe state machine (POST /api/subscriptions):
 * bell off → unsubscribe; all|personalized|none → subscribe + bell pref.
 * Keeps the SubscriptionResultDto shape; subscriberCount is the caller's
 * baseline ± 1 (or -1 when unknown — the UI then leaves the count alone).
 */
export async function proxySubscriptionStateMachine(
  channelId: string,
  bell: "all" | "personalized" | "none" | "off" | undefined,
  subscriberCountBaseline: number | null
): Promise<{
  subscribed: boolean;
  bell: "all" | "personalized" | "none" | null;
  subscriberCount: number;
  ok: true;
  effect: string;
  path: string;
}> {
  if (!bell || bell === "off") {
    const r = await proxySubscribe(channelId, false);
    return {
      subscribed: false,
      bell: null,
      subscriberCount:
        subscriberCountBaseline === null ? -1 : Math.max(0, subscriberCountBaseline - 1),
      ok: true,
      effect: r.effect,
      path: r.path,
    };
  }
  const sub = await proxySubscribe(channelId, true);
  let effect = sub.effect;
  let path = sub.path;
  // apply the bell pref (broker tier). A failed bell update does not undo
  // the subscription — the effect string says what happened, honestly.
  try {
    const b = await proxyBell(channelId, bell);
    effect = `${sub.effect}; ${b.effect}`;
    path = `${sub.path}+broker-bell`;
  } catch (e) {
    if (e instanceof ApiError && e.status === 502) {
      effect = `${sub.effect}; bell-update-failed (broker offline)`;
    } else {
      throw e;
    }
  }
  return {
    subscribed: true,
    bell,
    subscriberCount:
      subscriberCountBaseline === null ? -1 : Math.max(0, subscriberCountBaseline + 1),
    ok: true,
    effect,
    path,
  };
}

export interface CommentViewer {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}

/** The synthesized comment DTO the composer UI expects from a write tier. */
export type CommentWriteResult = CommentDto & {
  ok: true;
  effect: string;
  path?: string;
  /** WFX2-P6-CR: true → the row lives in the honest WebFlix store */
  local?: boolean;
};

/**
 * WFX2-P6-CR — the write-tier extras the routes pass through:
 *  - replyParams: the parent comment's live replyParams (direct reply rung);
 *  - sessionUser: the WebFlix account — the local rung's author bridge
 *    (absent → the local rung is skipped: no identity, no honest local write);
 *  - video: the watch payload's video snapshot (the local rung's shadow rows).
 */
export interface CommentWriteOpts {
  replyParams?: string;
  sessionUser?: WebFlixSessionUser | null;
  video?: CommentVideoSnapshotDto;
}

/** Synthesize the CommentDto the composer UI expects from a broker/direct post. */
function synthComment(
  videoId: string,
  text: string,
  viewer: CommentViewer,
  parentId: string | null,
  /** the execution path honestly reported by the tier (ui | fetch | none | direct) */
  path: "ui" | "fetch" | "none" | "direct" = "ui"
): CommentWriteResult {
  const author: CommentAuthorDto = {
    id: viewer.id,
    handle: viewer.handle,
    name: viewer.name,
    avatarUrl: viewer.avatarUrl,
    isMember: false,
    isCreator: false,
  };
  return {
    id: `yt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    body: text,
    likes: 0,
    heartedByCreator: false,
    pinned: false,
    edited: false,
    moderation: "approved",
    createdAt: new Date().toISOString(),
    author,
    yourLike: null,
    isOwn: true,
    replyCount: 0,
    totalReplyCount: 0,
    ok: true,
    effect: parentId ? "comment-replied" : "comment-created",
    path,
  };
}

/**
 * The honest LOCAL rung — the third tier, reached only when BOTH YouTube
 * tiers failed (offline/refused, never after a success). Persists in the
 * WebFlix store with full origin disclosure (local:true + path "local");
 * a store failure maps to an honest 502 (nothing was written anywhere).
 */
async function localRung(args: {
  videoId: string;
  text: string;
  parentId?: string;
  parentText?: string;
  opts: CommentWriteOpts;
}): Promise<CommentWriteResult> {
  if (!args.opts.sessionUser) throw failOffline();
  try {
    return await writeLocalComment({
      videoId: args.videoId,
      text: args.text,
      ...(args.parentId ? { parentId: args.parentId } : {}),
      ...(args.parentText ? { parentText: args.parentText } : {}),
      sessionUser: args.opts.sessionUser,
      ...(args.opts.video ? { videoSnapshot: args.opts.video } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError) throw e; // honest validation (e.g. wrong-video parent)
    throw new ApiError(
      502,
      "action backend offline and the WebFlix store is unreachable — comment not posted"
    );
  }
}

/** The offline ApiError both YouTube tiers failed into. */
function failOffline(): ApiError {
  return new ApiError(502, BROKER_OFFLINE_MESSAGE);
}

/**
 * Create a comment — the three-rung chain (WFX2-P6-CR):
 *   1. direct (InnerTube create_comment + SAPISIDHASH — the subscribe-lane
 *      pattern),
 *   2. broker (the DOM UI path),
 *   3. LOCAL (the honest WebFlix store, local:true — only after BOTH
 *      YouTube tiers failed; never claims a YouTube write).
 */
export async function proxyCommentCreate(
  videoId: string,
  text: string,
  viewer: CommentViewer,
  opts: CommentWriteOpts = {}
): Promise<CommentWriteResult> {
  if (directAuthConfigured()) {
    const direct = await createComment(videoId, text);
    if (direct.ok) {
      return synthComment(videoId, text, viewer, null, "direct");
    }
  }
  const r = await brokerAction("comment-create", { videoId }, { text });
  if (ok(r)) return synthComment(videoId, text, viewer, null, r.path ?? "ui");
  // both YouTube tiers refused → the honest local rung
  if (opts.sessionUser) return localRung({ videoId, text, opts });
  throw fail(r);
}

/**
 * Reply to a comment — the three-rung chain (WFX2-P6-CR):
 *   1. direct when the parent's live replyParams exists + the session is
 *      configured (create_comment with createCommentParams — the YouTube.js
 *      reply recipe); honest skip when replyParams is null (YouTube served
 *      the sign-in modal — the session expired),
 *   2. broker (comment-reply; the UI path needs the parent text),
 *   3. LOCAL (the honest WebFlix store — the shadow parent anchors the
 *      YouTube thread; local:true disclosure).
 */
export async function proxyCommentReply(
  videoId: string,
  parentId: string,
  text: string,
  viewer: CommentViewer,
  parentText?: string,
  opts: CommentWriteOpts = {}
): Promise<CommentWriteResult> {
  if (opts.replyParams && directAuthConfigured()) {
    const direct = await createReply(videoId, opts.replyParams, text);
    if (direct.ok) {
      return synthComment(videoId, text, viewer, parentId, "direct");
    }
  }
  const r = await brokerAction(
    "comment-reply",
    { commentId: parentId, videoId },
    { text, ...(parentText ? { commentText: parentText } : {}) }
  );
  if (ok(r)) return synthComment(videoId, text, viewer, parentId, r.path ?? "ui");
  // both YouTube tiers refused → the honest local rung
  if (opts.sessionUser) {
    return localRung({ videoId, text, parentId, parentText, opts });
  }
  throw fail(r);
}

export interface CommentLikeRequest {
  value?: LikeValue;
  action?: "like" | "dislike" | "none";
  baseline?: { likes?: number; yourLike?: LikeValue | null };
  commentText?: string;
  videoId?: string;
}

export interface CommentLikeResult {
  ok: true;
  effect: string;
  likes: number;
  yourLike: LikeValue | null;
}

/**
 * Comment like (broker comment-like). Toggle semantics for the legacy value
 * shape (a comment has a single like control — click toggles, like YouTube).
 */
export async function proxyCommentLike(
  commentId: string,
  req: CommentLikeRequest
): Promise<CommentLikeResult> {
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  const baseLikes = Math.max(0, req.baseline?.likes ?? 0);
  const prior = req.baseline?.yourLike ?? null;

  // single like control (like YouTube's comment like button):
  // like (explicit) → set; like (legacy value) → toggle; dislike/none → remove
  const mode =
    action === "none" || action === "dislike"
      ? "remove"
      : req.value && !req.action
        ? "toggle"
        : "set";
  const r = await brokerAction(
    "comment-like",
    { commentId, ...(req.videoId ? { videoId: req.videoId } : {}) },
    { mode, ...(req.commentText ? { commentText: req.commentText } : {}) }
  );
  if (!ok(r)) throw fail(r);
  const liked =
    typeof r.detail?.["liked"] === "boolean"
      ? r.detail.liked
      : mode === "remove"
        ? false
        : mode === "set"
          ? true
          : prior !== "like";
  const likes =
    liked && prior !== "like"
      ? baseLikes + 1
      : !liked && prior === "like"
        ? Math.max(0, baseLikes - 1)
        : baseLikes;
  return {
    ok: true,
    effect: liked ? "comment-liked" : "comment-like-removed",
    likes,
    yourLike: liked ? "like" : null,
  };
}

export interface PlaylistAddResult {
  ok: true;
  effect: string;
  added: boolean;
  containsVideo: boolean;
  already?: boolean;
  path?: string;
}

/**
 * Add/toggle a video in a playlist (broker playlist-add). `title` enables
 * the Save-dialog row match for the UI path; real YouTube playlist ids
 * (PL…/VL…/WL) also work through the fetch fallback.
 */
export async function proxyPlaylistAdd(
  playlistId: string,
  videoId: string,
  opts: { mode?: "add" | "remove" | "toggle"; title?: string } = {}
): Promise<PlaylistAddResult> {
  const mode = opts.mode ?? "add";
  const r = await brokerAction(
    "playlist-add",
    { playlistId },
    { videoId, mode, ...(opts.title ? { title: opts.title } : {}) }
  );
  if (!ok(r)) throw fail(r);
  const added = typeof r.detail?.["added"] === "boolean" ? r.detail.added : mode !== "remove";
  return {
    ok: true,
    effect: added ? "playlist-added" : "playlist-removed",
    added,
    containsVideo: added,
    already: r.already,
    path: r.path,
  };
}

export interface WatchLaterResult {
  ok: true;
  effect: string;
  added: boolean;
  playlistId: string;
  already?: boolean;
  path?: string;
}

/** Watch later (YouTube's own WL playlist via the broker). */
export async function proxyWatchLater(
  videoId: string,
  add: boolean | undefined
): Promise<WatchLaterResult> {
  const mode = add === undefined ? "toggle" : add ? "add" : "remove";
  const r = await brokerAction("watch-later", { videoId }, { mode });
  if (!ok(r)) throw fail(r);
  const added = typeof r.detail?.["added"] === "boolean" ? r.detail.added : add !== false;
  return {
    ok: true,
    effect: added ? "watch-later-added" : "watch-later-removed",
    added,
    playlistId: "WL",
    already: r.already,
    path: r.path,
  };
}

export interface NotInterestedResult {
  ok: true;
  effect: string;
  notInterested: true;
  hidden: true;
  path?: string;
  note?: string;
}

/** Not interested (broker — a real home-feed action on youtube.com). */
export async function proxyNotInterested(videoId: string): Promise<NotInterestedResult> {
  const r = await brokerAction("not-interested", { videoId });
  if (!ok(r)) throw fail(r);
  const note = typeof r.detail?.["note"] === "string" ? r.detail.note : undefined;
  return {
    ok: true,
    effect: "not-interested",
    notInterested: true,
    hidden: true,
    path: r.path,
    ...(note ? { note } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* WFX2-B-S comment writes (broker ⋮-menu DOM paths)                   */
/* ------------------------------------------------------------------ */

/** The comment's identity the broker needs to locate it in the DOM. */
export interface CommentLocator {
  videoId: string;
  /** the comment's CURRENT text — the DOM locator for the ⋮ menu path */
  commentText?: string;
}

export interface CommentEditResult {
  ok: true;
  effect: string;
  body: string;
  edited: true;
  path?: string;
}

/** Edit own comment — broker comment-edit (⋮ → Edit → inline editor). */
export async function proxyCommentEdit(
  commentId: string,
  text: string,
  locator: CommentLocator
): Promise<CommentEditResult> {
  const r = await brokerAction(
    "comment-edit",
    { commentId, videoId: locator.videoId },
    { text, ...(locator.commentText ? { commentText: locator.commentText } : {}) }
  );
  if (!ok(r)) throw fail(r);
  return { ok: true, effect: "comment-edited", body: text, edited: true, path: r.path };
}

export interface CommentDeleteResult {
  ok: true;
  effect: string;
  deleted: true;
  path?: string;
}

/** Delete own comment — broker comment-delete (⋮ → Delete → confirm). */
export async function proxyCommentDelete(
  commentId: string,
  locator: CommentLocator
): Promise<CommentDeleteResult> {
  const r = await brokerAction(
    "comment-delete",
    { commentId, videoId: locator.videoId },
    locator.commentText ? { commentText: locator.commentText } : {}
  );
  if (!ok(r)) throw fail(r);
  return { ok: true, effect: "comment-deleted", deleted: true, path: r.path };
}

export interface CommentHeartResult {
  ok: true;
  effect: string;
  heartedByCreator: boolean;
  path?: string;
}

/** Creator heart toggle — broker comment-heart (⋮ → Heart / Remove heart). */
export async function proxyCommentHeart(
  commentId: string,
  locator: CommentLocator
): Promise<CommentHeartResult> {
  const r = await brokerAction(
    "comment-heart",
    { commentId, videoId: locator.videoId },
    locator.commentText ? { commentText: locator.commentText } : {}
  );
  if (!ok(r)) throw fail(r);
  const hearted =
    typeof r.detail?.["hearted"] === "boolean" ? r.detail.hearted : true;
  return {
    ok: true,
    effect: hearted ? "comment-hearted" : "comment-heart-removed",
    heartedByCreator: hearted,
    path: r.path,
  };
}

export interface CommentPinResult {
  ok: true;
  effect: string;
  pinned: boolean;
  path?: string;
}

/** Creator pin toggle — broker comment-pin (⋮ → Pin / Unpin). */
export async function proxyCommentPin(
  commentId: string,
  locator: CommentLocator
): Promise<CommentPinResult> {
  const r = await brokerAction(
    "comment-pin",
    { commentId, videoId: locator.videoId },
    locator.commentText ? { commentText: locator.commentText } : {}
  );
  if (!ok(r)) throw fail(r);
  const pinned = typeof r.detail?.["pinned"] === "boolean" ? r.detail.pinned : true;
  return {
    ok: true,
    effect: pinned ? "comment-pinned" : "comment-unpinned",
    pinned,
    path: r.path,
  };
}

export interface CommentReportResult {
  ok: true;
  effect: string;
  reported: true;
  reason?: string;
  path?: string;
}

/** Report a comment — broker comment-report (⋮ → Report → reasons dialog). */
export async function proxyCommentReport(
  commentId: string,
  locator: CommentLocator & { reason?: string }
): Promise<CommentReportResult> {
  const r = await brokerAction(
    "comment-report",
    { commentId, videoId: locator.videoId },
    {
      ...(locator.commentText ? { commentText: locator.commentText } : {}),
      ...(locator.reason ? { reason: locator.reason } : {}),
    }
  );
  if (!ok(r)) throw fail(r);
  const reason = typeof r.detail?.["reason"] === "string" ? r.detail.reason : undefined;
  return {
    ok: true,
    effect: "comment-reported",
    reported: true,
    ...(reason ? { reason } : {}),
    path: r.path,
  };
}

/* ------------------------------------------------------------------ */
/* WFX2-P4-PE — playlist edit (broker playlist-update + playlist-reorder) */
/* ------------------------------------------------------------------ */

export interface PlaylistUpdateRequest {
  /** the new title (omitted = leave unchanged) */
  title?: string;
  /** the new description (omitted = leave unchanged) */
  description?: string;
  /** "public" | "unlisted" | "private" (omitted = leave unchanged) */
  visibility?: "public" | "unlisted" | "private";
}

export interface PlaylistUpdateResult {
  ok: true;
  effect: string;
  /** the field map the broker drive filled (only the present ones) */
  fields: { title: boolean; description: boolean; visibility: boolean };
  verified: boolean;
  /** the dialog closed but the header did not re-render the new title */
  unverifiedNote?: string;
  /** already:true when the payload carried no fields (no-op) */
  already?: boolean;
  path?: string;
}

/**
 * Update a playlist's title/description/visibility — broker playlist-update
 * (the playlist's own edit dialog: ⋮ → Edit → fill → Save; verified when
 * the header re-renders the new title). Honest verified:false when the
 * dialog closed but the header did not re-render within the deadline.
 */
export async function proxyPlaylistUpdate(
  playlistId: string,
  req: PlaylistUpdateRequest
): Promise<PlaylistUpdateResult> {
  const payload: Record<string, string> = {};
  if (typeof req.title === "string") payload.title = req.title;
  if (typeof req.description === "string") payload.description = req.description;
  if (typeof req.visibility === "string") payload.visibility = req.visibility;
  // The lane's kind module accepts "playlist-update" + "playlist-reorder";
  // the app-side BrokerKind union (src/lib/broker.ts) is owned by the A-W
  // lane and not in this lane's file ownership, so the cast rides the wire
  // (the broker's ACTION_KINDS registry has both kinds pre-seeded — the
  // string is the same; only the TS union needs the cast).
  const r = await brokerAction(
    "playlist-update" as never,
    { playlistId },
    payload as never
  );
  if (!ok(r)) throw fail(r);
  const fields = {
    title: typeof req.title === "string",
    description: typeof req.description === "string",
    visibility: typeof req.visibility === "string",
  };
  const detail = (r.detail ?? {}) as Record<string, unknown>;
  const stage = typeof detail.stage === "string" ? detail.stage : undefined;
  const note = typeof detail.note === "string" ? detail.note : undefined;
  return {
    ok: true,
    effect: r.already ? "playlist-update-noop" : "playlist-updated",
    fields,
    verified: r.verified ?? false,
    ...(note ? { unverifiedNote: note } : {}),
    ...(r.already ? { already: true } : {}),
    ...(stage ? { path: r.path ?? stage } : { path: r.path }),
  };
}

export interface PlaylistReorderResult {
  ok: true;
  effect: string;
  /** the moved videoId sits at toIndex in the re-rendered list (verified) */
  verified: boolean;
  /** the drop fired but the list did not re-render the new order within the deadline */
  unverifiedNote?: string;
  fromIndex: number;
  toIndex: number;
  videoId?: string;
  path?: string;
}

/**
 * Reorder a playlist item — broker playlist-reorder (the playlist page's
 * real drag handle: pointerdown → stepped pointermove ladder → pointerup;
 * verified when the moved videoId sits at toIndex in the re-rendered list).
 * Honest verified:false when the drop fired but the order was not confirmed.
 */
export async function proxyPlaylistReorder(
  playlistId: string,
  fromIndex: number,
  toIndex: number,
  videoId?: string
): Promise<PlaylistReorderResult> {
  const payload: Record<string, unknown> = { fromIndex, toIndex };
  if (typeof videoId === "string" && videoId.length > 0) payload.videoId = videoId;
  const r = await brokerAction(
    "playlist-reorder" as never,
    { playlistId },
    payload as never
  );
  if (!ok(r)) throw fail(r);
  const detail = (r.detail ?? {}) as Record<string, unknown>;
  const note = typeof detail.note === "string" ? detail.note : undefined;
  return {
    ok: true,
    effect: "playlist-reordered",
    verified: r.verified ?? false,
    ...(note ? { unverifiedNote: note } : {}),
    fromIndex,
    toIndex,
    ...(typeof videoId === "string" && videoId.length > 0 ? { videoId } : {}),
    path: r.path,
  };
}
