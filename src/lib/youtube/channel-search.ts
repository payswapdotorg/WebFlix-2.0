/**
 * WFX2-B-W in-channel search — the "Search this channel" flow.
 *
 * Mechanism (LIVE-VERIFIED from this sandbox — evidence/wfx2bw/DISCOVERY.md):
 *   POST browse {browseId: "UC…", params: <channel-search-tab params>, query}
 * The channel's own response carries its Search tab as an
 * `expandableTabRenderer` (title "Search") whose endpoint holds the params —
 * captured from the real response: `EgZzZWFyY2jyBgQKAloA` (channel-agnostic;
 * same tab-param family as the Videos tab `EgZ2aWRlb3PyBgQKAjoA`). The
 * response returns the channel page with the Search tab populated by
 * channel-scoped videoRenderers (verified: Rick Astley + "never" → 24
 * channel-only results, all his own videos).
 *
 * Derivation note: the packet suggested `b64{2: query, 6: 8}` — that encoding
 * returns the channel page with an EMPTY Search tab (probed live). The tab
 * params + `query` body field is the mechanism the real response itself uses.
 */
import { innertubeBrowse } from "./innertube";
import { cached, TTL } from "./cache";
import { mapVideos, walkTree } from "./mappers";
import { resolveChannel } from "./channels";
import type { VideoDTO } from "@/lib/types";

/** Live-verified constant (the real channel Search tab params). */
export const CHANNEL_SEARCH_TAB_PARAM = "EgZzZWFyY2jyBgQKAloA";

/**
 * The channel's own Search tab params, extracted from its browse response
 * (expandableTabRenderer title "Search" → endpoint.browseEndpoint.params).
 * Null when the response carries no search tab — callers use the constant.
 */
export function channelSearchTabParams(channelResponse: unknown): string | null {
  for (const tab of walkTree(channelResponse, "expandableTabRenderer")) {
    const title = typeof tab?.title === "string" ? tab.title.toLowerCase() : "";
    const params = tab?.endpoint?.browseEndpoint?.params;
    if (title === "search" && typeof params === "string" && params) return params;
  }
  return null;
}

function continuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

export interface ChannelSearchPage {
  query: string;
  channelId: string;
  channelName: string;
  videos: VideoDTO[];
  nextCursor: string | null;
}

/** Search inside a channel (@handle / UC… / bare handle), channel-scoped. */
export async function searchInChannel(
  handle: string,
  query: string,
  cursor?: string
): Promise<ChannelSearchPage | null> {
  const cleaned = decodeURIComponent(handle).trim();
  const term = query.trim();
  if (!cleaned || (!term && !cursor)) return null;

  const lookup = await resolveChannel(cleaned);
  if (!lookup || !lookup.header) return null;

  const tabParams =
    channelSearchTabParams(lookup.homeResponse) ?? CHANNEL_SEARCH_TAB_PARAM;

  const body: Record<string, unknown> = cursor
    ? { browseId: lookup.browseId, params: tabParams, continuation: cursor }
    : { browseId: lookup.browseId, params: tabParams, query: term };

  const response = await cached(
    `yt:channel:search:${lookup.browseId}:${term}:${cursor ?? ""}`,
    TTL.SEARCH_MS,
    () => innertubeBrowse(body)
  );

  const videos = mapVideos(response, { dedupe: true, limit: 40 }).filter((v) => !v.isShort);
  return {
    query: term,
    channelId: lookup.browseId,
    channelName: lookup.header.name,
    videos,
    nextCursor: continuationToken(response),
  };
}
