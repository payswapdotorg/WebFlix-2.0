/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { GET as getHome } from "@/app/api/home/route";
import { GET as listVideosRoute } from "@/app/api/videos/route";
import { getHomeFeed } from "@/lib/queries";
import { isUnfinishedWatch } from "@/lib/dto";
import type { ContinueVideoDTO, HomeFeedDTO, VideoDTO, VideoPageDTO } from "@/lib/types";

/**
 * Home API shape — integration test against the real route handler and
 * the seeded SQLite database (bun test boots the same Prisma client).
 */
describe("GET /api/home — shape (every rail present + typed)", () => {
  test("responds 200 with every WebFlix rail in the payload", async () => {
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as HomeFeedDTO;

    expect(Array.isArray(feed.chips)).toBe(true);
    expect(feed.chips[0]).toBe("All");
    expect(feed.chips).toHaveLength(15);

    expect(feed.hero === null || typeof feed.hero.id === "string").toBe(true);
    expect(Array.isArray(feed.trending)).toBe(true);
    expect(Array.isArray(feed.continueWatching)).toBe(true);
    expect(Array.isArray(feed.shorts)).toBe(true);
    expect(Array.isArray(feed.recommended)).toBe(true);
    expect(feed.recommendedCursor === null || typeof feed.recommendedCursor === "string").toBe(true);
    expect(
      feed.becauseYouWatched === null ||
        (typeof feed.becauseYouWatched.label === "string" &&
          Array.isArray(feed.becauseYouWatched.videos))
    ).toBe(true);
  });

  test("video DTOs are typed and complete", async () => {
    const feed = await getHomeFeed(null);
    const all: VideoDTO[] = [
      ...(feed.hero ? [feed.hero] : []),
      ...feed.trending,
      ...feed.recommended,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) {
      expect(typeof v.id).toBe("string");
      expect(typeof v.title).toBe("string");
      expect(v.thumbnailUrl).toMatch(/^https:\/\//);
      expect(v.videoUrl).toMatch(/^https:\/\//);
      expect(v.durationSec).toBeGreaterThanOrEqual(0);
      expect(v.views).toBeGreaterThanOrEqual(0);
      expect(["public", "unlisted", "private"]).toContain(v.visibility);
      expect(typeof v.isShort).toBe("boolean");
      expect(typeof v.isLive).toBe("boolean");
      expect(typeof v.createdAt).toBe("string");
      expect(Number.isNaN(Date.parse(v.createdAt))).toBe(false);
      expect(v.channel).toBeDefined();
      expect(typeof v.channel.handle).toBe("string");
      expect(typeof v.channel.name).toBe("string");
    }
  });

  test("hero is trending #1 by views in the window; trending is views-desc", async () => {
    const feed = await getHomeFeed(null);
    expect(feed.hero).not.toBeNull();
    for (const t of feed.trending) {
      expect(t.views).toBeLessThanOrEqual(feed.hero!.views);
    }
    for (let i = 1; i < feed.trending.length; i++) {
      expect(feed.trending[i - 1].views).toBeGreaterThanOrEqual(feed.trending[i].views);
    }
    expect(feed.trending.length).toBeLessThanOrEqual(8);
  });

  test("continueWatching: unfinished (>30s), recency-ordered, progress data present", async () => {
    const feed = await getHomeFeed(null);
    const items = feed.continueWatching as ContinueVideoDTO[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.watchedSec).toBeGreaterThan(30);
      expect(isUnfinishedWatch(item.watchedSec, item.durationSec)).toBe(true);
      expect(typeof item.watchedAt).toBe("string");
    }
    for (let i = 1; i < items.length; i++) {
      expect(new Date(items[i - 1].watchedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(items[i].watchedAt).getTime()
      );
    }
  });

  test("shorts shelf holds exactly the seeded shorts (6, vertical thumbs)", async () => {
    const feed = await getHomeFeed(null);
    expect(feed.shorts).toHaveLength(6);
    for (const s of feed.shorts) {
      expect(s.isShort).toBe(true);
      expect(s.thumbnailUrl).toMatch(/\/360\/640$/);
    }
  });

  test("becauseYouWatched points at the most recent watch's category", async () => {
    const feed = await getHomeFeed(null);
    expect(feed.becauseYouWatched).not.toBeNull();
    const label = feed.becauseYouWatched!.label;
    // The seed's most recent watch is the Tokyo street food tour (Cooking).
    expect(label).toContain("Tokyo");
    for (const v of feed.becauseYouWatched!.videos) {
      expect(v.category).toBe("Cooking");
    }
  });

  test("category filter: Music feed contains only Music (chips behavior, server side)", async () => {
    const res = await getHome(new Request("http://localhost/api/home?category=Music"));
    const feed = (await res.json()) as HomeFeedDTO;
    const all = [...feed.trending, ...feed.recommended, ...(feed.hero ? [feed.hero] : [])];
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) {
      expect(v.category).toBe("Music");
    }
    expect(feed.becauseYouWatched).toBeNull();
  });
});

describe("GET /api/videos — keyset pagination for infinite scroll", () => {
  test("first page + cursor + no overlap on second page", async () => {
    const res1 = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as VideoPageDTO;
    expect(page1.videos.length).toBeGreaterThan(0);
    expect(page1.nextCursor).not.toBeNull();

    const res2 = await listVideosRoute(
      new Request(`http://localhost/api/videos?cursor=${page1.nextCursor}`)
    );
    const page2 = (await res2.json()) as VideoPageDTO;
    const ids1 = new Set(page1.videos.map((v) => v.id));
    const overlap = page2.videos.filter((v) => ids1.has(v.id));
    expect(overlap).toHaveLength(0);

    // Views stay non-increasing across the keyset boundary.
    const last1 = page1.videos[page1.videos.length - 1].views;
    for (const v of page2.videos) {
      expect(v.views).toBeLessThanOrEqual(last1);
    }
  });

  test("invalid cursor → 500 JSON error (no crash)", async () => {
    const res = await listVideosRoute(
      new Request("http://localhost/api/videos?cursor=garbage")
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});
