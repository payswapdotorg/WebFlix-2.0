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
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import { runsText, parseViewCount, parseCompactCount, watchUrl, videoThumbnailUrl } from "./mappers";
import { mapRelatedPage, type RelatedPage } from "./related";
import { mapAutoplay } from "./autoplay";
import { commentsTokenFromWatchResponse } from "./comments";
import { operatorIsCreator } from "./operator";
import type { VideoDto, ViewerVideoState, VideoDetailDto } from "@/lib/watch/types";
import { parseChapters, type Chapter } from "@/lib/watch/chapters";

export interface WatchMetadata {
  video: VideoDto;
  state: ViewerVideoState;
  related: RelatedPage;
  autoplay: { video: NonNullable<RelatedPage["items"][number]> | null; countDownSecs: number | null };
  commentsToken: string | null;
  chapters: Chapter[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

/** Like count from the segmented like/dislike view model (exact via a11y). */
function likeCountFrom(primaryInfo: any): { count: number; text: string | null } {
  const buttons =
    primaryInfo?.videoActions?.menuRenderer?.topLevelButtons ?? [];
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
  const primaryInfo = contents.find((c: any) => c?.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const secondaryInfo = contents.find((c: any) => c?.videoSecondaryInfoRenderer)
    ?.videoSecondaryInfoRenderer;
  const owner = secondaryInfo?.owner?.videoOwnerRenderer;

  const title = runsText(primaryInfo?.title);
  const viewsText =
    primaryInfo?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText ??
    primaryInfo?.viewCount?.videoViewCountRenderer?.shortViewCount?.simpleText ??
    null;
  const views = parseViewCount(viewsText) ?? 0;
  const { count: likes, text: likeCountText } = likeCountFrom(primaryInfo);
  const publishedText = runsText(primaryInfo?.relativeDateText) || runsText(primaryInfo?.dateText) || null;
  const absoluteDate = runsText(primaryInfo?.dateText); // "Oct 25, 2009"

  const channelId: string = owner?.navigationEndpoint?.browseEndpoint?.browseId ?? "";
  const canonical: string = owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handle =
    (canonical.startsWith("/@") ? canonical.slice(1) : "") || channelId;
  const subscriberCountText = runsText(owner?.subscriberCountText) || null;

  const description: string =
    secondaryInfo?.attributedDescription?.content ??
    runsText(secondaryInfo?.description) ??
    "";

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
    premieredAt: null,
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

  const state: ViewerVideoState = {
    like: null, // like state is broker-tier (A-W lane)
    subscribed,
    bell: null,
    resumeSec: null, // client-local progress memory (A-W lane)
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
  return cached(`yt:watch:${videoId}`, TTL.WATCH_MS, () => innertubeNext({ videoId }));
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
  const meta = await getWatchMetadata(videoId);
  if (!meta) return null;
  // WFX2-B-S creator-mode: the operator session IS the video's channel
  // (heart/pin surface on the watch page). Public mode → false, honestly.
  const isCreator = await operatorIsCreator(meta.video.channel.id);
  return { video: meta.video, state: { ...meta.state, isCreator } };
}
