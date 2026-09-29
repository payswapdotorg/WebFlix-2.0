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
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import { mapChannelHeader, mapVideos, mapShorts, walkTree, findFirst, type ChannelHeaderDTO } from "./mappers";
import type { ChannelPageDTO } from "@/lib/types";

const VIDEOS_TAB_FALLBACK_PARAM = "EgZ2aWRlb3MyBgQKAjoA";

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
      createdAt: null, // join date is not part of this response (about tab owns it — Wave B)
      isSubscribed,
      isOwner: false, // single-tenant mode: the operator's own channel is rare; not exposed here
      videoCount: parseVideoCountText(header.videoCountText) || videos.length,
    },
    videos,
    shorts,
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
