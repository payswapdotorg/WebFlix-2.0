/**
 * WFX2-P36-ACTION-PERSISTENCE — the per-user official-API action proxy.
 *
 * THE P36 LAW (docs/work-items/P36-ACTION-PERSISTENCE.md, the reviewer's
 * work order): production mutations must NEVER depend on one deployment-wide
 * operator cookie (YT_COOKIES) or one shared logged-in broker tab. Every
 * externally-mutating action acts on the SIGNED-IN WebFlix user's OWN
 * connected YouTube account through the official YouTube Data API, with an
 * authenticated read-back confirming the write before success is claimed.
 *
 * Execution policy (this file owns it):
 *  - OFFICIAL LANE (the user's own OAuth connection): like / dislike /
 *    remove-rating (videos.rate), subscribe / unsubscribe
 *    (subscriptions.insert/delete), playlist membership + create / update /
 *    delete (playlistItems.* / playlists.*) — each followed by its
 *    authenticated read-back (getRating / subscriptions.list /
 *    playlistItems.list) whose result is reported as `verified`;
 *  - LOCAL LANE (the honest WebFlix store, fully disclosed): comments
 *    (local:true — the official API only lets channels comment on their own
 *    videos), watch-later (a WebFlix-local list — YouTube's WL is a system
 *    playlist the Data API can't write), not-interested /
 *    don't-recommend-channel (local personalization signals);
 *  - UNSUPPORTED LANE (honest 501 + the handoff to YouTube): bell
 *    preferences, comment like/edit/delete/heart/pin/report, history
 *    writes, playlist reorder, community posts — no official end-user API
 *    exists, so WebFlix never pretends one did.
 *
 * BY CONSTRUCTION this module imports NEITHER @/lib/broker NOR
 * @/lib/youtube-direct: no shared-operator path can serve an end-user write.
 *
 * WFX2-P38 — THE DEPLOYMENT-TRUTH LAW: when the deployment itself lacks the
 * Google OAuth credentials (no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET), the
 * unconnected tier answers "not-configured" → 503 youtube-not-configured
 * ("this WebFlix deployment isn't connected to Google yet") — NEVER the
 * user-facing connect errand, which is reserved for a deployment where
 * connecting is actually possible (oauthConfigured && !userConnection).
 */
import { ApiError } from "./api";
import type { CommentDto, CommentVideoSnapshotDto, LikeValue } from "./types";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { getSessionUser } from "@/lib/auth/session";
import {
  getYouTubeConnection,
  markYouTubeConnectionNeedsReauth,
  putYouTubeConnection,
} from "@/lib/auth/youtube-connection-store";
import { decryptSecret, encryptSecret, oauthConfigured, refreshAccessToken } from "@/lib/youtube/oauth";
import {
  officialCreatePlaylist,
  officialDeletePlaylist,
  officialGetRating,
  officialPlaylistAdd,
  officialPlaylistMembership,
  officialPlaylistRemoveById,
  officialRateVideo,
  officialSubscribe,
  officialSubscriptionStatus,
  officialUnsubscribeById,
  officialUpdatePlaylist,
  SYSTEM_PLAYLIST_IDS,
  type OfficialFailure,
  type OfficialRating,
} from "@/lib/youtube/official-actions";
import { writeLocalComment, ensureShadowUser, ensureShadowVideo } from "./local-comments";
import { invalidateWatchCache } from "@/lib/youtube/watch";
import { db } from "@/lib/db";

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

/* ------------------------------------------------------------------ */
/* The action tier — the signed-in user's own OAuth connection         */
/* ------------------------------------------------------------------ */

export type UserActionTier =
  | { ok: true; user: WebFlixSessionUser; accessToken: string; channelId: string | null }
  | { ok: false; kind: "not-connected" | "needs-reauth" | "store-error" | "not-configured" };

/**
 * Resolve the acting user's YouTube action tier: the signed-in WebFlix user
 * + their OWN connected account's fresh access token. Never falls back to
 * any other identity — the P36 isolation law.
 *
 * WFX2-P38 — an absent connection on an UNCONFIGURED deployment answers
 * "not-configured" (the deployment truth), not "not-connected" (the user
 * connect errand — impossible where oauth/start would 503 anyway).
 */
export async function resolveActionTier(req: Request): Promise<UserActionTier> {
  const user = await getSessionUser(req);
  if (!user) return { ok: false, kind: "not-connected" }; // routes gate 401 first; defensive
  let connection;
  try {
    connection = await getYouTubeConnection(user.id);
  } catch {
    return { ok: false, kind: "store-error" };
  }
  if (!connection) {
    return { ok: false, kind: oauthConfigured() ? "not-connected" : "not-configured" };
  }
  if (connection.status === "needs_reauth") return { ok: false, kind: "needs-reauth" };

  const access = await decryptSecret(connection.accessTokenEnc);
  if (access === null) return { ok: false, kind: "needs-reauth" }; // key rotated / corrupt blob
  if (connection.accessExpiresAt > Date.now() + 60_000) {
    return { ok: true, user, accessToken: access, channelId: connection.channelId };
  }

  // the transparent refresh (offline access); a refused grant → needs-reauth
  const refresh = connection.refreshTokenEnc
    ? await decryptSecret(connection.refreshTokenEnc)
    : null;
  if (!refresh) return { ok: false, kind: "needs-reauth" };
  const refreshed = await refreshAccessToken(refresh);
  if (!refreshed.ok) {
    if (refreshed.kind === "invalid-grant") {
      await markYouTubeConnectionNeedsReauth(user.id).catch(() => {});
    }
    return { ok: false, kind: "needs-reauth" };
  }
  const updated = {
    ...connection,
    accessTokenEnc: await encryptSecret(refreshed.data.accessToken),
    accessExpiresAt: Date.now() + refreshed.data.expiresIn * 1000,
    scope: refreshed.data.scope,
    updatedAt: new Date().toISOString(),
  };
  await putYouTubeConnection(updated).catch(() => {
    /* best-effort: the token serves this request; the next one refreshes again */
  });
  return { ok: true, user, accessToken: refreshed.data.accessToken, channelId: connection.channelId };
}

/**
 * The read-only tier for state bootstraps (the watch page's like/subscribe
 * state, the shorts rail's yourLike): the user's token when connected,
 * null otherwise — NEVER the operator session's state.
 *
 * WFX2-P41 — the return also carries the user's id: the playback chain's
 * per-user OAuth player rung keys its cache by userId (the isolation law —
 * one user's authenticated playback fuel is never served to another), so
 * the read tier reports WHOSE token it is. Additive — existing callers
 * ignore the new field.
 */
export async function resolveReadTier(
  req: Request,
): Promise<{ accessToken: string; channelId: string | null; userId: string } | null> {
  const tier = await resolveActionTier(req);
  return tier.ok
    ? { accessToken: tier.accessToken, channelId: tier.channelId, userId: tier.user.id }
    : null;
}

/** Map a tier failure onto the honest ApiError (machine-stable `kind`). */
export function tierError(
  kind: "not-connected" | "needs-reauth" | "store-error" | "not-configured",
): ApiError {
  // WFX2-P38 — the deployment truth FIRST: an unconfigured deployment is a
  // 503 (the setup is the operator's, the user can't act on it at all).
  if (kind === "not-configured") {
    return new ApiError(
      503,
      "YouTube actions aren't available yet — this WebFlix deployment isn't connected to Google",
      "youtube-not-configured",
    );
  }
  if (kind === "not-connected") {
    return new ApiError(
      403,
      "Connect your YouTube account to act — Settings → YouTube connection",
      "youtube-not-connected",
    );
  }
  if (kind === "needs-reauth") {
    return new ApiError(
      403,
      "Your YouTube account connection needs re-authorizing — Settings → YouTube connection",
      "youtube-needs-reauth",
    );
  }
  return new ApiError(502, "The account store is unavailable right now — try again", "store-error");
}

/** Map an official-API failure onto the honest ApiError. */
function officialFailure(f: OfficialFailure): ApiError {
  if (f.kind === "quota") {
    return new ApiError(502, f.message, "youtube-quota");
  }
  if (f.status === 401 || f.status === 403) {
    return new ApiError(
      502,
      `YouTube rejected the action (${f.message}) — re-connect your account in Settings if it persists`,
      "youtube-provider-rejected",
    );
  }
  return new ApiError(502, f.message, "youtube-provider-error");
}

/** The honest unsupported-operation error (the handoff to YouTube). */
function unsupported(what: string): ApiError {
  return new ApiError(
    501,
    `${what} isn't supported by the official YouTube API — open the video on YouTube to do it there`,
    "youtube-unsupported",
  );
}

/** The honest count delta (prior → next for one side of the rating pair). */
function deltaCount(
  current: number,
  prior: LikeValue | null,
  next: LikeValue | null,
  which: "like" | "dislike",
): number {
  const had = prior === which;
  const has = next === which;
  if (has && !had) return current + 1;
  if (!has && had) return Math.max(0, current - 1);
  return current;
}

/* ------------------------------------------------------------------ */
/* Video like / dislike / remove-rating — videos.rate + getRating      */
/* ------------------------------------------------------------------ */

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
  /** P36 — true only when the authenticated read-back confirmed the rating */
  verified?: boolean;
  note?: string;
}

/**
 * Video like/dislike — the user's OWN account through videos.rate, confirmed
 * by videos.getRating (the authenticated read-back). Dislike now rides the
 * SAME official lane as like (the P33 broker-only gap closed the
 * policy-aligned way). Legacy `value` keeps YouTube's toggle semantics.
 */
export async function proxyVideoLike(
  videoId: string,
  req: LikeRequest,
  tier: UserActionTier,
): Promise<LikeResult> {
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  if (!tier.ok) throw tierError(tier.kind);
  const base = {
    likes: Math.max(0, req.baseline?.likes ?? 0),
    dislikes: Math.max(0, req.baseline?.dislikes ?? 0),
    yourLike: req.baseline?.yourLike ?? null,
  };

  // resolve the target rating (set semantics + the legacy toggle law)
  let target: OfficialRating;
  if (req.action) {
    target = req.action;
  } else if (req.value) {
    target = base.yourLike === req.value ? "none" : req.value;
  } else {
    target = "none";
  }

  const write = await officialRateVideo(tier.accessToken, videoId, target);
  if (!write.ok) throw officialFailure(write);
  // the P35 cache law kept: the write changed YouTube-side state
  await invalidateWatchCache(videoId).catch(() => {});

  // the authenticated read-back — the ONLY success confirmation P36 trusts
  const read = await officialGetRating(tier.accessToken, videoId);
  const verified = read.ok && read.data.rating === target;
  const yourLike: LikeValue | null = read.ok
    ? read.data.rating === "like"
      ? "like"
      : read.data.rating === "dislike"
        ? "dislike"
        : null
    : target === "none"
      ? null
      : target;
  const effect =
    target === "like" ? "liked" : target === "dislike" ? "disliked" : "rating-removed";
  return {
    ok: true,
    effect,
    likes: deltaCount(base.likes, base.yourLike, yourLike, "like"),
    dislikes: deltaCount(base.dislikes, base.yourLike, yourLike, "dislike"),
    yourLike,
    already: false,
    path: "oauth-official",
    verified,
    ...(read.ok
      ? {}
      : {
          note: "the rating was written; the read-back was unavailable so the state shows your intended rating",
        }),
  };
}

/* ------------------------------------------------------------------ */
/* Subscribe / unsubscribe — subscriptions.insert/delete + list        */
/* ------------------------------------------------------------------ */

export interface SubscribeResult {
  ok: true;
  effect: string;
  subscribed: boolean;
  path: string;
  already?: boolean;
  /** P36 — true only when the authenticated read-back confirmed the state */
  verified?: boolean;
  note?: string;
}

/** P35's context kept — a successful write also drops the watch cache. */
export interface SubscribeContext {
  videoId?: string | null;
}

export async function proxySubscribe(
  channelId: string,
  on: boolean | null,
  tier: UserActionTier,
  ctx: SubscribeContext = {},
): Promise<SubscribeResult> {
  if (!tier.ok) throw tierError(tier.kind);

  // the authenticated current-state read (the toggle's resolver + the
  // idempotence guard + the unsubscribe's subscription-id source)
  const status = await officialSubscriptionStatus(tier.accessToken, channelId);
  if (!status.ok) throw officialFailure(status);
  const want = on === null ? !status.data.subscribed : on;

  if (want) {
    if (status.data.subscribed) {
      return {
        ok: true,
        effect: "subscribed",
        subscribed: true,
        path: "oauth-official",
        already: true,
        verified: true,
      };
    }
    const write = await officialSubscribe(tier.accessToken, channelId);
    if (!write.ok) throw officialFailure(write);
    if (ctx.videoId) await invalidateWatchCache(ctx.videoId).catch(() => {});
    const read = await officialSubscriptionStatus(tier.accessToken, channelId);
    return {
      ok: true,
      effect: "subscribed",
      subscribed: true,
      path: "oauth-official",
      verified: read.ok ? read.data.subscribed === true : false,
      ...(read.ok
        ? {}
        : { note: "subscribed; the read-back was unavailable so the state is unconfirmed" }),
    };
  }

  if (!status.data.subscribed) {
    return {
      ok: true,
      effect: "unsubscribed",
      subscribed: false,
      path: "oauth-official",
      already: true,
      verified: true,
    };
  }
  if (!status.data.subscriptionId) {
    throw new ApiError(
      502,
      "your subscription exists but its id could not be resolved for removal — try again",
      "youtube-provider-error",
    );
  }
  const write = await officialUnsubscribeById(tier.accessToken, status.data.subscriptionId);
  if (!write.ok) throw officialFailure(write);
  if (ctx.videoId) await invalidateWatchCache(ctx.videoId).catch(() => {});
  const read = await officialSubscriptionStatus(tier.accessToken, channelId);
  return {
    ok: true,
    effect: "unsubscribed",
    subscribed: false,
    path: "oauth-official",
    verified: read.ok ? read.data.subscribed === false : false,
    ...(read.ok
      ? {}
      : { note: "unsubscribed; the read-back was unavailable so the state is unconfirmed" }),
  };
}

/* ------------------------------------------------------------------ */
/* Bell — the honest unsupported lane (off = unsubscribe, supported)    */
/* ------------------------------------------------------------------ */

export async function proxyBell(
  channelId: string,
  pref: "all" | "personalized" | "none" | "off",
  tier: UserActionTier,
): Promise<{ ok: true; effect: string; bell: "all" | "personalized" | "none" | null }> {
  if (pref === "off") {
    const r = await proxySubscribe(channelId, false, tier);
    return { ok: true, effect: r.effect, bell: null };
  }
  throw unsupported("Bell preferences");
}

/**
 * The watch page subscribe state machine (POST /api/subscriptions).
 * bell off/omitted → unsubscribe; all|personalized|none → subscribe (the
 * official lane). The bell PREF itself is API-unsupported — the response
 * says so honestly instead of pretending it was set.
 */
export async function proxySubscriptionStateMachine(
  channelId: string,
  bell: "all" | "personalized" | "none" | "off" | undefined,
  subscriberCountBaseline: number | null,
  tier: UserActionTier,
  ctx: SubscribeContext = {},
): Promise<{
  subscribed: boolean;
  bell: "all" | "personalized" | "none" | null;
  subscriberCount: number;
  ok: true;
  effect: string;
  path: string;
  verified?: boolean;
  note?: string;
}> {
  if (!bell || bell === "off") {
    const r = await proxySubscribe(channelId, false, tier, ctx);
    return {
      subscribed: false,
      bell: null,
      subscriberCount:
        subscriberCountBaseline === null ? -1 : Math.max(0, subscriberCountBaseline - 1),
      ok: true,
      effect: r.effect,
      path: r.path,
      verified: r.verified,
    };
  }
  const sub = await proxySubscribe(channelId, true, tier, ctx);
  return {
    subscribed: true,
    // honest: the pref was NOT set (no API) — null, with the note
    bell: null,
    subscriberCount:
      subscriberCountBaseline === null ? -1 : Math.max(0, subscriberCountBaseline + 1),
    ok: true,
    effect: `${sub.effect}; bell preference not API-supported`,
    path: `${sub.path}+bell-unsupported`,
    verified: sub.verified,
    note:
      "Subscribed through your connected account. Bell preferences aren't supported by the YouTube Data API — set them on YouTube.",
  };
}

/* ------------------------------------------------------------------ */
/* Comments — the honest LOCAL lane (the official API only lets        */
/* channels comment on their own videos)                               */
/* ------------------------------------------------------------------ */

export type CommentWriteResult = CommentDto & {
  ok: true;
  effect: string;
  path?: string;
  /** WFX2-P6-CR: true → the row lives in the honest WebFlix store */
  local?: boolean;
};

export interface CommentWriteOpts {
  sessionUser?: WebFlixSessionUser | null;
  video?: CommentVideoSnapshotDto;
}

/**
 * Create a comment — the LOCAL lane, fully disclosed (local:true, "Stored on
 * WebFlix — not posted to YouTube"). The official Data API does not support
 * viewer comments on other channels' videos; WebFlix never pretends it does.
 */
export async function proxyCommentCreate(
  videoId: string,
  text: string,
  _viewer: unknown,
  opts: CommentWriteOpts = {},
): Promise<CommentWriteResult> {
  if (!opts.sessionUser) {
    throw new ApiError(401, "sign in to comment", "unauthenticated");
  }
  try {
    return await writeLocalComment({
      videoId,
      text,
      sessionUser: opts.sessionUser,
      ...(opts.video ? { videoSnapshot: opts.video } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "the WebFlix store is unreachable — comment not posted", "store-error");
  }
}

/** Reply to a comment — the LOCAL lane (same honest disclosure). */
export async function proxyCommentReply(
  videoId: string,
  parentId: string,
  text: string,
  _viewer: unknown,
  parentText?: string,
  opts: CommentWriteOpts = {},
): Promise<CommentWriteResult> {
  if (!opts.sessionUser) {
    throw new ApiError(401, "sign in to reply", "unauthenticated");
  }
  try {
    return await writeLocalComment({
      videoId,
      text,
      parentId,
      ...(parentText ? { parentText } : {}),
      sessionUser: opts.sessionUser,
      ...(opts.video ? { videoSnapshot: opts.video } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "the WebFlix store is unreachable — comment not posted", "store-error");
  }
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

/** Comment like — unsupported (no official end-user API; never broker'd). */
export async function proxyCommentLike(
  _commentId: string,
  _req: CommentLikeRequest,
): Promise<CommentLikeResult> {
  throw unsupported("Liking YouTube comments");
}

/** The comment's identity (kept for the route signatures). */
export interface CommentLocator {
  videoId: string;
  commentText?: string;
}

export interface CommentEditResult {
  ok: true;
  effect: string;
  body: string;
  edited: true;
  path?: string;
}

export async function proxyCommentEdit(
  _commentId: string,
  _text: string,
  _locator: CommentLocator,
): Promise<CommentEditResult> {
  throw unsupported("Editing YouTube comments");
}

export interface CommentDeleteResult {
  ok: true;
  effect: string;
  deleted: true;
  path?: string;
}

export async function proxyCommentDelete(
  _commentId: string,
  _locator: CommentLocator,
): Promise<CommentDeleteResult> {
  throw unsupported("Deleting YouTube comments");
}

export interface CommentHeartResult {
  ok: true;
  effect: string;
  heartedByCreator: boolean;
  path?: string;
}

export async function proxyCommentHeart(
  _commentId: string,
  _locator: CommentLocator,
): Promise<CommentHeartResult> {
  throw unsupported("Creator hearts");
}

export interface CommentPinResult {
  ok: true;
  effect: string;
  pinned: boolean;
  path?: string;
}

export async function proxyCommentPin(
  _commentId: string,
  _locator: CommentLocator,
): Promise<CommentPinResult> {
  throw unsupported("Pinning comments");
}

export interface CommentReportResult {
  ok: true;
  effect: string;
  reported: true;
  reason?: string;
  path?: string;
}

export async function proxyCommentReport(
  _commentId: string,
  _locator: CommentLocator & { reason?: string },
): Promise<CommentReportResult> {
  throw unsupported("Reporting YouTube comments");
}

export interface CommentRestoreResult {
  ok: true;
  effect: string;
  restored: true;
  path?: string;
}

/**
 * WFX2-P40 — restoring a YOUTUBE comment: unsupported (no official
 * end-user path; a deleted YouTube comment cannot be restored through the
 * API). Local rows take the store-backed tier in the route
 * (localRestoreComment) and never reach this proxy.
 */
export async function proxyCommentRestore(
  _commentId: string,
): Promise<CommentRestoreResult> {
  throw unsupported("Restoring YouTube comments");
}

/* ------------------------------------------------------------------ */
/* Watch-later — the honest LOCAL list (YouTube's WL is a system       */
/* playlist the Data API cannot write)                                 */
/* ------------------------------------------------------------------ */

export interface WatchLaterResult {
  ok: true;
  effect: string;
  added: boolean;
  playlistId: string;
  already?: boolean;
  path?: string;
  local?: boolean;
  note?: string;
}

/** Find (or create) the user's WebFlix-local Watch-later playlist row. */
async function localWatchLaterPlaylistId(userId: string): Promise<string> {
  const existing = await db.playlist.findFirst({
    where: { userId, isWatchLater: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.playlist.create({
    data: { userId, title: "Watch later", isWatchLater: true, visibility: "private" },
    select: { id: true },
  });
  return created.id;
}

/**
 * Watch later — the WebFlix-local list, fully disclosed. Toggle resolves
 * server-side from the local truth; the note says exactly why it's local.
 *
 * WFX2-P37 — the optional display snapshot: callers that already hold the
 * video's title/channel (the card menu, the watch Save dialog) pass it so
 * the shadow video row — what /playlist/WL's local list renders — carries
 * the REAL title/channel instead of the "YouTube video <id>" fallback.
 * Absent snapshot keeps the pre-P37 honest-default shape exactly.
 */
export async function proxyWatchLater(
  videoId: string,
  add: boolean | undefined,
  sessionUser: WebFlixSessionUser | null,
  snapshot: CommentVideoSnapshotDto = {}
): Promise<WatchLaterResult> {
  if (!sessionUser) throw new ApiError(401, "sign in to save videos", "unauthenticated");
  try {
    const user = await ensureShadowUser(sessionUser);
    await ensureShadowVideo(videoId, snapshot);
    const playlistId = await localWatchLaterPlaylistId(user.id);
    const existing = await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId, videoId } },
    });
    const want = add === undefined ? !existing : add;
    if (want && !existing) {
      const position = await db.playlistItem.count({ where: { playlistId } });
      await db.playlistItem.create({ data: { playlistId, videoId, position } });
    } else if (!want && existing) {
      await db.playlistItem.deleteMany({ where: { playlistId, videoId } });
    }
    return {
      ok: true,
      effect: want ? "watch-later-added" : "watch-later-removed",
      added: want,
      playlistId: "WL",
      already: want === Boolean(existing),
      path: "local",
      local: true,
      note:
        "Saved on WebFlix — YouTube's own Watch Later isn't writable through the official API",
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "the WebFlix store is unreachable — save failed", "store-error");
  }
}

/** The watch bootstrap's local WL read (per user; honest false when absent). */
export async function readLocalSavedWatchLater(
  videoId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<boolean> {
  if (!sessionUser) return false;
  try {
    const user = await ensureShadowUser(sessionUser);
    const wl = await db.playlist.findFirst({
      where: { userId: user.id, isWatchLater: true },
      select: { id: true },
    });
    if (!wl) return false;
    const item = await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: wl.id, videoId } },
      select: { playlistId: true },
    });
    return item !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Playlist membership + management — the official playlistItems /     */
/* playlists lanes (the user's OWN playlists)                          */
/* ------------------------------------------------------------------ */

export interface PlaylistAddResult {
  ok: true;
  effect: string;
  added: boolean;
  containsVideo: boolean;
  already?: boolean;
  path?: string;
  verified?: boolean;
  note?: string;
}

/**
 * Add/toggle a video in one of the user's OWN playlists — the official
 * playlistItems lane with the membership read-back. WL/LL system playlists
 * are rejected up-front (the API cannot write them — the local watch-later
 * lane serves the WL surface instead).
 */
export async function proxyPlaylistAdd(
  playlistId: string,
  videoId: string,
  opts: { mode?: "add" | "remove" | "toggle"; title?: string } = {},
  tier: UserActionTier,
): Promise<PlaylistAddResult> {
  const mode = opts.mode ?? "add";
  if (SYSTEM_PLAYLIST_IDS.has(playlistId)) {
    throw new ApiError(
      501,
      "Watch Later / Liked videos are YouTube system playlists the Data API can't write — use the WebFlix list or YouTube's own surface",
      "youtube-system-playlist",
    );
  }
  if (!tier.ok) throw tierError(tier.kind);

  // the membership read (the toggle resolver + the idempotence guard)
  const membership = await officialPlaylistMembership(tier.accessToken, playlistId, videoId);
  if (!membership.ok) throw officialFailure(membership);
  const contains = membership.data.contains;
  const want = mode === "remove" ? false : mode === "add" ? true : !contains;

  if (want && contains) {
    return {
      ok: true,
      effect: "playlist-added",
      added: true,
      containsVideo: true,
      already: true,
      path: "oauth-official",
      verified: true,
    };
  }
  if (!want && !contains) {
    return {
      ok: true,
      effect: "playlist-removed",
      added: false,
      containsVideo: false,
      already: true,
      path: "oauth-official",
      verified: true,
    };
  }

  if (want) {
    const write = await officialPlaylistAdd(tier.accessToken, playlistId, videoId);
    if (!write.ok) throw officialFailure(write);
    const read = await officialPlaylistMembership(tier.accessToken, playlistId, videoId);
    return {
      ok: true,
      effect: "playlist-added",
      added: true,
      containsVideo: read.ok ? read.data.contains : true,
      path: "oauth-official",
      verified: read.ok ? read.data.contains === true : false,
      ...(read.ok
        ? {}
        : { note: "added; the membership read-back was unavailable" }),
    };
  }

  if (!membership.data.itemId) {
    throw new ApiError(
      502,
      "the playlist item id could not be resolved for removal — try again",
      "youtube-provider-error",
    );
  }
  const write = await officialPlaylistRemoveById(tier.accessToken, membership.data.itemId);
  if (!write.ok) throw officialFailure(write);
  const read = await officialPlaylistMembership(tier.accessToken, playlistId, videoId);
  return {
    ok: true,
    effect: "playlist-removed",
    added: false,
    containsVideo: read.ok ? read.data.contains : false,
    path: "oauth-official",
    verified: read.ok ? read.data.contains === false : false,
    ...(read.ok ? {} : { note: "removed; the membership read-back was unavailable" }),
  };
}

export interface PlaylistUpdateRequest {
  title?: string;
  description?: string;
  visibility?: "public" | "unlisted" | "private";
}

export interface PlaylistUpdateResult {
  ok: true;
  effect: string;
  fields: { title: boolean; description: boolean; visibility: boolean };
  verified: boolean;
  unverifiedNote?: string;
  already?: boolean;
  path?: string;
}

/**
 * Update a playlist's title/description/visibility — the official
 * playlists.update lane (partial-safe: the current resource is fetched and
 * merged so an omitted field is never cleared). The response IS the updated
 * resource — the API's own read-back.
 */
export async function proxyPlaylistUpdate(
  playlistId: string,
  req: PlaylistUpdateRequest,
  tier: UserActionTier,
): Promise<PlaylistUpdateResult> {
  if (!tier.ok) throw tierError(tier.kind);
  const fields = {
    title: typeof req.title === "string",
    description: typeof req.description === "string",
    visibility: typeof req.visibility === "string",
  };
  if (!fields.title && !fields.description && !fields.visibility) {
    return {
      ok: true,
      effect: "playlist-update-noop",
      fields,
      verified: true,
      already: true,
      path: "oauth-official",
    };
  }
  const r = await officialUpdatePlaylist(tier.accessToken, playlistId, {
    ...(fields.title ? { title: req.title } : {}),
    ...(fields.description ? { description: req.description } : {}),
    ...(fields.visibility ? { visibility: req.visibility } : {}),
  });
  if (!r.ok) throw officialFailure(r);
  return {
    ok: true,
    effect: "playlist-updated",
    fields,
    verified: true,
    path: "oauth-official",
  };
}

export interface PlaylistReorderResult {
  ok: true;
  effect: string;
  verified: boolean;
  unverifiedNote?: string;
  fromIndex: number;
  toIndex: number;
  videoId?: string;
  path?: string;
}

/** Reorder — the honest unsupported lane (no safe official reorder path). */
export async function proxyPlaylistReorder(
  playlistId: string,
  fromIndex: number,
  toIndex: number,
  videoId?: string,
): Promise<PlaylistReorderResult> {
  void playlistId;
  void fromIndex;
  void toIndex;
  void videoId;
  throw unsupported("Reordering playlists");
}

/* ------------------------------------------------------------------ */
/* Playlist create / delete — the official playlists.insert/delete lane */
/* ------------------------------------------------------------------ */

export interface PlaylistCreateResult {
  ok: true;
  effect: string;
  verified: boolean;
  playlist: {
    id: string;
    title: string;
    visibility: "public" | "unlisted" | "private";
    itemCount: number;
    thumbUrl: string | null;
  };
  path: string;
}

/** Create a playlist in the user's OWN account — playlists.insert. */
export async function proxyPlaylistCreate(
  title: string,
  visibility: "public" | "unlisted" | "private",
  tier: UserActionTier,
): Promise<PlaylistCreateResult> {
  if (!tier.ok) throw tierError(tier.kind);
  const r = await officialCreatePlaylist(tier.accessToken, title, visibility);
  if (!r.ok) throw officialFailure(r);
  return {
    ok: true,
    effect: "created",
    verified: true,
    playlist: {
      id: r.data.id,
      title: r.data.title,
      visibility: r.data.visibility,
      itemCount: r.data.itemCount,
      thumbUrl: r.data.thumbUrl,
    },
    path: "oauth-official",
  };
}

/** Delete one of the user's OWN playlists — playlists.delete (204). */
export async function proxyPlaylistDelete(
  playlistId: string,
  tier: UserActionTier,
): Promise<{ ok: true; effect: string; verified: boolean; path: string }> {
  if (SYSTEM_PLAYLIST_IDS.has(playlistId)) {
    throw new ApiError(
      501,
      "Watch Later / Liked videos are YouTube system playlists the Data API can't delete",
      "youtube-system-playlist",
    );
  }
  if (!tier.ok) throw tierError(tier.kind);
  const r = await officialDeletePlaylist(tier.accessToken, playlistId);
  if (!r.ok) throw officialFailure(r);
  return { ok: true, effect: "deleted", verified: true, path: "oauth-official" };
}

/* ------------------------------------------------------------------ */
/* The feed-feedback family — the honest LOCAL signal lane             */
/* ------------------------------------------------------------------ */

export interface NotInterestedResult {
  ok: true;
  effect: string;
  notInterested: true;
  hidden: true;
  local?: boolean;
  path?: string;
  note?: string;
}

/**
 * Not interested — a WebFlix-LOCAL personalization signal (the VideoSignal
 * store), fully disclosed: "Hidden on WebFlix". YouTube's own Not-interested
 * has no official API, so WebFlix never claims a YouTube-side write.
 */
export async function proxyNotInterested(
  videoId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<NotInterestedResult> {
  await writeLocalSignal(videoId, "not_interested", sessionUser);
  return {
    ok: true,
    effect: "not-interested",
    notInterested: true,
    hidden: true,
    local: true,
    path: "local",
    note: "Hidden on WebFlix — YouTube's own feed feedback isn't available through the official API",
  };
}

export interface DontRecommendChannelResult {
  ok: true;
  effect: string;
  dontRecommendChannel: true;
  hidden: true;
  local?: boolean;
  path?: string;
  note?: string;
}

export async function proxyDontRecommendChannel(
  videoId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<DontRecommendChannelResult> {
  await writeLocalSignal(videoId, "dont_recommend_channel", sessionUser);
  return {
    ok: true,
    effect: "dont-recommend-channel",
    dontRecommendChannel: true,
    hidden: true,
    local: true,
    path: "local",
    note: "The channel won't be recommended on WebFlix — YouTube's own feed feedback isn't available through the official API",
  };
}

/** Write the WebFlix-local personalization signal (one row per user+video). */
async function writeLocalSignal(
  videoId: string,
  kind: "not_interested" | "dont_recommend_channel",
  sessionUser: WebFlixSessionUser | null,
): Promise<void> {
  if (!sessionUser) throw new ApiError(401, "sign in first", "unauthenticated");
  try {
    const user = await ensureShadowUser(sessionUser);
    await ensureShadowVideo(videoId);
    // one signal row per user+video (the schema's unique key) — the kind is
    // the latest verdict; an undo targets its own kind only
    await db.videoSignal.upsert({
      where: { videoId_userId: { videoId, userId: user.id } },
      create: { videoId, userId: user.id, kind },
      update: { kind },
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "the WebFlix store is unreachable — try again", "store-error");
  }
}

/** Remove the WebFlix-local personalization signal (the undo). */
async function removeLocalSignal(
  videoId: string,
  kind: "not_interested" | "dont_recommend_channel",
  sessionUser: WebFlixSessionUser | null,
): Promise<void> {
  if (!sessionUser) throw new ApiError(401, "sign in first", "unauthenticated");
  try {
    const user = await ensureShadowUser(sessionUser);
    await db.videoSignal.deleteMany({ where: { videoId, userId: user.id, kind } });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "the WebFlix store is unreachable — try again", "store-error");
  }
}

export interface FeedbackUndoResult {
  ok: true;
  effect: string;
  restored: true;
  local?: boolean;
  path?: string;
  note?: string;
}

/**
 * Feedback undo — removes the LOCAL signal (always available, no YouTube
 * toast window needed — the signal is ours). Fully disclosed as local.
 */
export async function proxyFeedbackUndo(
  videoId: string,
  kind: "not_interested" | "dont_recommend_channel",
  sessionUser: WebFlixSessionUser | null,
): Promise<FeedbackUndoResult> {
  await removeLocalSignal(videoId, kind, sessionUser);
  return {
    ok: true,
    effect: "feedback-undo",
    restored: true,
    local: true,
    path: "local",
    note: "Restored on WebFlix",
  };
}
