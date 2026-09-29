/** Shared DTO types — the contract between API routes and client components. */

export type ChannelLite = {
  id: string;
  /** "@handle" or "UC…" — both resolve through /api/channel/[handle] */
  handle: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
  /** parsed from the real subscriber text (approx when abbreviated, e.g. "4.55M") */
  subscriberCount: number;
  /** live passthrough, e.g. "4.55M subscribers" */
  subscriberCountText?: string | null;
};

export type VideoDTO = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  /** null when the upstream response carries no duration (live streams, shorts cards) */
  durationSec: number | null;
  views: number;
  /** live passthrough, e.g. "1,821,187,782 views" / "1.8B views" */
  viewsText?: string | null;
  /** live passthrough, e.g. "16 years ago" */
  publishedText?: string | null;
  likes: number;
  dislikes: number;
  visibility: "public" | "unlisted" | "private";
  isMembersOnly: boolean;
  membersTier: string | null;
  category: string;
  isShort: boolean;
  isLive: boolean;
  premieredAt: string | null;
  /** null when the upstream response carries no publish date (approx from publishedText otherwise) */
  createdAt: string | null;
  /** live badge passthrough, e.g. ["verified_artist"] */
  badges?: string[];
  channel: ChannelLite;
};

/** Video + where you left off (continue watching / history). */
export type ContinueVideoDTO = VideoDTO & {
  watchedSec: number;
  watchedAt: string;
};

export type HomeFeedDTO = {
  hero: VideoDTO | null;
  trending: VideoDTO[];
  continueWatching: ContinueVideoDTO[];
  becauseYouWatched: { label: string; videos: VideoDTO[] } | null;
  shorts: VideoDTO[];
  recommended: VideoDTO[];
  recommendedCursor: string | null;
  chips: string[];
};

export type VideoPageDTO = {
  videos: VideoDTO[];
  nextCursor: string | null;
};

export type NotificationDTO = {
  id: string;
  kind: "video" | "live" | "post" | "reply";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  videoId: string | null;
  videoThumbnailUrl: string | null;
  channel: ChannelLite;
};

export type MeDTO = {
  user: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string;
    description: string | null;
  };
  ownedChannel: { handle: string; name: string } | null;
  subscriptions: (ChannelLite & { bell: "off" | "personalized" | "all" })[];
};

export type PlaylistDTO = {
  id: string;
  title: string;
  visibility: "public" | "unlisted" | "private";
  isWatchLater: boolean;
  createdAt: string;
  videoCount: number;
  coverUrl: string | null;
  videos: VideoDTO[];
};

export type CommentDTO = {
  id: string;
  body: string;
  likes: number;
  likesText?: string | null;
  heartedByCreator: boolean;
  pinned: boolean;
  createdAt: string | null;
  publishedText?: string | null;
  author: { handle: string; name: string; avatarUrl: string };
  replyCount: number;
};

export type ChannelPageDTO = {
  channel: ChannelLite & {
    bannerUrl: string | null;
    description: string | null;
    /** live channel responses carry no join date (about tab — Wave B) */
    createdAt: string | null;
    isSubscribed: boolean;
    isOwner: boolean;
    videoCount: number;
  };
  videos: VideoDTO[];
  shorts: VideoDTO[];
};

export type WatchPageDTO = {
  video: VideoDTO;
  isSubscribed: boolean;
  isOwner: boolean;
  memberTierName: string | null;
  related: VideoDTO[];
  comments: CommentDTO[];
};

export type StudioDTO = {
  channel: ChannelLite & {
    bannerUrl: string | null;
    description: string | null;
    createdAt: string;
  };
  totals: { views: number; likes: number; videos: number; comments: number };
  videos: (VideoDTO & { commentCount: number })[];
};

export type SearchPageDTO = {
  query: string;
  videos: VideoDTO[];
  channels: ChannelLite[];
};

export type HistoryGroupDTO = {
  label: string;
  items: ContinueVideoDTO[];
};

export type SubscriptionsPageDTO = {
  channels: ChannelLite[];
  videos: VideoDTO[];
};

export type TrendingPageDTO = {
  category: string;
  videos: VideoDTO[];
};

export type ShortsPageDTO = {
  shorts: VideoDTO[];
};
