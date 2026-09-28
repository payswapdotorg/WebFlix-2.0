/**
 * WFX2-W like service.
 *
 * Video like/dislike — YouTube toggle semantics:
 *   like → like    = unset
 *   like → dislike = swap
 *   dislike → dislike = unset
 *   none → like|dislike = set
 * Aggregates (Video.likes / Video.dislikes) are updated transactionally with
 * the VideoLike rows so counts are always honest.
 *
 * Comment likes — YouTube shows only the like count; dislikes are a
 * stateless personal signal (no aggregate). Same toggle semantics for
 * your-state.
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import type { LikeValue, LikeResultDto, CommentLikeResultDto } from "./types";

export async function setVideoLike(
  videoId: string,
  userId: string,
  value: LikeValue
): Promise<LikeResultDto> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, likes: true, dislikes: true },
  });
  if (!video) throw notFound("Video");

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.videoLike.findUnique({
      where: { videoId_userId: { videoId, userId } },
    });

    if (existing && existing.value === value) {
      // same value → unset
      await tx.videoLike.delete({ where: { id: existing.id } });
      const updated = await tx.video.update({
        where: { id: videoId },
        data: value === "like" ? { likes: { decrement: 1 } } : { dislikes: { decrement: 1 } },
        select: { likes: true, dislikes: true },
      });
      return { likes: updated.likes, dislikes: updated.dislikes, yourLike: null };
    }

    if (existing) {
      // other value → swap
      await tx.videoLike.update({ where: { id: existing.id }, data: { value } });
      const updated = await tx.video.update({
        where: { id: videoId },
        data:
          value === "like"
            ? { likes: { increment: 1 }, dislikes: { decrement: 1 } }
            : { likes: { decrement: 1 }, dislikes: { increment: 1 } },
        select: { likes: true, dislikes: true },
      });
      return { likes: updated.likes, dislikes: updated.dislikes, yourLike: value };
    }

    // none → set
    await tx.videoLike.create({ data: { videoId, userId, value } });
    const updated = await tx.video.update({
      where: { id: videoId },
      data: value === "like" ? { likes: { increment: 1 } } : { dislikes: { increment: 1 } },
      select: { likes: true, dislikes: true },
    });
    return { likes: updated.likes, dislikes: updated.dislikes, yourLike: value };
  });

  return result;
}

export async function setCommentLike(
  commentId: string,
  userId: string,
  value: LikeValue
): Promise<CommentLikeResultDto> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, likes: true, moderation: true },
  });
  if (!comment || comment.moderation === "deleted") throw notFound("Comment");

  return db.$transaction(async (tx) => {
    const existing = await tx.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (existing && existing.value === value) {
      await tx.commentLike.delete({ where: { id: existing.id } });
      let likes = comment.likes;
      if (value === "like") {
        const updated = await tx.comment.update({
          where: { id: commentId },
          data: { likes: { decrement: 1 } },
          select: { likes: true },
        });
        likes = updated.likes;
      }
      return { likes, yourLike: null };
    }

    if (existing) {
      await tx.commentLike.update({ where: { id: existing.id }, data: { value } });
      const delta = value === "like" ? 1 : -1; // dislike swap removes a like
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likes: { increment: delta } },
        select: { likes: true },
      });
      return { likes: updated.likes, yourLike: value };
    }

    await tx.commentLike.create({ data: { commentId, userId, value } });
    let likes = comment.likes;
    if (value === "like") {
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likes: { increment: 1 } },
        select: { likes: true },
      });
      likes = updated.likes;
    }
    return { likes, yourLike: value };
  });
}
