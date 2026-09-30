/**
 * WFX2-C-F channel search-compose — the channel family's wall-proof third rung.
 *
 * youtube.com walls the channel-read family for ALL server egress (verified
 * live by the lead — evidence across the wave-C probes): the `@handle` SSR
 * scrape 404s, the browse-by-UCid answers a 200 *skeleton* (no title/tabs/
 * videos), and the type=channel search returns decoy renderers (plausible
 * UCids, empty titles). What still works: the plain video search — real
 * videoRenderers, each carrying REAL channel fields (channelId, channel
 * name, channel thumbnail). This module composes the channel family from
 * that data with exact-id honesty:
 *
 *  - resolveChannelFromSearch(handle): a NAME search on the handle (the "@"
 *    stripped) whose results are grouped by the channelId they actually
 *    carry. The dominant channel = the id owning a SUPERMAJORITY (>= 60%)
 *    of the results that have channel fields; below the threshold the
 *    resolution is null (the honest degrade stands). Never attribute by
 *    name similarity — only by the id that actually owns the results; and
 *    when the requested handle IS a "UC…" id, that exact id must be the
 *    dominant one. Cached under `yt:channel:resolve:<normalized>` (adapter
 *    TTL + the adapter's default last-good) so repeated channel reads
 *    never re-search.
 *  - composeChannelPage(handle): the composed ChannelPageDTO — the REAL
 *    fields the search results carry (id, name, handle, avatar, verified)
 *    flagged `composed: true`, with honest nulls for the fields search
 *    cannot carry (subscriberCount/banner/description — NEVER invented
 *    numbers). Videos/shorts are the id-filtered results (exact-id).
 *  - storeComposedPage: keeps the composed page in the `yt:channel:page:*`
 *    family (the requested handle's key + the resolved real handle's key
 *    when that key holds no live entry) so repeated reads and the
 *    search-route channelFromLastGood lookup both work.
 *
 * Every upstream call rides the adapter (`cached`) — no uncached paths.
 */
import { innertubeSearch } from "./innertube";
import { cached, TTL } from "./cache";
import { cacheJsonSet, cachePeek } from "./upstash-cache";
import { mapVideos, walkTree, lastThumbnailUrl } from "./mappers";
import type { ChannelPageDTO, VideoDTO } from "@/lib/types";

/**
 * Mirrors channels.ts `normalizeChannelHandle` (kept local on purpose:
 * channels.ts imports this module for the ladder rung — importing back
 * would create a module cycle; the key families must stay byte-identical).
 */
function normalizeHandle(handle: string): string {
  return decodeURIComponent(handle).trim().toLowerCase();
}

/** The channel-page family key (mirrors channels.ts `channelPageCacheKey`). */
function pageCacheKey(handle: string): string {
  return `yt:channel:page:${normalizeHandle(handle)}`;
}

/** The resolve cache key — WFX2-C-F: repeated channel reads never re-search. */
export function resolveChannelCacheKey(handle: string): string {
  return `yt:channel:resolve:${normalizeHandle(handle)}`;
}

/** The supermajority threshold: the id owning >= 60% of the name-search
 * results that have channel fields IS the channel. */
const DOMINANT_SHARE = 0.6;

/** The channel a name search resolved to — every field real (search-carried). */
export interface ChannelSearchResolution {
  channelId: string;
  channelName: string;
  /** the real "@handle" from the results' bylines, or the UC… id */
  channelHandle: string;
  avatarUrl: string;
  verified: boolean;
  /** the real search results owned by channelId (exact-id — never guessed) */
  videos: VideoDTO[];
}

/** The channelId a raw videoRenderer carries (the channelFromBylineRuns
 * extraction: the owner block or the byline runs' browseEndpoint.browseId). */
function rendererChannelId(r: any): string {
  const runs =
    r?.owner?.videoOwnerRenderer?.title?.runs ??
    r?.ownerText?.runs ??
    r?.longBylineText?.runs ??
    r?.shortBylineText?.runs;
  const first = Array.isArray(runs) ? runs[0] : null;
  const id = first?.navigationEndpoint?.browseEndpoint?.browseId;
  return typeof id === "string" ? id : "";
}

/**
 * The channel avatar the search videoRenderers carry — the renderer's own
 * avatar block (the current unified shape), the classic channel thumbnail,
 * or the owner block's thumbnail. The mapped VideoDTO leaves avatarUrl
 * empty for search results, so the compose extracts it from the raw
 * renderers of the dominant id. Empty when the results carry none.
 */
function channelAvatarFromRenderers(renderers: unknown[], channelId: string): string {
  for (const r of renderers as any[]) {
    if (rendererChannelId(r) !== channelId) continue;
    const url =
      lastThumbnailUrl(r?.avatar?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image) ||
      lastThumbnailUrl(r?.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail) ||
      lastThumbnailUrl(r?.owner?.videoOwnerRenderer?.thumbnail);
    if (url) return url;
  }
  return "";
}

/**
 * The dominant channel of a search response — pure (no upstream, no cache):
 * group the mapped results by the channelId they carry; the dominant id must
 * own >= DOMINANT_SHARE of the results that have channel fields.
 * `expectedId` (present when the requested handle IS a "UC…" id) adds the
 * exact-id guard: the dominant id must BE the requested one. Null below the
 * threshold — the honest degrade stands (never a name-similarity guess).
 */
export function resolveFromSearchResponse(
  response: unknown,
  expectedId?: string
): ChannelSearchResolution | null {
  // map EVERY result (no page-size limit) — the supermajority must count all
  // the real results, not a truncated first page
  const videos = mapVideos(response, { dedupe: true });
  const groups = new Map<string, VideoDTO[]>();
  let withChannelFields = 0;
  for (const v of videos) {
    if (!v.channel.id) continue; // results without channel fields never count
    withChannelFields++;
    const list = groups.get(v.channel.id);
    if (list) list.push(v);
    else groups.set(v.channel.id, [v]);
  }
  if (withChannelFields === 0) return null;

  let dominantId = "";
  let dominantVideos: VideoDTO[] = [];
  for (const [id, list] of groups) {
    if (list.length > dominantVideos.length) {
      dominantId = id;
      dominantVideos = list;
    }
  }
  // exact-id honesty for UC… handles: the dominant id must be the requested
  // one — a name search that someone else dominates resolves to nothing
  if (expectedId && dominantId !== expectedId) return null;
  if (dominantVideos.length / withChannelFields < DOMINANT_SHARE) return null;

  const first = dominantVideos.find((v) => v.channel.name) ?? dominantVideos[0];
  const rawHandle = first.channel.handle;
  const channelHandle =
    rawHandle.startsWith("@") || /^UC[\w-]{20,}$/.test(rawHandle) ? rawHandle : dominantId;
  return {
    channelId: dominantId,
    channelName: first.channel.name,
    channelHandle,
    avatarUrl: channelAvatarFromRenderers(walkTree(response, "videoRenderer"), dominantId),
    verified: dominantVideos.some((v) => v.channel.verified),
    videos: dominantVideos.slice(0, 40), // page-size parity with the search family
  };
}

/**
 * Resolve "@handle" / bare name / "UC…" through a NAME search on the handle
 * (the "@" stripped): the dominant channel of the results IS the channel.
 * Rides the adapter under `yt:channel:resolve:<normalized>` (feed TTL, the
 * adapter's default last-good — a null resolution is an honest value, cached
 * so repeated channel reads never re-search). Null below the supermajority
 * threshold.
 */
export async function resolveChannelFromSearch(
  handle: string
): Promise<ChannelSearchResolution | null> {
  const cleaned = decodeURIComponent(handle).trim();
  if (!cleaned) return null;
  const query = cleaned.startsWith("@") ? cleaned.slice(1) : cleaned;
  if (!query) return null;
  const isUcId = /^UC[\w-]{20,}$/.test(cleaned);
  return cached(resolveChannelCacheKey(cleaned), TTL.FEED_MS, async () => {
    const response = await innertubeSearch({ query });
    return resolveFromSearchResponse(response, isUcId ? cleaned : undefined);
  });
}

/**
 * The composed channel page from a resolution — the REAL fields the search
 * results carry, `composed: true`, and honest nulls for the fields search
 * cannot carry (subscriberCount/banner/description — NEVER invented
 * numbers). Videos: the id-filtered results, shorts excluded; shorts: the
 * id-filtered results' shorts when any, else honest empty. Tabs: only
 * Videos (the one tab the compose can actually fill — honest about the
 * rest). joinable: false (membership data needs the walled paths).
 */
export function composeChannelPageFromResolution(
  resolution: ChannelSearchResolution
): ChannelPageDTO {
  const videos = resolution.videos.filter((v) => !v.isShort);
  const shorts = resolution.videos.filter((v) => v.isShort);
  return {
    channel: {
      id: resolution.channelId,
      handle: resolution.channelHandle,
      name: resolution.channelName,
      avatarUrl: resolution.avatarUrl,
      verified: resolution.verified,
      subscriberCount: 0, // honest: search results carry no subscriber data
      subscriberCountText: null, // honest
      bannerUrl: null, // honest: search results carry no banner
      description: null, // honest: search results carry no channel description
      createdAt: null,
      isSubscribed: false, // honest: subscribe state needs the session-scoped browse
      isOwner: false,
      videoCount: videos.length, // the real count of composed rows
      composed: true, // WFX2-C-F: the mandatory compose marker
    },
    videos,
    shorts,
    tabs: ["videos"],
    joinable: false,
  };
}

/** Compose the channel page for a handle — null when the name search does not
 * resolve (below the supermajority threshold — the honest degrade stands). */
export async function composeChannelPage(handle: string): Promise<ChannelPageDTO | null> {
  const resolution = await resolveChannelFromSearch(handle);
  if (!resolution) return null;
  return composeChannelPageFromResolution(resolution);
}

/** The composed page's family entry (structurally channels.ts's
 * ChannelPageResult — kept local to avoid the module cycle). */
interface PageFamilyEntry {
  page: ChannelPageDTO;
  walled: boolean;
}

/**
 * Keep the composed page in the `yt:channel:page:*` family: the requested
 * handle's key AND the resolved real handle's key when that key holds no
 * live entry (never clobbers a stored browse last-good). A plain TTL — after
 * it expires the next read honestly re-attempts the browse ladder first.
 */
export async function storeComposedPage(handle: string, page: ChannelPageDTO): Promise<void> {
  const entry: PageFamilyEntry = { page, walled: false };
  await cacheJsonSet(pageCacheKey(handle), entry, TTL.FEED_MS);
  const requestedKey = pageCacheKey(handle);
  const realKey = pageCacheKey(page.channel.handle);
  if (realKey !== requestedKey) {
    const existing = await cachePeek<PageFamilyEntry>(realKey);
    if (!existing) await cacheJsonSet(realKey, entry, TTL.FEED_MS);
  }
}
