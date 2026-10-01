/**
 * WFX2-P2-SO — the Community/Posts social surface, end-to-end.
 *
 * THE WALL LADDER (the core problem): youtube.com's InnerTube browse endpoint
 * is IP-class walled for every server egress (Vercel regions — verified live
 * by the lead; dev/tests run unwalled via fixtures), which is why
 * /api/channel/[handle]/tab?tab=community answered {"tab":"community",
 * "walled":true} in production while the mapper sat unused. The ONLY unwalled
 * read path is the logged-in BROWSER (the Tier-2 broker channel — its egress
 * is VPN'd). This module climbs the same ladder discipline as home/channel
 * compose:
 *
 *   rung 1  browse-fresh   — the existing InnerTube browse (the channel's own
 *                            Posts tab param); healthy = the response carries
 *                            the tab strip (the walled 200-but-empty `{}` does
 *                            not);
 *   rung 2  broker-read    — NEW Tier-2 read: the broker navigates the
 *                            logged-in YouTube tab to
 *                            youtube.com/@<handle>/community and returns its
 *                            own window.ytInitialData RAW; the app maps it
 *                            through the EXISTING mapCommunityPosts mapper —
 *                            ONE mapper, TWO transports, no duplicate parsing;
 *   rung 3  last-good      — the Upstash adapter's cachedResilient contract
 *                            (the walled shape is never cached; a last-good
 *                            payload keeps serving inside the 24h hard
 *                            window — the home law);
 *   rung 4  honest-empty   — {tab: "community", walled: true} — never fake
 *                            posts, never a naked 502.
 *
 * The DTO carries the additive `source` flag per rung (browse | broker |
 * last-good) so the harness + UI can trust where the posts came from.
 *
 * Also here: the post-comments read (the post detail browse → the SAME
 * comment continuation walking the watch comments use, paged + sorted) with
 * the same honest walled degrade.
 */
import { innertubeBrowse } from "./innertube";
import { cached, cachedResilient, cachePeek, rateLimit, TTL } from "./cache";
import { walkTree } from "./mappers";
import { resolveChannel } from "./channels";
import { operatorIsCreator } from "./operator";
import { CHANNEL_TAB_PARAMS, tabParamFromResponse, mapCommunityPosts } from "./channel-tabs";
import { commentsTokenFromWatchResponse, mapCommentsPage } from "./comments";
import { brokerCommunityRead } from "@/lib/broker";
import type { ChannelTabDTO, CommunityPostDTO, CommunityTabSource } from "@/lib/types";
import type { CommentsPageDto } from "@/lib/watch/types";

// ---------------------------------------------------------------------------
// rung health probes (pure — fixture-testable)
// ---------------------------------------------------------------------------

/**
 * A healthy Posts-tab browse answer carries the response's own tab strip —
 * the walled datacenter shape answers 200 with a body that maps to ZERO
 * content (no tabRenderer anywhere). One tabRenderer row is enough proof the
 * real tab payload arrived (even a genuinely-empty community tab keeps the
 * strip, so an honest empty is never mistaken for the wall).
 */
export function communityBrowseHealthy(response: unknown): boolean {
  return walkTree(response, "tabRenderer").length > 0;
}

/**
 * The broker-read payload must prove it is the community tab: backstage post
 * rows, or at least the response's own Posts/Community tab strip (a
 * channel-not-found redirect carries neither — honest failure, not fake
 * emptiness).
 */
export function communityBrowserPayloadHealthy(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (walkTree(payload, "backstagePostRenderer").length > 0) return true;
  return walkTree(payload, "tabRenderer").some(
    (t) => String(t?.title ?? "") === "Posts" || String(t?.title ?? "") === "Community"
  );
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

/** The ladder's cache key — the channel's own id when resolution works, the
 * cleaned handle otherwise (the walled case is exactly when the broker rung
 * runs, and resolution is the first thing the wall takes). */
export function communityCacheKey(handle: string, channelId: string | null): string {
  return channelId
    ? `yt:community:${channelId}`
    : `yt:community:@${handle.replace(/^@/, "").toLowerCase()}`;
}

/**
 * The channel resolution for the ladder — resolveChannel through a 60-second
 * micro-cache so the per-request ladder never re-pays the walled resolution
 * chain (the failure marker null caches too; in production the wall makes
 * this null for the full window, honestly).
 */
async function resolveCommunityChannel(
  handle: string
): Promise<Awaited<ReturnType<typeof resolveChannel>>> {
  const cleaned = decodeURIComponent(handle).trim();
  return cached(`yt:community:lookup:${cleaned.toLowerCase()}`, 60_000, async () =>
    resolveChannel(cleaned).catch(() => null)
  );
}

/**
 * The Community tab through the wall ladder. Caching + last-good ride the
 * adapter's cachedResilient (the walled shape never caches; 24h hard window —
 * the home law); the source flag is computed per answer via the read-only
 * cachePeek probe (fresh → the rung that produced it, stale → "last-good").
 * The `compose` flag (the operator owns this channel) is session state —
 * computed per request, never cached.
 */
export async function getCommunityTab(handle: string): Promise<ChannelTabDTO> {
  const cleaned = decodeURIComponent(handle).trim();
  const lookup = await resolveCommunityChannel(cleaned);
  const channelId = lookup?.header?.id || lookup?.browseId || null;
  const key = communityCacheKey(cleaned, channelId);
  const homeResponse = lookup?.homeResponse ?? null;

  const dto = await cachedResilient(
    key,
    TTL.FEED_MS,
    () => computeCommunityTab(cleaned, channelId, homeResponse),
    { isEmpty: (t) => (t as ChannelTabDTO).walled === true, hardTtlMs: TTL.HOME_HARD_MS }
  );

  if (dto.walled === true) return dto;

  // rung labeling (the home feed's read-only probe pattern): a fresh entry
  // wears the rung that produced it; a stale-but-hard-valid entry was served
  // by the last-good/SWR path → "last-good".
  const peek = await cachePeek(key);
  const source: CommunityTabSource = peek?.fresh ? (dto.source ?? "browse") : "last-good";

  const compose = channelId ? await operatorIsCreator(channelId).catch(() => false) : false;
  return { ...dto, source, compose };
}

/** The ladder's compute: browse-fresh → broker-read → honest-empty. */
async function computeCommunityTab(
  cleaned: string,
  channelId: string | null,
  homeResponse: unknown
): Promise<ChannelTabDTO> {
  // rung 1 — browse-fresh (the existing InnerTube path; unwalled egress,
  // dev + fixture tests)
  if (channelId) {
    try {
      const ownParam = tabParamFromResponse(homeResponse, "community");
      const params = ownParam ?? CHANNEL_TAB_PARAMS.community;
      const response = await innertubeBrowse({ browseId: channelId, params });
      if (communityBrowseHealthy(response)) {
        return { tab: "community", posts: mapCommunityPosts(response), source: "browse" };
      }
    } catch {
      /* walled/failed browse — fall through to the broker rung */
    }
  }

  // rung 2 — Tier-2 broker-read through the logged-in browser
  const posts = await tryBrokerCommunityRead(cleaned, channelId);
  if (posts) return { tab: "community", posts, source: "broker" };

  // rung 4 — honest empty (rung 3, last-good, is the adapter's isEmpty path)
  return { tab: "community", walled: true };
}

/**
 * The Tier-2 read: the broker returns the logged-in browser's own
 * community-tab ytInitialData raw; this maps it through the SAME backstage
 * mapper. Rate-limited (a broker read is an upstream call — never spammed);
 * honest null on every failure mode (offline / not-the-community-tab
 * payload / zero posts with no tab strip).
 */
async function tryBrokerCommunityRead(
  cleaned: string,
  channelId: string | null
): Promise<CommunityPostDTO[] | null> {
  const handle = cleaned.replace(/^@/, "");
  if (!(await rateLimit(`community-broker:${handle.toLowerCase()}`, { limit: 30 }))) {
    return null;
  }
  const r = await brokerCommunityRead(handle, channelId ?? undefined);
  if (r instanceof Error) return null;
  const payload = r.detail?.data;
  if (!communityBrowserPayloadHealthy(payload)) return null;
  return mapCommunityPosts(payload);
}

// ---------------------------------------------------------------------------
// post comments (the expandable per-post thread — paged, sorted)
// ---------------------------------------------------------------------------

export type PostCommentsPageDto = CommentsPageDto & {
  /** WFX2-P2-SO (additive): the post read is walled upstream (honest degrade) */
  walled?: boolean;
};

/**
 * One post's comments. The post detail browse (browseId = postId) carries the
 * SAME comment continuation family the watch page does (the
 * comment-item-section itemSectionRenderer → continuation token; the sort
 * menu's Top/Newest tokens), and the continuation pages map through the
 * EXISTING mapCommentsPage walker — one comment mapper, video and post
 * surfaces alike. First pages cached per (post, sort); honest walled degrade
 * (a walled read is flagged, never faked as a zero-comment post).
 */
export async function getPostComments(
  postId: string,
  sort: "top" | "new",
  cursor?: string
): Promise<PostCommentsPageDto> {
  if (cursor) {
    return fetchPostCommentsPage(cursor, null);
  }
  const tokens = await cached(`yt:post:comments:tokens:${postId}`, TTL.COMMENTS_MS, () =>
    getPostCommentsSortTokens(postId)
  );
  if (tokens.walled) return { items: [], nextCursor: null, total: 0, walled: true };
  const token = sort === "new" ? (tokens.newest ?? tokens.top) : tokens.top;
  if (!token) {
    // the healthy post response carries no comments section
    return { items: [], nextCursor: null, total: 0 };
  }
  return cached(`yt:post:comments:page:${postId}:${sort}`, TTL.COMMENTS_MS, () =>
    fetchPostCommentsPage(token, null)
  );
}

async function getPostCommentsSortTokens(postId: string): Promise<{
  top: string | null;
  newest: string | null;
  walled: boolean;
}> {
  try {
    const detail = await innertubeBrowse({ browseId: postId });
    const top = commentsTokenFromWatchResponse(detail);
    if (!top) return { top: null, newest: null, walled: false };
    const first = await innertubeBrowse({ continuation: top });
    const page = mapCommentsPage(first, null);
    if (page.sortTokens.newest) return { top, newest: page.sortTokens.newest, walled: false };
    return { top, newest: null, walled: false };
  } catch {
    // the post read itself is walled / failed upstream
    return { top: null, newest: null, walled: true };
  }
}

async function fetchPostCommentsPage(
  token: string,
  parentId: string | null
): Promise<PostCommentsPageDto> {
  try {
    const response = await innertubeBrowse({ continuation: token });
    const page = mapCommentsPage(response, parentId);
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total ?? page.items.length,
    };
  } catch {
    return { items: [], nextCursor: null, total: 0, walled: true };
  }
}

/** Reply page under one post comment (thread continuation walking). */
export async function getPostCommentReplies(
  postId: string,
  commentId: string,
  cursor?: string
): Promise<{ items: PostCommentsPageDto["items"]; nextCursor: string | null; walled?: boolean }> {
  if (cursor) {
    return fetchPostCommentsPage(cursor, commentId);
  }
  // resolve the thread's replies token from the first top-level page (cached)
  const first = await getPostComments(postId, "top");
  if (first.walled) return { items: [], nextCursor: null, walled: true };
  const target = first.items.find((c) => c.id === commentId);
  const repliesToken = target?.repliesToken ?? null;
  if (!repliesToken) return { items: [], nextCursor: null };
  return fetchPostCommentsPage(repliesToken, commentId);
}
