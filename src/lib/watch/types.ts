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
  /** null when upstream carries no duration (watch metadata comes from `next`, which has none) */
  durationSec: number | null;
  views: number;
  /** live passthroughs */
  viewsText?: string | null;
  publishedText?: string | null;
  likeCountText?: string | null;
  badges?: string[];
  likes: number;
  dislikes: number;
  visibility: "public" | "unlisted" | "private";
  category: string;
  /** approx date derived from the real relative-age text */
  createdAt: string | null;
  isMembersOnly: boolean;
  membersTier: string | null;
  isShort: boolean;
  isLive: boolean;
  premieredAt: string | null;
  channel: ChannelDto & { subscriberCountText?: string | null };
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
  /** WFX2-P7-AN: the viewer's lifetime watchedSec on THIS video (null when no ViewEvent) */
  watchedSec: number | null;
}

export interface VideoDetailDto {
  video: VideoDto;
  state: ViewerVideoState;
}

// ---- Task 2-c: playback fallback DTOs (the embed-wall chain) ----

/**
 * A server-usable progressive stream format (muxed audio+video, itag 18/22
 * preferred). Only formats with a PLAIN `url` (no signatureCipher) are
 * surfaced — deciphering is out of scope, honestly empty otherwise.
 * The URL points at googlevideo.com and is played through /api/stream
 * (same-origin proxy with Range passthrough).
 */
export interface StreamFormatDto {
  itag: number;
  /** the googlevideo.com videoplayback URL (server-fetched, IP-bound) */
  url: string;
  mimeType: string;
  qualityLabel: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  contentLength: string | null;
  approxDurationMs: number | null;
  /** muxed audio track present (progressive formats only) */
  hasAudio: boolean;
}

/**
 * One animatable storyboard level (parsed from the player response's
 * `storyboards.playerStoryboardSpecRenderer.spec`, Invidious-style).
 * `templateUrl` carries a literal `$N` placeholder — sheet k is
 * `templateUrl.replace("$N", "M" + k)` (0 ≤ k < sheetCount); each sheet is a
 * `cols × rows` grid of `frameWidth × frameHeight` frames, frame i covering
 * `i * intervalMs` of the video. The "default" single-sheet level is skipped
 * (no sequence to animate).
 */
export interface StoryboardLevelDto {
  level: number;
  templateUrl: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  intervalMs: number;
  frameCount: number;
  sheetCount: number;
}

/**
 * GET /api/videos/[id]/playback — the server-side player-response chain
 * (innertube `player` over the client chain — INNER_TUBE_PLAYER_CLIENT
 * (default WEB) then IOS — then the watch page's embedded
 * ytInitialPlayerResponse). Empty arrays = the egress could not get a
 * playable response (walled) — the honest degrade.
 */
export interface PlaybackDto {
  streamFormats: StreamFormatDto[];
  storyboards: StoryboardLevelDto[];
  /** videoDetails.lengthSeconds when the response carried it */
  durationSec: number | null;
  /** which chain rung produced the payload ("" = none served) */
  source: "player" | "watch-page" | "";
}

// ---- WFX2-P7-AN: watch insights DTOs (the /api/watch/insights payload) ----

export interface InsightsTotalsDto {
  /** lifetime sum of ViewEvent.watchedSec */
  watchedSecAllTime: number;
  /** ViewEvent rows = distinct videos watched */
  videosWatched: number;
  /** WatchDailyStat rows with sec > 0 */
  activeDays: number;
  /** watchedSecAllTime / activeDays (0 when no active days) */
  avgSecPerActiveDay: number;
  /** consecutive active days (sec>0) ending today or yesterday, UTC */
  streakDays: number;
}

export interface SeriesPointDto {
  /** "YYYY-MM-DD" UTC */
  day: string;
  sec: number;
}

export interface InsightsTopVideoDto {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  watchedSec: number;
  lastWatchedAt: string;
}

export interface InsightsDto {
  totals: InsightsTotalsDto;
  /** 28 UTC days, oldest first, gap days zero-filled (real zeros) */
  series28d: SeriesPointDto[];
  /** top 10 by lifetime watchedSec (Video-less ViewEvents skipped) */
  topVideos: InsightsTopVideoDto[];
}

export interface RelatedVideoDto {
  id: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number | null;
  views: number;
  viewsText?: string | null;
  publishedText?: string | null;
  createdAt: string | null;
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
  /** live like-count passthrough, e.g. "321K" */
  likesText?: string | null;
  heartedByCreator: boolean;
  pinned: boolean;
  edited: boolean;
  moderation: string;
  createdAt: string | null;
  /** live passthrough, e.g. "1 year ago" / "6 years ago (edited)" */
  publishedText?: string | null;
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
  /** live: continuation token for this thread's replies */
  repliesToken?: string | null;
  /**
   * WFX2-P6-CR: live replyParams — the toolbar surface mutation's
   * replyCommand → createCommentEndpoint.createCommentParams (the direct
   * reply rung's wire parameter). Null when YouTube serves the sign-in
   * modal instead (session expired) or the payload carries none.
   */
  replyParams?: string | null;
  /**
   * WFX2-P6-CR: true when the row lives in the honest WebFlix store (the
   * local rung) — NOT posted to YouTube. The UI discloses the origin.
   */
  local?: boolean;
}

/**
 * WFX2-P6-CR — the watch payload's video snapshot the composer forwards so
 * the local rung can mirror the real YouTube video/channel as shadow rows
 * (honest mirror: the real id/title/channel, marked public).
 */
export interface CommentVideoSnapshotDto {
  title?: string;
  channelId?: string;
  channelHandle?: string;
  channelName?: string;
  channelAvatarUrl?: string;
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
