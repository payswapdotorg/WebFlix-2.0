/**
 * WFX2-P19-EXPL — explore category browse (/explore/category/[key]).
 *
 * youtube.com's Explore lands every category on a real browse page. Its own
 * category surfaces are session-gated (browse FEexplore → 400; the public
 * /feed/trending redirects to the What-to-Watch nudge — both probed live,
 * evidence/wfx2bw/DISCOVERY.md), so the honest public path for a category
 * grid is the SAME machinery the home ladder's rung 3 and the Live surface
 * already use: REAL per-category seed searches, merged + de-duplicated
 * (the live-surface precedent — interleaved per query, belt-and-braces
 * non-shorts filter), then live search continuations for the scroll.
 *
 * Mechanism (mirrors feeds.ts composeSearchPool/composeSearchPage exactly):
 *  - each category's seed queries fetch one cached first page
 *    (getSearchVideoPage — the EXISTING yt:searchpage:… keys, type=video);
 *  - the merged, id-deduped pool is itself ONE cached value per category
 *    (yt:explore:pool:<key>), so a pool cursor's offset slices the identical
 *    list on every page (a fresh merge could reshuffle mid-scroll);
 *  - every seed query's first-page continuation token is captured at compose
 *    time — when the pool exhausts, the chain pages query 0's live
 *    continuation, then query 1's, … and ends with the honest null.
 *
 * Cursors are the opaque rung-3 envelopes from cursors.ts ({s:"ecat"…} /
 * {s:"ecats"…}), each scoped to its category key — a cursor never crosses
 * categories (decodeExploreCategoryCursor answers null → the route's 400).
 */
import { cached, TTL } from "./cache";
import { getSearchVideoPage } from "./feeds";
import {
  decodeExploreCategoryCursor,
  encodeCursor,
  type ExploreCategoryPoolCursor,
  type ExploreCategorySearchCursor,
} from "./cursors";
import { CATEGORIES } from "@/lib/categories";
import type { VideoDTO } from "@/lib/types";

/**
 * The per-category seed queries — 3 broad, real, video-rich browse terms per
 * category (mirrors the home compose's 3-query pool and the Live surface's
 * live-scoped query set). Live has no entry: it keeps its own surface
 * (/explore/live — the Features→Live filter search).
 */
export const EXPLORE_CATEGORY_SEEDS: Record<string, readonly string[]> = {
  Music: ["music videos", "new music", "live music"],
  Gaming: ["gaming", "gameplay", "video game highlights"],
  News: ["news", "breaking news", "world news"],
  Sports: ["sports highlights", "football highlights", "live sports"],
  Coding: ["coding", "programming", "learn to code"],
  Tech: ["tech", "tech review", "gadgets"],
  Education: ["education", "documentary", "science explained"],
  Travel: ["travel", "travel vlog", "travel guide"],
  Cooking: ["cooking", "recipe", "easy recipes"],
  Fitness: ["workout", "fitness", "home workout"],
  Comedy: ["comedy", "stand up comedy", "funny videos"],
  Mixes: ["music mix", "dj mix", "party mix"],
  Podcasts: ["podcast", "podcast episode", "full podcast"],
};

/** The 13 browse categories, in the hub/sidebar (CATEGORIES) order. */
export const EXPLORE_CATEGORY_KEYS: readonly string[] = CATEGORIES.filter(
  (c) => c !== "Live" && EXPLORE_CATEGORY_SEEDS[c] !== undefined,
);

/** True when `key` is one of the 13 category-browse keys (never "Live"). */
export function isExploreCategory(key: string | null | undefined): key is string {
  return !!key && EXPLORE_CATEGORY_KEYS.includes(key);
}

/** The seed queries for a category (null for unknown/Live keys). */
export function exploreCategorySeeds(key: string | null | undefined): readonly string[] | null {
  if (!key || !isExploreCategory(key)) return null;
  return EXPLORE_CATEGORY_SEEDS[key];
}

/**
 * Fixed per-seed first-page size so every category-page consumer reads the
 * SAME cached search pages the rest of the app already fetches.
 */
const SEED_PAGE_LIMIT = 24;

/** The cached per-category pool entry (see categoryPool). */
interface CategoryPool {
  /** the merged, interleaved, id-deduped first-pass videos */
  videos: VideoDTO[];
  /** seeds[i]'s first-page continuation token (null = failed/none) */
  tokens: (string | null)[];
}

/**
 * The category's merged first-pass pool: every seed query's REAL search
 * results, interleaved query-by-query (the live-surface merge precedent —
 * one row shows variety across the seed set), de-duplicated by id, with
 * non-shorts items only (the type=video filter already scopes results; the
 * belt-and-braces check protects against upstream drift, exactly like the
 * Live surface's isLive guard). Per-query failures are tolerated; only when
 * EVERY query fails — search itself is down — does this throw, surfacing the
 * honest upstream error. The WHOLE pool is one cached value so pool-cursor
 * offsets slice the identical list on every page.
 */
async function categoryPool(key: string): Promise<CategoryPool> {
  const queries = EXPLORE_CATEGORY_SEEDS[key];
  return cached(`yt:explore:pool:${key}`, TTL.SEARCH_MS, async () => {
    const pages = await Promise.all(
      queries.map((query) =>
        getSearchVideoPage(query, { type: "video" }, undefined, SEED_PAGE_LIMIT).catch(
          () => null,
        ),
      ),
    );
    if (pages.every((page) => page === null)) {
      throw new Error(`explore category ${key}: every seed query failed (search is down)`);
    }
    const tokens = pages.map((page) => page?.nextCursor ?? null);
    const perQuery = pages.map((page) =>
      (page?.videos ?? []).filter((v) => !v.isShort),
    );
    const seen = new Set<string>();
    const merged: VideoDTO[] = [];
    const maxLen = Math.max(0, ...perQuery.map((v) => v.length));
    for (let i = 0; i < maxLen; i++) {
      for (const results of perQuery) {
        const video = results[i];
        if (!video || seen.has(video.id)) continue;
        seen.add(video.id);
        merged.push(video);
      }
    }
    return { videos: merged, tokens };
  });
}

/** The first seed-query index holding a captured continuation token (-1 = none). */
function firstTokenQuery(tokens: (string | null)[]): number {
  return tokens.findIndex((tok) => typeof tok === "string" && tok.length > 0);
}

/**
 * The category chain's next cursor after consuming the pool through `offset`
 * (mirrors feeds.ts nextComposeCursor): pool windows remain → a pool cursor;
 * the pool is exhausted → the search-phase cursor for the first seed query
 * that captured a continuation token (its FIRST page is already in the
 * pool, so the token starts the next); every query tokenless → null (the
 * honest end — nothing real left to page).
 */
function nextCategoryCursor(
  key: string,
  offset: number,
  tokens: (string | null)[],
  poolLength: number,
): string | null {
  if (offset < poolLength) {
    return encodeCursor({ s: "ecat", k: key, o: offset, t: tokens });
  }
  const qi = firstTokenQuery(tokens);
  if (qi === -1) return null;
  return encodeCursor({ s: "ecats", k: key, qi, t: tokens[qi] as string });
}

/**
 * A pool cursor's page: slice [o, o+limit) from the SAME cached pool the
 * first page composed. A cursor whose offset is already past the pool (it
 * shrank between pages) transitions to the search phase immediately, so a
 * page is never empty-with-a-cursor (an empty page would strand the grid's
 * sentinel while it stays in view).
 */
async function categoryPoolPage(
  key: string,
  cursor: ExploreCategoryPoolCursor,
  limit: number,
): Promise<{ videos: VideoDTO[]; nextCursor: string | null }> {
  const pool = await categoryPool(key);
  if (cursor.o < pool.videos.length) {
    return {
      videos: pool.videos.slice(cursor.o, cursor.o + limit),
      nextCursor: nextCategoryCursor(key, cursor.o + limit, cursor.t, pool.videos.length),
    };
  }
  const qi = firstTokenQuery(cursor.t);
  if (qi === -1) return { videos: [], nextCursor: null };
  return categorySearchPage(key, { s: "ecats", k: key, qi, t: cursor.t[qi] as string }, limit);
}

/**
 * A search-phase cursor's page: one live search continuation for seed query
 * `qi` (the cursor's own token). The query's own continuation token keeps
 * the chain; when it exhausts, the NEXT seed query's captured first token
 * takes over; when every query has exhausted, the chain honestly ends
 * (null) — never a fabricated loop.
 */
async function categorySearchPage(
  key: string,
  cursor: ExploreCategorySearchCursor,
  limit: number,
): Promise<{ videos: VideoDTO[]; nextCursor: string | null }> {
  const query = EXPLORE_CATEGORY_SEEDS[key][cursor.qi];
  const page = await getSearchVideoPage(query, { type: "video" }, cursor.t, limit);
  if (page.nextCursor) {
    return {
      videos: page.videos,
      nextCursor: encodeCursor({ s: "ecats", k: key, qi: cursor.qi, t: page.nextCursor }),
    };
  }
  // this seed query exhausted — advance to the next query with a captured
  // token (the pool entry holds the token table; a cache hit in the common case)
  const pool = await categoryPool(key);
  for (let qi = cursor.qi + 1; qi < EXPLORE_CATEGORY_SEEDS[key].length; qi++) {
    const tok = pool.tokens[qi];
    if (typeof tok === "string" && tok.length > 0) {
      return { videos: page.videos, nextCursor: encodeCursor({ s: "ecats", k: key, qi, t: tok }) };
    }
  }
  return { videos: page.videos, nextCursor: null };
}

export interface ExploreCategoryPage {
  category: string;
  videos: VideoDTO[];
  nextCursor: string | null;
}

/**
 * One page of a category's browse grid. `cursor` is an opaque envelope from a
 * previous page (invalid/cross-category values must have been rejected by the
 * route via decodeExploreCategoryCursor — this function trusts its input).
 * The first (cursorless) page is the pool's head window + the chain cursor.
 */
export async function getExploreCategoryPage(
  key: string,
  cursor: ExploreCategoryPoolCursor | ExploreCategorySearchCursor | null,
  limit: number,
): Promise<ExploreCategoryPage> {
  if (cursor?.s === "ecat") {
    const page = await categoryPoolPage(key, cursor, limit);
    return { category: key, ...page };
  }
  if (cursor?.s === "ecats") {
    const page = await categorySearchPage(key, cursor, limit);
    return { category: key, ...page };
  }
  const pool = await categoryPool(key);
  return {
    category: key,
    videos: pool.videos.slice(0, limit),
    nextCursor: nextCategoryCursor(key, limit, pool.tokens, pool.videos.length),
  };
}
