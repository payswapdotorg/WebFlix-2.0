/**
 * WFX2-P36-ACTION-PERSISTENCE — the community-post write proxies, on the
 * HONEST UNSUPPORTED lane.
 *
 * THE P36 LAW (docs/work-items/P36-ACTION-PERSISTENCE.md): production
 * mutations must never depend on one deployment-wide operator cookie
 * (YT_COOKIES) or one shared logged-in broker tab. Community posts
 * (post create, post like/dislike, post comments, post-comment likes) have
 * NO official YouTube Data API for end users — so every proxy here throws
 * the honest ApiError(501, …, "youtube-unsupported") with the handoff to
 * YouTube, and this module imports NEITHER @/lib/broker NOR
 * @/lib/youtube-direct: no shared-operator path can serve a user write.
 *
 * The request/response contracts the routes and UI consume are kept verbatim
 * (shapes, validation, the parseCompactCount helper) — only the execution
 * lane changed: the pre-P36 broker drives are retired.
 */
import { ApiError } from "@/lib/watch/api";
import type { CommentDto } from "@/lib/watch/types";

/** The honest unsupported handoff (machine-stable kind, the P36 taxonomy). */
function unsupported(what: string): ApiError {
  return new ApiError(
    501,
    `${what} isn't supported by the official YouTube API — community posts live on YouTube`,
    "youtube-unsupported",
  );
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
 * Post like/dislike — the HONEST UNSUPPORTED lane: no official API for
 * rating community posts, so never a fake likes delta. The request shape
 * (canonical action / legacy value) is still validated before the 501.
 */
export async function proxyPostLike(postId: string, req: PostLikeRequest): Promise<PostLikeResult> {
  void postId;
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  throw unsupported("Liking YouTube community posts");
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

/** Create a comment on a post — the HONEST UNSUPPORTED lane. */
export async function proxyPostCommentCreate(
  postId: string,
  text: string,
  viewer: PostCommentViewer,
): Promise<CommentDto & { ok: true; effect: string; path?: string }> {
  void postId;
  void text;
  void viewer;
  throw unsupported("Commenting on YouTube community posts");
}

export interface PostCommentLikeRequest {
  value?: "like" | "dislike";
  action?: "like" | "dislike" | "none";
  baseline?: { likes?: number; yourLike?: "like" | "dislike" | null };
  /** the comment's text (kept for the request contract) */
  commentText?: string;
}

export interface PostCommentLikeResult {
  ok: true;
  effect: string;
  likes: number;
  yourLike: "like" | "dislike" | null;
}

/**
 * Like a post comment — the HONEST UNSUPPORTED lane. The request shape is
 * still validated before the 501.
 */
export async function proxyPostCommentLike(
  postId: string,
  commentId: string,
  req: PostCommentLikeRequest,
): Promise<PostCommentLikeResult> {
  void postId;
  void commentId;
  const action = req.action ?? req.value;
  if (!action) throw new ApiError(400, "action (like|dislike|none) is required");
  throw unsupported("Liking comments on YouTube community posts");
}

// ---------------------------------------------------------------------------
// post create (the creator composer)
// ---------------------------------------------------------------------------

export interface PostCreateResult {
  ok: true;
  effect: string;
  /** the write's verification state (never reached on the unsupported lane) */
  verified?: boolean;
  path?: string;
  note?: string;
}

/**
 * Create a community post — the HONEST UNSUPPORTED lane. The composer's
 * request validation (text/image/poll presence, the 2-5 poll option law) is
 * kept so the route's 400s stay honest; the write itself has no official
 * end-user API, so it never happens here.
 */
export async function proxyPostCreate(input: {
  handle: string;
  channelId?: string;
  text: string;
  imageUrl?: string;
  pollOptions?: string[];
}): Promise<PostCreateResult> {
  void input.handle;
  void input.channelId;
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
  throw unsupported("Creating YouTube community posts");
}
