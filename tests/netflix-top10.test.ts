/// <reference types="bun-types" />
/**
 * P42-NETFLIX-SOURCE — the Tudum Top 10 parser + mapper battery.
 * Fixture: tests/fixtures/netflix/top10-films.html — REAL captured bytes of
 * the weekly English-films pool page (captured 2026-10-24, research record
 * §3). NO network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  ALL_POOL_KEYS,
  POOLS,
  extractGraphqlCache,
  mapTop10Entity,
  parseTop10Page,
} from "@/lib/netflix/top10";
import { netflixTitleUrl, netflixWatchUrl } from "@/lib/netflix/deeplink";
import { setNetflixUpstream } from "@/lib/netflix/upstream";
import { clearCache } from "@/lib/youtube/cache";
import { getTop10Pool } from "@/lib/netflix/top10";

const FIXTURE = readFileSync("tests/fixtures/netflix/top10-films.html", "utf8");

beforeEach(() => clearCache());
afterEach(() => setNetflixUpstream(null));

describe("extractGraphqlCache — the SSR-cache extractor", () => {
  test("extracts the embedded Relay cache from the real capture", () => {
    const cache = extractGraphqlCache(FIXTURE);
    expect(cache).not.toBeNull();
    const entities = Object.keys(cache?.data ?? {}).filter((k) =>
      k.startsWith("PulseTop10ItemEntity:")
    );
    // Global pool + geo pool copies ride the same page.
    expect(entities.length).toBe(20);
  });

  test("honest null on a markerless page (shape change / walled answer)", () => {
    expect(extractGraphqlCache("<html><body>Sorry, something went wrong</body></html>")).toBeNull();
    expect(extractGraphqlCache("")).toBeNull();
  });

  test("honest null on a truncated literal", () => {
    const truncated = FIXTURE.slice(0, FIXTURE.indexOf("PulseTop10ItemEntity"));
    expect(extractGraphqlCache(truncated)).toBeNull();
  });
});

describe("parseTop10Page — the pool parser", () => {
  test("parses the real capture into 10 deduped, rank-ordered titles", () => {
    const parsed = parseTop10Page(FIXTURE, "weekly-films");
    expect(parsed).not.toBeNull();
    expect(parsed?.titles.length).toBe(10);
    expect(parsed?.weekEndDate).toBe("2026-10-18");
    const ranks = parsed?.titles.map((t) => t.weeklyRank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(parsed?.titles[0].title).toBe("Animals");
    expect(parsed?.titles[0].netflixId).toBe(81757047);
  });

  test("kind gate: the films fixture parses to nothing under a series pool", () => {
    expect(parseTop10Page(FIXTURE, "weekly-tv")).toBeNull();
  });

  test("all-time gate: the weekly fixture (weekEndDate set) parses to nothing under alltime pools", () => {
    expect(parseTop10Page(FIXTURE, "alltime-films")).toBeNull();
  });
});

describe("mapTop10Entity — the DTO mapping", () => {
  const parsed = parseTop10Page(FIXTURE, "weekly-films");
  const animals = parsed?.titles.find((t) => t.netflixId === 81757047);

  test("maps the measured fields of the #1 title", () => {
    expect(animals).toBeDefined();
    expect(animals?.title).toBe("Animals");
    expect(animals?.kind).toBe("movie");
    expect(animals?.synopsis).toContain("kidnapped");
    expect(animals?.maturityRating).toBe("R");
    expect(animals?.weeklyRank).toBe(1);
    expect(animals?.allTimeRank).toBeNull();
    expect(animals?.weeklyHoursViewed).toBe(55_400_000);
    expect(animals?.weeksInTop10).toBe(2);
    expect(animals?.pool).toBe("weekly-films");
    expect(animals?.isPlayable).toBe(true);
  });

  test("deep links come from deeplink.ts only (ADR 0002 §1)", () => {
    expect(animals?.deepLinkUrl).toBe(netflixWatchUrl(81757047));
    expect(animals?.deepLinkUrl).toBe("https://www.netflix.com/watch/81757047");
    expect(animals?.titlePageUrl).toBe(netflixTitleUrl(81757047));
  });

  test("country ranks ride along (~93 countries; US #1)", () => {
    const n = Object.keys(animals?.countryRanks ?? {}).length;
    expect(n).toBeGreaterThan(50);
    expect(animals?.countryRanks["US"]).toBe(1);
    expect(animals?.countryRanks["HK"]).toBe(2);
  });

  test("artwork URLs are real Netflix CDN links", () => {
    expect(animals?.backdropUrl).toContain("nflximg.net");
    expect(animals?.posterUrl).toContain("nflximg.net");
  });

  test("a record without id/title maps to null — never a fake row", () => {
    expect(mapTop10Entity({}, POOLS["weekly-films"])).toBeNull();
  });
});

describe("getTop10Pool — the bounded fetch + cache ladder", () => {
  test("serves the fixture through the upstream seam and mirrors the parse", async () => {
    const served: string[] = [];
    setNetflixUpstream(async (url) => {
      served.push(url);
      return new Response(FIXTURE, { status: 200, headers: { "Content-Type": "text/html" } });
    });
    const pool = await getTop10Pool("weekly-films");
    expect(pool).not.toBeNull();
    expect(pool?.titles.length).toBe(10);
    // the bounded URL law: exactly the pool page, nothing else
    expect(served).toEqual(["https://www.netflix.com/tudum/top10/"]);
  });

  test("an upstream failure answers null honestly (no fake rows)", async () => {
    setNetflixUpstream(async () => new Response("blocked", { status: 403 }));
    expect(await getTop10Pool("weekly-films")).toBeNull();
  });

  test("a 200-but-garbage page answers null honestly (the poisoning guard shape)", async () => {
    setNetflixUpstream(
      async () =>
        new Response("<html><body>200 but not a top10 page</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
    );
    expect(await getTop10Pool("weekly-films")).toBeNull();
  });

  test("the pool matrix is the 8 documented URLs (ADR 0002 §2)", () => {
    expect(ALL_POOL_KEYS.length).toBe(8);
    for (const key of ALL_POOL_KEYS) {
      expect(POOLS[key].path.startsWith("/tudum/top10")).toBe(true);
    }
  });
});
