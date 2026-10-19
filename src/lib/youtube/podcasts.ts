/**
 * P25 G13 — youtube.com's podcasts destination surface (/podcasts), the
 * trending SSR read's sibling.
 *
 * Measured 2026-10-19 from this sandbox egress (the packet's evidence pack,
 * the binding baseline): https://www.youtube.com/podcasts answers 200 (~200KB)
 * with the REAL public surface — responseContext browse_id
 * "FEpodcasts_destination", logged_in=0 — NOT the REA-3B FEwhat_to_watch
 * nudge shell. The served shape:
 *  - header.pageHeaderRenderer.pageHeaderViewModel: the "Podcasts" title;
 *  - contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.
 *    richGridRenderer.contents[] = richSectionRenderer → richShelfRenderer
 *    shelves (the measured page: Popular episodes / Popular podcasts /
 *    Live now / nine topic shelves / Popular podcast creators);
 *  - the shelf cards: videoRenderer (episodes — the EXISTING
 *    mapVideoRenderer maps them), lockupViewModel
 *    LOCKUP_CONTENT_TYPE_PODCAST (the podcast SHOW cards: playlist id +
 *    square studio thumbnail + the episodes badge + the publisher row +
 *    "Updated …" + the "View full podcast" /playlist?list= target + the
 *    card's own Play-all /watch?v=…&list=… target), gridChannelRenderer
 *    (creator cards);
 *  - ZERO continuationItemRenderer / continuationCommand anywhere — the
 *    surface is ONE page. No sentinel, no chips, no fabricated scroll.
 *
 * The InnerTube browse form (browseId FEpodcasts_destination) answers 400
 * INVALID_ARGUMENT from this egress (measured) — the SSR HTML read is the
 * real seam, exactly like trending's ssr.ts path.
 */
import { fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { mapVideoRenderer, runsText, lastThumbnailUrl } from "./mappers";
import type { PodcastCreatorDTO, PodcastShelfDTO, PodcastShowDTO } from "@/lib/types";

/** youtube.com's own podcasts destination path (the measured surface). */
export const PODCASTS_SSR_PATH = "/podcasts";

/** The one served page title fallback (the response's own header wins). */
const FALLBACK_TITLE = "Podcasts";

/** The measured served header title ("Podcasts"). */
function podcastsTitle(data: Record<string, any>): string {
  const content =
    data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.title
      ?.dynamicTextViewModel?.text?.content;
  return typeof content === "string" && content.trim() ? content.trim() : FALLBACK_TITLE;
}

/** richShelfRenderer.title → text (simpleText or the first run). */
function shelfTitle(shelf: any): string {
  const t = shelf?.title;
  const text = typeof t?.simpleText === "string" ? t.simpleText : runsText(t);
  return text.trim();
}

/**
 * lockupViewModel (LOCKUP_CONTENT_TYPE_PODCAST) → PodcastShowDTO.
 * Honest per-field: every absent field maps to null (never guessed); a
 * lockup without a usable playlist id or title is dropped upstream.
 */
export function mapPodcastShow(l: any): PodcastShowDTO | null {
  const playlistId = l?.contentId;
  if (typeof playlistId !== "string" || !playlistId) return null;
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const title = typeof lmv?.title?.content === "string" ? lmv.title.content.trim() : "";
  if (!title) return null; // skeleton/promo lockups carry no title

  // the metadata rows (measured): [publisher + /@handle command] ·
  // ["Updated …" no command] · ["View full podcast" → /playlist?list=]
  const rows = lmv?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  let publisherName: string | null = null;
  let publisherHandle: string | null = null;
  let publisherVerified = false;
  let updatedText: string | null = null;
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text;
      const content = typeof text?.content === "string" ? text.content : "";
      if (!content) continue;
      const runs = text?.commandRuns ?? [];
      if (runs.length > 0) {
        // a command-carrying row: the publisher (channel browseEndpoint) or
        // the "View full podcast" link (derivable from contentId — skipped)
        const url =
          runs[0]?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url ?? "";
        const browse = runs[0]?.onTap?.innertubeCommand?.browseEndpoint ?? {};
        if (url.startsWith("/@") || browse.browseId) {
          if (publisherName === null) {
            publisherName = content;
            if (url.startsWith("/@")) publisherHandle = url.slice(1);
            // the verified check-badge rides the publisher row's attachmentRuns
            publisherVerified = JSON.stringify(part).includes("CHECK_CIRCLE_FILLED");
          }
        }
      } else if (updatedText === null && !/^view full podcast$/i.test(content)) {
        // the plain "Updated …" row (the first no-command non-link row)
        updatedText = content;
      }
    }
  }

  // the episodes badge lives in the thumbnail overlay badges (measured:
  // "139 episodes" + the BROADCAST icon)
  let episodeCountText: string | null = null;
  const overlays =
    l?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel
      ?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? []) {
      const text = badge?.thumbnailBadgeViewModel?.text;
      if (typeof text === "string" && text.trim()) episodeCountText = text.trim();
    }
  }

  // the square studio thumbnail (the largest source, measured 240/480/720)
  const sources =
    l?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image
      ?.sources ?? [];

  // the card's own Play-all target (the measured watchEndpoint)
  const watch =
    l?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint ?? {};
  const playAllVideoId = typeof watch?.videoId === "string" && watch.videoId ? watch.videoId : null;

  return {
    playlistId,
    title,
    publisherName,
    publisherHandle,
    publisherVerified,
    episodeCountText,
    updatedText,
    thumbnailUrl: sources.length ? sources[sources.length - 1].url : null,
    playAllVideoId,
  };
}

/** gridChannelRenderer → PodcastCreatorDTO (the measured card shape). */
export function mapPodcastCreator(r: any): PodcastCreatorDTO | null {
  const id = r?.channelId;
  if (typeof id !== "string" || !id) return null;
  const canonical = r?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handle = canonical.startsWith("/@") ? canonical.slice(1) : id;
  // videoCountText is runs ("5,014" + " videos"); subscriberCountText is simple
  const videoCountText = runsText(r?.videoCountText) || null;
  const subscriberCountText = runsText(r?.subscriberCountText) || null;
  return {
    id,
    handle,
    name: runsText(r?.title).trim(),
    avatarUrl: lastThumbnailUrl(r?.thumbnail) || null,
    subscriberCountText,
    videoCountText,
  };
}

/**
 * One shelf → PodcastShelfDTO. The three card families keep their document
 * order within the shelf (episodes/shows/creators arrays); an item that
 * fails to map is SKIPPED — never a fabricated slot; a shelf whose every
 * item failed (or that carries no items) returns null and is dropped.
 */
function mapShelf(shelf: any): PodcastShelfDTO | null {
  const title = shelfTitle(shelf);
  if (!title) return null;
  const episodes: PodcastShelfDTO["episodes"] = [];
  const shows: PodcastShowDTO[] = [];
  const creators: PodcastCreatorDTO[] = [];
  for (const item of shelf?.contents ?? []) {
    const content = item?.richItemRenderer?.content ?? {};
    if (content.videoRenderer) {
      const dto = mapVideoRenderer(content.videoRenderer);
      if (dto) episodes.push(dto);
    } else if (content.lockupViewModel) {
      const show = mapPodcastShow(content.lockupViewModel);
      if (show) shows.push(show);
    } else if (content.gridChannelRenderer) {
      const creator = mapPodcastCreator(content.gridChannelRenderer);
      if (creator) creators.push(creator);
    }
    // any other card family: honestly unmapped today (the measured page
    // carries none) — skipped, never guessed
  }
  if (episodes.length === 0 && shows.length === 0 && creators.length === 0) return null;
  return { title, episodes, shows, creators };
}

/** The measured one-page parse: the header title + the shelf family in order. */
export function parsePodcastsPage(data: Record<string, any>): {
  title: string;
  shelves: PodcastShelfDTO[];
} {
  const shelves: PodcastShelfDTO[] = [];
  const contents =
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.richGridRenderer?.contents ?? [];
  for (const item of contents) {
    const shelf = item?.richSectionRenderer?.content?.richShelfRenderer;
    if (!shelf) continue;
    const dto = mapShelf(shelf);
    if (dto) shelves.push(dto);
  }
  return { title: podcastsTitle(data), shelves };
}

/**
 * The podcasts destination page (cached 5 min — the FEED_MS soft TTL +
 * SWR family every feed read rides). Live calls ONLY from the running
 * route (the fixtures-only test law); throws only when the SSR fetch
 * itself fails (the route's honest 502).
 */
export async function getPodcastsPage(): Promise<{
  title: string;
  shelves: PodcastShelfDTO[];
}> {
  return cached(`yt:podcasts:destination`, TTL.FEED_MS, async () => {
    const data = await fetchYtInitialData(PODCASTS_SSR_PATH);
    return parsePodcastsPage(data);
  });
}
