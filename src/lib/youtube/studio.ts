/**
 * WFX2-C-B studio — the creator surfaces for the single-tenant operator
 * channel, honestly:
 *
 *  - Operator channel resolution (session-only): the signed-in youtube.com
 *    home page carries the session's own channel id in its `ytcfg` bootstrap
 *    (`"CHANNEL_ID":"UC…"`); `https://www.youtube.com/@me` (YouTube's
 *    signed-in self-handle) is the fallback. Both mechanisms are real
 *    YouTube behaviors — when neither yields a channel the studio degrades
 *    to the honest "connect the operator session" state, never a guess.
 *  - Channel analytics: Studio SSR of
 *    `https://studio.youtube.com/channel/<UC…>/analytics` with cookie auth
 *    (the task's prescribed mechanism). Metrics are surfaced ONLY when the
 *    page's own embedded state parses — every other outcome (no session,
 *    accounts.google.com redirect, unparseable page, upstream error) is an
 *    honest empty state. NEVER fabricated numbers.
 *  - Per-video public stats: the channel's real public videos tab (browse)
 *    plus real likes/comments from `next()`/comments continuations — the
 *    same verified mechanism the watch page uses. All rows are labeled
 *    public-scope; un-enriched rows show "—" (null), not zero.
 *  - Channel customization read: the real channel header (name, description,
 *    banner, avatar) + links from the browse response, rendered
 *    editable-ready with a deep link to the real Studio editor. No write
 *    simulation (branding writes are out of scope this wave).
 *  - Upload hand-off: metadata gathered here, executed on YouTube —
 *    `https://www.youtube.com/upload` deep link + a copy-paste bundle.
 *    YouTube documents no URL params for upload pre-fill → the bundle is the
 *    honest carrier. No upload simulation, no fake "published" state.
 *
 * Every live call is cached (`./cache`) and only happens inside running
 * route handlers. The `player` endpoint is never touched.
 */
import { upstreamFetch } from "./upstream";
import { BROWSER_UA } from "./innertube";
import { getCookieHeader, hasSession } from "./session";
import { fetchPageHtml, fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { resolveChannel, getChannelPage } from "./channels";
import { getWatchMetadata } from "./watch";
import { listLiveComments } from "./comments";
import { findFirst, walkTree, type ChannelHeaderDTO } from "./mappers";
import type { ChannelLookup } from "./channels";
import type {
  StudioAnalyticsDTO,
  StudioChannelDTO,
  StudioDeepLinksDTO,
  StudioPageDTO,
  StudioVideoDTO,
  UploadContextDTO,
  UploadHandoffDTO,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// deep links (real Studio URLs)
// ---------------------------------------------------------------------------

export const STUDIO_ROOT = "https://studio.youtube.com";
export const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

/** The real Studio page URLs (channel-scoped; root when unresolved). */
export function studioDeepLinks(channelId: string | null): StudioDeepLinksDTO {
  const base = channelId ? `${STUDIO_ROOT}/channel/${channelId}` : STUDIO_ROOT;
  return {
    studioRoot: STUDIO_ROOT,
    analytics: channelId ? `${base}/analytics` : STUDIO_ROOT,
    content: channelId ? `${base}/videos` : STUDIO_ROOT,
    customization: channelId ? `${base}/customization` : STUDIO_ROOT,
    upload: YOUTUBE_UPLOAD_URL,
  };
}

/** The real per-video Studio editor URL. */
export function studioVideoEditUrl(videoId: string): string {
  return `${STUDIO_ROOT}/video/${videoId}/edit`;
}

// ---------------------------------------------------------------------------
// operator channel resolution (session-only, honest)
// ---------------------------------------------------------------------------

const CHANNEL_ID_IN_HTML_RE = /"CHANNEL_ID"\s*:\s*"(UC[\w-]{20,})"/;

/**
 * The operator's channel id from a signed-in youtube.com page's `ytcfg`
 * bootstrap (`"CHANNEL_ID":"UC…"` — the session's own channel, distinct from
 * any grid item's channelId). Pure (exported for fixture-driven tests).
 */
export function extractChannelIdFromHtml(html: string): string | null {
  const m = CHANNEL_ID_IN_HTML_RE.exec(html);
  return m ? m[1] : null;
}

/**
 * Resolve the operator's own channel via the session cookie:
 *  1. the youtube.com home page's ytcfg `CHANNEL_ID`
 *  2. `https://www.youtube.com/@me` (YouTube's signed-in self-handle — the
 *     followed page IS the operator's channel page)
 * Both steps only run with YT_COOKIES set; failures fall through to null
 * (the honest unresolved state — the studio then links out to the Studio
 * root, which resolves the channel via Google auth).
 */
export async function operatorChannelLookup(): Promise<ChannelLookup | null> {
  if (!hasSession()) return null;

  try {
    const homeHtml = await cached("yt:studio:home-html", TTL.FEED_MS, () =>
      fetchPageHtml("/")
    );
    const channelId = extractChannelIdFromHtml(homeHtml);
    if (channelId) {
      const lookup = await resolveChannel(channelId);
      if (lookup) return lookup;
    }
  } catch {
    // fall through to the @me mechanism
  }

  try {
    const ssr = await cached("yt:studio:atme", TTL.FEED_MS, () =>
      fetchYtInitialData("/@me")
    );
    const externalId = findFirst(ssr, "channelMetadataRenderer")?.externalId;
    if (typeof externalId === "string" && externalId) {
      return resolveChannel(externalId);
    }
  } catch {
    // honest unresolved
  }

  return null;
}

// ---------------------------------------------------------------------------
// channel links (customization read — from the browse response)
// ---------------------------------------------------------------------------

/**
 * Channel external links from a browse/SSR channel response
 * (`channelExternalLinkViewModel` — the About flyout / header link rows).
 * Empty when the response carries none (honest — not every channel exposes
 * links in this response; the full editor is one deep link away). Pure.
 */
export function extractChannelLinks(response: unknown): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const link of walkTree(response, "channelExternalLinkViewModel")) {
    const title = typeof link?.title?.content === "string" ? link.title.content : "";
    const url = typeof link?.link?.content === "string" ? link.link.content : "";
    if (!title && !url) continue;
    const key = url || title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title || url, url: url || title });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Studio analytics (Studio SSR with cookie auth — parse or honestly degrade)
// ---------------------------------------------------------------------------

/** Studio analytics metric aliases (the creator-analytics key family). */
const METRIC_ALIASES: Record<string, string[]> = {
  views: ["views", "viewCount"],
  impressions: ["impressions"],
  watchTimeMinutes: ["estimatedMinutesWatched", "watchTimeMinutes", "estimatedWatchTimeMinutes", "watchTime"],
  subscribersGained: ["subscribersGained", "netSubscribersGained"],
  estimatedRevenue: ["estimatedRevenue", "revenue"],
  likes: ["likes", "likeCount"],
  comments: ["comments", "commentCount"],
  shares: ["shares", "shareCount"],
};

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;

interface StudioMetrics {
  views: number | null;
  impressions: number | null;
  watchTimeMinutes: number | null;
  subscribersGained: number | null;
  estimatedRevenue: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

function candidateJsonBlobs(html: string): unknown[] {
  const roots: unknown[] = [];
  // 1. the ytInitialData block (if the page embeds one)
  const ytid = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
  if (ytid) {
    try {
      roots.push(JSON.parse(ytid[1]));
    } catch {
      /* tolerate */
    }
  }
  // 2. any script whose content mentions analytics — extract the outermost
  //    brace-balanced object and parse it (tolerant, bounded)
  for (const m of html.matchAll(SCRIPT_TAG_RE)) {
    const code = m[1] ?? "";
    if (!/analytics/i.test(code)) continue;
    const start = code.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < code.length && i < start + 5_000_000; i++) {
      const ch = code[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
    }
    if (end < 0) continue;
    try {
      roots.push(JSON.parse(code.slice(start, end + 1)));
    } catch {
      /* tolerate — the next script may carry the state */
    }
  }
  return roots;
}

/**
 * Tolerant extractor for Studio analytics metrics from the analytics page's
 * HTML: metrics surface ONLY from numbers the page itself embeds. Pure
 * (fixture-driven tests drive the parser; the running app drives the honest
 * unavailable mode when the real page embeds nothing parseable).
 */
export function extractStudioMetrics(html: string): StudioMetrics | null {
  const roots = candidateJsonBlobs(html);
  const metrics: StudioMetrics = {
    views: null,
    impressions: null,
    watchTimeMinutes: null,
    subscribersGained: null,
    estimatedRevenue: null,
    likes: null,
    comments: null,
    shares: null,
  };
  let found = 0;
  for (const root of roots) {
    for (const [metric, aliases] of Object.entries(METRIC_ALIASES)) {
      if (metrics[metric as keyof StudioMetrics] !== null) continue;
      for (const alias of aliases) {
        for (const value of walkTree(root, alias)) {
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            metrics[metric as keyof StudioMetrics] = value;
            found++;
            break;
          }
        }
        if (metrics[metric as keyof StudioMetrics] !== null) break;
      }
    }
  }
  return found > 0 ? metrics : null;
}

function studioHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://studio.youtube.com/",
  };
  const cookie = getCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

type StudioPageOutcome =
  | { kind: "page"; html: string }
  | { kind: "auth" }
  | { kind: "error" };

/**
 * Studio SSR: GET the real analytics page with cookie auth. Redirects are
 * NOT followed — a 3xx to accounts.google.com means the Studio session needs
 * re-authentication (honest auth-required mode, never fake numbers).
 */
async function fetchStudioAnalyticsPage(channelId: string): Promise<StudioPageOutcome> {
  const url = `${STUDIO_ROOT}/channel/${channelId}/analytics`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await upstreamFetch()(url, {
      method: "GET",
      headers: studioHeaders(),
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      if (/accounts\.google\.com/.test(location)) return { kind: "auth" };
      // non-auth redirects (e.g. canary hops) — follow once via the final body
      const followed = await upstreamFetch()(location.startsWith("http") ? location : `${STUDIO_ROOT}${location}`, {
        method: "GET",
        headers: studioHeaders(),
        redirect: "follow",
        signal: controller.signal,
      });
      if (!followed.ok) return { kind: "error" };
      const text = await followed.text();
      return /accounts\.google\.com\/(Service)?[Ll]ogin/.test(text)
        ? { kind: "auth" }
        : { kind: "page", html: text };
    }
    if (!res.ok) return { kind: "error" };
    const html = await res.text();
    return /accounts\.google\.com\/(Service)?[Ll]ogin/.test(html)
      ? { kind: "auth" }
      : { kind: "page", html };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The studio-scope analytics block: real parsed metrics or an honest mode.
 * Public mode and unresolved channels never fake numbers.
 */
export async function getStudioAnalytics(channelId: string | null): Promise<StudioAnalyticsDTO> {
  if (!hasSession()) {
    return {
      mode: "no-session",
      metrics: null,
      note: "Connect the operator session (YT_COOKIES) — channel analytics are read from YouTube Studio with cookie auth.",
    };
  }
  if (!channelId) {
    return {
      mode: "no-channel",
      metrics: null,
      note: "Operator channel unresolved — open YouTube Studio to see your channel's analytics.",
    };
  }
  const outcome = await cached(`yt:studio:analytics:${channelId}`, TTL.FEED_MS, () =>
    fetchStudioAnalyticsPage(channelId)
  );
  switch (outcome.kind) {
    case "auth":
      return {
        mode: "auth-required",
        metrics: null,
        note: "The Studio session needs re-authentication — open studio.youtube.com in the operator browser, sign in, then reload this page.",
      };
    case "error":
      return {
        mode: "error",
        metrics: null,
        note: "YouTube Studio did not answer — retry, or open the full analytics on YouTube.",
      };
    case "page": {
      const metrics = extractStudioMetrics(outcome.html);
      if (!metrics) {
        return {
          mode: "unavailable",
          metrics: null,
          note: "The Studio page loaded but exposed no embedded analytics to WebFlix — open the full analytics on YouTube (the numbers there are the source of truth).",
        };
      }
      return {
        mode: "ok",
        metrics,
        note: "Parsed from the Studio page's own embedded data — open the full analytics on YouTube for the authoritative view.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// per-video public stats (next() + comments continuations — real, cached)
// ---------------------------------------------------------------------------

/**
 * Real public stats for one video: exact views + likes from `next()` (the
 * numbers the watch page shows) and the comment count from the comments page
 * header. Null = not derivable — the UI shows "—", never a fake zero.
 * Cached per video (10m) — the enrichment rides the same cached `next`
 * responses the watch page uses, plus the comments page (which is not
 * otherwise cached at this layer).
 */
export async function enrichVideoStats(
  videoId: string
): Promise<{
  views: number | null;
  viewsText: string | null;
  likes: number | null;
  commentCount: number | null;
}> {
  return cached(`yt:studio:stats:${videoId}`, TTL.WATCH_MS, async () => {
    try {
      const meta = await getWatchMetadata(videoId);
      if (!meta) return { views: null, viewsText: null, likes: null, commentCount: null };
      let commentCount: number | null = null;
      try {
        const page = await listLiveComments(videoId, "top");
        commentCount = page.total;
      } catch {
        commentCount = null;
      }
      return {
        views: meta.video.views,
        viewsText: meta.video.viewsText ?? null,
        likes: meta.video.likes,
        commentCount,
      };
    } catch {
      return { views: null, viewsText: null, likes: null, commentCount: null };
    }
  });
}

// ---------------------------------------------------------------------------
// the studio payload
// ---------------------------------------------------------------------------

export const DEFAULT_ENRICH_LIMIT = 10;
export const MAX_ENRICH_LIMIT = 50;

function studioChannel(
  header: ChannelHeaderDTO,
  lookup: ChannelLookup
): StudioChannelDTO {
  return {
    id: header.id || lookup.browseId,
    handle: header.handle || lookup.handle,
    name: header.name,
    avatarUrl: header.avatarUrl,
    bannerUrl: header.bannerUrl,
    description: header.description,
    verified: header.verified,
    subscriberCount: header.subscriberCount,
    subscriberCountText: header.subscriberCountText,
    videoCountText: header.videoCountText,
    links: extractChannelLinks(lookup.homeResponse),
  };
}

function parseVideoCount(text: string | null | undefined): number {
  if (!text) return 0;
  const m = /^\s*([\d.,]+)\s*(K|M|B)?\s*videos?\s*$/i.exec(text);
  if (!m) return 0;
  const mult = m[2]
    ? ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[m[2].toUpperCase()]!
    : 1;
  return Math.round(Number(m[1].replace(/,/g, "")) * mult);
}

/**
 * The full studio surface. Session mode resolves the operator's real channel
 * and enriches the first `enrich` public videos with real likes/comments.
 * Public mode makes ZERO upstream calls and returns the honest empty state.
 */
export async function getStudioData(opts: { enrich?: number } = {}): Promise<StudioPageDTO> {
  const session = hasSession();
  const enrich = Math.max(
    0,
    Math.min(opts.enrich ?? DEFAULT_ENRICH_LIMIT, MAX_ENRICH_LIMIT)
  );

  if (!session) {
    return {
      session: false,
      channel: null,
      videos: [],
      totals: {
        subscribers: 0,
        subscriberCountText: null,
        videoCount: 0,
        views: 0,
        likes: 0,
        comments: 0,
        enrichedCount: 0,
      },
      analytics: {
        mode: "no-session",
        metrics: null,
        note: "Connect the operator session (YT_COOKIES) — channel analytics are read from YouTube Studio with cookie auth.",
      },
      deepLinks: studioDeepLinks(null),
    };
  }

  const lookup = await operatorChannelLookup();
  if (!lookup || !lookup.header) {
    return {
      session: true,
      channel: null,
      videos: [],
      totals: {
        subscribers: 0,
        subscriberCountText: null,
        videoCount: 0,
        views: 0,
        likes: 0,
        comments: 0,
        enrichedCount: 0,
      },
      analytics: {
        mode: "no-channel",
        metrics: null,
        note: "The operator channel could not be resolved from this session — open YouTube Studio (it resolves your channel via Google auth).",
      },
      deepLinks: studioDeepLinks(null),
    };
  }

  const channelId = lookup.header.id || lookup.browseId;
  const channel = studioChannel(lookup.header, lookup);

  // real public videos tab (getChannelPage resolves through the same cached
  // browse responses — no duplicate upstream calls)
  const page = await getChannelPage(channelId);
  const source = page?.videos ?? [];
  const videos: StudioVideoDTO[] = source.map((v) => ({
    id: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnailUrl,
    durationSec: v.durationSec,
    views: v.views,
    viewsText: v.viewsText ?? null,
    publishedText: v.publishedText ?? null,
    createdAt: v.createdAt ?? null,
    isShort: v.isShort,
    isLive: v.isLive,
    likes: null,
    commentCount: null,
  }));

  // real per-video stats for the first N rows (cached individually): exact
  // views + likes from the watch metadata, comment count from the comments page
  if (enrich > 0) {
    const slice = videos.slice(0, enrich);
    const stats = await Promise.all(slice.map((v) => enrichVideoStats(v.id)));
    slice.forEach((v, i) => {
      const s = stats[i];
      if (s.views !== null) {
        // upgrade the grid's compact count ("1.8B views") to the exact watch count
        v.views = s.views;
        v.viewsText = s.viewsText;
      }
      v.likes = s.likes;
      v.commentCount = s.commentCount;
    });
  }

  const enriched = videos.filter((v) => v.likes !== null || v.commentCount !== null);
  const totals = {
    subscribers: channel.subscriberCount,
    subscriberCountText: channel.subscriberCountText,
    videoCount: parseVideoCount(channel.videoCountText) || videos.length,
    views: videos.reduce((sum, v) => sum + v.views, 0),
    likes: enriched.reduce((sum, v) => sum + (v.likes ?? 0), 0),
    comments: enriched.reduce((sum, v) => sum + (v.commentCount ?? 0), 0),
    enrichedCount: enriched.length,
  };

  const analytics = await getStudioAnalytics(channelId);

  return { session: true, channel, videos, totals, analytics, deepLinks: studioDeepLinks(channelId) };
}

// ---------------------------------------------------------------------------
// upload hand-off (metadata → YouTube; NO upload simulation)
// ---------------------------------------------------------------------------

/** YouTube's real limits (the upload form enforces these on youtube.com). */
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
export const YOUTUBE_TAGS_MAX = 500;

export interface UploadHandoffInput {
  title: string;
  description: string;
  tags: string[];
  visibility: "public" | "unlisted" | "private";
  thumbnailUrl: string | null;
  isShort: boolean;
}

/**
 * Build the hand-off bundle from validated fields. YouTube's upload page
 * documents no URL params for pre-fill — the bundle (copy-to-clipboard) is
 * the honest carrier for every field. Pure.
 */
export function buildUploadHandoff(input: UploadHandoffInput): UploadHandoffDTO {
  const visibilityLabel =
    input.visibility === "public"
      ? "Public"
      : input.visibility === "unlisted"
        ? "Unlisted"
        : "Private";
  const lines: string[] = [
    "=== WebFlix → YouTube upload metadata ===",
    `TITLE: ${input.title}`,
    "",
    "DESCRIPTION:",
    input.description || "(none)",
  ];
  if (input.tags.length > 0) {
    lines.push("", `TAGS: ${input.tags.join(", ")}`);
  }
  lines.push("", `VISIBILITY: ${visibilityLabel}`);
  if (input.thumbnailUrl) {
    lines.push("", `THUMBNAIL URL: ${input.thumbnailUrl}`);
  }
  if (input.isShort) {
    lines.push("", "FORMAT: vertical (Short)");
  }
  lines.push(
    "",
    `— gather these into the upload form at ${YOUTUBE_UPLOAD_URL} (YouTube owns the upload).`
  );
  return {
    handoffUrl: YOUTUBE_UPLOAD_URL,
    prefillSupported: false,
    bundle: lines.join("\n"),
    fields: {
      title: input.title,
      description: input.description,
      tags: input.tags,
      visibility: input.visibility,
      thumbnailUrl: input.thumbnailUrl,
      isShort: input.isShort,
    },
  };
}

/** The upload page context: the operator channel (for "publishing as …"). */
export async function getUploadContext(): Promise<UploadContextDTO> {
  const session = hasSession();
  if (!session) {
    return { session: false, channel: null, uploadUrl: YOUTUBE_UPLOAD_URL, studioRoot: STUDIO_ROOT };
  }
  const lookup = await operatorChannelLookup().catch(() => null);
  const header = lookup?.header ?? null;
  return {
    session: true,
    channel: header
      ? { name: header.name, handle: header.handle, avatarUrl: header.avatarUrl }
      : null,
    uploadUrl: YOUTUBE_UPLOAD_URL,
    studioRoot: STUDIO_ROOT,
  };
}
