import { NextResponse } from "next/server";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { commentsForWatch } from "@/lib/youtube/comments";
import { rateLimit } from "@/lib/youtube/cache";
import type { CommentDTO, VideoDTO, WatchPageDTO } from "@/lib/types";
import type { CommentDto, RelatedVideoDto } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/** RelatedVideoDto (rail DTO) → the full VideoDTO the aggregate payload uses. */
function relatedToVideoDTO(r: RelatedVideoDto): VideoDTO {
  return {
    id: r.id,
    title: r.title,
    description: "",
    thumbnailUrl: r.thumbnailUrl,
    videoUrl: `https://www.youtube.com/watch?v=${r.id}`,
    durationSec: r.durationSec,
    views: r.views,
    viewsText: r.viewsText ?? null,
    publishedText: r.publishedText ?? null,
    likes: 0,
    dislikes: 0,
    visibility: "public",
    isMembersOnly: false,
    membersTier: null,
    category: "All",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: r.createdAt,
    badges: [],
    channel: {
      id: r.channel.id,
      handle: r.channel.handle,
      name: r.channel.name,
      avatarUrl: r.channel.avatarUrl,
      verified: r.channel.verified,
      subscriberCount: 0,
    },
  };
}

/** Live CommentDto (watch domain) → the aggregate CommentDTO. */
function liveCommentToDTO(c: CommentDto): CommentDTO {
  return {
    id: c.id,
    body: c.body,
    likes: c.likes,
    likesText: c.likesText ?? null,
    heartedByCreator: c.heartedByCreator,
    pinned: c.pinned,
    createdAt: c.createdAt,
    publishedText: c.publishedText ?? null,
    author: {
      handle: c.author.handle,
      name: c.author.name,
      avatarUrl: c.author.avatarUrl,
    },
    replyCount: c.replyCount,
  };
}

/**
 * GET /api/watch/[id] — the aggregate watch bootstrap: `next {videoId}`
 * metadata + the first comments page + the related rail (one cached upstream
 * response feeds all three).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await rateLimit(`watch:${_req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await params;
    const meta = await getWatchMetadata(id);
    if (!meta) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    const commentsResult = await commentsForWatch(id).catch(() => ({
      comments: [] as CommentDto[],
      total: 0,
      nextCursor: null,
    }));
    const data: WatchPageDTO = {
      video: meta.video,
      isSubscribed: meta.state.subscribed,
      isOwner: false,
      memberTierName: null,
      related: meta.related.items.slice(0, 12).map(relatedToVideoDTO),
      comments: commentsResult.comments.map(liveCommentToDTO),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/watch/[id] failed", err);
    return NextResponse.json({ error: "Failed to load video" }, { status: 502 });
  }
}
