/**
 * WFX2-A-B search — youtubei search with filter params + result mapping
 * (videos, channels, playlists — the SearchPageDTO the UI consumes).
 * WFX2-B-W additions (additive): playlist result cards, the spelling
 * correction, the results-count text, channel-result metadata.
 */
import { innertubeSearch } from "./innertube";
import { cached, TTL } from "./cache";
import { buildSearchParam, parseSearchFilters, type SearchFilters } from "./filters";
import { mapVideos, mapChannelRenderer, mapPlaylistRenderer, walkTree } from "./mappers";
import { channelFromLastGood } from "./channels";
import { mapSearchCorrection, searchResultCountText, mapSearchPlaylists } from "./search-parity";
import type { ChannelLite, PlaylistLiteDTO, SearchCorrection, VideoDTO } from "@/lib/types";

export interface SearchResults {
  query: string;
  videos: VideoDTO[];
  channels: ChannelLite[];
  /** WFX2-B-W: playlist result cards (lockupViewModel + classic renderer) */
  playlists: PlaylistLiteDTO[];
  /** WFX2-B-W: "About N results" from estimatedResults */
  resultCountText: string | null;
  /** WFX2-B-W: didYouMean / showingResultsFor spelling correction */
  correction: SearchCorrection | null;
  /** WFX2-P6-IS: the response's own continuation token — the next results
   *  page's cursor (null = the results honestly ended; mirrors feeds'
   *  getSearchVideoPage mechanics: the token POSTs back as {continuation}). */
  nextCursor: string | null;
}

/**
 * The next-page continuation token from a search response — ANY page's shape.
 *
 * WFX2-P22-C (the infinite-scroll regression): first pages wrap results in
 * `contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer`
 * (token = the section's trailing continuationItemRenderer), but CONTINUATION
 * pages (a {continuation} POST) return `onResponseReceivedCommands[0]
 * .appendContinuationItemsAction.continuationItems` with NO sectionListRenderer
 * anywhere (live-verified 2026-10-10 — see tests/fixtures/yt/search_page2_append.json,
 * a real page-2 capture). Walking only sectionListRenderer therefore read
 * page 1's token and then null on every later page: the search grid died
 * after 2 pages, and the home compose's search phase got ONE page per seed
 * query before the whole chain ended — "I don't have infinite scrolling
 * anymore".
 *
 * The fix mirrors feeds' feedContinuationToken / subscriptions'
 * subscriptionsContinuationToken: walk the WHOLE tree for
 * `continuationItemRenderer` nodes (present in BOTH shapes, at the results
 * tail) and take the first token. The header chip bar's
 * chipCloudChipRenderer.navigationEndpoint tokens are NOT inside a
 * continuationItemRenderer, so they can never be mistaken for the
 * pagination token. The legacy `sectionListRenderer.continuations`
 * arm stays for old-shape captures.
 */
export function searchContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  for (const section of walkTree(response, "sectionListRenderer")) {
    const token = section?.continuations?.[0]?.nextContinuationData?.continuation;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/**
 * Live search. `filters` carries sort / uploadDate / duration / type (see
 * filters.ts for the verified protobuf encoding) + the live/verbatim flags.
 * `cursor` (WFX2-P6-IS) pages the results: it is the PREVIOUS page's own
 * continuation token (searchContinuationToken above) — the token encodes the
 * whole filtered query, so continuation pages need nothing else upstream.
 */
export async function searchYouTube(
  query: string,
  filters: SearchFilters = {},
  cursor?: string
): Promise<SearchResults> {
  const params = cursor ? undefined : buildSearchParam(filters) || undefined;
  const cacheKey = `yt:search:${query}:${JSON.stringify(filters)}:${cursor ?? ""}`;
  const response = await cached(cacheKey, TTL.SEARCH_MS, () =>
    innertubeSearch(cursor ? { continuation: cursor } : { query, ...(params ? { params } : {}) })
  );

  const videos = mapVideos(response, { dedupe: true, limit: 40 });
  const channels: ChannelLite[] = [];
  const seenChannels = new Set<string>();
  for (const r of walkTree(response, "channelRenderer")) {
    const dto = mapChannelRenderer(r);
    if (!dto || seenChannels.has(dto.id)) continue;
    seenChannels.add(dto.id);
    channels.push(dto);
  }
  // WFX2-B-S item 14 — the channel-renderer wall: mixed searches from server
  // egress can omit channel renderers entirely. When the query matches a
  // channel handle served through the resilient channel path, that
  // channel's LAST-GOOD header fills the row (exact handle match — never a
  // guessed attribution); otherwise the honest empty stands.
  if (channels.length === 0) {
    const fromCache = await channelFromLastGood(query);
    if (fromCache && !seenChannels.has(fromCache.id)) {
      seenChannels.add(fromCache.id);
      channels.push(fromCache);
    }
  }
  // type=channel searches are all-channel; mixed results carry a compact row
  const channelLimit = filters.type === "channel" ? 24 : 6;
  if (channels.length > channelLimit) channels.length = channelLimit;
  return {
    query,
    videos,
    channels,
    playlists: cursor ? [] : mapSearchPlaylists(response, 12),
    resultCountText: cursor ? null : searchResultCountText(response),
    correction: cursor ? null : mapSearchCorrection(response),
    nextCursor: searchContinuationToken(response),
  };
}

/** Playlist results (search type=playlist) — available for later waves. */
export function playlistsIn(response: unknown) {
  return walkTree(response, "playlistRenderer")
    .map(mapPlaylistRenderer)
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
