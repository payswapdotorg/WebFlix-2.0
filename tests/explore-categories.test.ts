/// <reference types="bun-types" />
/**
 * WFX2-P19-EXPL — the explore category seed map (src/lib/youtube/
 * explore-categories.ts): the 13 browse categories (Live keeps its own
 * /explore/live surface), each with real seed queries the browse grid is
 * composed from. Mirrors categories.test.ts (the chip-vocabulary battery).
 */
import { describe, expect, test } from "bun:test";
import {
  EXPLORE_CATEGORY_KEYS,
  EXPLORE_CATEGORY_SEEDS,
  exploreCategorySeeds,
  isExploreCategory,
} from "@/lib/youtube/explore-categories";
import { CATEGORIES } from "@/lib/categories";

describe("the explore category vocabulary (13 browse categories)", () => {
  test("the keys = CATEGORIES order minus Live (the hub/sidebar order)", () => {
    expect(EXPLORE_CATEGORY_KEYS).toEqual(CATEGORIES.filter((c) => c !== "Live"));
    expect(EXPLORE_CATEGORY_KEYS).toHaveLength(13);
  });

  test("Live is NOT a browse category (it keeps /explore/live)", () => {
    expect(isExploreCategory("Live")).toBe(false);
    expect(EXPLORE_CATEGORY_SEEDS["Live"]).toBeUndefined();
  });

  test("every browse category is a known WebFlix category", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) {
      expect(CATEGORIES).toContain(key);
    }
  });

  test("isExploreCategory accepts exactly the 13 (and rejects junk)", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) expect(isExploreCategory(key)).toBe(true);
    for (const junk of ["", "live", "music", "Movies", "Random", "Music ", null, undefined]) {
      expect(isExploreCategory(junk as never)).toBe(false);
    }
  });
});

describe("the seed queries (real search terms per category)", () => {
  test("every category carries a non-empty, deduplicated query set", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) {
      const seeds = EXPLORE_CATEGORY_SEEDS[key];
      expect(seeds).toBeDefined();
      expect(seeds.length).toBeGreaterThanOrEqual(2);
      for (const q of seeds) {
        expect(typeof q).toBe("string");
        expect(q.trim().length).toBeGreaterThan(2);
      }
      expect(new Set(seeds).size).toBe(seeds.length); // no duplicate seeds
    }
  });

  test("exploreCategorySeeds returns the map for known keys, null otherwise", () => {
    expect(exploreCategorySeeds("Music")).toBe(EXPLORE_CATEGORY_SEEDS["Music"]);
    expect(exploreCategorySeeds("Gaming")).toEqual(["gaming", "gameplay", "video game highlights"]);
    expect(exploreCategorySeeds("Live")).toBeNull();
    expect(exploreCategorySeeds("does-not-exist")).toBeNull();
    expect(exploreCategorySeeds(null)).toBeNull();
  });

  test("the recorded fixtures' queries are seed[0] of their categories", () => {
    // tests/fixtures/yt/search_music_videos|search_gaming|search_news are the
    // real captures of these seeds (the api suite routes by them)
    expect(EXPLORE_CATEGORY_SEEDS["Music"][0]).toBe("music videos");
    expect(EXPLORE_CATEGORY_SEEDS["Gaming"][0]).toBe("gaming");
    expect(EXPLORE_CATEGORY_SEEDS["News"][0]).toBe("news");
  });
});
