/**
 * WFX2-A-B search — youtubei search with filter params + result mapping
 * (videos, channels, playlists — the SearchPageDTO the UI consumes).
 */
import { innertubeSearch } from "./innertube";
import { cached, TTL } from "./cache";
import { buildSearchParam, parseSearchFilters, type SearchFilters } from "./filters";
import { mapVideos, mapChannelRenderer, mapPlaylistRenderer, walkTree } from "./mappers";
import type { ChannelLite, VideoDTO } from "@/lib/types";

export interface SearchResults {
  query: string;
  videos: VideoDTO[];
  channels: ChannelLite[];
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

/**
 * Live search. `filters` carries sort / uploadDate / duration / type (see
 * filters.ts for the verified protobuf encoding).
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
  if (channels.length > 3) channels.length = 3; // the UI renders a compact channel row
  return { query, videos, channels };
}

/** Playlist results (search type=playlist) — available for later waves. */
export function playlistsIn(response: unknown) {
  return walkTree(response, "playlistRenderer")
    .map(mapPlaylistRenderer)
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
