/// <reference types="bun-types" />
/**
 * P55-LAWS — the Netflix catalog search laws, pinned against regressions.
 *
 * 1. MIXED-CASE LAW  — Prisma `contains` is case-insensitive on SQLite but
 *    case-sensitive on Postgres; the search MUST score in JS (no SQL text
 *    filter) so "AnImAlS" finds "Animals" on every engine.
 * 2. TEXT-GATE LAW   — with the SQL pre-filter gone, the rank bonus may rank
 *    WITHIN text matches but can never carry a non-match past the gate.
 * 3. BILLIONS LAW    — the stat columns are BigInt; a 2.2B-hours all-time
 *    row round-trips exactly through the write seam and mirrorRowToDTO.
 * 4. STRUCTURAL LAW  — catalog.ts must carry no SQL `contains:` text filter
 *    at all (the case bug's root shape).
 *
 * Lane law: no network anywhere. The test owns the NetflixTitle table
 * (seed-watch never writes it); rows use the reserved 99xxxxxxx id band.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { db } from "@/lib/db";
import { toBig, fromBig } from "@/lib/netflix/bigint";
import { mirrorRowToDTO, searchNetflixCatalog, suggestNetflixTitles } from "@/lib/netflix/catalog";

// The reserved band — high, below the Int32 id ceiling, never a real title id.
const IDS = {
  animals: 990000001,
  squid: 990000002,
  popularNoise: 990000003,
  billions: 990000004,
};

const base = {
  kind: "movie",
  synopsis: "",
  releaseYear: null as number | null,
  maturityRating: null as string | null,
  posterUrl: null,
  backdropUrl: null,
  logoUrl: null,
  weeklyRank: null as number | null,
  allTimeRank: null as number | null,
  weeksInTop10: null as number | null,
  weeklyHoursViewed: null as bigint | null,
  weeklyViews: null as bigint | null,
  weekEndDate: null as string | null,
  pool: null as string | null,
  isPlayable: true,
  countryRanks: "",
};

beforeAll(async () => {
  await db.netflixTitle.createMany({
    data: [
      { ...base, netflixId: IDS.animals, title: "Animals", synopsis: "A family fights for freedom.", weeklyHoursViewed: BigInt("55400000"), weeklyViews: BigInt("30800000") },
      { ...base, netflixId: IDS.squid, title: "Squid Game", kind: "series", weeklyRank: 1, weeklyHoursViewed: BigInt("240300000"), weeklyViews: BigInt("141200000") },
      // The gate-law decoy: the currently-ranking #1 whose title shares
      // NOTHING with the probe queries below.
      { ...base, netflixId: IDS.popularNoise, title: "Completely Unrelated Thing", weeklyRank: 1 },
      // The billions row: the real all-time mirror carries > Int32 hours.
      { ...base, netflixId: IDS.billions, title: "Squid Game: All-Time", kind: "series", allTimeRank: 1, weeklyHoursViewed: BigInt("2205200000"), weeklyViews: BigInt("1002000000") },
    ],
  });
});

afterAll(async () => {
  await db.netflixTitle.deleteMany({ where: { netflixId: { in: Object.values(IDS) } } });
});

describe("P55 mixed-case law", () => {
  test("AnImAlS finds Animals (the prod-killer query shape)", async () => {
    const r = await searchNetflixCatalog("AnImAlS");
    const ids = r.titles.map((t) => t.netflixId);
    expect(ids).toContain(IDS.animals);
  });

  test("SQUID GAME (full caps) finds Squid Game", async () => {
    const r = await searchNetflixCatalog("SQUID game");
    const ids = r.titles.map((t) => t.netflixId);
    expect(ids).toContain(IDS.squid);
    expect(ids).toContain(IDS.billions);
  });

  test("suggest rides the same mixed-case law", async () => {
    const s = await suggestNetflixTitles("AnImAlS");
    expect(s.map((x) => x.netflixId)).toContain(IDS.animals);
  });
});

describe("P55 text-gate law (rank bonus ranks within matches only)", () => {
  test("a merely-popular non-match never answers a query", async () => {
    // weeklyRank=1 alone used to be enough to pass a raw score>0 gate.
    const r = await searchNetflixCatalog("zzzqqqxyzzy");
    expect(r.titles.map((t) => t.netflixId)).not.toContain(IDS.popularNoise);
    const s = await suggestNetflixTitles("zzzqqqxyzzy");
    expect(s.map((x) => x.netflixId)).not.toContain(IDS.popularNoise);
  });

  test("the ranking match outranks the equally-textual quieter one", async () => {
    // Both match "squid"; the weekly-ranked one answers first.
    const s = await suggestNetflixTitles("squid");
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s[0].netflixId).toBe(IDS.squid); // weeklyRank bonus inside the matches
  });
});

describe("P55 billions law (BigInt round-trip)", () => {
  test("2,205,200,000 hours survives write → read → DTO exactly", async () => {
    const row = await db.netflixTitle.findUnique({ where: { netflixId: IDS.billions } });
    expect(row).not.toBeNull();
    // The DB keeps the exact value past the Int32 ceiling…
    expect(row!.weeklyHoursViewed).toBe(BigInt("2205200000"));
    expect(row!.weeklyViews).toBe(BigInt("1002000000"));
    // …and the seam hands the DTO its exact number back.
    const dto = mirrorRowToDTO(row!);
    expect(dto.weeklyHoursViewed).toBe(2_205_200_000);
    expect(dto.weeklyViews).toBe(1_002_000_000);
  });

  test("the seam helpers round-trip nulls and truncation-safe values", () => {
    expect(toBig(null)).toBeNull();
    expect(toBig(undefined)).toBeNull();
    expect(fromBig(null)).toBeNull();
    expect(toBig(2_205_200_000)).toBe(BigInt("2205200000"));
    expect(fromBig(BigInt("2205200000"))).toBe(2_205_200_000);
  });
});

describe("P55 structural law (no SQL text filter, whole-mirror window)", () => {
  const src = readFileSync("src/lib/netflix/catalog.ts", "utf8");
  const searchFn = src.slice(src.indexOf("export async function searchNetflixCatalog"));

  test("no `contains:` anywhere — the case bug's root shape is banned", () => {
    expect(src.includes("contains:")).toBeFalse();
  });

  test("search fetches the whole bounded mirror (take: 1000), not a SQL-windowed slice", () => {
    expect(searchFn.includes("take: 1000")).toBeTrue();
  });

  test("the search catch keeps a receipt (F3 — never eat silently)", () => {
    expect(searchFn.includes("console.error")).toBeTrue();
  });
});
