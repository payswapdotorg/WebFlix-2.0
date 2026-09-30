/**
 * WFX2-A-B channels — resolve a handle/@handle/UC… to the real channel page:
 * header (name, handle, avatar, banner, subscriber count, verified, tabs) +
 * the videos tab + the shorts shelf.
 *
 * Resolution paths (both public, verified live):
 *  - "UC…" → POST browse {browseId}
 *  - "@name" (or bare name) → SSR page /@name → ytInitialData carries the
 *    header + channelMetadataRenderer.externalId (UC…) → browse for the tabs.
 * The videos-tab param comes from the response's own tab list (the classic
 * constant "EgZ2aWRlb3MyBgQKAjoA" is the fallback).
 */
import { innertubeBrowse, innertubeSearch } from "./innertube";
import { fetchYtInitialData } from "./ssr";
import { cached, cachedResilient, TTL } from "./cache";
import { cachePeek } from "./upstash-cache";
import { hasSession } from "./session";
import {
  mapChannelHeader,
  mapVideos,
  mapShorts,
  walkTree,
  findFirst,
  channelTabsFromResponse,
  channelJoinable,
  type ChannelHeaderDTO,
} from "./mappers";
import type { ChannelPageDTO } from "@/lib/types";

const VIDEOS_TAB_FALLBACK_PARAM = "EgZ2aWRlb3MyBgQKAjoA";

/** Normalize a handle for cache keys ("@RickAstley" | "rickastley" | "UC…"). */
export function normalizeChannelHandle(handle: string): string {
  return decodeURIComponent(handle).trim().toLowerCase();
}

/** The channel-page last-good cache key (the "channel family" root). */
export function channelPageCacheKey(handle: string): string {
  return `yt:channel:page:${normalizeChannelHandle(handle)}`;
}

export interface ChannelLookup {
  browseId: string;
  handle: string;
  header: ChannelHeaderDTO | null;
  homeResponse: unknown;
}

function tabParams(response: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tab of walkTree(response, "tabRenderer")) {
    const title = tab?.title;
    const params = tab?.endpoint?.browseEndpoint?.params;
    if (typeof title === "string" && typeof params === "string") out[title] = params;
  }
  return out;
}

/** Resolve "@handle" / "UC…" / bare handle → the channel's browse response. */
export async function resolveChannel(handle: string): Promise<ChannelLookup | null> {
  const cleaned = decodeURIComponent(handle).trim();
  if (!cleaned) return null;

  if (/^UC[\w-]{20,}$/.test(cleaned)) {
    const response = await cached(`yt:channel:home:${cleaned}`, TTL.FEED_MS, () =>
      innertubeBrowse({ browseId: cleaned })
    );
    const header = mapChannelHeader(response);
    if (!header) return null;
    return {
      browseId: header.id || cleaned,
      handle: header.handle || cleaned,
      header,
      homeResponse: response,
    };
  }

  const atHandle = cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
  const ssr = await cached(`yt:channel:ssr:${atHandle.toLowerCase()}`, TTL.FEED_MS, () =>
    fetchYtInitialData(`/${atHandle}`)
  );
  const externalId = findFirst(ssr, "channelMetadataRenderer")?.externalId;
  if (typeof externalId !== "string" || !externalId) {
    // last resort: channel search resolution
    const search = await innertubeSearch({ query: atHandle, params: "EgIQAg==" }); // type=channel
    const channelId = findFirst(search, "channelRenderer")?.channelId;
    if (typeof channelId !== "string" || !channelId) return null;
    const response = await cached(`yt:channel:home:${channelId}`, TTL.FEED_MS, () =>
      innertubeBrowse({ browseId: channelId })
    );
    const header = mapChannelHeader(response);
    return { browseId: channelId, handle: atHandle, header, homeResponse: response };
  }
  const ssrHeader = mapChannelHeader(ssr);
  const response = await cached(`yt:channel:home:${externalId}`, TTL.FEED_MS, () =>
    innertubeBrowse({ browseId: externalId })
  );
  const header = mapChannelHeader(response) ?? ssrHeader;
  return { browseId: externalId, handle: atHandle, header, homeResponse: response };
}

/** The channel page payload (header + videos tab + shorts shelf). */
export async function getChannelPage(handle: string): Promise<ChannelPageDTO | null> {
  const lookup = await resolveChannel(handle);
  if (!lookup || !lookup.header) return null;

  const tabs = { ...tabParams(lookup.homeResponse) };
  const videosParam = tabs["Videos"] ?? VIDEOS_TAB_FALLBACK_PARAM;
  const videosResponse = await cached(`yt:channel:videos:${lookup.browseId}`, TTL.FEED_MS, () =>
    innertubeBrowse({ browseId: lookup.browseId, params: videosParam })
  );
  const videos = mapVideos(videosResponse, { dedupe: true }).filter((v) => !v.isShort);
  const shorts = mapShorts(lookup.homeResponse, 12).length
    ? mapShorts(lookup.homeResponse, 12)
    : mapShorts(videosResponse, 12);

  // subscribe state is only honest with a session; the browse response's
  // subscribeButton reflects the requesting session
  let isSubscribed = false;
  if (hasSession()) {
    const sub = findFirst(lookup.homeResponse, "subscribeButtonRenderer");
    isSubscribed = sub?.subscribed === true;
  }

  const header = lookup.header;
  return {
    channel: {
      id: header.id || lookup.browseId,
      handle: header.handle || lookup.handle,
      name: header.name,
      avatarUrl: header.avatarUrl,
      verified: header.verified,
      subscriberCount: header.subscriberCount,
      subscriberCountText: header.subscriberCountText,
      bannerUrl: header.bannerUrl,
      description: header.description,
      createdAt: null, // the About panel owns the join date (WFX2-B-S)
      isSubscribed,
      isOwner: false, // single-tenant mode: the operator's own channel is rare; not exposed here
      videoCount: parseVideoCountText(header.videoCountText) || videos.length,
    },
    videos,
    shorts,
    // WFX2-B-S: the response's own tab list + the Join button renderer
    tabs: channelTabsFromResponse(lookup.homeResponse),
    joinable: channelJoinable(lookup.homeResponse),
  };
}

/**
 * The channel page under the cutover resilience contract (WFX2-B-S — the
 * live production gap): the whole read (SSR @handle scrape + browse) is
 * cached through `cachedResilient` with an unhealthy-shape predicate — the
 * walled/failed shape is NEVER cached, a last-good page serves when the
 * wall hits, and a cold walled read returns the honest
 * `{page: null, walled: true}` marker for the route to degrade with
 * (HTTP 200 + structured empty — never a naked 502).
 */
export interface ChannelPageResult {
  page: ChannelPageDTO | null;
  walled: boolean;
}

export async function getChannelPageResilient(handle: string): Promise<ChannelPageResult> {
  return cachedResilient(
    channelPageCacheKey(handle),
    TTL.FEED_MS,
    async (): Promise<ChannelPageResult> => {
      try {
        const page = await getChannelPage(handle);
        if (!page) return { page: null, walled: true };
        return { page, walled: false };
      } catch {
        // the walled @handle scrape throws (SSR 404 on datacenter egress) —
        // the honest marker, cached last-good kept intact
        return { page: null, walled: true };
      }
    },
    { isEmpty: (v: unknown) => (v as ChannelPageResult | null)?.walled === true }
  );
}

/**
 * The channel last-good family lookup (WFX2-B-S item 14): when search
 * upstream omits channel renderers (the wall signature — mixed searches
 * from server egress return video renderers only), a query that matches a
 * channel handle served through the resilient channel path resolves to
 * that channel's LAST-GOOD page header. Exact handle match only ("@name"
 * or bare "name" == the cached handle) — never a guessed attribution.
 * Returns null when no last-good entry exists (the honest empty).
 */
export async function channelFromLastGood(query: string): Promise<ChannelLiteRow | null> {
  const cleaned = query.trim();
  if (!cleaned) return null;
  const atHandle = cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
  const keys = [channelPageCacheKey(atHandle), channelPageCacheKey(cleaned)];
  for (const key of keys) {
    const peeked = await cachePeek<ChannelPageResult>(key);
    if (peeked && peeked.value.page) {
      return fromPage(peeked.value.page);
    }
  }
  return null;
}

export interface ChannelLiteRow {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
  subscriberCount: number;
  subscriberCountText: string | null;
  description: string | null;
}

function fromPage(page: ChannelPageDTO): ChannelLiteRow {
  return {
    id: page.channel.id,
    handle: page.channel.handle,
    name: page.channel.name,
    avatarUrl: page.channel.avatarUrl,
    verified: page.channel.verified,
    subscriberCount: page.channel.subscriberCount,
    subscriberCountText: page.channel.subscriberCountText ?? null,
    description: page.channel.description ?? null,
  };
}

function parseVideoCountText(text: string | null | undefined): number {
  if (!text) return 0;
  const m = /^\s*([\d.,]+)\s*(K|M|B)?\s*videos?\s*$/i.exec(text);
  if (!m) return 0;
  const mult = m[2]
    ? ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[m[2].toUpperCase()]!
    : 1;
  return Math.round(Number(m[1].replace(/,/g, "")) * mult);
}
