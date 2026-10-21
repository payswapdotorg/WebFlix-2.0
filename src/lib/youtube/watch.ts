/**
 * WFX2-A-B watch metadata — `next {videoId}` is the ONLY watch-metadata
 * source (the `player` endpoint is off-limits server-side).
 *
 * Mapped from tests/fixtures/yt/next_dQw4.json (real response):
 *  - title: videoPrimaryInfoRenderer.title
 *  - viewCount: videoPrimaryInfoRenderer.viewCount.videoViewCountRenderer
 *    .viewCount.simpleText ("1,821,187,782 views" — exact)
 *  - likeCount: videoPrimaryInfoRenderer.videoActions.menuRenderer
 *    .topLevelButtons[0].segmentedLikeDislikeButtonViewModel…
 *    .accessibilityText ("like this video along with 19,427,647 other people"
 *    — exact; approx title text as fallback)
 *  - published: dateText ("Oct 25, 2009") + relativeDateText ("16 years ago")
 *  - channel: videoSecondaryInfoRenderer.owner.videoOwnerRenderer
 *    (name, avatar, subscriberCountText, browseId, canonicalBaseUrl)
 *  - description: videoSecondaryInfoRenderer.attributedDescription.content
 *  - subscribe state: videoSecondaryInfoRenderer.subscribeButton
 *    .subscribeButtonRenderer (only meaningful with a session)
 *  - durationSec: NOT carried by `next` → null (the IFrame player owns it)
 */
import { innertubeNext } from "./innertube";
import { cached, cacheInvalidate, TTL } from "./cache";
import { hasSession } from "./session";
import {
  runsText,
  parseViewCount,
  parseCompactCount,
  watchUrl,
  videoThumbnailUrl,
} from "./mappers";
import { mapRelatedPage, type RelatedPage } from "./related";
import { mapAutoplay } from "./autoplay";
import { commentsTokenFromWatchResponse } from "./comments";
import { operatorIsCreator } from "./operator";
import { directAuthConfigured, playlistContains } from "../youtube-direct";
import type { VideoDto, ViewerVideoState, VideoDetailDto, LikeValue } from "@/lib/watch/types";
import { parseChapters, type Chapter } from "@/lib/watch/chapters";

export interface WatchMetadata {
  video: VideoDto;
  state: ViewerVideoState;
  related: RelatedPage;
  autoplay: {
    video: NonNullable<RelatedPage["items"][number]> | null;
    countDownSecs: number | null;
  };
  commentsToken: string | null;
  chapters: Chapter[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 25, 2009" → ISO (robust across engines — no Date.parse magic). */
function absoluteDateToIso(text: string): string | null {
  const m = /^\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase());
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString();
}

/**
 * P21-LIVE-PREMIERES — the `next` dateText for an upcoming premiere /
 * scheduled stream is "Scheduled for Oct 9, 2026" (verified live on real
 * premieres — tests/fixtures/yt/next_premiere.json; `next` carries no
 * exact timestamp, so the watch-page premieredAt is DATE-granular — the
 * exact-to-the-second start stays YouTube's). Null for every other wording
 * (the honest absence — a regular video's date falls through to createdAt).
 */
function premiereDateFromText(dateText: string): string | null {
  const m = /^\s*(?:Scheduled for|Premieres)\s+([A-Za-z]{3}\s+\d{1,2},\s*\d{4})\s*$/.exec(dateText);
  return m ? absoluteDateToIso(m[1]) : null;
}

/** Like count from the segmented like/dislike view model (exact via a11y). */
function likeCountFrom(primaryInfo: any): { count: number; text: string | null } {
  const buttons = primaryInfo?.videoActions?.menuRenderer?.topLevelButtons ?? [];
  for (const btn of buttons) {
    const segmented = btn?.segmentedLikeDislikeButtonViewModel ?? btn?.likeButtonViewModel;
    const vm =
      segmented?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel ??
      segmented?.likeButtonViewModel?.toggleButtonViewModel ??
      segmented?.toggleButtonViewModel;
    const buttonViewModel =
      vm?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel ??
      vm?.defaultButtonViewModel?.buttonViewModel;
    if (buttonViewModel) {
      const a11y: string = buttonViewModel?.accessibilityText ?? "";
      const m = /along with ([\d,]+) other people/i.exec(a11y);
      if (m) return { count: Number(m[1].replace(/,/g, "")), text: buttonViewModel?.title ?? null };
      const title: string = buttonViewModel?.title ?? "";
      const compact = parseCompactCount(title);
      if (compact !== null) return { count: compact, text: title };
      return { count: 0, text: title || null };
    }
  }
  return { count: 0, text: null };
}

/** Pure mapper: `next` response → watch metadata (null when unavailable). */
export function mapWatchMetadata(videoId: string, response: unknown): WatchMetadata {
  const contents =
    (response as any)?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
  const primaryInfo = contents.find(
    (c: any) => c?.videoPrimaryInfoRenderer,
  )?.videoPrimaryInfoRenderer;
  const secondaryInfo = contents.find(
    (c: any) => c?.videoSecondaryInfoRenderer,
  )?.videoSecondaryInfoRenderer;
  const owner = secondaryInfo?.owner?.videoOwnerRenderer;

  const title = runsText(primaryInfo?.title);
  const viewsText =
    primaryInfo?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText ??
    primaryInfo?.viewCount?.videoViewCountRenderer?.shortViewCount?.simpleText ??
    null;
  const views = parseViewCount(viewsText) ?? 0;
  const { count: likes, text: likeCountText } = likeCountFrom(primaryInfo);
  const publishedText =
    runsText(primaryInfo?.relativeDateText) || runsText(primaryInfo?.dateText) || null;
  const absoluteDate = runsText(primaryInfo?.dateText); // "Oct 25, 2009"
  // P21-LIVE-PREMIERES: "Scheduled for Oct 9, 2026" → the premiere start
  const premieredAt = premiereDateFromText(absoluteDate);

  const channelId: string = owner?.navigationEndpoint?.browseEndpoint?.browseId ?? "";
  const canonical: string = owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handle = (canonical.startsWith("/@") ? canonical.slice(1) : "") || channelId;
  const subscriberCountText = runsText(owner?.subscriberCountText) || null;

  const description: string =
    secondaryInfo?.attributedDescription?.content ?? runsText(secondaryInfo?.description) ?? "";

  const liveBadges = JSON.stringify(primaryInfo?.badges ?? secondaryInfo?.badges ?? "");
  const isLive = /BADGE_STYLE_TYPE_LIVE/.test(liveBadges);

  const video: VideoDto = {
    id: videoId,
    title,
    description,
    videoUrl: watchUrl(videoId),
    thumbnailUrl: videoThumbnailUrl(videoId),
    durationSec: null, // `next` carries no length — the client player owns duration
    views,
    viewsText,
    publishedText,
    likeCountText,
    likes,
    dislikes: 0, // YouTube no longer exposes dislike counts
    visibility: "public",
    category: "All",
    isMembersOnly: false,
    membersTier: null,
    isShort: false,
    premieredAt,
    createdAt: absoluteDate ? absoluteDateToIso(absoluteDate) : null,
    channel: {
      id: channelId,
      handle,
      name: runsText(owner?.title),
      avatarUrl:
        (Array.isArray(owner?.thumbnail?.thumbnails) && owner.thumbnail.thumbnails.length
          ? owner.thumbnail.thumbnails[owner.thumbnail.thumbnails.length - 1].url
          : "") ?? "",
      verified: badgeVerified(owner),
      subscriberCount: parseSubscriberCountText(subscriberCountText),
      subscriberCountText,
    },
    isLive,
  };

  const subscribeButton = secondaryInfo?.subscribeButton?.subscribeButtonRenderer;
  const subscribed = hasSession() ? subscribeButton?.subscribed === true : false;

  // P35 — the viewer's rating from the SAME response (likeStatusEntity in
  // frameworkUpdates — youtube.com's own watch-load mechanism; verified live
  // 2026-10-21). The pre-P33 "like state is broker-tier" comment was stale:
  // the direct tier owns the like family since P33, and the state rides the
  // session-authenticated `next` call this mapper already consumes.
  const like: LikeValue | null = hasSession() ? likeStatusFromResponse(response, videoId) : null;

  const state: ViewerVideoState = {
    like,
    subscribed,
    bell: null,
    resumeSec: null, // client-local progress memory (A-W lane)
    // WFX2-P7-AN: the live-YouTube path carries no local ViewEvent read —
    // the watch page's watched line stays hidden (the honest degrade)
    watchedSec: null,
    playlistIds: [],
    savedWatchLater: false,
    isCreator: false,
  };

  const related = mapRelatedPage(response);
  const autoplay = mapAutoplay(response);
  const commentsToken = commentsTokenFromWatchResponse(response);
  const chapters = description ? parseChapters(description, video.durationSec) : [];

  return { video, state, related, autoplay, commentsToken, chapters };
}

function badgeVerified(owner: any): boolean {
  for (const b of owner?.badges ?? []) {
    const style = b?.metadataBadgeRenderer?.style;
    if (typeof style === "string" && style.startsWith("BADGE_STYLE_TYPE_VERIFIED")) return true;
  }
  return false;
}

function parseSubscriberCountText(text: string | null): number {
  if (!text) return 0;
  const m = /^\s*([\d.,]+)\s*([KMB])?/i.exec(text);
  if (!m) return 0;
  const mult = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()]! : 1;
  return Math.round(Number(m[1].replace(/,/g, "")) * mult);
}

/** The raw cached `next` response (comments + related share it). */
export async function watchResponse(videoId: string): Promise<Record<string, any>> {
  return cached(WATCH_CACHE_KEY(videoId), TTL.WATCH_MS, () => innertubeNext({ videoId }));
}

/** P35 — the watch-response cache key (one source of truth for read + invalidate). */
export function WATCH_CACHE_KEY(videoId: string): string {
  return `yt:watch:${videoId}`;
}

/**
 * P35 — drop the cached `next` response for a video. Called after a
 * successful server-side YouTube write (like/remove-rating, subscribe) so
 * the very next bootstrap re-fetches `next` WITH the session cookies and
 * parses the fresh likeStatusEntity / subscribeButton — the button state
 * survives a reload instead of reverting to the stale cached copy.
 */
export async function invalidateWatchCache(videoId: string): Promise<void> {
  await cacheInvalidate(WATCH_CACHE_KEY(videoId));
}

/**
 * P35 — the viewer's rating from the `next` response's entity mutations:
 * `frameworkUpdates.entityBatchUpdate.mutations[].payload.likeStatusEntity`
 * carries `{ key, likeStatus: "LIKE" | "DISLIKE" | "INDIFFERENT" }` where the
 * key is URL-encoded base64 embedding the videoId (verified live 2026-10-21:
 * the public `next` for jNQXAC9IVRw answers likeStatus INDIFFERENT, key
 * "EgtqTlFYQUM5SVZSdyA-KAE%3D"). This is exactly how youtube.com itself
 * renders your rating on watch load. Absent entity / no videoId match /
 * INDIFFERENT → null — never a guess.
 */
export function likeStatusFromResponse(response: unknown, videoId: string): LikeValue | null {
  const root = (response ?? null) as Record<string, any> | null;
  const mutations = root?.frameworkUpdates?.entityBatchUpdate?.mutations;
  if (!Array.isArray(mutations)) return null;
  for (const m of mutations) {
    const entity = m?.payload?.likeStatusEntity;
    if (!entity || typeof entity.key !== "string") continue;
    // the key embeds the videoId inside URL-encoded base64 — decode and match
    let decoded: string;
    try {
      decoded = Buffer.from(decodeURIComponent(entity.key), "base64").toString("latin1");
    } catch {
      continue;
    }
    if (!decoded.includes(videoId)) continue;
    if (entity.likeStatus === "LIKE") return "like";
    if (entity.likeStatus === "DISLIKE") return "dislike";
    return null; // INDIFFERENT (or an unknown status) — no rating
  }
  return null;
}

/** Full watch metadata (cached). */
export async function getWatchMetadata(videoId: string): Promise<WatchMetadata | null> {
  const response = await watchResponse(videoId);
  const meta = mapWatchMetadata(videoId, response);
  if (!meta.video.title) {
    // unavailable / removed videos carry no primaryInfo — surface 404 upstream
    const hasPrimary = JSON.stringify(response).includes("videoPrimaryInfoRenderer");
    if (!hasPrimary) return null;
  }
  return meta;
}

/** The /api/videos/[id] payload shape. */
export async function getVideoDetail(videoId: string): Promise<VideoDetailDto | null> {
  // P35 — the WL membership read rides BESIDE the cached meta (fresh per
  // load, session-authenticated): the save button bootstraps from the
  // server-side truth instead of the hardcoded false that made every reload
  // un-save a saved video. Parallel with the meta so latency stays one hop.
  const [meta, savedWatchLater] = await Promise.all([
    getWatchMetadata(videoId),
    readSavedWatchLater(videoId),
  ]);
  if (!meta) return null;
  // WFX2-B-S creator-mode: the operator session IS the video's channel
  // (heart/pin surface on the watch page). Public mode → false, honestly.
  const isCreator = await operatorIsCreator(meta.video.channel.id);
  return {
    video: meta.video,
    state: { ...meta.state, isCreator, savedWatchLater },
  };
}

/**
 * P35 — fresh Watch-later membership for the watch bootstrap. Honest false
 * when the direct session isn't configured or the read fails/overflows the
 * page budget (the toggle path re-reads fresh server-side before acting, so
 * a wrong false can never double-add — the ensure semantics absorb it).
 */
async function readSavedWatchLater(videoId: string): Promise<boolean> {
  if (!directAuthConfigured()) return false;
  try {
    return (await playlistContains("WL", videoId)) === true;
  } catch {
    return false;
  }
}
