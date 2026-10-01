import { z } from "zod";
import type { ChannelInfo, CommentState, NormalizedComment, NormalizedPost, NormalizedVideo, VideoKind, Visibility } from "./types";

const count = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  });

export const MainChannelSchema = z
  .object({
    id: z.string().optional(),
    handle: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    thumbnail: z.string().optional().nullable(),
    avatarUrl: z.string().optional().nullable(),
    bannerUrl: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    subscriberCount: count.optional(),
    videoCount: count.optional(),
    viewCount: count.optional(),
  })
  .passthrough();

export const MainVideoSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    kind: z.enum(["video", "short", "live"]).optional(),
    isShort: z.boolean().optional(),
    isLive: z.boolean().optional(),
    thumbnail: z.string().optional().nullable(),
    thumbnailUrl: z.string().optional().nullable(),
    publishedAt: z.string().optional(),
    publishDate: z.string().optional(),
    viewCount: count.optional(),
    likeCount: count.optional(),
    commentCount: count.optional(),
    visibility: z.string().optional(),
    privacy: z.string().optional(),
    status: z.string().optional(),
    durationSeconds: count.optional(),
    duration: z.string().optional(),
  })
  .passthrough();

export const MainPostSchema = z
  .object({
    id: z.string(),
    text: z.string().optional(),
    content: z.string().optional(),
    publishedAt: z.string().optional(),
    createdAt: z.string().optional(),
    likeCount: count.optional(),
    commentCount: count.optional(),
  })
  .passthrough();

export const MainCommentSchema = z
  .object({
    id: z.string(),
    videoId: z.string().optional(),
    text: z.string().optional(),
    content: z.string().optional(),
    author: z.union([z.string(), z.object({ name: z.string().optional(), displayName: z.string().optional(), avatar: z.string().optional().nullable() }).passthrough()]).optional(),
    publishedAt: z.string().optional(),
    createdAt: z.string().optional(),
    state: z.string().optional(),
    likes: count.optional(),
    hearted: z.boolean().optional(),
  })
  .passthrough();

export type MainVideo = z.infer<typeof MainVideoSchema>;

// Upstream envelopes vary (bare array | {videos|items|rows|comments|posts}).
export function asArray(json: unknown, fields: string[]): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const f of fields) {
      const arr = o[f];
      if (Array.isArray(arr)) return arr;
    }
  }
  return [];
}
export const parseVideos = (json: unknown): MainVideo[] =>
  asArray(json, ["videos", "items", "rows"])
    .map((v) => MainVideoSchema.safeParse(v))
    .filter((r): r is z.SafeParseSuccess<MainVideo> => r.success)
    .map((r) => r.data);
export const parsePosts = (json: unknown): z.infer<typeof MainPostSchema>[] =>
  asArray(json, ["posts", "items"])
    .map((v) => MainPostSchema.safeParse(v))
    .filter((r): r is z.SafeParseSuccess<z.infer<typeof MainPostSchema>> => r.success)
    .map((r) => r.data);
export const parseComments = (json: unknown): z.infer<typeof MainCommentSchema>[] =>
  asArray(json, ["comments", "items"])
    .map((v) => MainCommentSchema.safeParse(v))
    .filter((r): r is z.SafeParseSuccess<z.infer<typeof MainCommentSchema>> => r.success)
    .map((r) => r.data);

export function parseDuration(iso: string | null | undefined): number | null {
  if (!iso || !/^P/.test(iso)) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  const d = Number(m[1] ?? 0), h = Number(m[2] ?? 0), min = Number(m[3] ?? 0), s = Number(m[4] ?? 0);
  return Math.round(d * 86400 + h * 3600 + min * 60 + s);
}

export function normalizeVideo(raw: unknown): NormalizedVideo | null {
  const p = MainVideoSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  if (!d.id) return null;
  const kind: VideoKind = d.kind ?? (d.isShort ? "short" : d.isLive ? "live" : "video");
  const visRaw = (d.visibility ?? d.privacy ?? d.status ?? "public").toString().toLowerCase();
  const visibility: Visibility = visRaw.includes("unlist") ? "unlisted" : visRaw.includes("private") ? "private" : "public";
  return {
    id: d.id,
    title: d.title && d.title.length > 0 ? d.title : "(untitled)",
    kind,
    thumbnailUrl: d.thumbnailUrl ?? d.thumbnail ?? null,
    publishedAt: d.publishedAt ?? d.publishDate ?? null,
    views: d.viewCount ?? 0,
    likes: d.likeCount ?? 0,
    comments: d.commentCount ?? 0,
    visibility,
    restrictions: "none", // honest: no restriction signals exist in main-app data yet
    durationSeconds: d.durationSeconds ?? parseDuration(d.duration),
  };
}

export function normalizeChannel(rawUnknown: unknown): ChannelInfo | null {
  let raw = rawUnknown;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const wrapper = o.channel ?? o.operator ?? o.data;
    // unwrap one level when the payload is a wrapper object (e.g. /api/studio
    // returns {channel: {...}}) — the channel object may sit anywhere.
    if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) raw = wrapper;
  }
  const p = MainChannelSchema.safeParse(raw);
  if (!p.success) return null;
  const c = p.data;
  if (!c.id && !c.handle && !c.title && !c.name) return null;
  return {
    id: c.id ?? null,
    handle: c.handle ?? (c.id ? `@${c.id}` : ""),
    title: c.title ?? c.name ?? "Operator channel",
    avatarUrl: c.avatarUrl ?? c.thumbnail ?? null,
    bannerUrl: c.bannerUrl ?? null,
    description: c.description ?? null,
    subscriberCount: c.subscriberCount ?? null,
    videoCount: c.videoCount ?? null,
  };
}

export function normalizeComment(raw: unknown): NormalizedComment | null {
  const p = MainCommentSchema.safeParse(raw);
  if (!p.success) return null;
  const c = p.data;
  if (!c.id) return null;
  const author = typeof c.author === "string" ? c.author : c.author?.displayName ?? c.author?.name ?? "Unknown";
  const stateRaw = (c.state ?? "").toLowerCase();
  const state: CommentState =
    stateRaw.includes("spam") ? "likelySpam"
    : stateRaw.includes("held") || stateRaw.includes("pending") || stateRaw.includes("review") ? "heldForReview"
    : "published";
  return {
    id: c.id,
    videoId: c.videoId ?? null,
    videoTitle: null, // enriched by the route once video titles are known
    text: c.text ?? c.content ?? "",
    authorName: author,
    authorAvatar: typeof c.author === "object" ? c.author?.avatar ?? null : null,
    publishedAt: c.publishedAt ?? c.createdAt ?? null,
    state,
    likes: c.likes ?? 0,
    hearted: c.hearted ?? false,
  };
}

export function normalizePost(raw: unknown): NormalizedPost | null {
  const p = MainPostSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  if (!d.id) return null;
  return { id: d.id, text: d.text ?? d.content ?? "", publishedAt: d.publishedAt ?? d.createdAt ?? null };
}

export function byPublishedDesc(a: { publishedAt: string | null }, b: { publishedAt: string | null }): number {
  return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
}

export interface DashboardCards { latestVideo: NormalizedVideo | null; recentVideos: NormalizedVideo[]; latestPost: NormalizedPost | null }
export function buildDashboard(videos: NormalizedVideo[], posts: NormalizedPost[]): DashboardCards {
  const sorted = [...videos].sort(byPublishedDesc);
  return { latestVideo: sorted[0] ?? null, recentVideos: sorted.slice(0, 5), latestPost: posts[0] ?? null };
}
