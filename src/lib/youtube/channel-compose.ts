/**
 * WFX2-C-F channel search-compose — the channel family's wall-proof third
 * rung. WFX2-CF-2 (the lead's live-verification followup): the dominance
 * rule + the watch-meta header enrichment. WFX2-CF-3 (the stability fix):
 * the resilient resolve + the 2-hour composed-page store.
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
 *    carry. WFX2-CF-2 dominance rule (the live finding: a dominant REAL
 *    channel — "Rick Astley" from either egress — attributes 44-56% of the
 *    results with the runner-up at ~16%; the bare 60% supermajority
 *    declined it and the honest degrade served): the dominant id IS the
 *    channel when it owns >= 40% of the attributed results AND >= 2x the
 *    runner-up's count, OR an absolute >= 60% supermajority. Below both →
 *    null (the honest degrade stands). Never attribute by name similarity
 *    — only by the id that actually owns the results; and when the
 *    requested handle IS a "UC…" id, that exact id must be the dominant
 *    one. Resilient under `yt:channel:resolve:<normalized>` (WFX2-CF-3: a
 *    NULL resolution is the unhealthy shape — never cached, never
 *    overwrites; the last-good resolution serves within the resolve key
 *    family's default hard window) so a flaky search can never poison the
 *    window.
 *  - composeChannelPage(handle): the composed ChannelPageDTO — the REAL
 *    fields the search results carry (id, name, handle, avatar, verified)
 *    flagged `composed: true`. WFX2-CF-2 watch-meta enrichment: the top
 *    video of the resolved channel rides the EXISTING watch path
 *    (getVideoDetail → the `yt:watch:<videoId>` cache family — unwalled,
 *    real data) and the composed header gains the REAL subscriberCount/
 *    subscriberCountText/verified/handle/avatarUrl that payload carries —
 *    the fields the search results cannot (no more honest-nulls where real
 *    data is one unwalled call away). On any watch failure (or a watch
 *    owner that is not the resolved channel — exact-id honesty) the
 *    search-carried fields + honest nulls stand (never fabricated);
 *    bannerUrl/description are ALWAYS honest nulls (no path carries them).
 *    Videos/shorts are the id-filtered results (exact-id).
 *  - storeComposedPage: keeps the composed page in the `yt:channel:page:*`
 *    family (the requested handle's key + the resolved real handle's key
 *    when that key holds no live entry) so repeated reads and the
 *    search-route channelFromLastGood lookup both work. WFX2-CF-3: a
 *    plain 2-hour TTL — one successful compose buys hours of stable
 *    serving.
 *
 * Every upstream call rides the adapter (`cached`/`cachedResilient`) — no
 * uncached paths.
 */
import { innertubeSearch } from "./innertube";
import { cachedResilient, TTL } from "./cache";
import { cacheJsonSet, cachePeek } from "./upstash-cache";
import { mapVideos, walkTree, lastThumbnailUrl } from "./mappers";
import { getVideoDetail } from "./watch";
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

/** The supermajority branch: the id owning >= 60% of the name-search
 * results that have channel fields IS the channel outright. */
const DOMINANT_SHARE = 0.6;

/** WFX2-CF-2 — the dominance branch's floor: a share below 40% is never a
 * dominant channel, however weak the field (the honest degrade stands). */
const DOMINANCE_SHARE = 0.4;

/** WFX2-CF-2 — the dominance branch's lead: the dominant count must be at
 * least 2x the runner-up's (the live finding: 44-56% over a ~16% runner-up
 * resolves; a 45-vs-30 split does not). */
const DOMINANCE_RUNNER_UP_MULT = 2;

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
 * group the mapped results by the channelId they carry, then the WFX2-CF-2
 * dominance rule — the dominant id IS the channel when it owns
 *   >= 60% of the attributed results (supermajority), OR
 *   >= 40% AND >= 2x the runner-up's count (dominance — counts over the
 *   same denominator ARE shares, so the count comparison is the share
 *   comparison).
 * `expectedId` (present when the requested handle IS a "UC…" id) adds the
 * exact-id guard: the dominant id must BE the requested one. Null below
 * both thresholds — the honest degrade stands (never a name-similarity
 * guess, never a mere plurality).
 */
export function resolveFromSearchResponse(
  response: unknown,
  expectedId?: string
): ChannelSearchResolution | null {
  // map EVERY result (no page-size limit) — the dominance must count all
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

  // WFX2-CF-2 — the dominance rule (both branches evaluated over the same
  // denominator, so the count comparisons ARE the share comparisons):
  //   supermajority: >= 60% of the attributed results outright, OR
  //   dominance:     >= 40% AND >= 2x the runner-up's count.
  // Below both → null (the honest degrade stands — never a plurality
  // guess). The runner-up is the second-largest group; an equal-tie
  // runner-up never satisfies the 2x lead (a 50/50 split → null).
  const counts = [...groups.values()].map((list) => list.length).sort((a, b) => b - a);
  const runnerUpCount = counts[1] ?? 0;
  const dominantCount = dominantVideos.length;
  const share = dominantCount / withChannelFields;
  const supermajority = share >= DOMINANT_SHARE;
  const dominance =
    share >= DOMINANCE_SHARE && dominantCount >= DOMINANCE_RUNNER_UP_MULT * runnerUpCount;
  if (!supermajority && !dominance) return null;

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
 * (the "@" stripped): the dominant channel of the results IS the channel
 * (the WFX2-CF-2 dominance rule — see resolveFromSearchResponse). Rides the
 * adapter under `yt:channel:resolve:<normalized>` (feed TTL + the resolve
 * key family's default hard window).
 *
 * WFX2-CF-3 — the resilient resolve (the live finding: the search-result
 * channel attributions VARY between requests — the same query resolves
 * 44-56% dominant across calls, sometimes above the dominance rule,
 * sometimes below): a NULL resolution is the unhealthy shape. Under the
 * plain `cached()` a flaky null got cached for the full 5-minute TTL and
 * every channel page in that window degraded — production flapped between
 * the composed page and the honest degrade across lambda instances. The
 * standard adapter contract instead: a null is NEVER cached and never
 * overwrites; the LAST-GOOD resolution serves within the default hard
 * window, so a flaky search can no longer poison it (a genuinely
 * below-threshold handle honestly re-searches each read). Null below both
 * the dominance and supermajority thresholds.
 */
export async function resolveChannelFromSearch(
  handle: string
): Promise<ChannelSearchResolution | null> {
  const cleaned = decodeURIComponent(handle).trim();
  if (!cleaned) return null;
  const query = cleaned.startsWith("@") ? cleaned.slice(1) : cleaned;
  if (!query) return null;
  const isUcId = /^UC[\w-]{20,}$/.test(cleaned);
  return cachedResilient(
    resolveChannelCacheKey(cleaned),
    TTL.FEED_MS,
    async () => {
      const response = await innertubeSearch({ query });
      return resolveFromSearchResponse(response, isUcId ? cleaned : undefined);
    },
    { isEmpty: (v) => v === null }
  );
}

/**
 * The composed channel page from a resolution — the REAL fields the search
 * results carry, `composed: true`, and honest nulls for the fields search
 * cannot carry (subscriberCount/banner/description — NEVER invented
 * numbers; the WFX2-CF-2 watch-meta enrichment — enrichComposedPageHeader —
 * fills the subscriber fields with real data when the unwalled watch path
 * serves). Videos: the id-filtered results, shorts excluded; shorts: the
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
      subscriberCount: 0, // honest until the watch enrichment fills it (CF-2)
      subscriberCountText: null, // honest until the watch enrichment fills it (CF-2)
      bannerUrl: null, // honest: no path carries the banner
      description: null, // honest: no path carries the channel description
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

/**
 * WFX2-CF-2 — the watch-meta header enrichment: the composed page's header
 * gains the REAL channel fields the search results cannot carry. The top
 * video of the resolved channel (the top of the composed Videos rail, else
 * the top short) rides the EXISTING watch path — getVideoDetail → the
 * `yt:watch:<videoId>` cache family (unwalled, real data) — whose owner
 * block carries subscriberCount/subscriberCountText/verified/handle/
 * avatarUrl. Exact-id honesty applies to the enrichment itself: the watch
 * payload's owner must BE the resolved channel (a foreign — or empty —
 * owner id enriches nothing). On any failure the composed page keeps the
 * search-carried fields + honest nulls — never fabricated, never clobbered
 * by an empty payload. Mutates `page.channel` in place (the compose flow is
 * linear: compose → enrich → store).
 */
export async function enrichComposedPageHeader(
  page: ChannelPageDTO,
  resolution: ChannelSearchResolution
): Promise<void> {
  const top = resolution.videos.find((v) => !v.isShort) ?? resolution.videos[0];
  if (!top) return; // unreachable in practice (a resolution always owns >= 1)
  // a failed/unavailable watch call → the honest degrade stands
  const detail = await getVideoDetail(top.id).catch(() => null);
  if (!detail) return;
  const owner = detail.video.channel;
  // exact-id: the watch payload's owner must BE the resolved channel — a
  // foreign or empty owner id enriches nothing
  if (owner.id !== resolution.channelId) return;
  if (owner.subscriberCountText) {
    page.channel.subscriberCountText = owner.subscriberCountText;
    page.channel.subscriberCount = owner.subscriberCount;
  }
  if (owner.handle) page.channel.handle = owner.handle;
  if (owner.avatarUrl) page.channel.avatarUrl = owner.avatarUrl;
  page.channel.verified = owner.verified; // the watch owner badges' real state
}

/** Compose the channel page for a handle — null when the name search does not
 * resolve (below both the dominance and supermajority thresholds — the honest
 * degrade stands). A successful compose enriches the header through the
 * existing watch path (WFX2-CF-2). */
export async function composeChannelPage(handle: string): Promise<ChannelPageDTO | null> {
  const resolution = await resolveChannelFromSearch(handle);
  if (!resolution) return null;
  const page = composeChannelPageFromResolution(resolution);
  await enrichComposedPageHeader(page, resolution);
  return page;
}

/** The composed page's family entry (structurally channels.ts's
 * ChannelPageResult — kept local to avoid the module cycle). */
interface PageFamilyEntry {
  page: ChannelPageDTO;
  walled: boolean;
}

/**
 * WFX2-CF-3 — the composed-page family store window: a plain 2-hour TTL.
 * One successful compose buys hours of stable serving (the live finding: a
 * 5-minute entry re-ran the whole ladder — the walled browse re-attempt +
 * the flaky resolve — every 5 minutes and the page flapped). On expiry the
 * ladder still re-attempts the browse first: the wall stands → the
 * resilient resolve serves the last-good resolution → re-compose + re-store.
 */
const COMPOSED_STORE_MS = 2 * 3_600_000;

/**
 * Keep the composed page in the `yt:channel:page:*` family: the requested
 * handle's key AND the resolved real handle's key when that key holds no
 * live entry (never clobbers a stored browse last-good). A plain 2-hour
 * TTL (WFX2-CF-3) — after it expires the next read honestly re-attempts
 * the browse ladder first (the wall stands → the resilient resolve serves
 * → re-compose + re-store).
 */
export async function storeComposedPage(handle: string, page: ChannelPageDTO): Promise<void> {
  const entry: PageFamilyEntry = { page, walled: false };
  await cacheJsonSet(pageCacheKey(handle), entry, COMPOSED_STORE_MS);
  const requestedKey = pageCacheKey(handle);
  const realKey = pageCacheKey(page.channel.handle);
  if (realKey !== requestedKey) {
    const existing = await cachePeek<PageFamilyEntry>(realKey);
    if (!existing) await cacheJsonSet(realKey, entry, COMPOSED_STORE_MS);
  }
}
