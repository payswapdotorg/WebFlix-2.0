/**
 * WFX2-W comment service.
 *
 * - Sort: "Top comments" (pinned first, then likes desc) / "Newest" (pinned
 *   first, then createdAt desc) — YouTube keeps the pinned comment on top
 *   in both modes.
 * - Default view hides flagged and soft-deleted comments.
 * - Reply threads: one nested level rendered; deeper levels collapse behind
 *   "N replies" expanders (any depth supported via parentId pagination).
 * - Creator heart/pin: only the video channel's owner.
 * - Delete: soft (moderation=deleted) with restore for the undo toast.
 */
import { db } from "@/lib/db";
import { notFound, forbidden, badRequest } from "./api";
import { pageSlice, decodeCursor, encodeCursor } from "./pagination";
import type { CommentDto, CommentsPageDto, CommentAuthorDto, LikeValue, PageDto } from "./types";

const DEFAULT_PAGE = 10;
const REPLY_PAGE = 10;
const INLINE_REPLIES = 3;

type CommentRow = {
  id: string;
  videoId: string;
  parentId: string | null;
  userId: string;
  body: string;
  likes: number;
  heartedByCreator: boolean;
  pinned: boolean;
  moderation: string;
  edited: boolean;
  createdAt: Date;
  user: { id: string; handle: string; name: string; avatarUrl: string };
};

interface CommentContext {
  videoId: string;
  channelId: string;
  creatorUserId: string | null;
  memberUserIds: Set<string>;
  viewerId: string;
  viewerLikes: Map<string, LikeValue>;
}

function toDto(
  row: CommentRow,
  ctx: CommentContext,
  replyCount: number,
  totalReplyCount: number
): CommentDto {
  const author: CommentAuthorDto = {
    id: row.user.id,
    handle: row.user.handle,
    name: row.user.name,
    avatarUrl: row.user.avatarUrl,
    isMember: ctx.memberUserIds.has(row.userId),
    isCreator: row.userId === ctx.creatorUserId,
  };
  return {
    id: row.id,
    parentId: row.parentId,
    body: row.body,
    likes: row.likes,
    heartedByCreator: row.heartedByCreator,
    pinned: row.pinned,
    edited: row.edited,
    moderation: row.moderation,
    createdAt: row.createdAt.toISOString(),
    author,
    yourLike: ctx.viewerLikes.get(row.id) ?? null,
    isOwn: row.userId === ctx.viewerId,
    replyCount,
    totalReplyCount,
  };
}

async function loadContext(videoId: string, viewerId: string): Promise<{
  channelId: string;
  creatorUserId: string | null;
  memberUserIds: Set<string>;
  visible: CommentRow[];
  viewerLikes: Map<string, LikeValue>;
}> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, channelId: true, channel: { select: { ownerId: true } } },
  });
  if (!video) throw notFound("Video");

  const [visible, memberships, viewerLikes] = await Promise.all([
    db.comment.findMany({
      where: { videoId, moderation: "approved" },
      include: { user: { select: { id: true, handle: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.membership.findMany({
      where: { tier: { channelId: video.channelId } },
      select: { userId: true },
    }),
    db.commentLike.findMany({
      where: { userId: viewerId, comment: { videoId } },
      select: { commentId: true, value: true },
    }),
  ]);

  return {
    channelId: video.channelId,
    creatorUserId: video.channel.ownerId,
    memberUserIds: new Set(memberships.map((m) => m.userId)),
    visible,
    viewerLikes: new Map(viewerLikes.map((l) => [l.commentId, l.value as LikeValue])),
  };
}

/** Count direct replies + total descendants per comment id. */
function buildCounts(visible: CommentRow[]): {
  children: Map<string, CommentRow[]>;
  direct: Map<string, number>;
  totals: Map<string, number>;
} {
  const children = new Map<string, CommentRow[]>();
  for (const row of visible) {
    if (row.parentId === null) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  const direct = new Map<string, number>();
  const totals = new Map<string, number>();
  const totalOf = (id: string, seen: Set<string>): number => {
    if (totals.has(id)) return totals.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    let n = 0;
    for (const child of children.get(id) ?? []) {
      n += 1 + totalOf(child.id, seen);
    }
    return n;
  };
  for (const row of visible) {
    direct.set(row.id, children.get(row.id)?.length ?? 0);
    totals.set(row.id, totalOf(row.id, new Set()));
  }
  return { children, direct, totals };
}

/**
 * List comments for a video.
 * - no parentId: top-level page (with first INLINE_REPLIES level-2 replies)
 * - parentId given: flat reply page under that comment (oldest first)
 */
export async function listComments(
  videoId: string,
  viewerId: string,
  sort: "top" | "new",
  cursor?: string
): Promise<CommentsPageDto>;
export async function listComments(
  videoId: string,
  viewerId: string,
  sort: "top" | "new",
  cursor: string | undefined,
  parentId: string
): Promise<PageDto<CommentDto>>;
export async function listComments(
  videoId: string,
  viewerId: string,
  sort: "top" | "new",
  cursor?: string,
  parentId?: string
): Promise<CommentsPageDto | PageDto<CommentDto>> {
  const offset = decodeCursor(cursor);
  if (offset === null) throw badRequest("Invalid cursor");

  const ctx = await loadContext(videoId, viewerId);
  const { children, direct, totals } = buildCounts(ctx.visible);

  const commentCtx: CommentContext = {
    videoId,
    channelId: ctx.channelId,
    creatorUserId: ctx.creatorUserId,
    memberUserIds: ctx.memberUserIds,
    viewerId,
    viewerLikes: ctx.viewerLikes,
  };

  // ---- reply page under a parent ----------------------------------------
  if (parentId) {
    const parent = ctx.visible.find((c) => c.id === parentId);
    if (!parent) throw notFound("Comment");
    const replies = children.get(parentId) ?? [];
    const { items, nextCursor } = pageSlice(replies, offset, REPLY_PAGE);
    return {
      items: items.map((r) =>
        toDto(r, commentCtx, direct.get(r.id) ?? 0, totals.get(r.id) ?? 0)
      ),
      nextCursor,
    };
  }

  // ---- top-level page ----------------------------------------------------
  const topLevel = ctx.visible.filter((c) => c.parentId === null);
  const sorted = [...topLevel].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "top") {
      if (b.likes !== a.likes) return b.likes - a.likes;
      return a.createdAt.getTime() - b.createdAt.getTime();
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const { items, nextCursor } = pageSlice(sorted, offset, DEFAULT_PAGE);
  const total = ctx.visible.length; // honest: approved comments incl. replies

  const dtos: CommentDto[] = items.map((row) => {
    const dto = toDto(row, commentCtx, direct.get(row.id) ?? 0, totals.get(row.id) ?? 0);
    const replies = children.get(row.id) ?? [];
    const first = replies.slice(0, INLINE_REPLIES);
    dto.replies = first.map((r) =>
      toDto(r, commentCtx, direct.get(r.id) ?? 0, totals.get(r.id) ?? 0)
    );
    dto.replyNextCursor =
      replies.length > INLINE_REPLIES ? encodeCursor(INLINE_REPLIES) : null;
    return dto;
  });

  return { items: dtos, nextCursor, total };
}

async function getCommentWithVideo(commentId: string) {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    include: {
      user: { select: { id: true, handle: true, name: true, avatarUrl: true } },
      video: { select: { id: true, channelId: true, channel: { select: { ownerId: true } } } },
    },
  });
  if (!comment || comment.moderation === "deleted") throw notFound("Comment");
  return comment;
}

/** Single comment DTO (used after create/edit/state changes). */
export async function getCommentDto(commentId: string, viewerId: string): Promise<CommentDto> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    include: { user: { select: { id: true, handle: true, name: true, avatarUrl: true } } },
  });
  if (!comment) throw notFound("Comment");

  const video = await db.video.findUnique({
    where: { id: comment.videoId },
    select: { channelId: true, channel: { select: { ownerId: true } } },
  });
  const [memberships, viewerLike, replyCount] = await Promise.all([
    video
      ? db.membership.findMany({ where: { tier: { channelId: video.channelId } }, select: { userId: true } })
      : Promise.resolve([]),
    db.commentLike.findUnique({
      where: { userId_commentId: { userId: viewerId, commentId } },
      select: { value: true },
    }),
    db.comment.count({ where: { parentId: commentId, moderation: "approved" } }),
  ]);

  const ctx: CommentContext = {
    videoId: comment.videoId,
    channelId: video?.channelId ?? "",
    creatorUserId: video?.channel.ownerId ?? null,
    memberUserIds: new Set(memberships.map((m) => m.userId)),
    viewerId,
    viewerLikes: new Map(viewerLike ? [[commentId, viewerLike.value as LikeValue]] : []),
  };
  return toDto(comment, ctx, replyCount, replyCount);
}

/** Create a comment (or reply). Moderation defaults to approved. */
export async function createComment(
  videoId: string,
  userId: string,
  body: string,
  parentId?: string
): Promise<CommentDto> {
  const trimmed = body.trim();
  if (!trimmed) throw badRequest("Comment cannot be empty");
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");
  if (parentId) {
    const parent = await db.comment.findUnique({
      where: { id: parentId },
      select: { id: true, videoId: true, moderation: true },
    });
    if (!parent || parent.moderation === "deleted") throw notFound("Parent comment");
    if (parent.videoId !== videoId) throw badRequest("Parent comment belongs to another video");
  }
  const created = await db.comment.create({
    data: { videoId, userId, body, parentId: parentId ?? null, moderation: "approved" },
  });
  return getCommentDto(created.id, userId);
}

/** Edit own comment (inline edit). */
export async function editComment(
  commentId: string,
  userId: string,
  body: string
): Promise<CommentDto> {
  const comment = await getCommentWithVideo(commentId);
  if (comment.userId !== userId) throw forbidden("You can only edit your own comments");
  await db.comment.update({ where: { id: commentId }, data: { body, edited: true } });
  return getCommentDto(commentId, userId);
}

/** Soft-delete own comment (undoable). */
export async function deleteComment(commentId: string, userId: string): Promise<{ deleted: boolean }> {
  const comment = await getCommentWithVideo(commentId);
  if (comment.userId !== userId) throw forbidden("You can only delete your own comments");
  await db.comment.update({ where: { id: commentId }, data: { moderation: "deleted" } });
  return { deleted: true };
}

/** Undo for the delete toast. */
export async function restoreComment(
  commentId: string,
  userId: string
): Promise<CommentDto> {
  const comment = await db.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw notFound("Comment");
  if (comment.userId !== userId) throw forbidden("You can only restore your own comments");
  if (comment.moderation !== "deleted") throw badRequest("Comment is not deleted");
  await db.comment.update({ where: { id: commentId }, data: { moderation: "approved" } });
  return getCommentDto(commentId, userId);
}

/** Report → flagged; disappears from the default (approved) view. */
export async function reportComment(commentId: string, userId: string): Promise<{ flagged: true }> {
  const comment = await db.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw notFound("Comment");
  await db.comment.update({ where: { id: commentId }, data: { moderation: "flagged" } });
  return { flagged: true };
}

/** Toggle the creator heart — only the video channel's owner. */
export async function heartComment(
  commentId: string,
  userId: string
): Promise<{ heartedByCreator: boolean }> {
  const comment = await getCommentWithVideo(commentId);
  if (comment.video.channel.ownerId !== userId) {
    throw forbidden("Only the creator can heart comments on their videos");
  }
  const updated = await db.comment.update({
    where: { id: commentId },
    data: { heartedByCreator: !comment.heartedByCreator },
  });
  return { heartedByCreator: updated.heartedByCreator };
}

/** Toggle pin — only the video channel's owner. */
export async function pinComment(
  commentId: string,
  userId: string
): Promise<{ pinned: boolean }> {
  const comment = await getCommentWithVideo(commentId);
  if (comment.video.channel.ownerId !== userId) {
    throw forbidden("Only the creator can pin comments on their videos");
  }
  const updated = await db.comment.update({
    where: { id: commentId },
    data: { pinned: !comment.pinned },
  });
  return { pinned: updated.pinned };
}
