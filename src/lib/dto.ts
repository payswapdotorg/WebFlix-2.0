import type { Channel, Video } from "@prisma/client";
import type { ChannelLite, ContinueVideoDTO, VideoDTO } from "./types";

type VideoWithChannel = Video & { channel: Channel };

/** Prisma row → wire DTO (dates become ISO strings). Pure, testable. */
export function toVideoDTO(v: VideoWithChannel): VideoDTO {
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    thumbnailUrl: v.thumbnailUrl,
    videoUrl: v.videoUrl,
    durationSec: v.durationSec,
    views: v.views,
    likes: v.likes,
    dislikes: v.dislikes,
    visibility: v.visibility as VideoDTO["visibility"],
    isMembersOnly: v.isMembersOnly,
    membersTier: v.membersTier,
    category: v.category,
    isShort: v.isShort,
    isLive: v.isLive,
    premieredAt: v.premieredAt ? v.premieredAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    channel: toChannelLite(v.channel),
  };
}

export function toChannelLite(c: Channel): ChannelLite {
  return {
    id: c.id,
    handle: c.handle,
    name: c.name,
    avatarUrl: c.avatarUrl,
    verified: c.verified,
    subscriberCount: c.subscriberCount,
  };
}

export function toContinueVideoDTO(
  v: VideoWithChannel,
  watchedSec: number,
  watchedAt: Date
): ContinueVideoDTO {
  return { ...toVideoDTO(v), watchedSec, watchedAt: watchedAt.toISOString() };
}

/** Continue-watching rule: >30s watched and not nearly finished (ZTube/YouTube rule). */
export function isUnfinishedWatch(watchedSec: number, durationSec: number): boolean {
  if (watchedSec <= 0 || durationSec <= 0) return false;
  return watchedSec > 30 && watchedSec < Math.max(31, durationSec - 5);
}
