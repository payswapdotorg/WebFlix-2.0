/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ALL_CHIP,
  CATEGORIES,
  HOME_CHIPS,
  normalizeCategory,
  filterVideosByCategory,
} from "@/lib/categories";
import type { VideoDTO } from "@/lib/types";

function fakeVideo(overrides: Partial<VideoDTO>): VideoDTO {
  return {
    id: "v1",
    title: "Some video",
    description: "",
    thumbnailUrl: "https://picsum.photos/seed/x/640/360",
    videoUrl: "https://example.com/v.mp4",
    durationSec: 60,
    views: 1,
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "Music",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: new Date().toISOString(),
    channel: {
      id: "c1",
      handle: "ch",
      name: "Channel",
      avatarUrl: "",
      verified: false,
      subscriberCount: 0,
    },
    ...overrides,
  };
}

describe("home chips (All + the 14 WebFlix categories)", () => {
  test("chips row = All + 14 categories, WebFlix order", () => {
    expect(HOME_CHIPS).toEqual([
      "All",
      "Music",
      "Gaming",
      "Live",
      "News",
      "Sports",
      "Coding",
      "Tech",
      "Education",
      "Travel",
      "Cooking",
      "Fitness",
      "Comedy",
      "Mixes",
      "Podcasts",
    ]);
    expect(HOME_CHIPS).toHaveLength(15);
    expect(HOME_CHIPS[0]).toBe(ALL_CHIP);
  });

  test("category count matches the reference sidebar", () => {
    expect(CATEGORIES).toHaveLength(14);
  });
});

describe("chips filter behavior (filterVideosByCategory)", () => {
  const videos = [
    fakeVideo({ id: "a", category: "Music" }),
    fakeVideo({ id: "b", category: "Gaming" }),
    fakeVideo({ id: "c", category: "Music", isShort: true }),
    fakeVideo({ id: "d", category: "Cooking" }),
  ];

  test("'All' returns every video unchanged", () => {
    expect(filterVideosByCategory(videos, ALL_CHIP)).toHaveLength(4);
    expect(filterVideosByCategory(videos, "All")[0].id).toBe("a");
  });

  test("a category returns only matching videos (shorts included)", () => {
    const music = filterVideosByCategory(videos, "Music");
    expect(music.map((v) => v.id)).toEqual(["a", "c"]);
  });

  test("unknown/empty category falls back to unfiltered", () => {
    expect(filterVideosByCategory(videos, "")).toHaveLength(4);
  });

  test("empty result is honest (no fallback content)", () => {
    expect(filterVideosByCategory(videos, "Podcasts")).toHaveLength(0);
  });
});

describe("normalizeCategory (query param → chip)", () => {
  test("valid categories pass through", () => {
    expect(normalizeCategory("Music")).toBe("Music");
    expect(normalizeCategory("Podcasts")).toBe("Podcasts");
  });
  test("null/undefined/invalid → All", () => {
    expect(normalizeCategory(null)).toBe("All");
    expect(normalizeCategory(undefined)).toBe("All");
    expect(normalizeCategory("NotACategory")).toBe("All");
    expect(normalizeCategory("")).toBe("All");
  });
});
