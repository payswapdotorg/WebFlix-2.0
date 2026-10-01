import { kvMemoryClearForTests } from "@/lib/cache";

export function daysAgo(n: number): Date { return new Date(Date.now() - n * 86_400_000); }
export function iso(n: number): string { return daysAgo(n).toISOString(); }

export function useMemoryKv(): void {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
  kvMemoryClearForTests();
}

export const channelFixture = {
  id: "UC_operator",
  handle: "@operator",
  title: "WebFlix Operator",
  avatarUrl: "https://cdn.test/avatar.png",
  bannerUrl: "https://cdn.test/banner.png",
  description: "Operator channel",
  subscriberCount: 1200,
  videoCount: 5,
};

export const videosFixture = [
  { id: "v1", title: "Latest upload", kind: "video", publishedAt: iso(2), viewCount: 5000, likeCount: 400, commentCount: 32, visibility: "public", durationSeconds: 480 },
  { id: "v2", title: "Short one", isShort: true, publishedAt: iso(5), viewCount: "12000", likeCount: "900", commentCount: "15", visibility: "public", durationSeconds: 45 },
  { id: "v3", title: "Unlisted cut", publishedAt: iso(40), viewCount: 800, likeCount: 50, commentCount: 4, visibility: "unlisted", durationSeconds: 300 },
  { id: "v4", title: "Old private", publishedAt: iso(400), viewCount: 0, likeCount: 0, commentCount: 0, visibility: "private", durationSeconds: 600 },
  { id: "v5", title: "Live replay", isLive: true, publishedAt: iso(9), viewCount: 2200, likeCount: 180, commentCount: 21, visibility: "public", duration: "PT1H2M3S" },
];

export const commentsFixture = [
  { id: "c1", videoId: "v1", text: "Great video!", author: { name: "Ada" }, publishedAt: iso(1), state: "published", likes: 5 },
  { id: "c2", videoId: "v1", text: "Held one", author: "Ben", createdAt: iso(2), state: "heldForReview" },
  { id: "c3", videoId: "v2", text: "Spam link", author: { name: "Eve" }, publishedAt: iso(3), state: "likelySpam" },
  { id: "c4", videoId: "v2", text: "No state", author: { name: "Cy" }, publishedAt: iso(4) },
];
