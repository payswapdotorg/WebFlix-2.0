/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ALL_CHIP,
  CATEGORIES,
  HOME_CHIPS,
  HOME_DYNAMIC_CHIPS,
  HOME_CATEGORY_CHIPS,
  CATEGORY_CHIPS,
  RECENTLY_UPLOADED_CHIP,
  categoryDestination,
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

describe("home chips — REA-3: youtube.com's measured ladder (station pack, logged-in 2026-10-17)", () => {
  test("the dynamic family rides directly after All, then the category chips", () => {
    // youtube.com: All, [New to you — honestly absent, no personalization
    // seam], Mixes, Recently uploaded, Live, then the category chips.
    expect(HOME_CHIPS.slice(0, 4)).toEqual(["All", "Mixes", RECENTLY_UPLOADED_CHIP, "Live"]);
    expect(HOME_CHIPS[0]).toBe(ALL_CHIP);
    // the category block follows, with Live/Mixes deduped (they ride the
    // dynamic block — one chip per label, exactly youtube.com's row)
    expect(HOME_CHIPS.slice(4)).toEqual([...HOME_CATEGORY_CHIPS]);
    expect(HOME_CATEGORY_CHIPS).toHaveLength(12);
    expect(HOME_CATEGORY_CHIPS).not.toContain("Live");
    expect(HOME_CATEGORY_CHIPS).not.toContain("Mixes");
    expect(HOME_CHIPS).toHaveLength(16);
  });

  test("\"New to you\" is honestly absent — no fabricated personalization chip", () => {
    expect(HOME_CHIPS).not.toContain("New to you");
    expect(HOME_DYNAMIC_CHIPS).toEqual(["Mixes", RECENTLY_UPLOADED_CHIP, "Live"]);
  });

  test("the explore/category browse ladder stays All + the 14 categories", () => {
    expect(CATEGORY_CHIPS).toEqual([ALL_CHIP, ...CATEGORIES]);
    expect(CATEGORY_CHIPS).toHaveLength(15);
  });

  test("category count matches the reference sidebar", () => {
    expect(CATEGORIES).toHaveLength(14);
  });

  test("normalizeCategory accepts the dynamic chips (the home filter family)", () => {
    expect(normalizeCategory(RECENTLY_UPLOADED_CHIP)).toBe(RECENTLY_UPLOADED_CHIP);
    expect(normalizeCategory("Live")).toBe("Live");
    expect(normalizeCategory("Mixes")).toBe("Mixes");
    expect(normalizeCategory("NotAChip")).toBe("All");
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

describe("categoryDestination (P25 G13 + P30 — the dedicated destinations, measured)", () => {
  test("Podcasts → the dedicated podcasts destination /podcasts (youtube.com's own FEpodcasts_destination)", () => {
    expect(categoryDestination("Podcasts")).toBe("/podcasts");
  });

  test("Music → the dedicated music destination /music (P30: youtube.com's own Music page — the channel-style header + square-lockup shelf family, measured 2026-10-20)", () => {
    expect(categoryDestination("Music")).toBe("/music");
  });

  test("Live keeps its own surface; every OTHER category keeps the composed grid", () => {
    expect(categoryDestination("Live")).toBe("/explore/live");
    for (const c of CATEGORIES.filter((c) => c !== "Podcasts" && c !== "Live" && c !== "Music")) {
      expect(categoryDestination(c)).toBe(`/explore/category/${encodeURIComponent(c)}`);
    }
  });

  test("unknown values keep the composed form (never a fabricated destination)", () => {
    expect(categoryDestination("NotACategory")).toBe("/explore/category/NotACategory");
    expect(categoryDestination("")).toBe("/explore/category/");
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
