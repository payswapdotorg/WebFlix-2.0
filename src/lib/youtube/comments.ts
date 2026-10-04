/**
 * WFX2-A-B comments — InnerTube continuation walking over `next`.
 *
 * Verified shape (tests/fixtures/yt/comments_dQw4.json + live):
 *  - watch page token: contents.twoColumnWatchNextResults.results.results
 *    .contents[].itemSectionRenderer[sectionIdentifier="comment-item-section"]
 *    .contents[0].continuationItemRenderer.continuationEndpoint
 *    .continuationCommand.token
 *  - page 1: POST next {continuation} → onResponseReceivedEndpoints[]
 *    .reloadContinuationItemsCommand.continuationItems:
 *      [commentsHeaderRenderer] + [commentThreadRenderer ×20] +
 *      [continuationItemRenderer] (next page)
 *  - REPLIES pages + top-level pages 2+: the same POST answers with
 *    appendContinuationItemsAction (NOT reloadContinuationItemsCommand —
 *    targetId "comment-replies-item-<commentId>" for replies, "comments-section"
 *    for top-level). Replies rows are BARE commentViewModel objects (no
 *    commentThreadRenderer envelope); top-level rows keep the envelope.
 *    Replies pagination rides a trailing continuationItemRenderer whose token
 *    hides in button.buttonRenderer.command.continuationCommand.token (the
 *    "Show more replies" button) — top-level pages keep the classic
 *    continuationEndpoint form; both are read.
 *  - entities: frameworkUpdates.entityBatchUpdate.mutations[].payload
 *    .commentEntityPayload (keyed lookup; live key = commentViewModel
 *    .commentKey — the commentEntityPayloadKey spelling is accepted too)
 *  - WFX2-B-S: engagementToolbarStateEntityPayload (same mutations) carries
 *    heartState (TOOLBAR_HEART_STATE_HEARTED — creator hearts) and likeState
 *    (TOOLBAR_LIKE_STATE_LIKE/DISLIKE — the session viewer's own rating),
 *    keyed by commentViewModel.toolbarStateKey.
 *  - WFX2-P6-CR: engagementToolbarSurfaceEntityPayload (same mutations)
 *    carries replyCommand.innertubeCommand.createCommentEndpoint
 *    .createCommentParams — the direct reply rung's wire parameter, keyed by
 *    commentViewModel.toolbarSurfaceKey (absent → sign-in modal → null DTO).
 *  - sort: commentsHeaderRenderer.sortMenu.sortFilterSubMenuRenderer
 *    .subMenuItems[{title:"Top"|"Newest", serviceEndpoint.continuationCommand.token}]
 *  - replies: commentThreadRenderer.replies.commentRepliesRenderer.subThreads[0]
 *    .continuationItemRenderer…continuationCommand.token
 */
import { innertubeNext } from "./innertube";
import { cached, TTL } from "./cache";
import { walkTree, runsText, parseCompactCount, relativeAgeToDate } from "./mappers";
import { watchResponse } from "./watch";
import type { CommentDto, CommentsPageDto, PageDto } from "@/lib/watch/types";

const COMMENT_SECTION_ID = "comment-item-section";

/** The comments continuation token from a watch `next` response. */
export function commentsTokenFromWatchResponse(response: unknown): string | null {
  for (const section of walkTree(response, "itemSectionRenderer")) {
    if (section?.sectionIdentifier === COMMENT_SECTION_ID) {
      const token =
        section?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand
          ?.token;
      if (typeof token === "string" && token) return token;
    }
  }
  return null;
}

interface CommentsPage {
  items: CommentDto[];
  nextCursor: string | null;
  total: number | null;
  sortTokens: { top: string | null; newest: string | null };
}

/** toolbarState entities (like/heart state per comment — WFX2-B-S). */
interface ToolbarStates {
  like: Map<string, "like" | "dislike" | null>;
  hearted: Set<string>;
}

function toolbarStatesFrom(response: unknown): ToolbarStates {
  const like = new Map<string, "like" | "dislike" | null>();
  const hearted = new Set<string>();
  for (const st of walkTree(response, "engagementToolbarStateEntityPayload")) {
    const key = st?.key;
    if (typeof key !== "string" || !key) continue;
    if (st?.heartState === "TOOLBAR_HEART_STATE_HEARTED") hearted.add(key);
    if (st?.likeState === "TOOLBAR_LIKE_STATE_LIKE") like.set(key, "like");
    else if (st?.likeState === "TOOLBAR_LIKE_STATE_DISLIKE") like.set(key, "dislike");
    else like.set(key, null);
  }
  return { like, hearted };
}

/**
 * WFX2-P6-CR — replyParams per toolbarSurfaceKey, from the toolbar SURFACE
 * mutations: `.replyCommand.innertubeCommand.createCommentEndpoint
 * .createCommentParams` (the direct reply rung's wire parameter, researched
 * from YouTube.js and verified against the live payload shape). With the
 * operator session expired YouTube serves the sign-in modal instead
 * (`prepareAccountCommand`) — then the surface simply carries no
 * replyCommand and this map stays empty for that key (honest null DTOs).
 */
function replyParamsFrom(response: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const surface of walkTree(response, "engagementToolbarSurfaceEntityPayload")) {
    const key = surface?.key;
    const params =
      surface?.replyCommand?.innertubeCommand?.createCommentEndpoint?.createCommentParams;
    if (typeof key !== "string" || !key) continue;
    if (typeof params === "string" && params) out.set(key, params);
  }
  return out;
}

/**
 * The commentEntityPayload lookup key on a commentViewModel. Verified live:
 * replies pages key their entities with `commentKey` (the same field the
 * top-level pages use) — the `commentEntityPayloadKey` spelling is accepted
 * tolerantly in case a client variant emits it.
 */
function entityKeyOf(cvm: any): string {
  const key = cvm?.commentKey ?? cvm?.commentEntityPayloadKey;
  return typeof key === "string" ? key : "";
}

/**
 * A trailing continuationItemRenderer's pagination token. Top-level pages
 * use the classic continuationEndpoint form; replies pages hide the token in
 * the "Show more replies" button (button.buttonRenderer.command) — both
 * shapes are read (verified live, 2026-10).
 */
function continuationTokenOf(cir: any): string | null {
  const token =
    cir?.continuationEndpoint?.continuationCommand?.token ??
    cir?.button?.buttonRenderer?.command?.continuationCommand?.token;
  return typeof token === "string" && token ? token : null;
}

/**
 * The continuation commands that carry comment rows: page 1 of the top-level
 * section arrives as reloadContinuationItemsCommand; every later top-level
 * page AND every replies page arrives as appendContinuationItemsAction
 * (same continuationItems array, no header row). Both are walked — order
 * within a response is preserved per command.
 */
function* continuationCommands(response: unknown): Generator<any> {
  for (const key of ["appendContinuationItemsAction", "reloadContinuationItemsCommand"]) {
    for (const cmd of walkTree(response, key)) yield cmd;
  }
}

/** Pure mapper for one comments continuation page. */
export function mapCommentsPage(response: unknown, parentId: string | null): CommentsPage {
  // entity payloads keyed for lookup
  const entities = new Map<string, any>();
  for (const payload of walkTree(response, "commentEntityPayload")) {
    if (typeof payload?.key === "string") entities.set(payload.key, payload);
  }
  // toolbar states (creator heart + viewer like — the response's own state)
  const toolbar = toolbarStatesFrom(response);
  // replyParams per toolbarSurfaceKey (WFX2-P6-CR — the direct reply rung)
  const replyParams = replyParamsFrom(response);

  const threads: any[] = [];
  const items: CommentDto[] = [];
  const seen = new Set<string>();
  let nextCursor: string | null = null;
  let total: number | null = null;
  let sortTokens: CommentsPage["sortTokens"] = { top: null, newest: null };

  for (const cmd of continuationCommands(response)) {
    for (const item of cmd?.continuationItems ?? []) {
      if (item?.commentThreadRenderer) {
        threads.push(item.commentThreadRenderer);
      } else if (item?.commentViewModel) {
        // replies pages: a BARE commentViewModel row (no thread envelope) —
        // its entities ride this same response's frameworkUpdates
        const cvm = item.commentViewModel;
        const entity = entities.get(entityKeyOf(cvm)) ?? null;
        const dto = mapCommentViewModel(entity, cvm, null, parentId, toolbar, replyParams);
        if (dto && !seen.has(dto.id)) {
          seen.add(dto.id);
          items.push(dto);
        }
      } else if (item?.continuationItemRenderer) {
        const token = continuationTokenOf(item.continuationItemRenderer);
        if (token) nextCursor = token;
      } else if (item?.commentsHeaderRenderer) {
        const header = item.commentsHeaderRenderer;
        const countText = runsText(header?.countText).replace(/[^\d]/g, "");
        total = countText ? Number(countText) : null;
        for (const sub of
          header?.sortMenu?.sortFilterSubMenuRenderer?.subMenuItems ?? []) {
          const token = sub?.serviceEndpoint?.continuationCommand?.token;
          if (typeof token !== "string" || !token) continue;
          if (sub?.title === "Newest") sortTokens.newest = token;
          else if (sub?.title === "Top") sortTokens.top = token;
        }
      }
    }
  }

  for (const thread of threads) {
    const cvm = thread?.commentViewModel?.commentViewModel ?? thread?.commentViewModel ?? {};
    const entity = entities.get(entityKeyOf(cvm)) ?? null;
    const dto = mapCommentViewModel(entity, cvm, thread, parentId, toolbar, replyParams);
    if (dto && !seen.has(dto.id)) {
      seen.add(dto.id);
      items.push(dto);
    }
  }

  return { items, nextCursor, total, sortTokens };
}

/**
 * One commentViewModel → CommentDto, shared by the thread-envelope rows
 * (top-level pages, `thread` present) and the bare rows (replies pages,
 * `thread` null — no nested replies token to harvest).
 */
function mapCommentViewModel(
  entity: any,
  cvm: any,
  thread: any,
  parentId: string | null,
  toolbar: ToolbarStates,
  replyParams: Map<string, string>
): CommentDto | null {
  const id = entity?.properties?.commentId ?? cvm?.commentId;
  if (typeof id !== "string" || !id) return null;
  const publishedTime: string = entity?.properties?.publishedTime ?? "";
  const edited = /\(edited\)\s*$/i.test(publishedTime);
  const likesText: string | null = entity?.toolbar?.likeCountNotliked ?? null;
  const replyCount = parseCompactCount(entity?.toolbar?.replyCount) ?? 0;
  const author = entity?.author ?? {};
  const canonical =
    author?.channelCommand?.innertubeCommand?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handleFromName = typeof author?.displayName === "string" && author.displayName.startsWith("@")
    ? author.displayName
    : "";
  const handle =
    handleFromName ||
    (canonical.startsWith("/@") ? canonical.slice(1) : "") ||
    (typeof author?.channelId === "string" ? author.channelId : "");

  // replies continuation for this thread (nested continuationCommand tokens)
  let repliesToken: string | null = null;
  const subThreads =
    thread?.replies?.commentRepliesRenderer?.subThreads ??
    thread?.replies?.commentRepliesRenderer?.contents ??
    [];
  for (const st of subThreads) {
    const token =
      st?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
      st?.continueThreadItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) {
      repliesToken = token;
      break;
    }
  }

  return {
    id,
    parentId,
    body: entity?.properties?.content?.content ?? "",
    likes: parseCompactCount(likesText) ?? 0,
    likesText,
    // the response's own engagementToolbarState (creator hearts + viewer like)
    heartedByCreator: toolbar.hearted.has(cvm?.toolbarStateKey ?? ""),
    pinned:
      typeof cvm?.pinnedText === "string" ||
      thread?.renderingPriority === "RENDERING_PRIORITY_PINNED_COMMENT",
    edited,
    moderation: "approved",
    createdAt: relativeAgeToDate(publishedTime.replace(/\s*\(edited\)\s*$/i, "")),
    publishedText: publishedTime || null,
    author: {
      id: author?.channelId ?? "",
      handle,
      name: author?.displayName ?? "",
      avatarUrl: author?.avatarThumbnailUrl ?? "",
      isMember: false, // no member data in this response format
      isCreator: author?.isCreator === true,
    },
    yourLike: toolbar.like.get(cvm?.toolbarStateKey ?? "") ?? null,
    isOwn: author?.isCurrentUser === true,
    replyCount,
    totalReplyCount: replyCount,
    replies: undefined,
    replyNextCursor: null,
    repliesToken,
    // WFX2-P6-CR: the direct reply rung's parameter (null when YouTube
    // serves the sign-in modal — session expired — or the payload has none)
    replyParams: replyParams.get(cvm?.toolbarSurfaceKey ?? "") ?? null,
  };
}

/**
 * The initial (Top) comments token plus the sort menu's Newest token, cached
 * per video. `sort=new` costs one extra upstream call on first hit (the sort
 * menu rides on the Top page).
 */
export async function getCommentsSortTokens(videoId: string): Promise<{
  top: string | null;
  newest: string | null;
}> {
  const top = await getInitialCommentsToken(videoId);
  if (!top) return { top: null, newest: null };
  const page = await fetchCommentsPage(top, null);
  if (page.sortTokens.newest) return { top, newest: page.sortTokens.newest };
  return { top, newest: null };
}

async function getInitialCommentsToken(videoId: string): Promise<string | null> {
  const watch = await watchResponse(videoId);
  return commentsTokenFromWatchResponse(watch);
}

async function fetchCommentsPage(token: string, parentId: string | null): Promise<CommentsPage> {
  const response = await innertubeNext({ continuation: token });
  return mapCommentsPage(response, parentId);
}

/** Top-level comments page (20/page) — `sort` maps to the Top/Newest tokens.
 * WFX2-C-W: the first page per (video, sort) is cached through the Upstash
 * adapter (5-minute soft TTL, last-good on upstream failure); continuation
 * pages use unique tokens and pass straight through. */
export async function listLiveComments(
  videoId: string,
  sort: "top" | "new",
  cursor?: string
): Promise<CommentsPageDto> {
  if (cursor) {
    const page = await fetchCommentsPage(cursor, null);
    return { items: page.items, nextCursor: page.nextCursor, total: page.total ?? 0 };
  }
  const tokens = await cached(`yt:comments:tokens:${videoId}`, TTL.COMMENTS_MS, () =>
    getCommentsSortTokens(videoId)
  );
  const token = sort === "new" ? (tokens.newest ?? tokens.top) : tokens.top;
  if (!token) {
    // no comments section on this video
    return { items: [], nextCursor: null, total: 0 };
  }
  const page = await cached(`yt:comments:page:${videoId}:${sort}`, TTL.COMMENTS_MS, () =>
    fetchCommentsPage(token, null)
  );
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    total: page.total ?? page.items.length,
  };
}

/** Reply page under one comment (thread continuation walking). */
export async function listLiveReplies(
  videoId: string,
  commentId: string,
  cursor?: string
): Promise<PageDto<CommentDto>> {
  if (cursor) {
    const page = await fetchCommentsPage(cursor, commentId);
    return { items: page.items, nextCursor: page.nextCursor };
  }
  // resolve the thread's replies token from the first top-level page (cached)
  const first = await listLiveComments(videoId, "top");
  const target = first.items.find((c) => c.id === commentId);
  if (!target) return { items: [], nextCursor: null };
  const repliesToken = target.repliesToken;
  if (!repliesToken) return { items: [], nextCursor: null };
  const page = await fetchCommentsPage(repliesToken, commentId);
  return { items: page.items, nextCursor: page.nextCursor };
}

/**
 * Attach the first inline replies page to the leading comments (the UI
 * renders threads from `replies`; deeper threads lazy-load via the
 * parentId cursor sentinel ""). Bounded: 3 upstream calls per page.
 */
export async function attachInlineReplies(
  videoId: string,
  comments: CommentDto[],
  inlineLimit = 3
): Promise<CommentDto[]> {
  const out: CommentDto[] = [];
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    if (i < inlineLimit && c.repliesToken) {
      const page = await fetchCommentsPage(c.repliesToken, c.id);
      out.push({
        ...c,
        replies: page.items,
        replyNextCursor: page.nextCursor ?? null,
        repliesToken: c.repliesToken,
      });
    } else {
      // sentinel: "" makes the UI's Show-more expander fetch page 1 via parentId
      out.push({ ...c, replyNextCursor: c.repliesToken ? "" : null });
    }
  }
  return out;
}

/** Comments count + first page for the watch bootstrap route. */
export async function commentsForWatch(videoId: string): Promise<{
  comments: CommentDto[];
  total: number;
  nextCursor: string | null;
}> {
  const page = await listLiveComments(videoId, "top");
  const comments = await attachInlineReplies(videoId, page.items);
  return { comments, total: page.total, nextCursor: page.nextCursor };
}
