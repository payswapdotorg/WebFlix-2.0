/**
 * WFX2-A-B mappers — walk real youtube.com responses and yield the app's DTOs.
 *
 * Every field below is mapped from an actual response field (fixtures in
 * tests/fixtures/yt/ are the shape reference); nothing is invented:
 *  - videoRenderer / gridVideoRenderer — search, feeds, channel grids
 *  - richItemRenderer — home/trending/history grids (wraps the above)
 *  - lockupViewModel — the current unified item renderer (trending, related
 *    rail, channel shelves, history, subscriptions)
 *  - shortsLockupViewModel — shorts cards
 *  - channelRenderer — search channel results
 *  - playlistRenderer — search playlist results
 * Card thumbnails hotlink `i.ytimg.com/vi/<id>/hqdefault.jpg` (regular) or
 * `oardefault.jpg` (shorts) per the architecture doc — zero egress cost.
 */
import type { ChannelLite, ChannelTabId, VideoDTO } from "@/lib/types";

// ---------------------------------------------------------------------------
// generic tree walking + text helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect every value stored at `key`, in document order — the
 * fixture shapes show how deeply nested these responses are.
 */
export function walkTree(obj: unknown, key: string): any[] {
  const out: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) out.push(v);
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(obj);
  return out;
}

/** Pick the first value at `key` anywhere in the tree (document order). */
export function findFirst(obj: unknown, key: string): any {
  return walkTree(obj, key)[0] ?? null;
}

/** runs[].text | simpleText | content — the three YouTube text encodings. */
export function runsText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.content === "string") return node.content;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? "").join("");
  return "";
}

/** Best-quality thumbnail URL from a sources/thumbnails block (WFX2-C-F:
 * exported for the channel search-compose's avatar extraction). */
export function lastThumbnailUrl(node: any): string {
  const thumbs = node?.thumbnails ?? node?.sources;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return "";
  const best = thumbs.reduce((a: any, b: any) => ((b?.width ?? 0) >= (a?.width ?? 0) ? b : a));
  return typeof best?.url === "string" ? best.url : "";
}

/** Canonical hotlinked card thumbnail (architecture doc: zero egress cost). */
export function videoThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Vertical original-aspect thumbnail for shorts cards. */
export function shortsThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ---------------------------------------------------------------------------
// numeric text parsing — every parser is total (never throws, never invents)
// ---------------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
};

const WORD_MULTIPLIERS: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** "12:34" → 754 · "1:02:03" → 3723 · "9 minutes, 26 seconds" → 566 · else null. */
export function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const compact = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (compact) {
    const h = Number(compact[1] ?? 0);
    const m = Number(compact[2]);
    const s = Number(compact[3]);
    if (m < 60 && s < 60) return h * 3600 + m * 60 + s;
    return null;
  }
  const words = /^\s*(?:(\d+)\s+hours?,\s*)?(?:(\d+)\s+minutes?,\s*)?(\d+)\s+seconds?\s*$/.exec(
    text
  );
  if (words) {
    return Number(words[1] ?? 0) * 3600 + Number(words[2] ?? 0) * 60 + Number(words[3]);
  }
  return null;
}

/** Count text → number. "1.2M"→1.2e6 · "5,561,627"→5561627 · "No views"→0. */
export function parseCompactCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*([\d.,]+)\s*([KMB])?\s*$/.exec(text);
  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const mult = m[2] ? MULTIPLIERS[m[2]] : 1;
  return Math.round(value * mult);
}

/** "1.2M views" / "5,561,627 views" / "No views" → number (0 when none). */
export function parseViewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  if (/^no views$/i.test(text.trim())) return 0;
  const compact = parseCompactCount(text.replace(/\s*views?\s*$/i, ""));
  if (compact !== null) return compact;
  return null;
}

/** Accessibility variant: "345 thousand views" → 345000. */
export function parseSpelledCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*([\d.,]+)\s*(thousand|million|billion)\b/i.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * WORD_MULTIPLIERS[m[2].toLowerCase()]);
}

/** Views from either the display text or the a11y text (a11y is expanded). */
export function viewsFromTexts(display: string | null | undefined, a11y: string | null | undefined): number {
  return (
    parseViewCount(a11y) ??
    parseSpelledCount(a11y) ??
    parseViewCount(display) ??
    parseCompactCount(display) ??
    0
  );
}

/** "4.55M subscribers" → 4550000 · "918 subscribers" → 918. */
export function parseSubscriberCount(text: string | null | undefined): number {
  if (!text) return 0;
  const spelled = parseSpelledCount(text);
  if (spelled !== null) return spelled;
  const compact = parseCompactCount(text.replace(/\s*subscribers?\s*$/i, ""));
  return compact ?? 0;
}

/** "437 videos" → 437. */
export function parseVideoCount(text: string | null | undefined): number {
  if (!text) return 0;
  const compact = parseCompactCount(text.replace(/\s*videos?\s*$/i, ""));
  return compact ?? 0;
}

const AGE_UNITS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

const AGE_UNIT_ALIASES: Record<string, string> = {
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  m: "minute", min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  d: "day", day: "day", days: "day",
  w: "week", wk: "week", week: "week", weeks: "week",
  mo: "month", month: "month", months: "month",
  y: "year", yr: "year", yrs: "year", year: "year", years: "year",
};

/**
 * Relative age passthrough → approximate ISO date ("16 years ago" → now-16y,
 * "15y ago" / "4mo ago" / "Streamed 2y ago" likewise). This derives a
 * sortable date from the real text; the exact passthrough stays in
 * `publishedText` for display.
 */
export function relativeAgeToDate(text: string | null | undefined, now = new Date()): string | null {
  if (!text) return null;
  const cleaned = text.replace(/^Streamed\s+/i, "").trim();
  const m = /^(\d+)\s*([a-z]+)\s+ago$/i.exec(cleaned);
  if (!m) return null;
  const unit = AGE_UNIT_ALIASES[m[2].toLowerCase()];
  if (!unit) return null;
  const seconds = Number(m[1]) * (AGE_UNITS[unit] ?? 0);
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// video card mappers
// ---------------------------------------------------------------------------

function emptyChannel(): ChannelLite {
  return { id: "", handle: "", name: "", avatarUrl: "", verified: false, subscriberCount: 0 };
}

function baseVideo(videoId: string, title: string): VideoDTO {
  return {
    id: videoId,
    title,
    description: "",
    thumbnailUrl: videoThumbnailUrl(videoId),
    videoUrl: watchUrl(videoId),
    durationSec: null,
    views: 0,
    viewsText: null,
    publishedText: null,
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "All",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: null,
    badges: [],
    channel: emptyChannel(),
  };
}

function badgeStyles(node: any): string[] {
  const out: string[] = [];
  for (const b of node?.ownerBadges ?? []) {
    const style = b?.metadataBadgeRenderer?.style;
    if (typeof style === "string") out.push(style.replace(/^BADGE_STYLE_TYPE_/, "").toLowerCase());
    else {
      const label = runsText(b?.metadataBadgeRenderer?.label);
      if (label) out.push(label.toLowerCase());
    }
  }
  for (const b of node?.badges ?? []) {
    const style = b?.metadataBadgeRenderer?.style;
    if (typeof style === "string") out.push(style.replace(/^BADGE_STYLE_TYPE_/, "").toLowerCase());
    else {
      const label = runsText(b?.metadataBadgeRenderer?.label);
      if (label) out.push(label.toLowerCase());
    }
  }
  return [...new Set(out)];
}

/** Text badges off thumbnail overlays (lockup view models) — duration-like
 * strings ("3:51") excluded; "Members only" is the member-only marker. */
function overlayBadgeTexts(node: any): string[] {
  const out: string[] = [];
  for (const badge of walkTree(node, "thumbnailBadgeViewModel")) {
    const text = typeof badge?.text === "string" ? badge.text.trim() : "";
    if (text && !/^\d+[\d:]*$/.test(text)) out.push(text.toLowerCase());
  }
  return [...new Set(out)];
}

function isLiveFromRenderer(node: any): boolean {
  if (badgeStyles(node).some((s) => s.includes("live"))) return true;
  for (const overlay of node?.thumbnailOverlays ?? []) {
    const style = overlay?.thumbnailOverlayTimeStatusRenderer?.style;
    if (style === "LIVE" || style === "UPCOMING") return true;
  }
  const views = runsText(node?.shortViewCountText) || runsText(node?.viewCountText);
  return /watching now$/i.test(views);
}

/** Channel-lite from a byline runs array (search/owner text). */
function channelFromBylineRuns(runs: any[] | undefined): ChannelLite {
  const first = Array.isArray(runs) ? runs[0] : null;
  const browse = first?.navigationEndpoint?.browseEndpoint ?? first?.navigationEndpoint?.commandMetadata;
  const channelId: string = first?.navigationEndpoint?.browseEndpoint?.browseId ?? "";
  const canonical: string = first?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handle = canonical.startsWith("/@")
    ? canonical.slice(1)
    : canonical.startsWith("/")
      ? canonical.slice(1)
      : channelId;
  return {
    id: channelId,
    handle: handle || channelId,
    name: runs?.map((r: any) => r?.text ?? "").join("") ?? "",
    avatarUrl: "",
    verified: false,
    subscriberCount: 0,
  };
}

/** videoRenderer → VideoDTO (search results, home/trending grids). */
export function mapVideoRenderer(r: any): VideoDTO | null {
  const id = r?.videoId;
  if (typeof id !== "string" || !id) return null;
  const dto = baseVideo(id, runsText(r?.title));
  const owner = r?.owner?.videoOwnerRenderer;
  if (owner) {
    // browse/home grids carry the owner block (avatar, subs, verified)
    dto.channel = channelFromBylineRuns(owner?.title?.runs);
    dto.channel.avatarUrl = lastThumbnailUrl(owner?.thumbnail);
    dto.channel.subscriberCountText = runsText(owner?.subscriberCountText) || null;
    dto.channel.subscriberCount = parseSubscriberCount(dto.channel.subscriberCountText);
    const ownerBadges = badgeStyles(owner);
    dto.channel.verified = ownerBadges.some((b) => b.startsWith("verified"));
  } else {
    const bylineRuns = r?.ownerText?.runs ?? r?.longBylineText?.runs ?? r?.shortBylineText?.runs;
    dto.channel = channelFromBylineRuns(bylineRuns);
  }
  dto.durationSec = parseDuration(runsText(r?.lengthText));
  dto.views = viewsFromTexts(runsText(r?.viewCountText) || runsText(r?.shortViewCountText), null);
  dto.viewsText = runsText(r?.viewCountText) || runsText(r?.shortViewCountText) || null;
  dto.publishedText = runsText(r?.publishedTimeText) || null;
  dto.createdAt = relativeAgeToDate(dto.publishedText);
  dto.badges = badgeStyles(r);
  dto.channel.verified =
    dto.channel.verified || dto.badges.some((b) => b.startsWith("verified"));
  dto.isMembersOnly = dto.badges.some((b) => b.includes("members only"));
  dto.isLive = isLiveFromRenderer(r);
  return dto;
}

/** compactVideoRenderer → VideoDTO (classic related-rail items). */
export function mapCompactVideoRenderer(r: any): VideoDTO | null {
  const id = r?.videoId;
  if (typeof id !== "string" || !id) return null;
  const dto = baseVideo(id, runsText(r?.title));
  const bylineRuns = r?.shortBylineText?.runs ?? r?.longBylineText?.runs;
  dto.channel = channelFromBylineRuns(bylineRuns);
  dto.channel.avatarUrl = lastThumbnailUrl(r?.channelThumbnail) || "";
  dto.durationSec = parseDuration(runsText(r?.lengthText));
  dto.views = viewsFromTexts(
    runsText(r?.viewCountText) || runsText(r?.shortViewCountText),
    r?.viewCountText?.simpleText
  );
  dto.viewsText = runsText(r?.shortViewCountText) || runsText(r?.viewCountText) || null;
  dto.publishedText = runsText(r?.publishedTimeText) || null;
  dto.createdAt = relativeAgeToDate(dto.publishedText);
  dto.badges = badgeStyles(r);
  dto.channel.verified = dto.badges.some((b) => b.startsWith("verified"));
  dto.isMembersOnly = dto.badges.some((b) => b.includes("members only"));
  dto.isLive = isLiveFromRenderer(r);
  return dto;
}

/** gridVideoRenderer → VideoDTO (channel video grids). */
export function mapGridVideoRenderer(r: any): VideoDTO | null {
  const id = r?.videoId;
  if (typeof id !== "string" || !id) return null;
  const dto = baseVideo(id, runsText(r?.title));
  dto.channel = channelFromBylineRuns(
    r?.ownerText?.runs ?? r?.longBylineText?.runs ?? r?.shortBylineText?.runs
  );
  dto.durationSec = parseDuration(runsText(r?.lengthText));
  dto.views = viewsFromTexts(runsText(r?.viewCountText) || runsText(r?.shortViewCountText), null);
  dto.viewsText = runsText(r?.viewCountText) || runsText(r?.shortViewCountText) || null;
  dto.publishedText = runsText(r?.publishedTimeText) || null;
  dto.createdAt = relativeAgeToDate(dto.publishedText);
  dto.badges = badgeStyles(r);
  dto.channel.verified = dto.badges.some((b) => b.startsWith("verified"));
  dto.isLive = isLiveFromRenderer(r);
  return dto;
}

interface LockupMeta {
  channelName: string;
  avatarUrl: string;
  viewsText: string | null;
  viewsA11y: string | null;
  publishedText: string | null;
  verified: boolean;
}

/** Flatten lockupViewModel metadata rows into channel/views/age parts. */
function lockupMeta(l: any): LockupMeta {
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const rows =
    lmv?.metadata?.contentMetadataViewModel?.metadataRows ??
    lmv?.metadata?.rows ??
    [];
  const meta: LockupMeta = {
    channelName: "",
    avatarUrl: "",
    viewsText: null,
    viewsA11y: null,
    publishedText: null,
    verified: false,
  };
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text?.content ?? "";
      const a11y = part?.text?.accessibilityLabel ?? "";
      const icon = part?.leadingIcon?.name ?? "";
      if (!text) continue;
      if (/ago$/i.test(text) || /ago$/i.test(a11y)) {
        meta.publishedText = meta.publishedText ?? text;
        continue;
      }
      if (
        icon === "PLAY_ARROW_OUTLINED" ||
        / views$/i.test(a11y) ||
        (/^[\d.,]+[KMB]?$/i.test(text) && meta.channelName !== "" && meta.viewsText === null && !/^\d+ videos?$/i.test(text) && !/subscri/i.test(text))
      ) {
        if (meta.viewsText === null) {
          meta.viewsText = text;
          meta.viewsA11y = a11y || null;
        }
        continue;
      }
      if (!meta.channelName && !/subscri/i.test(text) && !/^\d+ videos?$/i.test(text)) {
        meta.channelName = text;
      }
    }
  }
  meta.avatarUrl =
    lastThumbnailUrl(
      lmv?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image
    ) || "";
  return meta;
}

/** lockupViewModel → VideoDTO (trending, related rail, shelves, history). */
export function mapLockupViewModel(l: any): VideoDTO | null {
  const id = l?.contentId;
  if (typeof id !== "string" || !id) return null;
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const title = lmv?.title?.content ?? "";
  if (!title) return null; // promo/skeleton lockups carry no title
  const dto = baseVideo(id, title);
  const meta = lockupMeta(l);
  dto.channel.name = meta.channelName;
  dto.channel.avatarUrl = meta.avatarUrl;
  dto.views = viewsFromTexts(meta.viewsText, meta.viewsA11y);
  dto.viewsText = meta.viewsText ? (/\bviews?\b/i.test(meta.viewsText) ? meta.viewsText : `${meta.viewsText} views`) : null;
  dto.publishedText = meta.publishedText;
  dto.createdAt = relativeAgeToDate(meta.publishedText);
  // duration lives in the thumbnail overlay badges ("9:26")
  const overlays = l?.contentImage?.thumbnailViewModel?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay?.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const text = badge?.thumbnailBadgeViewModel?.text ?? "";
      if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(text)) {
        dto.durationSec = parseDuration(text);
      } else if (/^live/i.test(text)) {
        dto.isLive = true;
      }
    }
  }
  // WFX2-B-S: member-only badges on locked channel videos ("Members only")
  dto.badges = overlayBadgeTexts(l);
  dto.isMembersOnly = dto.badges.some((b) => b.includes("members only"));
  return dto;
}

/** shortsLockupViewModel → VideoDTO (shorts cards). */
export function mapShortsLockupViewModel(s: any): VideoDTO | null {
  const entityId = typeof s?.entityId === "string" ? s.entityId : "";
  const videoId =
    s?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
    (entityId.startsWith("shorts-shelf-item-") ? entityId.slice("shorts-shelf-item-".length) : "");
  if (!videoId) return null;
  // title: overlay metadata first, accessibilityText ("Title, 1.3 million views - play Short") second
  const overlayTitle =
    s?.overlay?.lockupOverlayViewModel?.metadata?.lockupMetadataViewModel?.title?.content;
  const a11y = typeof s?.accessibilityText === "string" ? s.accessibilityText : "";
  let title = typeof overlayTitle === "string" ? overlayTitle : "";
  let viewsA11y: string | null = null;
  if (!title && a11y) {
    const cut = a11y.lastIndexOf(", ");
    title = cut > 0 ? a11y.slice(0, cut) : a11y.replace(/\s*-\s*play Short$/i, "");
    const m = /,\s*([^,]+?)\s*-\s*play Short$/i.exec(a11y);
    if (m) viewsA11y = m[1];
  }
  const dto = baseVideo(videoId, title);
  dto.isShort = true;
  dto.thumbnailUrl = shortsThumbnailUrl(videoId);
  const overlayRows =
    s?.overlay?.lockupOverlayViewModel?.metadata?.lockupMetadataViewModel?.metadata
      ?.contentMetadataViewModel?.metadataRows ?? [];
  for (const row of overlayRows) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text?.content ?? "";
      if (/ views$/i.test(text)) dto.viewsText = text;
    }
  }
  if (viewsA11y && !dto.viewsText) dto.viewsText = `${viewsA11y} views`;
  dto.views = viewsFromTexts(dto.viewsText, viewsA11y);
  dto.durationSec = null;
  return dto;
}

/** richItemRenderer → VideoDTO (dispatches on the wrapped content). */
export function mapRichItemRenderer(r: any): VideoDTO | null {
  const content = r?.content ?? {};
  return (
    mapVideoRenderer(content.videoRenderer) ??
    mapGridVideoRenderer(content.gridVideoRenderer) ??
    mapLockupViewModel(content.lockupViewModel) ??
    mapShortsLockupViewModel(content.shortsLockupViewModel) ??
    null
  );
}

/**
 * Map every video card found anywhere in a response, in document order,
 * skipping ads/promo slots and de-duplicating by id. This is the generic
 * feed/search/trending walker.
 */
export function mapVideos(response: unknown, opts: { limit?: number; dedupe?: boolean } = {}): VideoDTO[] {
  const dedupe = opts.dedupe ?? true;
  const seen = new Set<string>();
  const out: VideoDTO[] = [];
  const push = (dto: VideoDTO | null) => {
    if (!dto || !dto.id || !dto.title) return;
    if (dedupe && seen.has(dto.id)) return;
    seen.add(dto.id);
    out.push(dto);
  };
  for (const r of walkTree(response, "videoRenderer")) push(mapVideoRenderer(r));
  for (const r of walkTree(response, "gridVideoRenderer")) push(mapGridVideoRenderer(r));
  for (const r of walkTree(response, "lockupViewModel")) push(mapLockupViewModel(r));
  for (const r of walkTree(response, "richItemRenderer")) push(mapRichItemRenderer(r));
  for (const r of walkTree(response, "shortsLockupViewModel")) push(mapShortsLockupViewModel(r));
  const limit = opts.limit;
  return limit ? out.slice(0, limit) : out;
}

/** Only the shorts from a response (shorts shelves / grids). */
export function mapShorts(response: unknown, limit?: number): VideoDTO[] {
  const seen = new Set<string>();
  const out: VideoDTO[] = [];
  for (const s of walkTree(response, "shortsLockupViewModel")) {
    const dto = mapShortsLockupViewModel(s);
    if (!dto || seen.has(dto.id)) continue;
    seen.add(dto.id);
    out.push(dto);
  }
  return limit ? out.slice(0, limit) : out;
}

// ---------------------------------------------------------------------------
// channel + playlist result mappers (search)
// ---------------------------------------------------------------------------

export interface ChannelResultDTO extends ChannelLite {
  subscriberCountText: string | null;
  videoCountText: string | null;
  description: string | null;
}

/**
 * channelRenderer → ChannelResultDTO. NOTE the real response quirk: the
 * handle lives in `subscriberCountText` and the subscriber text in
 * `videoCountText` (verified live — see evidence/wfx2ab/CORE.md).
 */
export function mapChannelRenderer(r: any): ChannelResultDTO | null {
  const id = r?.channelId;
  if (typeof id !== "string" || !id) return null;
  const canonical = r?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handleFromText = runsText(r?.subscriberCountText).trim();
  const handle =
    (handleFromText.startsWith("@") ? handleFromText : "") ||
    (canonical.startsWith("/@") ? canonical.slice(1) : "") ||
    id;
  const subscriberText = runsText(r?.videoCountText) || null;
  const badges = badgeStyles(r);
  return {
    id,
    handle,
    name: runsText(r?.title),
    avatarUrl: lastThumbnailUrl(r?.thumbnail),
    verified: badges.some((b) => b.startsWith("verified")),
    subscriberCount: parseSubscriberCount(subscriberText),
    subscriberCountText: subscriberText,
    videoCountText: null,
    description: runsText(r?.descriptionSnippet) || null,
  };
}

export interface PlaylistResultDTO {
  id: string;
  title: string;
  videoCount: number;
  thumbnailUrl: string | null;
  channelName: string;
  updatedText: string | null;
}

/** playlistRenderer → PlaylistResultDTO (search playlist results). */
export function mapPlaylistRenderer(r: any): PlaylistResultDTO | null {
  const id = r?.playlistId;
  if (typeof id !== "string" || !id) return null;
  const thumbs = r?.thumbnails ?? [];
  let thumbnailUrl: string | null = lastThumbnailUrl(thumbs[0] ?? null) || null;
  if (!thumbnailUrl) {
    // playlist stacks nest the first video's thumbnail
    thumbnailUrl = lastThumbnailUrl(thumbs[0]?.playlistVideoThumbnailRenderer?.thumbnail) || null;
  }
  return {
    id,
    title: runsText(r?.title),
    videoCount: parseVideoCount(runsText(r?.videoCountText) || runsText(r?.videoCount)),
    thumbnailUrl,
    channelName: runsText(r?.ownerText) || runsText(r?.shortBylineText),
    updatedText: runsText(r?.publishedTimeText) || null,
  };
}

// ---------------------------------------------------------------------------
// channel page header (pageHeaderRenderer / c4TabbedHeaderRenderer)
// ---------------------------------------------------------------------------

export interface ChannelHeaderDTO {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  bannerUrl: string | null;
  verified: boolean;
  subscriberCount: number;
  subscriberCountText: string | null;
  videoCountText: string | null;
  description: string | null;
}

/**
 * WFX2-P6-CH — the bare-handle law for ChannelPageDTO.channel.handle: strip
 * any leading "@"/"/" run the upstream form carries ("@name", "@/name",
 * "/@name" → "name") so every consumer gets a BARE handle (the channel page
 * renders "@name" by prefixing the "@" itself — the live bug showed
 * "@/@mind_warehouse" when the upstream handle rode its own "@"). "UC…"
 * channel ids pass through untouched (they never start with @ or /).
 */
export function bareChannelHandle(handle: string): string {
  return handle.replace(/^[@\s/]+/, "").trim();
}

/** Map the current channel page header from a browse/SSR response. */
export function mapChannelHeader(response: unknown): ChannelHeaderDTO | null {
  const phr = findFirst(response, "pageHeaderRenderer");
  const phv = phr?.content?.pageHeaderViewModel;
  if (phv) {
    const rows =
      phv?.metadata?.contentMetadataViewModel?.metadataRows ??
      phv?.metadata?.rows ??
      [];
    let handle = "";
    let subscriberText: string | null = null;
    let videoCountText: string | null = null;
    for (const row of rows) {
      for (const part of row?.metadataParts ?? []) {
        const text = part?.text?.content ?? "";
        if (!text) continue;
        if (!handle && text.startsWith("@")) handle = text;
        else if (/subscribers?$/i.test(text)) subscriberText = text;
        else if (/^\d[\d.,]*[KMB]?\s*videos?$/i.test(text)) videoCountText = text;
      }
    }
    const name = phv?.title?.dynamicTextViewModel?.text?.content ?? phr?.pageTitle ?? "";
    const externalId =
      findFirst(response, "channelMetadataRenderer")?.externalId ??
      findFirst(response, "externalId") ??
      "";
    return {
      id: typeof externalId === "string" ? externalId : "",
      handle: handle || (typeof externalId === "string" ? externalId : ""),
      name,
      avatarUrl: lastThumbnailUrl(phv?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image),
      bannerUrl: lastThumbnailUrl(phv?.banner?.imageBannerViewModel?.image) || null,
      verified: /verified/i.test(JSON.stringify(phv?.attribution ?? {}) ?? "") ||
        /verified/i.test(String(phv?.rendererContext?.accessibilityContext?.label ?? "")),
      subscriberCount: parseSubscriberCount(subscriberText),
      subscriberCountText: subscriberText,
      videoCountText,
      description: phv?.description?.descriptionPreviewViewModel?.description?.content ?? null,
    };
  }
  // legacy header shape (c4TabbedHeaderRenderer)
  const c4 = findFirst(response, "c4TabbedHeaderRenderer");
  if (c4) {
    const subscriberText = runsText(c4?.subscriberCountText) || null;
    const canonical = c4?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
    return {
      id: c4?.channelId ?? "",
      handle: canonical.startsWith("/@") ? canonical.slice(1) : c4?.channelId ?? "",
      name: runsText(c4?.title),
      avatarUrl: lastThumbnailUrl(c4?.avatar),
      bannerUrl: lastThumbnailUrl(c4?.banner) || null,
      verified: badgeStyles(c4).some((b) => b.startsWith("verified")),
      subscriberCount: parseSubscriberCount(subscriberText),
      subscriberCountText: subscriberText,
      videoCountText: runsText(c4?.videoCountText) || null,
      description: null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// channel page tabs + membership (WFX2-B-S)
// ---------------------------------------------------------------------------

/** Map the response's tab titles to our tab ids (Community tab = "Posts"). */
const TAB_TITLE_TO_ID: Record<string, ChannelTabId> = {
  Home: "home",
  Videos: "videos",
  Shorts: "shorts",
  Live: "live",
  Playlists: "playlists",
  Posts: "community",
  Community: "community",
};

/** The channel's available tabs from its own tab list (YouTube's order + About). */
export function channelTabsFromResponse(response: unknown): ChannelTabId[] {
  const seen: ChannelTabId[] = [];
  for (const tab of walkTree(response, "tabRenderer")) {
    const id = TAB_TITLE_TO_ID[String(tab?.title ?? "")];
    if (id && !seen.includes(id)) seen.push(id);
  }
  // About rides the header (the "…more" panel) — always offered
  if (!seen.includes("about")) seen.push("about");
  return seen;
}

/** Does the channel offer memberships (the Join button in the header actions)? */
export function channelJoinable(response: unknown): boolean {
  const actions = walkTree(response, "pageHeaderViewModel")[0]?.actions
    ?.flexibleActionsViewModel?.actionsRows;
  for (const row of actions ?? []) {
    for (const a of row?.actions ?? []) {
      if (a?.buttonViewModel?.title === "Join") return true;
    }
  }
  // legacy header shape
  return findFirst(response, "sponsorButtonRenderer") !== null;
}
