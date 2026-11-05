/**
 * P94-a — the TikTok channel lane (docs/research/2026-11-04-tiktok-main-
 * interface-gap-report.md G1): the DERIVED creator page. TikTok publishes no
 * profile API, so a channel is aggregated from the composed corpus (the
 * curated universe + community imports — the SAME composition the feed and
 * hub ride) by creator handle:
 *
 *  - grouping: the oEmbed-verified `authorUrl`'s @handle wins (the most
 *    precise identity), the DTO `author` handle second, the import row's
 *    `authorHint` third — each match is factual (verified metadata or the
 *    importer's own pasted URL), never guessed.
 *  - fields: handle + postCount + profileUrl are always real; nickname
 *    (oEmbed author_name) and the banner (latest verified thumbnail) ride
 *    the metadata lane's honest nulls; the avatar is an aggregator
 *    candidate the UI renders with a labeled fallback.
 *  - honesty: a valid handle with zero shelf posts STILL renders (empty
 *    grid + the outbound profile link + the import CTA) — never a fake row,
 *    never a fabricated count.
 *
 * DB-FREE like library.ts: the request layer owns the DB reads (the
 * imports lane's extraIds/hints) and passes them in — the module's battery
 * runs env-clean, and the lib/tiktok import law holds.
 */
import {
  importedFallbackDTO,
  getTikTokRail,
  TIKTOK_FEED_PAGE_DEFAULT,
  TIKTOK_FEED_PAGE_MAX,
  type TikTokFeedPageDTO,
} from "./library";
import { isTikTokHandle, normalizeTikTokHandle, tiktokAuthorUrl } from "./urls";
import type { TikTokChannelPageDTO, TikTokVideoDTO } from "./types";

/** The composed universe's search cap for one channel page (the same
 * embed-domain politeness bound the feed's MAX_ITEMS runs). */
const CHANNEL_UNIVERSE_CAP = 60;

/**
 * The creator handle a video DTO verifiably carries — the channel link's
 * fuel (P94-a): the oEmbed `author_url`'s @handle wins (the most precise
 * identity), a format-valid `author` handle second, null when neither holds
 * (the card/feed keep their honest external-or-bare renderings).
 */
export function creatorHandleFromVideo(video: TikTokVideoDTO): string | null {
  if (video.authorUrl) {
    try {
      const atUser = new URL(video.authorUrl).pathname
        .split("/")
        .filter(Boolean)
        .find((s) => s.startsWith("@"));
      const handle = atUser ? normalizeTikTokHandle(atUser) : "";
      if (isTikTokHandle(handle)) return handle;
    } catch {
      /* a malformed author_url falls through to the author handle */
    }
  }
  if (video.author && isTikTokHandle(video.author)) {
    return normalizeTikTokHandle(video.author);
  }
  return null;
}

/** Pull the @handle out of an oEmbed author_url (the most precise grouping
 * key) — null when the URL does not carry one. */
function handleFromAuthorUrl(authorUrl: string | null): string | null {
  if (!authorUrl) return null;
  try {
    const segs = new URL(authorUrl).pathname.split("/").filter(Boolean);
    const atUser = segs.find((s) => s.startsWith("@"));
    if (!atUser) return null;
    const handle = normalizeTikTokHandle(atUser);
    return handle || null;
  } catch {
    return null;
  }
}

/**
 * The channel matcher, shared by the channel page (P94-a) and the
 * creator-scoped feed pages (P96-a): author_url's @handle wins, the DTO
 * author handle second, the import row's authorHint third — each match
 * factual, never guessed. Deduped (the hint fallback can join a row that
 * also matched on author — keep the first).
 */
function matchChannelVideos(
  videos: readonly TikTokVideoDTO[],
  needle: string,
  hintByPostId?: ReadonlyMap<string, string>,
): TikTokVideoDTO[] {
  const matches: TikTokVideoDTO[] = [];
  for (const video of videos) {
    if (video.unavailable) continue;
    const fromUrl = handleFromAuthorUrl(video.authorUrl);
    const author = video.author ? normalizeTikTokHandle(video.author) : null;
    if (
      (fromUrl && fromUrl.toLowerCase() === needle) ||
      (author && author.toLowerCase() === needle)
    ) {
      matches.push(video);
      continue;
    }
    // The import-row fallback: a walled card whose row carries the handle
    // the importer's URL did — the factual importedFallback card (P59-R2's
    // M2 move) renders instead of the anonymous row.
    const hint = hintByPostId?.get(video.postId);
    if (hint && normalizeTikTokHandle(hint).toLowerCase() === needle) {
      matches.push({ ...importedFallbackDTO(video.postId, hint) });
    }
  }
  const seen = new Set<string>();
  return matches.filter((v) => {
    if (seen.has(v.postId)) return false;
    seen.add(v.postId);
    return true;
  });
}

/**
 * The derived channel page for one handle. `extraIds` (public imports +
 * the viewer's own private saves) and `hintByPostId` (the import rows'
 * authorHints) come from the request layer — this module stays DB-free.
 */
export async function getTikTokChannelPage(
  handle: string,
  opts: { extraIds?: readonly string[]; hintByPostId?: ReadonlyMap<string, string> } = {},
): Promise<TikTokChannelPageDTO | null> {
  const clean = normalizeTikTokHandle(handle);
  if (!clean) return null;
  const needle = clean.toLowerCase();

  const rail = await getTikTokRail({
    extraIds: (opts.extraIds ?? []).slice(0, CHANNEL_UNIVERSE_CAP),
  });
  const universeSize = rail.universeSize;
  const videos = matchChannelVideos(rail.videos, needle, opts.hintByPostId);

  const nickname =
    videos.find((v) => v.source === "tiktok-oembed" && v.author)?.author ?? null;
  const bannerUrl = videos.find((v) => v.thumbnailUrl)?.thumbnailUrl ?? null;

  return {
    channel: {
      handle: clean,
      nickname,
      avatarUrl: `https://unavatar.io/tiktok/${encodeURIComponent(clean)}`,
      profileUrl: tiktokAuthorUrl(clean),
      postCount: videos.length,
      bannerUrl,
    },
    videos,
    universeSize,
    note:
      videos.length === 0
        ? `No posts from @${clean} in WebFlix's TikTok shelf yet — paste one from this creator to add it.`
        : null,
  };
}

/**
 * P96-a (the gap report's G17, the profile-playback gap) — the
 * creator-scoped feed pages (`/shorts?source=tiktok&creator=@handle`):
 * the SAME { items, nextCursor } contract law as the shared feed
 * (library.ts getTikTokFeedPage), paged over the channel matcher's
 * matches instead of the whole composed universe. The deep-link `post`
 * splices FIRST on page 1 only when the post verifiably belongs to the
 * scope (a foreign post is honestly ignored, never smuggled in); a cursor
 * that matches nothing honestly ends the feed (no restart loop). Null on
 * an invalid handle — the route answers its 400 from that.
 */
export async function getTikTokChannelFeedPage(opts: {
  handle: string;
  cursor?: string | null;
  post?: string | null;
  limit?: number;
  extraIds?: readonly string[];
  hintByPostId?: ReadonlyMap<string, string>;
}): Promise<TikTokFeedPageDTO | null> {
  const clean = normalizeTikTokHandle(opts.handle);
  if (!clean) return null;
  const needle = clean.toLowerCase();

  const rail = await getTikTokRail({
    extraIds: (opts.extraIds ?? []).slice(0, CHANNEL_UNIVERSE_CAP),
  });
  const matches = matchChannelVideos(rail.videos, needle, opts.hintByPostId);
  const scopedIds = matches.map((v) => v.postId);

  const limit = Math.min(
    Math.max(Math.floor(opts.limit ?? TIKTOK_FEED_PAGE_DEFAULT) || TIKTOK_FEED_PAGE_DEFAULT, 1),
    TIKTOK_FEED_PAGE_MAX,
  );

  const out: TikTokVideoDTO[] = [];
  const seen = new Set<string>();

  // Page-1 deep-link splice — only when the post is IN the scope (the
  // profile-playback law: the scope never leaks a foreign row).
  if (!opts.cursor && opts.post && scopedIds.includes(opts.post)) {
    const row = matches.find((v) => v.postId === opts.post);
    if (row) {
      out.push(row);
      seen.add(row.postId);
    }
  }

  // The scoped flow, starting after the cursor when paging; a cursor the
  // scope does not own honestly ends the feed (empty page, null cursor).
  let startIdx = 0;
  if (opts.cursor) {
    const at = scopedIds.indexOf(opts.cursor);
    if (at === -1) return { items: [], nextCursor: null };
    startIdx = at + 1;
  }
  for (let i = startIdx; i < matches.length && out.length < limit; i++) {
    const row = matches[i];
    if (seen.has(row.postId)) continue;
    out.push(row);
    seen.add(row.postId);
  }

  const last = out[out.length - 1] ?? null;
  const lastIdx = last ? scopedIds.indexOf(last.postId) : -1;
  const hasMore = lastIdx !== -1 && lastIdx < scopedIds.length - 1;
  return {
    items: out,
    nextCursor: hasMore && last ? last.postId : null,
  };
}
