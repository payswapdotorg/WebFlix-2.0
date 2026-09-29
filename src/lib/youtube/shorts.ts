/**
 * WFX2-A-S — YouTube Shorts feed client & mappers.
 *
 * Self-contained InnerTube helper for the shorts surface (A-B owns the
 * general innertube.ts; lane-distinct helper names here: `callReel`,
 * `callSearchForShorts`, `callNextForShort`).
 *
 * Verified mechanics (this lane's design probes, evidence/wfx2as/):
 * - SEED: POST /youtubei/v1/search {query} → shorts shelves =
 *   contents.twoColumnSearchResultsRenderer.primaryContents.
 *   sectionListRenderer.contents[].itemSectionRenderer.contents[].
 *   gridShelfViewModel.contents[].shortsLockupViewModel
 *   {entityId: "shorts-shelf-item-<id>", accessibilityText: "TITLE, N views
 *   - play Short", overlayMetadata, thumbnailViewModel,
 *   onTap.innertubeCommand.reelWatchEndpoint{videoId, params, playerParams,
 *   sequenceParams, sequenceProvider: REEL_WATCH_SEQUENCE_PROVIDER_RPC}}
 * - FEED/PAGING: POST /youtubei/v1/reel/reel_watch_sequence with
 *   {context, sequenceParams: <token>}  ← sequenceParams is the TOP-LEVEL
 *   body field (passing it as `params` 400s — verified). Response:
 *   {entries: [{command: {reelWatchEndpoint: {videoId, params}}}],
 *    continuationEndpoint: {continuationCommand: {token}}} — token feeds the
 *   next page as sequenceParams.
 * - reel_item_watch is NOT usable logged-out (REEL_ITEM_WATCH_STATUS_
 *   BAD_REQUEST) — per-short metadata comes from next{videoId} (as the task
 *   specifies) + comments continuation walking.
 *
 * HARD RULE: the `player` endpoint is never called here.
 */

// ---------------------------------------------------------------------------
// Transport (lane-distinct, minimal)
// ---------------------------------------------------------------------------

const INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1";
const CLIENT_VERSION = "2.20260925.00.00";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function cookieHeader(): string | undefined {
  const raw = process.env.YT_COOKIES;
  if (!raw) return undefined;
  const one = raw.trim().replace(/\s*[\r\n]+\s*/g, "; ");
  return one.endsWith(";") ? one : `${one};`;
}

function shortsContext(): Record<string, unknown> {
  return {
    client: {
      clientName: "WEB",
      clientVersion: CLIENT_VERSION,
      hl: "en",
      gl: "US",
    },
  };
}

function innertubeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": CLIENT_VERSION,
    "Accept-Language": "en-US,en;q=0.9",
  };
  const cookies = cookieHeader();
  if (cookies) headers.Cookie = cookies;
  return headers;
}

export class InnerTubeReelError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InnerTubeReelError";
    this.status = status;
  }
}

async function postInnerTube(
  path: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetcher(`${INNERTUBE_BASE}/${path}?prettyPrint=false`, {
    method: "POST",
    headers: innertubeHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new InnerTubeReelError(
      `InnerTube ${path} → HTTP ${res.status}`,
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Lane-distinct helper: one reel endpoint call. */
export async function callReel(
  endpoint: "reel_watch_sequence" | "reel_item_watch",
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube(`reel/${endpoint}`, body, fetcher);
}

/** Lane-distinct helper: search (shorts shelves live in general search). */
export async function callSearchForShorts(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube(
    "search",
    { context: shortsContext(), query },
    fetcher,
  );
}

/** Lane-distinct helper: next (per-short metadata + comments token). */
export async function callNextForShort(
  payload: { videoId?: string; continuation?: string },
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube("next", { context: shortsContext(), ...payload }, fetcher);
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ShortChannelDTO = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type ShortDTO = {
  id: string;
  /** May be "" for sequence-bare entries — the client hydrates via /api/shorts/[id]. */
  title: string;
  channel: ShortChannelDTO;
  viewsText: string | null;
  likesText: string | null;
  commentsCountText: string | null;
  thumbnailUrl: string | null;
};

export type ShortCommentDTO = {
  id: string;
  body: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorChannelId: string | null;
  isVerified: boolean;
  publishedTime: string | null;
  likesText: string | null;
  replyCount: number;
  heartedByCreator: boolean;
  pinned: boolean;
};

export type ShortMetaDTO = ShortDTO & {
  dateText: string | null;
  comments: ShortCommentDTO[];
  commentsNextToken: string | null;
};

export type ShortsFeedDTO = {
  items: ShortDTO[];
  nextCursor: string | null;
};

// ---------------------------------------------------------------------------
// JSON walkers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Json)
    : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Concatenate `runs[].text` (or simpleText) into one string. */
export function runsToText(v: unknown): string {
  if (typeof v === "string") return v;
  const o = asObj(v);
  if (!o) return "";
  if (typeof o.simpleText === "string") return o.simpleText;
  return arr(o.runs)
    .map((r) => (asObj(r)?.text as string | undefined) ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Seed mapping: search → shortsLockupViewModel → ShortDTO
// ---------------------------------------------------------------------------

/**
 * "🎧 Lofi Hip-Hop Radio 🌙 24/7 Live | Chill Beats, 816 views - play Short"
 * → { title: "🎧 Lofi … Beats", viewsText: "816 views" }
 */
export function splitAccessibilityText(
  accessibilityText: string,
): { title: string; viewsText: string | null } {
  const text = accessibilityText.trim();
  const m = text.match(/^(.*),\s*([\d.,]+\s*(?:views|view|watching now))\s*-\s*play Short$/i);
  if (m) return { title: m[1].trim(), viewsText: m[2].trim() };
  const m2 = text.match(/^(.*)\s*-\s*play Short$/i);
  if (m2) return { title: m2[1].trim(), viewsText: null };
  return { title: text, viewsText: null };
}

/**
 * Map a shortsLockupViewModel (verified real shape from search responses)
 * → ShortDTO.
 */
export function mapShortsLockup(lockup: unknown): ShortDTO | null {
  const vm = asObj(asObj(lockup)?.shortsLockupViewModel);
  if (!vm) return null;
  const entityId = typeof vm.entityId === "string" ? vm.entityId : "";
  const onTap = asObj(
    asObj(asObj(vm.onTap)?.innertubeCommand)?.reelWatchEndpoint,
  );
  const videoId =
    (typeof onTap?.videoId === "string" ? onTap.videoId : "") ||
    entityId.replace(/^shorts-shelf-item-/, "");
  if (!videoId) return null;

  // overlayMetadata: {primaryText: {content: title}, secondaryText: {content: views}}
  const overlay = asObj(vm.overlayMetadata);
  const title =
    asObj(overlay?.primaryText)?.content ??
    asObj(overlay?.overlayText)?.primaryText;
  let viewsText: string | null =
    (asObj(overlay?.secondaryText)?.content as string | undefined) ?? null;

  // accessibilityText fallback (verified fixture shape)
  const a11y = typeof vm.accessibilityText === "string" ? vm.accessibilityText : "";
  let parsedTitle = "";
  if (typeof title === "string" && title) {
    parsedTitle = title;
    if (!viewsText && a11y) viewsText = splitAccessibilityText(a11y).viewsText;
  } else if (a11y) {
    const split = splitAccessibilityText(a11y);
    parsedTitle = split.title;
    viewsText = split.viewsText;
  }

  // thumbnailViewModel.image.sources[].url — NOTE: double-nested in real
  // responses (same pattern as commentViewModel): lockup.thumbnailViewModel
  // = { thumbnailViewModel: { image: { sources: […] } } }
  let thumbnailUrl: string | null = null;
  const sources = arr(
    asObj(asObj(asObj(vm.thumbnailViewModel)?.thumbnailViewModel)?.image)
      ?.sources,
  );
  for (const s of sources) {
    const u = asObj(s)?.url;
    if (typeof u === "string") {
      thumbnailUrl = u;
      break;
    }
  }

  return {
    id: videoId,
    title: parsedTitle,
    channel: { id: "", handle: null, name: null, avatarUrl: null },
    viewsText,
    likesText: null,
    commentsCountText: null,
    thumbnailUrl,
  };
}

/**
 * Collect all shorts items from a search response (shorts shelves =
 * gridShelfViewModels inside itemSectionRenderers). Returns the mapped
 * DTOs and the first reelWatchEndpoint sequenceParams token found.
 */
export function extractShortsFromSearch(
  searchResponse: unknown,
): { items: ShortDTO[]; sequenceParams: string | null } {
  const root = asObj(searchResponse);
  const items: ShortDTO[] = [];
  let sequenceParams: string | null = null;

  const sections = arr(
    asObj(
      asObj(
        asObj(asObj(root?.contents)?.twoColumnSearchResultsRenderer)
          ?.primaryContents,
      )?.sectionListRenderer,
    )?.contents,
  );
  for (const sec of sections) {
    const isr = asObj(asObj(sec)?.itemSectionRenderer);
    if (!isr) continue;
    for (const c of arr(isr.contents)) {
      const shelf = asObj(asObj(c)?.gridShelfViewModel);
      if (!shelf) continue;
      for (const raw of arr(shelf.contents)) {
        const dto = mapShortsLockup(raw);
        if (!dto) continue;
        items.push(dto);
        if (!sequenceParams) {
          const ep = asObj(
            asObj(
              asObj(asObj(asObj(raw)?.shortsLockupViewModel)?.onTap)
                ?.innertubeCommand,
            )?.reelWatchEndpoint,
          );
          const sp = ep?.sequenceParams;
          if (typeof sp === "string" && sp) sequenceParams = sp;
        }
      }
    }
  }
  return { items, sequenceParams };
}

// ---------------------------------------------------------------------------
// Sequence mapping: reel_watch_sequence → entries + next cursor
// ---------------------------------------------------------------------------

/**
 * Map a reel_watch_sequence response (verified real shape):
 * {entries: [{command: {reelWatchEndpoint: {videoId, params}}}],
 *  continuationEndpoint: {continuationCommand: {token}}}
 * Entries carry no metadata → title/channel empty (client hydrates per id).
 */
export function mapReelSequence(
  sequenceResponse: unknown,
): ShortsFeedDTO {
  const root = asObj(sequenceResponse);
  const items: ShortDTO[] = [];
  for (const e of arr(root?.entries)) {
    const ep = asObj(asObj(asObj(e)?.command)?.reelWatchEndpoint);
    const videoId = typeof ep?.videoId === "string" ? ep.videoId : "";
    if (!videoId) continue;
    // keep sequence context on the DTO for potential deep-links (params)
    items.push({
      id: videoId,
      title: "",
      channel: { id: "", handle: null, name: null, avatarUrl: null },
      viewsText: null,
      likesText: null,
      commentsCountText: null,
      thumbnailUrl: null,
    });
  }
  const token = asObj(
    asObj(root?.continuationEndpoint)?.continuationCommand,
  )?.token;
  return {
    items,
    nextCursor: typeof token === "string" && token ? token : null,
  };
}

/** Build the reel_watch_sequence request body (sequenceParams top-level). */
export function reelSequenceBody(sequenceParams: string): Record<string, unknown> {
  return { context: shortsContext(), sequenceParams };
}

// ---------------------------------------------------------------------------
// Per-short metadata: next() → ShortMetaDTO (+ first comments page)
// ---------------------------------------------------------------------------

function commentsTokenFromNext(nextResponse: unknown): string | null {
  const root = asObj(nextResponse);
  const results = asObj(
    asObj(asObj(root?.contents)?.twoColumnWatchNextResults)?.results,
  );
  for (const c of arr(asObj(results?.results)?.contents)) {
    const isr = asObj(asObj(c)?.itemSectionRenderer);
    if (!isr || isr.sectionIdentifier !== "comment-item-section") continue;
    const cir = asObj(asObj(arr(isr.contents)[0])?.continuationItemRenderer);
    const token = asObj(
      asObj(cir?.continuationEndpoint)?.continuationCommand,
    )?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/**
 * Parse a comments continuation response (verified real shape from
 * comments_dQw4.json): onResponseReceivedEndpoints[].
 * reloadContinuationItemsCommand.continuationItems[] with
 * commentsHeaderRenderer (countText) / commentThreadRenderer
 * (commentViewModel + entity payloads in frameworkUpdates) /
 * continuationItemRenderer (next page token).
 */
export function mapCommentsPage(
  commentsResponse: unknown,
): {
  comments: ShortCommentDTO[];
  commentsCountText: string | null;
  nextToken: string | null;
} {
  const root = asObj(commentsResponse);
  const comments: ShortCommentDTO[] = [];
  let commentsCountText: string | null = null;
  let nextToken: string | null = null;

  // entity payloads by key (commentEntityPayload / toolbar states)
  const entities = new Map<string, Json>();
  for (const m of arr(
    asObj(asObj(root?.frameworkUpdates)?.entityBatchUpdate)?.mutations,
  )) {
    const payload = asObj(asObj(m)?.payload);
    for (const key of Object.keys(payload ?? {})) {
      const entity = asObj(payload?.[key]);
      if (entity && typeof entity.key === "string") {
        entities.set(entity.key, entity);
      }
    }
  }

  for (const e of arr(root?.onResponseReceivedEndpoints)) {
    const cmd = asObj(asObj(e)?.reloadContinuationItemsCommand);
    if (!cmd) continue;
    for (const item of arr(cmd.continuationItems)) {
      const header = asObj(asObj(item)?.commentsHeaderRenderer);
      if (header) {
        commentsCountText = runsToText(header.countText) || commentsCountText;
        continue;
      }
      const thread = asObj(asObj(item)?.commentThreadRenderer);
      if (thread) {
        // NOTE: commentViewModel is double-nested in real responses:
        // commentThreadRenderer.commentViewModel = { commentViewModel: {…} }
        const cvm = asObj(asObj(thread.commentViewModel)?.commentViewModel);
        const commentKey = typeof cvm?.commentKey === "string" ? cvm.commentKey : "";
        const entity = entities.get(commentKey);
        const props = asObj(entity?.properties);
        const author = asObj(entity?.author);
        const toolbarState = entities.get(
          typeof cvm?.toolbarStateKey === "string" ? cvm.toolbarStateKey : "",
        );

        // replies count from commentRepliesRenderer.viewReplies text
        const repliesText = runsToText(
          asObj(
            asObj(asObj(asObj(thread.replies)?.commentRepliesRenderer)?.viewReplies)
              ?.buttonRenderer,
          )?.text,
        );
        const replyMatch = repliesText.match(/^([\d,.]+)\s+repl/);

        const commentId =
          (typeof props?.commentId === "string" ? props.commentId : "") ||
          (typeof cvm?.commentId === "string" ? cvm.commentId : "") ||
          commentKey;
        if (!commentId) continue;

        comments.push({
          id: commentId,
          body: asObj(props?.content)?.content as string | undefined ?? "",
          authorName:
            (author?.displayName as string | undefined) ??
            (props?.authorButtonA11y as string | undefined) ??
            "unknown",
          authorHandle:
            typeof props?.authorButtonA11y === "string" &&
            props.authorButtonA11y.startsWith("@")
              ? props.authorButtonA11y
              : null,
          authorAvatarUrl:
            (author?.avatarThumbnailUrl as string | undefined) ?? null,
          authorChannelId:
            (author?.channelId as string | undefined) ?? null,
          isVerified: author?.isVerified === true,
          publishedTime:
            (props?.publishedTime as string | undefined) ?? null,
          likesText:
            (asObj(asObj(toolbarState?.likeCountIfIndifferent)?.likeCountButton)
              ?.content as string | undefined) ??
            (toolbarState?.likeCountIfIndifferentText as string | undefined) ??
            null,
          replyCount: replyMatch ? Number(replyMatch[1].replace(/,/g, "")) : 0,
          heartedByCreator:
            toolbarState?.heartState === "TOOLBAR_HEART_STATE_HEARTED",
          pinned: typeof cvm?.pinnedText === "string",
        });
        continue;
      }
      const cir = asObj(asObj(item)?.continuationItemRenderer);
      if (cir) {
        const token = asObj(
          asObj(cir.continuationEndpoint)?.continuationCommand,
        )?.token;
        if (typeof token === "string" && token) nextToken = token;
      }
    }
  }
  return { comments, commentsCountText, nextToken };
}

/**
 * Per-short metadata: title/channel/views/likes text from next{videoId}
 * plus the first comments page (comments continuation — the same walk A-B
 * implements generally; implemented locally here as getShortMeta()).
 */
export async function getShortMeta(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<ShortMetaDTO | null> {
  let nextRes: Record<string, unknown>;
  try {
    nextRes = await callNextForShort({ videoId }, fetcher);
  } catch {
    return null;
  }

  const root = asObj(nextRes);
  const results = asObj(
    asObj(asObj(root?.contents)?.twoColumnWatchNextResults)?.results,
  );
  const list = arr(asObj(results?.results)?.contents);

  let title = "";
  let viewsText: string | null = null;
  let likesText: string | null = null;
  let dateText: string | null = null;
  const channel: ShortChannelDTO = {
    id: "",
    handle: null,
    name: null,
    avatarUrl: null,
  };

  for (const c of list) {
    const vpir = asObj(asObj(c)?.videoPrimaryInfoRenderer);
    if (vpir) {
      title = runsToText(vpir.title);
      const vcr = asObj(asObj(vpir.viewCount)?.videoViewCountRenderer);
      viewsText = runsToText(vcr?.shortViewCount) || runsToText(vcr?.viewCount);
      dateText = runsToText(vpir.dateText) || null;
    }
    const vsir = asObj(asObj(c)?.videoSecondaryInfoRenderer);
    if (vsir) {
      const owner = asObj(asObj(vsir.owner)?.videoOwnerRenderer);
      if (owner) {
        channel.name = runsToText(owner.title) || null;
        // handle: owner.navigationEndpoint url "/@handle" (verified real
        // shape); fallback to the title run's endpoint ("/channel/UC…")
        const ownerNav = asObj(owner.navigationEndpoint);
        const ownerUrl = (
          asObj(ownerNav?.commandMetadata)?.webCommandMetadata as
            | Record<string, unknown>
            | undefined
        )?.url;
        const runs = arr(asObj(owner.title)?.runs);
        const run0 = asObj(runs[0]);
        const browse = asObj(asObj(run0?.navigationEndpoint)?.browseEndpoint);
        channel.id =
          (asObj(ownerNav?.browseEndpoint)?.browseId as string | undefined) ??
          (browse?.browseId as string | undefined) ??
          "";
        const url =
          (typeof ownerUrl === "string" ? ownerUrl : undefined) ??
          ((asObj(asObj(run0?.navigationEndpoint)?.commandMetadata)
            ?.webCommandMetadata as Json | undefined)?.url as
            | string
            | undefined);
        if (typeof url === "string" && url.startsWith("/@")) {
          // "/@RickAstleyYT" → "RickAstleyYT" (app convention: bare handles,
          // links /channel/<handle> — matches the demo seed + ChannelLite)
          channel.handle = url.slice(2);
        }
        const thumbs = arr(asObj(owner.thumbnail)?.thumbnails);
        const last = asObj(thumbs[thumbs.length - 1])?.url;
        channel.avatarUrl = typeof last === "string" ? last : null;
      }
    }
  }

  // likeCountEntity mutations (verified: likeCountIfLiked.content "768K")
  const mutations = arr(
    asObj(asObj(root?.frameworkUpdates)?.entityBatchUpdate)?.mutations,
  );
  for (const mRaw of mutations) {
    const payload = asObj(asObj(mRaw)?.payload);
    const likeEntity = asObj(payload?.likeCountEntity);
    if (likeEntity) {
      const liked = asObj(likeEntity.likeCountIfLiked)?.content;
      if (typeof liked === "string" && liked && !likesText) likesText = liked;
    }
  }

  // engagement panel like-button fallbacks (verified live):
  // 1. frameworkUpdates likeCountEntity.likeCountIfLiked (session-dependent)
  // 2. accessibility "like this video along with N other people"
  if (!likesText) {
    const s = JSON.stringify(nextRes);
    const m = s.match(/like this video along with ([\d,.]+) other people/);
    if (m) likesText = `${m[1]}`;
  }

  const commentsToken = commentsTokenFromNext(nextRes);
  let comments: ShortCommentDTO[] = [];
  let commentsCountText: string | null = null;
  let commentsNextToken: string | null = null;
  if (commentsToken) {
    try {
      const commentsRes = await callNextForShort(
        { continuation: commentsToken },
        fetcher,
      );
      const page = mapCommentsPage(commentsRes);
      comments = page.comments;
      commentsCountText = page.commentsCountText;
      commentsNextToken = page.nextToken;
    } catch {
      // comments are best-effort; metadata still returns
    }
  }

  return {
    id: videoId,
    title,
    channel,
    viewsText,
    likesText,
    commentsCountText,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`,
    dateText,
    comments,
    commentsNextToken,
  };
}

// ---------------------------------------------------------------------------
// Feed composition (server-side, for /api/shorts)
// ---------------------------------------------------------------------------

const SHORTS_SEED_QUERY = process.env.SHORTS_SEED_QUERY ?? "viral shorts";

/**
 * Seed page: search → shorts shelf lockups (with title/views) + kick the
 * sequence for the next cursor. Cached 5 minutes (architecture: feeds 5m).
 */
export async function getShortsSeed(
  fetcher: typeof fetch = fetch,
): Promise<ShortsFeedDTO> {
  const searchRes = await callSearchForShorts(SHORTS_SEED_QUERY, fetcher);
  const { items, sequenceParams } = extractShortsFromSearch(searchRes);
  let nextCursor: string | null = null;
  if (sequenceParams) {
    try {
      const seq = await callReel(
        "reel_watch_sequence",
        reelSequenceBody(sequenceParams),
        fetcher,
      );
      nextCursor = mapReelSequence(seq).nextCursor;
    } catch {
      nextCursor = sequenceParams; // sequence token still usable as cursor
    }
  }
  return { items, nextCursor };
}

/** Cursor page: reel_watch_sequence with the token as sequenceParams. */
export async function getShortsPage(
  cursor: string,
  fetcher: typeof fetch = fetch,
): Promise<ShortsFeedDTO> {
  const seq = await callReel(
    "reel_watch_sequence",
    reelSequenceBody(cursor),
    fetcher,
  );
  return mapReelSequence(seq);
}
