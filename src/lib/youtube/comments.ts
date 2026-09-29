/**
 * WFX2-A-B comments — InnerTube continuation walking over `next`.
 *
 * Verified shape (tests/fixtures/yt/comments_dQw4.json + live):
 *  - watch page token: contents.twoColumnWatchNextResults.results.results
 *    .contents[].itemSectionRenderer[sectionIdentifier="comment-item-section"]
 *    .contents[0].continuationItemRenderer.continuationEndpoint
 *    .continuationCommand.token
 *  - page: POST next {continuation} → onResponseReceivedEndpoints[]
 *    .reloadContinuationItemsCommand.continuationItems:
 *      [commentsHeaderRenderer] + [commentThreadRenderer ×20] +
 *      [continuationItemRenderer] (next page)
 *  - entities: frameworkUpdates.entityBatchUpdate.mutations[].payload
 *    .commentEntityPayload (keyed lookup)
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

/** Pure mapper for one comments continuation page. */
export function mapCommentsPage(response: unknown, parentId: string | null): CommentsPage {
  // entity payloads keyed for lookup
  const entities = new Map<string, any>();
  for (const payload of walkTree(response, "commentEntityPayload")) {
    if (typeof payload?.key === "string") entities.set(payload.key, payload);
  }

  const threads: any[] = [];
  let nextCursor: string | null = null;
  let total: number | null = null;
  let sortTokens: CommentsPage["sortTokens"] = { top: null, newest: null };

  for (const cmd of walkTree(response, "reloadContinuationItemsCommand")) {
    for (const item of cmd?.continuationItems ?? []) {
      if (item?.commentThreadRenderer) {
        threads.push(item.commentThreadRenderer);
      } else if (item?.continuationItemRenderer) {
        const token =
          item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (typeof token === "string" && token) nextCursor = token;
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

  const items: CommentDto[] = [];
  for (const thread of threads) {
    const cvm = thread?.commentViewModel?.commentViewModel ?? thread?.commentViewModel ?? {};
    const entity = entities.get(cvm?.commentKey ?? "") ?? null;
    const dto = mapCommentEntity(entity, cvm, thread, parentId);
    if (dto) items.push(dto);
  }

  return { items, nextCursor, total, sortTokens };
}

function mapCommentEntity(
  entity: any,
  cvm: any,
  thread: any,
  parentId: string | null
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
    heartedByCreator: false, // not exposed in this response format (see CORE.md)
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
    yourLike: null,
    isOwn: author?.isCurrentUser === true,
    replyCount,
    totalReplyCount: replyCount,
    replies: undefined,
    replyNextCursor: null,
    repliesToken,
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

/** Top-level comments page (20/page) — `sort` maps to the Top/Newest tokens. */
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
  const page = await fetchCommentsPage(token, null);
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
