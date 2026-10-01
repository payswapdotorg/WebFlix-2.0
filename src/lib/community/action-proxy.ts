/**
 * WFX2-P2-SO — the community-post write proxies (the comment-lane pattern:
 * the broker kinds mapped onto the UI's request/response contracts, honest
 * 502s when the broker is offline — the routes degrade, never lie).
 *
 * All post interactions act on the REAL youtube.com through the logged-in
 * browser (the Tier-2 broker channel): post likes click the real vote
 * buttons on the post page, post comments ride the real comments composer,
 * and post-create executes youtube.com's own backstage create flow.
 */
import { ApiError } from "@/lib/watch/api";
import type { CommentDto } from "@/lib/watch/types";
import {
  BROKER_OFFLINE_MESSAGE,
  BrokerError,
  brokerAction,
  type BrokerActionSuccess,
} from "@/lib/broker";

export { BROKER_OFFLINE_MESSAGE };

const OFFLINE = () => new ApiError(502, BROKER_OFFLINE_MESSAGE);

/** Map a broker failure to an honest ApiError for the routes. */
function fail(err: BrokerError): ApiError {
  if (err.kind === "offline") return OFFLINE();
  if (err.kind === "bad-request") return new ApiError(400, err.message);
  return new ApiError(502, err.message);
}

function ok(result: BrokerActionSuccess | BrokerError): result is BrokerActionSuccess {
  return !(result instanceof BrokerError);
}

// ---------------------------------------------------------------------------
// post like / dislike
// ---------------------------------------------------------------------------

export interface PostLikeRequest {
  /** canonical shape: "like" | "dislike" | "none" (set semantics) */
  action?: "like" | "dislike" | "none";
  /** legacy UI shape: "like" | "dislike" (toggle semantics — same value unsets) */
  value?: "like" | "dislike";
  /** the UI's current count (keeps the displayed number honest) */
  baseline?: { likes?: number; yourLike?: "like" | "dislike" | null };
}

export interface PostLikeResult {
  ok: true;
  effect: string;
  likes: number;
  yourLike: "like" | "dislike" | null;
  already?: boolean;
  path?: string;
}

/** Parse a compact count label ("4.4K" / "1,234") into a number. */
export function parseCompactCount(label: string | undefined | null): number | null {
  if (!label) return null;
  const m = label.replace(/,/g, "").match(/([\d.]+)\s*(K|M|B)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

/**
 * Post like/dislike — broker post-like (the real vote toggle on the post
 * page, aria-pressed verified). YouTube community posts expose like +
 * dislike; same-value clicks toggle off (the legacy value shape).
 */
export async function proxyPostLike(postId: string, req: PostLikeRequest): Promise<PostLikeResult> {
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  const baseLikes = Math.max(0, req.baseline?.likes ?? 0);
  const prior = req.baseline?.yourLike ?? null;

  // legacy toggle semantics: same value again → remove the rating
  const desired: "like" | "dislike" | "remove" =
    action === "none"
      ? "remove"
      : req.value && !req.action && prior === action
        ? "remove"
        : action;

  const r = await brokerAction("post-like", { postId }, { action: desired });
  if (!ok(r)) throw fail(r);

  const domLikes = parseCompactCount(r.detail?.["likesText"] as string | undefined);
  const yourLike: "like" | "dislike" | null =
    desired === "remove"
      ? null
      : ((r.detail?.["rating"] as "like" | "dislike" | undefined) ?? desired);
  const effect =
    desired === "remove"
      ? "post-rating-removed"
      : yourLike === "like"
        ? "post-liked"
        : "post-disliked";
  const likes =
    domLikes ??
    (yourLike === "like" && prior !== "like"
      ? baseLikes + 1
      : yourLike !== "like" && prior === "like"
        ? Math.max(0, baseLikes - 1)
        : baseLikes);
  return { ok: true, effect, likes, yourLike, already: r.already, path: r.path };
}

// ---------------------------------------------------------------------------
// post comments
// ---------------------------------------------------------------------------

export interface PostCommentViewer {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}

/** Synthesize the CommentDto the composer UI expects from a broker post. */
function synthPostComment(
  postId: string,
  text: string,
  viewer: PostCommentViewer
): CommentDto & { ok: true; effect: string; path?: string } {
  return {
    id: `yt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    parentId: null,
    body: text,
    likes: 0,
    heartedByCreator: false,
    pinned: false,
    edited: false,
    moderation: "approved",
    createdAt: new Date().toISOString(),
    publishedText: "just now",
    author: {
      id: viewer.id,
      handle: viewer.handle,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
      isMember: false,
      isCreator: false,
    },
    yourLike: null,
    isOwn: true,
    replyCount: 0,
    totalReplyCount: 0,
    ok: true,
    effect: "post-comment-created",
    path: "ui",
  };
}

/** Create a comment on a post — broker post-comment-create (UI DOM path). */
export async function proxyPostCommentCreate(
  postId: string,
  text: string,
  viewer: PostCommentViewer
): Promise<CommentDto & { ok: true; effect: string; path?: string }> {
  const r = await brokerAction("post-comment-create", { postId }, { text });
  if (!ok(r)) throw fail(r);
  const comment = synthPostComment(postId, text, viewer);
  return { ...comment, path: r.path ?? "ui" };
}

export interface PostCommentLikeRequest {
  value?: "like" | "dislike";
  action?: "like" | "dislike" | "none";
  baseline?: { likes?: number; yourLike?: "like" | "dislike" | null };
  /** the comment's text — the broker's DOM locator on the post page */
  commentText?: string;
}

export interface PostCommentLikeResult {
  ok: true;
  effect: string;
  likes: number;
  yourLike: "like" | "dislike" | null;
}

/**
 * Like a post comment — broker post-comment-like (the comment located by
 * text in the post page's comments DOM; single like control, toggle
 * semantics like YouTube's).
 */
export async function proxyPostCommentLike(
  postId: string,
  commentId: string,
  req: PostCommentLikeRequest
): Promise<PostCommentLikeResult> {
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  const baseLikes = Math.max(0, req.baseline?.likes ?? 0);
  const prior = req.baseline?.yourLike ?? null;

  const mode =
    action === "none" || action === "dislike"
      ? "remove"
      : req.value && !req.action
        ? "toggle"
        : "set";
  const r = await brokerAction(
    "post-comment-like",
    { postId, commentId },
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
    effect: liked ? "post-comment-liked" : "post-comment-like-removed",
    likes,
    yourLike: liked ? "like" : null,
  };
}

// ---------------------------------------------------------------------------
// post create (the creator composer)
// ---------------------------------------------------------------------------

export interface PostCreateResult {
  ok: true;
  effect: string;
  /** the broker's verification state (the new post rendered in the feed) */
  verified?: boolean;
  path?: string;
  note?: string;
}

/**
 * Create a community post on the operator's OWN channel — broker
 * post-create (youtube.com's real backstage composer: the create box → the
 * post dialog → text/image/poll → POST). The post's real id/author arrive
 * on the next ladder read; the UI reloads the Community tab.
 */
export async function proxyPostCreate(input: {
  handle: string;
  channelId?: string;
  text: string;
  imageUrl?: string;
  pollOptions?: string[];
}): Promise<PostCreateResult> {
  const text = input.text.trim();
  const imageUrl =
    input.imageUrl && /^https?:\/\//.test(input.imageUrl) ? input.imageUrl : undefined;
  const pollOptions =
    Array.isArray(input.pollOptions) && input.pollOptions.length
      ? input.pollOptions.map((o) => o.trim()).filter(Boolean)
      : undefined;
  if (!text && !imageUrl && !(pollOptions && pollOptions.length)) {
    throw new ApiError(400, "a post needs text, an image, or a poll");
  }
  if (pollOptions && (pollOptions.length < 2 || pollOptions.length > 5)) {
    throw new ApiError(400, "pollOptions must carry 2-5 non-empty options");
  }
  const r = await brokerAction(
    "post-create",
    { ...(input.channelId ? { channelId: input.channelId } : {}) },
    {
      handle: input.handle.replace(/^@/, ""),
      text,
      ...(imageUrl ? { imageUrl } : {}),
      ...(pollOptions ? { pollOptions } : {}),
    }
  );
  if (!ok(r)) throw fail(r);
  const note = typeof r.detail?.["note"] === "string" ? r.detail.note : undefined;
  return {
    ok: true,
    effect: "post-created",
    verified: r.verified,
    path: r.path,
    ...(note ? { note } : {}),
  };
}
