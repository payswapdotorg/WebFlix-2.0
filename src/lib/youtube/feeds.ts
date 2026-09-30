/**
 * WFX2-A-B feeds — home (browse FEwhat_to_watch), trending (SSR parse),
 * paginated video lists (browse/search continuations as cursors), and
 * history (SSR, session-gated) for continue-watching.
 *
 * Ground rules honored here (research log):
 *  - browse FEtrending is REJECTED server-side (400) → trending is SSR-only;
 *  - SSR surfaces always send cookie auth when a session exists;
 *  - the trending category pages are the semantic URLs /feed/trending/music|gaming|movies.
 */
import { innertubeBrowse, innertubeSearch } from "./innertube";
import { fetchYtInitialData } from "./ssr";
import { cached, cachedResilient, TTL } from "./cache";
import { hasSession } from "./session";
import { mapVideos, mapShorts, walkTree, runsText } from "./mappers";
import { buildSearchParam, parseSearchFilters } from "./filters";
import type { ContinueVideoDTO, HomeFeedDTO, VideoDTO } from "@/lib/types";
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
    "yt:home:feed",
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
    };
  }

  const response = await fetchHomeBrowseResponse();
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

  return {
    hero,
    trending: [], // the home response carries no "trending" shelf; the page links to /trending
    continueWatching,
    becauseYouWatched,
    shorts,
    recommended,
    recommendedCursor,
    chips: HOME_CHIPS,
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
 * fix), the default page rides the resilient home browse cache. */
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
  return getBrowseVideoPage(opts.cursor ?? undefined, limit);
}
