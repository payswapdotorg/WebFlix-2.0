import { z } from "zod";

/** WFX2-W request validators (zod). */

export const likeValueSchema = z.enum(["like", "dislike"]);
export const bellSchema = z.enum(["all", "personalized", "none", "off"]);

export const videoLikeBodySchema = z.object({
  value: likeValueSchema,
});

export const progressBodySchema = z.object({
  watchedSec: z.number().int().min(0).max(86_400),
  lastPositionSec: z.number().int().min(0).max(86_400),
});

export const subscriptionBodySchema = z.object({
  channelId: z.string().min(1),
  bell: bellSchema.optional(),
});

export const commentCreateBodySchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(5000),
  parentId: z.string().min(1).optional(),
});

export const commentEditBodySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/** WFX2-B-S live comment-write shapes (YouTube's 10,000-char comment limit). */
export const commentWriteBodySchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(10_000),
  videoId: z.string().min(1),
  /** the comment's CURRENT text — the broker's DOM locator (⋮ → Edit) */
  commentText: z.string().min(1).optional(),
});

export const commentDeleteBodySchema = z.object({
  videoId: z.string().min(1),
  commentText: z.string().min(1).optional(),
});

export const commentLikeBodySchema = z.object({
  value: likeValueSchema,
});

export const reportBodySchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const playlistCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(150),
  visibility: z.enum(["private", "public", "unlisted"]).default("private"),
});

export const playlistItemBodySchema = z.object({
  videoId: z.string().min(1),
});

export const commentsQuerySchema = z.object({
  sort: z.enum(["top", "new"]).default("top"),
  cursor: z.string().optional(),
  parentId: z.string().min(1).optional(),
});

export const relatedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(24).default(8),
});
