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
import type { CommentAuthorDto, CommentDto, LikeValue } from "./types";
import {
  BROKER_OFFLINE_MESSAGE,
  BrokerError,
  brokerAction,
  type BrokerActionSuccess,
} from "@/lib/broker";
import { subscribeChannel, getSubscribedState, directAuthConfigured } from "@/lib/youtube-direct";

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

/** Synthesize the CommentDto the composer UI expects from a broker post. */
function synthComment(
  videoId: string,
  text: string,
  viewer: CommentViewer,
  parentId: string | null,
  verified: boolean
): CommentDto & { ok: true; effect: string; path?: string } {
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
    path: verified ? "ui" : undefined,
  };
}

/** Create a comment (broker comment-create). */
export async function proxyCommentCreate(
  videoId: string,
  text: string,
  viewer: CommentViewer
): Promise<CommentDto & { ok: true; effect: string; path?: string }> {
  const r = await brokerAction("comment-create", { videoId }, { text });
  if (!ok(r)) throw fail(r);
  return synthComment(videoId, text, viewer, null, r.verified !== false);
}

/** Reply to a comment (broker comment-reply; UI path needs parent text). */
export async function proxyCommentReply(
  videoId: string,
  parentId: string,
  text: string,
  viewer: CommentViewer,
  parentText?: string
): Promise<CommentDto & { ok: true; effect: string; path?: string }> {
  const r = await brokerAction(
    "comment-reply",
    { commentId: parentId, videoId },
    { text, ...(parentText ? { commentText: parentText } : {}) }
  );
  if (!ok(r)) throw fail(r);
  return synthComment(videoId, text, viewer, parentId, r.verified !== false);
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
