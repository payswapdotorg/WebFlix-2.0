/**
 * WFX2-A-B feeds — home (browse FEwhat_to_watch), trending (SSR parse),
 * paginated video lists (browse/search continuations as cursors), and
 * history (SSR, session-gated) for continue-watching.
 *
 * Ground rules honored here (research log):
 *  - browse FEtrending is REJECTED server-side (400) → trending is SSR-only;
 *  - SSR surfaces always send cookie auth when a session exists;
 *  - the trending category pages are the semantic URLs /feed/trending/music|gaming|movies.
 *
 * WFX2-HR — the default home ("All" mode) and the /api/videos default feed
 * climb a three-rung ladder and NEVER serve empty rails while real search
 * data is available (search is NOT walled for the server egress — verified
 * live, while browse FEwhat_to_watch is):
 *   rung 1  browse-fresh     — the healthy FEwhat_to_watch answer;
 *   rung 2  browse-last-good — the adapter's Upstash last-good (24h window)
 *                              served when the wall shape hits;
 *   rung 3  search-compose   — REAL search results merged + deduped into the
 *                              home rails (curated general-interest queries,
 *                              the existing shorts seed, and a second-pass
 *                              because-you-watched rail seeded by the top
 *                              results' channels). Every call reuses the
 *                              existing cached search keys — no new uncached
 *                              upstream paths.
 */
import { innertubeBrowse, innertubeSearch } from "./innertube";
import { upstreamFetch } from "./upstream";
import { fetchYtInitialData } from "./ssr";
import { cached, cachedResilient, cachePeek, TTL } from "./cache";
import {
  decodeComposeCursor,
  encodeCursor,
  type ComposeSearchCursor,
  type PoolCursor,
} from "./cursors";
import { hasSession } from "./session";
import { mapVideos, mapShorts, walkTree, runsText, viewsFromTexts, watchUrl, shortsThumbnailUrl } from "./mappers";
import { getShortsSeed, type ShortDTO, type ShortsFeedDTO } from "./shorts";
import { buildSearchParam, parseSearchFilters } from "./filters";
import type { ContinueVideoDTO, HomeFeedDTO, HomeFeedSource, VideoDTO } from "@/lib/types";
import { HOME_CHIPS } from "@/lib/categories";

// ---------------------------------------------------------------------------
// home feed
// ---------------------------------------------------------------------------

/** Extract (title, videos) pairs from the response's real shelves. */
export function mapHomeShelves(response: unknown): { title: string | null; videos: VideoDTO[] }[] {
  const shelves: { title: string | null; videos: VideoDTO[] }[] = [];
  for (const section of walkTree(response, "richSectionRenderer")) {
    const shelf = section?.content?.richShelfRenderer;
    if (!shelf) continue;
    const title = runsText(shelf?.title) || null;
    const videos = mapVideos(shelf, { dedupe: true });
    if (videos.length > 0 || title) shelves.push({ title, videos });
  }
  for (const shelf of walkTree(response, "shelfRenderer")) {
    const title = runsText(shelf?.title) || null;
    const videos = mapVideos(shelf, { dedupe: true });
    if (videos.length > 0 || title) shelves.push({ title, videos });
  }
  return shelves;
}

/**
 * WFX2-C-W — the walled-browse detector: youtube.com answers the InnerTube
 * browse call with 200 + a body that maps to ZERO content when the request
 * comes from a datacenter IP (Vercel egress — verified live 2026-09-30).
 * Such answers are "unhealthy": they must never be cached and must never
 * overwrite a good payload.
 */
function homeResponseIsEmpty(response: unknown): boolean {
  return (
    mapVideos(response, { dedupe: true }).length === 0 &&
    mapShorts(response, 12).length === 0 &&
    mapHomeShelves(response).length === 0
  );
}

/** The home browse entry's cache key (shared by the ladder's source probe). */
const HOME_BROWSE_CACHE_KEY = "yt:home:feed";

/**
 * The home browse response — the cutover's production fix for empty rails:
 * Upstash-backed (L1+L2), stale-while-revalidate past the 5-minute soft TTL,
 * and last-good serving while the Vercel egress is walled (upstream failure
 * OR the 200-but-empty shape above). The 24-hour hard window means one warm
 * from an unwalled runner (a daily warmer cadence, scripts/warm-cache.mjs)
 * keeps home alive for a full day. With no last-good
 * the honest empty feed is returned — never fake data.
 */
function fetchHomeBrowseResponse(): Promise<unknown> {
  return cachedResilient(
    HOME_BROWSE_CACHE_KEY,
    TTL.FEED_MS,
    () => innertubeBrowse({ browseId: "FEwhat_to_watch" }),
    { isEmpty: homeResponseIsEmpty, hardTtlMs: TTL.HOME_HARD_MS },
  );
}

export async function getHomeFeed(rawCategory: string | null): Promise<HomeFeedDTO> {
  const category = HOME_CHIPS.includes(rawCategory ?? "") ? (rawCategory as string) : "All";

  if (category !== "All") {
    // category mode: search-backed flat grid (architecture parity map: chips → search)
    const page = await getSearchVideoPage(category, { type: "video" }, undefined, 48);
    return {
      hero: null,
      trending: [],
      continueWatching: [],
      becauseYouWatched: null,
      shorts: [],
      recommended: page.videos,
      recommendedCursor: page.nextCursor,
      chips: HOME_CHIPS,
      source: "search-compose", // the category grid is composed from real search data
    };
  }

  // rungs 1–2 live inside the resilient cache (browse-fresh, then last-good);
  // a hard upstream failure with no last-good throws — the compose catches it.
  let response: unknown;
  try {
    response = await fetchHomeBrowseResponse();
  } catch {
    return composeHomeFeedFromSearch(); // rung 3 — both browse rungs missed
  }
  if (homeResponseIsEmpty(response)) {
    // the walled 200-but-empty shape with no last-good → rung 3
    return composeHomeFeedFromSearch();
  }

  const shelves = mapHomeShelves(response);
  const feedVideos = mapVideos(response, { dedupe: true });
  const shorts = mapShorts(response, 12);

  const hero = feedVideos.find((v) => !v.isShort && !v.isLive) ?? null;
  const heroId = hero?.id ?? "";

  // becauseYouWatched: the first titled non-shorts shelf — its real title
  const becauseShelf = shelves.find(
    (s) => s.title && !/shorts/i.test(s.title) && s.videos.length > 0
  );
  const becauseYouWatched =
    becauseShelf && becauseShelf.title
      ? {
          label: becauseShelf.title,
          videos: becauseShelf.videos
            .filter((v) => v.id !== heroId)
            .slice(0, 12)
            .map((v) => ({ ...v, isShort: v.isShort })),
        }
      : null;

  const railIds = new Set<string>([
    heroId,
    ...shorts.map((s) => s.id),
    ...(becauseYouWatched?.videos.map((v) => v.id) ?? []),
  ]);
  const recommended = feedVideos.filter((v) => !railIds.has(v.id) && !v.isShort).slice(0, 24);
  const recommendedCursor = feedContinuationToken(response);

  // continue watching: history SSR (session only; omit gracefully otherwise)
  const continueWatching = hasSession() ? await getContinueWatching() : [];

  // rungs 1–2 served a healthy payload — label which one (read-only probe:
  // a fresh entry is rung 1's answer; a stale-but-hard-valid entry was served
  // by the last-good/SWR path → rung 2)
  const peek = await cachePeek<unknown>(HOME_BROWSE_CACHE_KEY);
  const source: HomeFeedSource = peek?.fresh ? "browse" : "last-good";

  return {
    hero,
    trending: [], // the home response carries no "trending" shelf; the page links to /trending
    continueWatching,
    becauseYouWatched,
    shorts,
    recommended,
    recommendedCursor,
    chips: HOME_CHIPS,
    source,
  };
}

function feedContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

// ---------------------------------------------------------------------------
// WFX2-HR rung 3 — the search-backed compose (never empty while search lives)
// ---------------------------------------------------------------------------

/**
 * Curated general-interest queries mirroring youtube's signed-out category
 * mix — live-verified to yield ~21 video results each through the unwalled
 * search endpoint (probe, 2026-10-02). Each page rides the EXISTING search
 * cache keys (yt:searchpage:…), so the compose is itself Upstash-cached.
 */
const HOME_COMPOSE_QUERIES: readonly string[] = [
  "most viewed youtube videos",
  "trending music",
  "popular gaming",
];

/**
 * Fixed per-query page size so every compose consumer (home rails, /api/videos
 * default feed) reads the SAME cached search pages — one upstream page per
 * query serves the whole ladder.
 */
const COMPOSE_PAGE_LIMIT = 24;

/** The compose's because-you-watched rail size (browse-mode parity: 12). */
const COMPOSE_BYW_LIMIT = 12;

/** The compose's shorts rail size (browse-mode parity: 12). */
const COMPOSE_SHORTS_LIMIT = 12;

/** The cached compose pool entry (see composeSearchPool). */
interface ComposePool {
  /** the merged, query-order, id-deduped first-pass videos */
  videos: VideoDTO[];
  /** HOME_COMPOSE_QUERIES[i]'s first-page continuation token (null = failed/none) */
  tokens: (string | null)[];
}

/**
 * The merged first-pass pool: every compose query's REAL search results,
 * merged in query order and de-duplicated by id, PLUS each seed query's
 * first-page continuation token captured at compose time. Per-query failures
 * are tolerated (best-effort merge; a failed query's token is null); only
 * when EVERY query fails — search itself is down — does this throw, surfacing
 * the honest upstream error.
 *
 * WFX2-P6-IS: the WHOLE pool is one cached value — a pool cursor's offset
 * must slice the identical list on every page (a fresh merge could reshuffle
 * the underlying search answers mid-scroll), so pages read this same entry.
 * The per-query pages inside still ride their own yt:searchpage:… keys — no
 * new uncached upstream paths.
 */
async function composeSearchPool(): Promise<ComposePool> {
  return cached("yt:compose:pool", TTL.SEARCH_MS, async () => {
    const pages = await Promise.all(
      HOME_COMPOSE_QUERIES.map((query) =>
        getSearchVideoPage(query, { type: "video" }, undefined, COMPOSE_PAGE_LIMIT).catch(
          () => null,
        ),
      ),
    );
    const okPages = pages.filter((page): page is VideoPage => page !== null);
    if (okPages.length === 0) {
      throw new Error("home compose: every search query failed (search is down)");
    }
    const tokens = pages.map((page) => page?.nextCursor ?? null);
    const seen = new Set<string>();
    const merged: VideoDTO[] = [];
    for (const page of okPages) {
      for (const video of page.videos) {
        if (seen.has(video.id)) continue;
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
 * The rung-3 chain's next cursor after consuming the pool through `offset`:
 * pool windows remain → a pool cursor; the pool is exhausted → the search-phase
 * cursor for the first seed query that captured a continuation token (its
 * FIRST page's videos are already in the pool, so the token starts the next);
 * every query tokenless → null (the honest end — nothing real left to page).
 */
function nextComposeCursor(
  offset: number,
  tokens: (string | null)[],
  poolLength: number,
): string | null {
  if (offset < poolLength) return encodeCursor({ s: "pool", o: offset, t: tokens });
  const qi = firstTokenQuery(tokens);
  if (qi === -1) return null;
  return encodeCursor({ s: "search", qi, t: tokens[qi] as string });
}

/**
 * A pool cursor's page: slice [o, o+limit) from the SAME cached pool the
 * first page composed (identical windows across pages — the pool is one
 * cached value). A cursor whose offset is already past the pool (it shrank,
 * or the direct-emission edge was skipped) transitions to the search phase
 * immediately, so a page is never empty-with-a-cursor (an empty page would
 * strand the grid's sentinel while it stays in view).
 */
async function composePoolPage(cursor: PoolCursor, limit: number): Promise<VideoPage> {
  const pool = await composeSearchPool();
  if (cursor.o < pool.videos.length) {
    const videos = pool.videos.slice(cursor.o, cursor.o + limit);
    return {
      videos,
      nextCursor: nextComposeCursor(cursor.o + limit, cursor.t, pool.videos.length),
    };
  }
  const qi = firstTokenQuery(cursor.t);
  if (qi === -1) return { videos: [], nextCursor: null };
  return composeSearchPage({ s: "search", qi, t: cursor.t[qi] as string }, limit);
}

/**
 * A search-phase cursor's page: one live search continuation for seed query
 * `qi` (the cursor's own token). The query's own continuation token keeps the
 * chain; when it exhausts, the NEXT seed query's captured first token takes
 * over; when every query has exhausted, the chain honestly ends (null) —
 * with the pool plus each seed query's continuation depth this is dozens of
 * real pages, and never a fabricated loop.
 */
async function composeSearchPage(cursor: ComposeSearchCursor, limit: number): Promise<VideoPage> {
  const query = HOME_COMPOSE_QUERIES[cursor.qi];
  const page = await getSearchVideoPage(query, { type: "video" }, cursor.t, limit);
  if (page.nextCursor) {
    return {
      videos: page.videos,
      nextCursor: encodeCursor({ s: "search", qi: cursor.qi, t: page.nextCursor }),
    };
  }
  // this seed query exhausted — advance to the next query with a captured
  // token. The pool entry holds the token table; it is read lazily (only on
  // this boundary) because it is a cache hit in the common case.
  const pool = await composeSearchPool();
  for (let qi = cursor.qi + 1; qi < HOME_COMPOSE_QUERIES.length; qi++) {
    const tok = pool.tokens[qi];
    if (typeof tok === "string" && tok.length > 0) {
      return { videos: page.videos, nextCursor: encodeCursor({ s: "search", qi, t: tok }) };
    }
  }
  return { videos: page.videos, nextCursor: null };
}

/**
 * The existing shorts seed (unwalled — already live on /api/shorts) mapped to
 * the home shorts-card DTO. Rides the SAME "shorts:seed" cache entry the
 * shorts route uses, and threads the shared upstream seam so fixture tests
 * stay hermetic. Best-effort: a seed failure leaves the rail honestly empty.
 */
async function composeShortsRail(): Promise<VideoDTO[]> {
  try {
    const seed = await cachedResilient(
      "shorts:seed",
      TTL.SHORTS_SEED_MS,
      () => getShortsSeed(seamShortsFetcher()),
      { isEmpty: (f) => (f as ShortsFeedDTO).items.length === 0 },
    );
    return seed.items.slice(0, COMPOSE_SHORTS_LIMIT).map(shortSeedToVideo);
  } catch {
    return []; // honest empty rail — the compose itself still serves
  }
}

/**
 * The shared upstream seam as a `typeof fetch` fetcher for the shorts module
 * (its helpers default to the global fetch; the seam routes them through the
 * injected test fake, keeping the no-live-network law for the compose path).
 */
function seamShortsFetcher(): typeof fetch {
  return Object.assign(
    (url: RequestInfo | URL, init?: RequestInit) => upstreamFetch()(String(url), init),
    { preconnect: () => {} },
  );
}

/** One seed item → the canonical shorts-card VideoDTO (browse-mode parity). */
function shortSeedToVideo(s: ShortDTO): VideoDTO {
  return {
    id: s.id,
    title: s.title,
    description: "",
    thumbnailUrl: shortsThumbnailUrl(s.id),
    videoUrl: watchUrl(s.id),
    durationSec: null,
    views: viewsFromTexts(s.viewsText, null),
    viewsText: s.viewsText,
    publishedText: null,
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "All",
    isShort: true,
    isLive: false,
    premieredAt: null,
    createdAt: null,
    badges: [],
    channel: {
      id: s.channel.id,
      handle: s.channel.handle ?? s.channel.id,
      name: s.channel.name ?? s.channel.handle ?? s.channel.id,
      avatarUrl: s.channel.avatarUrl ?? "",
      verified: false,
      subscriberCount: 0,
    },
  };
}

/**
 * The anonymous because-you-watched rail: a second-pass query set seeded by
 * the first pass's top results (query = the top videos' REAL channel names —
 * honest anonymous-mode parity with youtube's signed-out home). Best-effort:
 * failures or empty second passes leave the rail absent.
 */
async function composeBecauseYouWatched(
  merged: VideoDTO[],
  heroId: string
): Promise<HomeFeedDTO["becauseYouWatched"]> {
  const top = merged.find((v) => v.id === heroId) ?? merged.find((v) => !v.isShort && !v.isLive);
  if (!top) return null;
  const seedQueries: string[] = [];
  for (const video of merged) {
    if (video.isShort || video.isLive) continue;
    const channel = video.channel.name.trim();
    if (channel && !seedQueries.includes(channel)) seedQueries.push(channel);
    if (seedQueries.length >= 2) break; // bounded second pass (2 cached pages)
  }
  if (seedQueries.length === 0) return null;
  const pages = await Promise.all(
    seedQueries.map((query) =>
      getSearchVideoPage(query, { type: "video" }, undefined, COMPOSE_BYW_LIMIT)
        .then((page) => page.videos)
        .catch(() => null),
    ),
  );
  const seen = new Set<string>([heroId]);
  const videos: VideoDTO[] = [];
  for (const page of pages) {
    if (!page) continue;
    for (const video of page) {
      if (video.isShort || seen.has(video.id)) continue;
      seen.add(video.id);
      videos.push(video);
    }
  }
  if (videos.length === 0) return null;
  return { label: top.title, videos: videos.slice(0, COMPOSE_BYW_LIMIT) };
}

/**
 * The pool prefix the composed feed already rendered (hero + the recommended
 * rail) — the grid's continuation cursor resumes right after it, so the
 * first scrolled page never repeats what the feed itself showed.
 */
function consumedPoolPrefix(merged: VideoDTO[], heroId: string, recommended: VideoDTO[]): number {
  const shown = new Set<string>([heroId, ...recommended.map((v) => v.id)]);
  let consumed = 0;
  merged.forEach((video, i) => {
    if (shown.has(video.id)) consumed = i + 1;
  });
  return consumed;
}

/**
 * Rung 3 — the full default home composed from REAL search data: hero = the
 * top pick of the merged set, shorts = the existing seed, becauseYouWatched =
 * the second-pass channel rail, recommended = the rest of the merge. No
 * browse continuation exists for a composed feed, so WFX2-P6-IS hands the
 * grid the rung-3 compose cursor instead: the pool resumes right after the
 * prefix the feed showed, then the seed queries' live continuations carry
 * the scroll on (the /api/videos All-mode path speaks the same envelopes).
 */
async function composeHomeFeedFromSearch(): Promise<HomeFeedDTO> {
  const pool = await composeSearchPool(); // throws only when search itself fails
  const merged = pool.videos;

  const hero = merged.find((v) => !v.isShort && !v.isLive) ?? null;
  const heroId = hero?.id ?? "";

  const [shorts, becauseYouWatched, continueWatching] = await Promise.all([
    composeShortsRail(),
    composeBecauseYouWatched(merged, heroId),
    hasSession() ? getContinueWatching() : Promise.resolve([]),
  ]);

  const railIds = new Set<string>([
    heroId,
    ...shorts.map((s) => s.id),
    ...(becauseYouWatched?.videos.map((v) => v.id) ?? []),
  ]);
  const recommended = merged.filter((v) => !railIds.has(v.id) && !v.isShort).slice(0, 24);
  const recommendedCursor = nextComposeCursor(
    consumedPoolPrefix(merged, heroId, recommended),
    pool.tokens,
    merged.length,
  );

  return {
    hero,
    trending: [],
    continueWatching,
    becauseYouWatched,
    shorts,
    recommended,
    recommendedCursor,
    chips: HOME_CHIPS,
    source: "search-compose",
  };
}

// ---------------------------------------------------------------------------
// history (continue watching)
// ---------------------------------------------------------------------------

export async function getContinueWatching(limit = 12): Promise<ContinueVideoDTO[]> {
  if (!hasSession()) return [];
  const response = await cached("yt:history", TTL.FEED_MS, () =>
    fetchYtInitialData("/feed/history")
  );
  const videos = mapVideos(response, { dedupe: true }).filter((v) => !v.isShort);
  const nowIso = new Date().toISOString();
  return videos.slice(0, limit).map((v) => ({
    ...v,
    watchedSec: 0, // the SSR response carries no resume position (A-W's client memory owns it)
    watchedAt: nowIso, // history is reverse-chronological; exact timestamps are not in the response
  }));
}

// ---------------------------------------------------------------------------
// trending (SSR-only — the browse XHR is rejected with 400)
// ---------------------------------------------------------------------------

const TRENDING_CATEGORY_PATHS: Record<string, string> = {
  Music: "/feed/trending/music",
  Gaming: "/feed/trending/gaming",
  Live: "/feed/trending/live",
  News: "/feed/trending/news",
  Movies: "/feed/trending/movies",
  Sports: "/feed/trending/sport",
};

export async function getTrending(category: string): Promise<VideoDTO[]> {
  const path = TRENDING_CATEGORY_PATHS[category] ?? "/feed/trending";
  const response = await cached(`yt:trending:${path}`, TTL.FEED_MS, () =>
    fetchYtInitialData(path)
  );
  return mapVideos(response, { dedupe: true, limit: 48 });
}

// ---------------------------------------------------------------------------
// paginated video lists — /api/videos (continuation tokens as cursors)
// ---------------------------------------------------------------------------

export interface VideoPage {
  videos: VideoDTO[];
  nextCursor: string | null;
}

function searchContinuationToken(response: unknown): string | null {
  const sections = walkTree(response, "sectionListRenderer");
  for (const section of sections) {
    for (const item of section?.continuationItems ?? section?.contents ?? []) {
      const token =
        item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === "string" && token) return token;
    }
    const token = section?.continuations?.[0]?.nextContinuationData?.continuation;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/** One search-backed page of videos with its continuation cursor.
 * WFX2-C-W: cursorless (first) pages are cached through the Upstash adapter —
 * search is NOT walled for Vercel egress, so this is pure performance; the
 * adapter still adds last-good on upstream failure. Continuation pages use
 * unique opaque tokens — they pass straight through. */
export async function getSearchVideoPage(
  query: string,
  filters: { sort?: string; uploadDate?: string; duration?: string; type?: string },
  cursor: string | undefined,
  limit: number
): Promise<VideoPage> {
  const fetchPage = async (): Promise<VideoPage> => {
    const params = cursor ? undefined : buildSearchParam(parseSearchFilters(filters)) || undefined;
    const body: Record<string, unknown> = cursor
      ? { continuation: cursor }
      : { query, ...(params ? { params } : {}) };
    const response = await innertubeSearch(body);
    return { videos: mapVideos(response, { dedupe: true, limit }), nextCursor: searchContinuationToken(response) };
  };
  if (cursor) return fetchPage();
  return cached(
    `yt:searchpage:${query.toLowerCase()}:${JSON.stringify(filters)}:${limit}`,
    TTL.SEARCH_MS,
    fetchPage,
  );
}

/** One browse-backed page (home continuation or category browse). */
export async function getBrowseVideoPage(
  cursor: string | undefined,
  limit: number
): Promise<VideoPage> {
  const response = cursor
    ? await innertubeBrowse({ continuation: cursor })
    : await fetchHomeBrowseResponse();
  const videos = mapVideos(response, { dedupe: true, limit });
  return { videos, nextCursor: feedContinuationToken(response) };
}

/** /api/videos implementation — `q=` and category routes search (search is
 * NOT walled for Vercel egress — this is the `/api/videos?q=music` production
 * fix); the default page climbs the SAME home ladder: browse-fresh →
 * browse-last-good → search-compose (it shares the home feed's compose pool
 * and cache keys, so the default feed is never empty while search lives).
 * WFX2-P6-IS — the cursor pages: rungs 1–2 keep their NATIVE browse
 * continuation tokens exactly as before; rung 3's pages now speak the
 * self-contained compose envelopes (cursors.ts): pool offsets through the
 * cached merged pool, then the seed queries' live search continuations, then
 * the honest null end. A native token never decodes as an envelope, and a
 * continuation still never composes — the discrimination is by shape. */
export async function listLiveVideos(opts: {
  cursor?: string | null;
  category?: string | null;
  limit?: number;
  query?: string | null;
}): Promise<VideoPage> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 48);
  const query = (opts.query ?? "").trim();
  if (query) {
    return getSearchVideoPage(query, { type: "video" }, opts.cursor ?? undefined, limit);
  }
  const category = HOME_CHIPS.includes(opts.category ?? "") ? (opts.category as string) : "All";
  if (category !== "All") {
    return getSearchVideoPage(category, { type: "video" }, opts.cursor ?? undefined, limit);
  }
  if (!opts.cursor) {
    // rungs 1–2: the resilient home browse cache (fresh, then last-good)
    try {
      const page = await getBrowseVideoPage(undefined, limit);
      if (page.videos.length > 0) return page;
    } catch {
      // hard browse failure with no last-good — fall through to rung 3
    }
    // rung 3: the search-backed compose — first pool window + the chain cursor
    const pool = await composeSearchPool();
    return {
      videos: pool.videos.slice(0, limit),
      nextCursor: nextComposeCursor(limit, pool.tokens, pool.videos.length),
    };
  }
  const compose = decodeComposeCursor(opts.cursor, HOME_COMPOSE_QUERIES.length);
  if (compose?.s === "pool") return composePoolPage(compose, limit);
  if (compose?.s === "search") return composeSearchPage(compose, limit);
  return getBrowseVideoPage(opts.cursor, limit);
}
