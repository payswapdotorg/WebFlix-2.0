/**
 * WFX2-W video service — watch-page data, view counting (deduped per
 * user+video per hour), and the related rail.
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import { pageSlice, decodeCursor } from "./pagination";
import type {
  VideoDetailDto,
  VideoDto,
  RelatedVideoDto,
  PageDto,
  LikeValue,
  BellValue,
} from "./types";

export const VIEW_DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function toVideoDto(v: {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  views: number;
  likes: number;
  dislikes: number;
  visibility: string;
  category: string;
  createdAt: Date;
  channel: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string;
    subscriberCount: number;
    verified: boolean;
  };
}): VideoDto {
  return {
    ...v,
    createdAt: v.createdAt.toISOString(),
    channel: { ...v.channel },
  };
}

/** Full watch payload: video + viewer engagement state. */
export async function getVideoDetail(
  videoId: string,
  viewerId: string
): Promise<VideoDetailDto> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      channel: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          subscriberCount: true,
          verified: true,
          ownerUserId: true,
        },
      },
    },
  });
  if (!video || video.visibility === "private") throw notFound("Video");

  const [like, subscription, viewEvent, playlistItems] = await Promise.all([
    db.videoLike.findUnique({
      where: { videoId_userId: { videoId, userId: viewerId } },
      select: { value: true },
    }),
    db.subscription.findUnique({
      where: { channelId_userId: { channelId: video.channelId, userId: viewerId } },
      select: { bell: true },
    }),
    db.viewEvent.findUnique({
      where: { videoId_userId: { videoId, userId: viewerId } },
      select: { lastPositionSec: true },
    }),
    db.playlistItem.findMany({
      where: { videoId, playlist: { userId: viewerId } },
      select: { playlistId: true, playlist: { select: { isWatchLater: true } } },
    }),
  ]);

  const savedWatchLater = playlistItems.some((p) => p.playlist.isWatchLater);

  return {
    video: toVideoDto(video),
    state: {
      like: (like?.value as LikeValue) ?? null,
      subscribed: subscription !== null,
      bell: (subscription?.bell as BellValue) ?? null,
      resumeSec: viewEvent?.lastPositionSec ?? null,
      playlistIds: playlistItems.map((p) => p.playlistId),
      savedWatchLater,
      isCreator: video.channel.ownerUserId === viewerId,
    },
  };
}

/**
 * Register a view. Deduped per user+video per hour: the ViewEvent's `at`
 * anchors the window (progress saves never bump it).
 */
export async function registerView(
  videoId: string,
  viewerId: string,
  now: Date = new Date()
): Promise<{ counted: boolean; views: number }> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, views: true },
  });
  if (!video) throw notFound("Video");

  const existing = await db.viewEvent.findUnique({
    where: { videoId_userId: { videoId, userId: viewerId } },
  });

  if (!existing) {
    const [, updated] = await db.$transaction([
      db.viewEvent.create({
        data: { videoId, userId: viewerId, at: now, watchedSec: 0, lastPositionSec: 0 },
      }),
      db.video.update({ where: { id: videoId }, data: { views: { increment: 1 } } }),
    ]);
    return { counted: true, views: updated.views };
  }

  if (now.getTime() - existing.at.getTime() >= VIEW_DEDUPE_WINDOW_MS) {
    const [, updated] = await db.$transaction([
      db.viewEvent.update({ where: { id: existing.id }, data: { at: now } }),
      db.video.update({ where: { id: videoId }, data: { views: { increment: 1 } } }),
    ]);
    return { counted: true, views: updated.views };
  }

  return { counted: false, views: video.views };
}

/**
 * Related rail: same category first, then views desc, excluding the current
 * video, private videos, and the viewer's "not interested" signals.
 */
export async function getRelated(
  videoId: string,
  viewerId: string,
  cursor?: string,
  limit = 8
): Promise<PageDto<RelatedVideoDto>> {
  const current = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, category: true },
  });
  if (!current) throw notFound("Video");

  const offset = decodeCursor(cursor);
  if (offset === null) throw notFound("Cursor");

  const hidden = await db.videoSignal.findMany({
    where: { userId: viewerId, kind: "not_interested" },
    select: { videoId: true },
  });
  const hiddenIds = hidden.map((h) => h.videoId);

  const rows = await db.video.findMany({
    where: {
      AND: [
        { id: { not: videoId } },
        { visibility: { in: ["public", "unlisted"] } },
        ...(hiddenIds.length ? [{ id: { notIn: hiddenIds } }] : []),
      ],
    },
    orderBy: [{ views: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    include: {
      channel: { select: { id: true, handle: true, name: true, avatarUrl: true, verified: true } },
    },
  });

  // same category first (stable within group: views desc from the query)
  const ranked = [
    ...rows.filter((r) => r.category === current.category),
    ...rows.filter((r) => r.category !== current.category),
  ];

  const { items, nextCursor } = pageSlice(ranked, offset, limit);
  return {
    items: items.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      durationSec: r.durationSec,
      views: r.views,
      createdAt: r.createdAt.toISOString(),
      channel: { ...r.channel },
    })),
    nextCursor,
  };
}

/** Report a video → review queue (YouTube: reporting does not hide a video). */
export async function reportVideo(videoId: string, userId: string, reason: string) {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");
  await db.videoReport.upsert({
    where: { videoId_userId: { videoId, userId } },
    create: { videoId, userId, reason },
    update: { reason },
  });
  await db.video.update({ where: { id: videoId }, data: { moderation: "flagged" } });
  return { reported: true };
}

/** "Not interested" — hides the video from this viewer's related rail. */
export async function markNotInterested(videoId: string, userId: string) {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");
  await db.videoSignal.upsert({
    where: { videoId_userId: { videoId, userId } },
    create: { videoId, userId, kind: "not_interested" },
    update: { kind: "not_interested" },
  });
  return { notInterested: true };
}
