export type VideoKind = "video" | "short" | "live";
export type Visibility = "public" | "unlisted" | "private";
export type CommentState = "published" | "heldForReview" | "likelySpam";

export interface NormalizedVideo {
  id: string; title: string; kind: VideoKind; thumbnailUrl: string | null;
  publishedAt: string | null; views: number; likes: number; comments: number;
  visibility: Visibility; restrictions: "none"; durationSeconds: number | null;
}
export interface NormalizedPost { id: string; text: string; publishedAt: string | null }
export interface NormalizedComment {
  id: string; videoId: string | null; videoTitle: string | null; text: string;
  authorName: string; authorAvatar: string | null; publishedAt: string | null;
  state: CommentState; likes: number; hearted: boolean;
}
export interface ChannelInfo {
  id: string | null; handle: string; title: string;
  avatarUrl: string | null; bannerUrl: string | null; description: string | null;
  subscriberCount: number | null; videoCount: number | null;
}
export interface SeriesPoint { date: string; views: number; likes: number; comments: number; uploads: number }
export interface Totals { views: number; likes: number; comments: number; uploads: number; estWatchHours: number | null }
