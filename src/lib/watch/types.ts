/**
 * WFX2-W watch domain — shared DTO types (API payloads + client state).
 * All timestamps serialize as ISO strings.
 */

export type LikeValue = "like" | "dislike";
export type BellValue = "all" | "personalized" | "none";

export interface ChannelDto {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  subscriberCount: number;
  verified: boolean;
}

export interface VideoDto {
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
  createdAt: string;
  channel: ChannelDto;
}

export interface ViewerVideoState {
  /** null | current like state of the viewer */
  like: LikeValue | null;
  subscribed: boolean;
  bell: BellValue | null;
  /** resume position (lastPositionSec) if the viewer has watch history */
  resumeSec: number | null;
  /** viewer's playlists containing this video */
  playlistIds: string[];
  savedWatchLater: boolean;
  /** viewer owns this video's channel (creator powers: heart/pin) */
  isCreator: boolean;
}

export interface VideoDetailDto {
  video: VideoDto;
  state: ViewerVideoState;
}

export interface RelatedVideoDto {
  id: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  views: number;
  createdAt: string;
  channel: { id: string; handle: string; name: string; avatarUrl: string; verified: boolean };
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CommentAuthorDto {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  /** member of the video's channel (member badge variant) */
  isMember: boolean;
  /** author is the channel owner (creator comment) */
  isCreator: boolean;
}

export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  likes: number;
  heartedByCreator: boolean;
  pinned: boolean;
  edited: boolean;
  moderation: string;
  createdAt: string;
  author: CommentAuthorDto;
  yourLike: LikeValue | null;
  isOwn: boolean;
  /** direct reply count */
  replyCount: number;
  /** total descendants (the "N replies" expander label for top-level) */
  totalReplyCount: number;
  /** first page of direct replies (only on top-level payloads) */
  replies?: CommentDto[];
  replyNextCursor?: string | null;
}

export interface CommentsPageDto extends PageDto<CommentDto> {
  /** total approved comments incl. replies (the header count, honest from DB) */
  total: number;
}

export interface TranscriptCueDto {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface PlaylistDto {
  id: string;
  name: string;
  isWatchLater: boolean;
  visibility: string;
  itemCount: number;
  containsVideo: boolean;
}

export interface ViewerDto {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}

export interface LikeResultDto {
  likes: number;
  dislikes: number;
  yourLike: LikeValue | null;
}

export interface CommentLikeResultDto {
  likes: number;
  yourLike: LikeValue | null;
}

export interface SubscriptionResultDto {
  subscribed: boolean;
  bell: BellValue | null;
  subscriberCount: number;
}

export interface ProgressResultDto {
  watchedSec: number;
  lastPositionSec: number;
}
