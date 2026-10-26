/**
 * P42-NETFLIX-SOURCE — the Netflix catalog composition layer.
 *
 * Builds the hub's rails from the 8 bounded pools, exposes per-title reads
 * (pool cache → Prisma mirror fallback), the catalog search, and the honest
 * degradation shape. Every payload carries the provenance `source` field
 * (ADR 0002 §3) — never a fake row.
 */
import { db } from "@/lib/db";
import { netflixTitleUrl, netflixWatchUrl } from "./deeplink";
import { fromBig } from "./bigint";
import { ALL_POOL_KEYS, POOLS, getTop10Pool, type ParsedPool } from "./top10";
import type {
  NetflixCountryRank,
  NetflixHomeDTO,
  NetflixPoolKey,
  NetflixRailDTO,
  NetflixSearchResultsDTO,
  NetflixSource,
  NetflixTitleDTO,
  NetflixTitlePageDTO,
  NetflixCatalogSuggestion,
} from "./types";

/** Countries the hub rails render by default (Global is always first). */
export const RAIL_COUNTRIES = ["Global", "US"] as const;

function poolSource(poolKey: NetflixPoolKey): NetflixSource {
  return POOLS[poolKey].ranking === "weekly" ? "netflix-top10" : "netflix-most-popular";
}

/**
 * One rail = one pool, ranked for a country. "Global" rides the pool's own
 * rank order; a country rail re-ranks by that country's countryRanks entry
 * (measured: ~93 countries ride along on the same fetch).
 */
function railForPool(
  poolKey: NetflixPoolKey,
  country: string,
  pool: ParsedPool | null
): NetflixRailDTO | null {
  if (!pool || pool.titles.length === 0) return null;
  let titles = pool.titles;
  if (country !== "Global") {
    titles = pool.titles
      .filter((t) => typeof t.countryRanks[country] === "number")
      .sort((a, b) => a.countryRanks[country] - b.countryRanks[country]);
  }
  if (titles.length === 0) return null;
  return {
    key: poolKey,
    label: POOLS[poolKey].label,
    kind: POOLS[poolKey].kind,
    country,
    ranking: POOLS[poolKey].ranking,
    weekEndDate: pool.weekEndDate,
    titles: titles.slice(0, 10),
    source: poolSource(poolKey),
  };
}

/**
 * The hub composition: every pool answers through the shared cache; pools
 * that fail drop out honestly (a partial hub beats a dead hub — the same
 * ladder logic the home feed runs).
 */
export async function getNetflixHome(country: string = "Global"): Promise<NetflixHomeDTO> {
  const settled = await Promise.all(
    ALL_POOL_KEYS.map(async (key) => ({ key, pool: await getTop10Pool(key) }))
  );
  const byKey = new Map(settled.map((s) => [s.key, s.pool]));
  const rails: NetflixRailDTO[] = [];
  for (const key of ALL_POOL_KEYS) {
    const rail = railForPool(key, country, byKey.get(key) ?? null);
    if (rail) rails.push(rail);
  }
  const catalog = await unionCatalog(byKey);
  const okRails = rails.length > 0;
  return {
    rails,
    catalogSize: catalog.length,
    source: okRails ? poolSource(rails[0].key) : "last-good",
    unavailable: !okRails,
    unavailableReason: okRails
      ? null
      : "Netflix's Top 10 data is unreachable from this egress right now — the hub stays empty rather than showing fake rows.",
    fetchedAt: new Date().toISOString(),
  };
}

/** The deduped union of every pool's titles (the browsable catalog). */
async function unionCatalog(byKey?: Map<NetflixPoolKey, ParsedPool | null>): Promise<NetflixTitleDTO[]> {
  const pools =
    byKey ?? new Map((await Promise.all(ALL_POOL_KEYS.map(async (k) => [k, await getTop10Pool(k)] as const))).map(([k, p]) => [k, p]));
  const byId = new Map<number, NetflixTitleDTO>();
  for (const pool of pools.values()) {
    for (const t of pool?.titles ?? []) {
      byId.set(t.netflixId, t); // pool parses already dedupe + merge field-wise
    }
  }
  return [...byId.values()];
}

/**
 * Mirror row → DTO (the Prisma fallback path; ranks may be stale by design).
 * P55-LAW: the stat columns are BigInt in the schemas — this seam converts
 * back to the DTO's `number` contract (every value is exact below 2^53).
 */
export function mirrorRowToDTO(row: {
  netflixId: number;
  title: string;
  kind: string;
  synopsis: string;
  releaseYear: number | null;
  maturityRating: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  weeklyRank: number | null;
  allTimeRank: number | null;
  weeksInTop10: number | null;
  weeklyHoursViewed: bigint | number | null;
  weeklyViews: bigint | number | null;
  weekEndDate: string | null;
  pool: string | null;
  isPlayable: boolean;
  countryRanks: string;
}): NetflixTitleDTO {
  const countryRanks: Record<string, number> = {};
  for (const pair of (row.countryRanks ?? "").split(",")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const cc = pair.slice(0, idx).trim();
    const rank = Number(pair.slice(idx + 1).trim());
    if (cc && Number.isFinite(rank)) countryRanks[cc] = rank;
  }
  return {
    netflixId: row.netflixId,
    title: row.title,
    kind: row.kind === "series" ? "series" : "movie",
    synopsis: row.synopsis,
    releaseYear: row.releaseYear,
    maturityRating: row.maturityRating,
    backdropUrl: row.backdropUrl,
    posterUrl: row.posterUrl,
    logoUrl: row.logoUrl,
    weeklyRank: row.weeklyRank,
    allTimeRank: row.allTimeRank,
    weeksInTop10: row.weeksInTop10,
    weeklyHoursViewed: fromBig(row.weeklyHoursViewed),
    weeklyViews: fromBig(row.weeklyViews),
    countryRanks,
    weekEndDate: row.weekEndDate,
    pool: (row.pool as NetflixTitleDTO["pool"]) ?? null,
    isPlayable: row.isPlayable,
    deepLinkUrl: netflixWatchUrl(row.netflixId),
    titlePageUrl: netflixTitleUrl(row.netflixId),
  };
}

/**
 * One title: live pool caches first (fresh ranks), the Prisma mirror as the
 * fallback (a title that fell off the Top 10 keeps its detail page honest,
 * labeled from the mirror). Null → the route answers 404.
 */
export async function getNetflixTitle(netflixId: number): Promise<NetflixTitleDTO | null> {
  const pools = await Promise.all(ALL_POOL_KEYS.map((k) => getTop10Pool(k)));
  for (const pool of pools) {
    const hit = pool?.titles.find((t) => t.netflixId === netflixId);
    if (hit) return hit;
  }
  try {
    const row = await db.netflixTitle.findUnique({ where: { netflixId } });
    return row ? mirrorRowToDTO(row) : null;
  } catch {
    return null;
  }
}

/**
 * The title page: title + where-it-ranks + same-pool neighbors + the viewer's
 * My-List state. `myListResolved=false` means the viewer identity was
 * unavailable (anonymous) — the UI hides the toggle honestly.
 */
export async function getNetflixTitlePage(
  netflixId: number,
  viewerId: string | null
): Promise<NetflixTitlePageDTO | null> {
  const title = await getNetflixTitle(netflixId);
  if (!title) return null;
  // The FULL country-rank truth rides the DTO (the UI caps the display) —
  // the route never truncates the honest data.
  const countryRanks: NetflixCountryRank[] = Object.entries(title.countryRanks)
    .map(([countryId, rank]) => ({ countryId, rank }))
    .sort((a, b) => a.rank - b.rank || a.countryId.localeCompare(b.countryId));

  let relatedTitles: NetflixTitleDTO[] = [];
  if (title.pool) {
    const pool = await getTop10Pool(title.pool);
    relatedTitles = (pool?.titles ?? [])
      .filter((t) => t.netflixId !== netflixId)
      .slice(0, 10);
  }

  let myList = false;
  if (viewerId) {
    try {
      const row = await db.netflixMyListItem.findUnique({
        where: { userId_netflixId: { userId: viewerId, netflixId } },
      });
      myList = !!row;
    } catch {
      myList = false;
    }
  }

  return {
    title,
    countryRanks,
    relatedTitles,
    myList,
    source: poolSource(title.pool ?? "weekly-films"),
    unavailable: false,
    unavailableReason: null,
  };
}

/**
 * P49 — the lean suggest query for the GLOBAL search box: the same scoring
 * law as searchNetflixCatalog, but a small, cheap, DTO-light shape (the
 * suggest dropdown renders a title + badge, not a rail). Returns [] on any
 * mirror trouble — the suggest lane never blocks on Netflix.
 *
 * P55-LAW (case): NO SQL `contains` pre-filter — Prisma's `contains` is
 * case-insensitive on SQLite but case-sensitive on Postgres, so a lowercased
 * needle answered [] for every mixed-case title in prod. The bounded mirror
 * is fetched whole and all matching happens in the JS scorer (mixed-case
 * safe on every engine).
 *
 * P55-LAW (gate): the rank bonus ranks WITHIN text matches only — with the
 * SQL pre-filter gone, a raw `score > 0` gate would let a merely-popular
 * non-match (weeklyRank bonus alone) sail through and crowd real matches.
 */
export type { NetflixCatalogSuggestion } from "./types";

export async function suggestNetflixTitles(
  q: string,
  cap: number = 3
): Promise<NetflixCatalogSuggestion[]> {
  const query = q.trim();
  if (!query) return [];
  const needle = query.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean).slice(0, 6);
  try {
    const rows = await db.netflixTitle.findMany({ take: 1000 });
    return rows
      .map(mirrorRowToDTO)
      .map((t) => {
        const titleLower = t.title.toLowerCase();
        let text = 0;
        if (titleLower === needle) text += 100;
        if (titleLower.startsWith(needle)) text += 50;
        if (titleLower.includes(needle)) text += 25;
        for (const tok of tokens) if (titleLower.includes(tok)) text += 5;
        // The text gate owns match truth — no text hit, no answer, ever.
        if (text === 0) return null;
        // currently-ranking titles answer first (the hub's live truth) —
        // a tie-breaker inside the matches, never a substitute for one
        const score = text + (t.weeklyRank !== null ? 10 : 0) + (t.allTimeRank !== null ? 5 : 0);
        return { t, score };
      })
      .filter((s): s is { t: NetflixTitleDTO; score: number } => s !== null)
      .sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title))
      .slice(0, cap)
      .map((s) => ({
        netflixId: s.t.netflixId,
        title: s.t.title,
        releaseYear: s.t.releaseYear,
        kind: s.t.kind,
      }));
  } catch (err) {
    // F3-LAW: never eat an error silently — the suggest lane degrades to []
    // but the station log keeps the receipt.
    console.error("suggestNetflixTitles failed", err);
    return [];
  }
}

/**
 * Catalog search over the Prisma mirror (the search index the pools feed on
 * every refresh). Honest scope note: this is Netflix's own Top-10 universe,
 * not the full catalog (research record §5).
 *
 * P55-LAW (case): NO SQL `contains` pre-filter — Prisma's `contains` is
 * case-insensitive on SQLite but case-sensitive on Postgres, so prod
 * answered `catalogSize: 79` with `titles: []` for EVERY query. The
 * bounded mirror is fetched whole (take: 1000 — the Top-10 union) and all
 * matching happens in the JS scorer, mixed-case safe on every engine.
 */
export async function searchNetflixCatalog(
  q: string,
  kind?: "movie" | "series" | null
): Promise<NetflixSearchResultsDTO> {
  const query = q.trim();
  if (!query) {
    return { q, titles: [], catalogSize: 0, source: "netflix-catalog", note: null };
  }
  const needle = query.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean).slice(0, 6);
  try {
    const rows = await db.netflixTitle.findMany({ take: 1000 });
    const scored = rows
      .map(mirrorRowToDTO)
      // P51-AUDIT (S2): the kind filter runs BEFORE the cap — the old
      // client-side-only tab could show 0 while matching titles existed
      // past the 20-row slice
      .filter((t) => (kind ? t.kind === kind : true))
      .map((t) => {
        const titleLower = t.title.toLowerCase();
        let text = 0;
        if (titleLower === needle) text += 100;
        if (titleLower.startsWith(needle)) text += 50;
        if (titleLower.includes(needle)) text += 25;
        for (const tok of tokens) if (titleLower.includes(tok)) text += 5;
        if (t.synopsis.toLowerCase().includes(needle)) text += 2;
        // The text gate owns match truth — a synopsis-only hit is a hit,
        // a merely-popular row is not.
        if (text === 0) return null;
        return { t, score: text };
      })
      .filter((s): s is { t: NetflixTitleDTO; score: number } => s !== null)
      .sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title))
      .slice(0, 20)
      .map((s) => s.t);
    return {
      q,
      titles: scored,
      catalogSize: await db.netflixTitle.count(),
      source: "netflix-catalog",
      note: "Searching Netflix's official Top 10 & Most Popular universe — the catalog Netflix itself publishes for tracking.",
    };
  } catch (err) {
    // F3-LAW: never eat an error silently — the honest empty shape stands,
    // but the station log keeps the receipt (the silent empty catch is how
    // the stat-ceiling bug hid through two deploys).
    console.error("searchNetflixCatalog failed", err);
    return {
      q,
      titles: [],
      catalogSize: 0,
      source: "netflix-catalog",
      note: "The Netflix catalog index is unavailable right now.",
    };
  }
}
