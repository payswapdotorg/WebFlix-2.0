import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentCreate, proxyCommentReply } from "@/lib/watch/action-proxy";
import { listLiveComments, attachInlineReplies } from "@/lib/youtube/comments";
import { mergeLocalComments, listLocalReplies, shadowUserId } from "@/lib/watch/local-comments";
import { rateLimit } from "@/lib/youtube/cache";
import { getSessionUser } from "@/lib/auth/session";
import type { CommentVideoSnapshotDto } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/** Parse the additive video snapshot (the local rung's shadow rows). */
function parseVideoSnapshot(raw: unknown): CommentVideoSnapshotDto | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const v = raw as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof v[key] === "string" && v[key] ? (v[key] as string) : undefined;
  const snapshot: CommentVideoSnapshotDto = {
    ...(str("title") ? { title: str("title") } : {}),
    ...(str("channelId") ? { channelId: str("channelId") } : {}),
    ...(str("channelHandle") ? { channelHandle: str("channelHandle") } : {}),
    ...(str("channelName") ? { channelName: str("channelName") } : {}),
    ...(str("channelAvatarUrl") ? { channelAvatarUrl: str("channelAvatarUrl") } : {}),
  };
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

/**
 * GET /api/videos/[id]/comments?sort=top|new&cursor=&parentId= — LIVE
 * comments via InnerTube continuation walking (20/page; sort tokens from the
 * response's own sort menu), MERGED with the honest WebFlix store
 * (WFX2-P6-CR): locally-written top-level comments prepend on the first
 * page (local:true disclosed), local replies nest under their parent
 * threads, the header count adjusts. `parentId` serves the UI's reply
 * threads (the dedicated nested replies route serves the same data).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!(await rateLimit(`comments:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const url = new URL(req.url);
    const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const parentId = url.searchParams.get("parentId") ?? undefined;

    // the read-path viewers for the local merge: the resolved viewer (total —
    // anonymous on DB failure) + the WebFlix session's shadow author id
    const viewer = await resolveViewer(req.headers);
    const sessionUser = await getSessionUser(req);
    const viewerIds = [
      ...new Set(
        [viewer.id, ...(sessionUser ? [shadowUserId(sessionUser.id)] : [])].filter(Boolean)
      ),
    ];

    if (parentId) {
      // reply page under one comment (existing UI thread expander)
      const { listLiveReplies } = await import("@/lib/youtube/comments");
      const page = await listLiveReplies(id, parentId, cursor);
      let items = await attachInlineReplies(id, page.items);
      if (items.length === 0) {
        // the live thread has nothing → the local rung's replies serve here
        // (a local parent, or a YouTube parent whose thread never loaded)
        const local = await listLocalReplies(id, parentId, viewerIds);
        if (local.items.length > 0) items = local.items;
      }
      return json({ items, nextCursor: page.nextCursor });
    }

    const page = await listLiveComments(id, sort, cursor);
    const items = await attachInlineReplies(id, page.items);
    const merged = await mergeLocalComments({
      videoId: id,
      items,
      total: page.total,
      viewerIds,
      firstPage: !cursor,
    });
    return json({ items: merged.items, nextCursor: page.nextCursor, total: merged.total });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/videos/[id]/comments {body, parentId?, parentText?, replyParams?,
 * video?} — comment create/reply through the three-rung chain (WFX2-P6-CR:
 * direct SAPISIDHASH → broker → the honest local WebFlix store, disclosed
 * as local:true). The composer's canonical route is /api/comments; this is
 * the watch-page shape kept for the existing UI (it forwards the same
 * additive extras when the client provides them).
 *
 * Response: the CommentDto (+ok/effect/path, +local for local writes) with
 * 201 — the comment's real id/author come from YouTube on the next live
 * read; for local writes the row IS the store row.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) return json({ error: "body is required" }, 400);
    if (text.length > 5000) return json({ error: "body must be ≤ 5000 chars" }, 400);
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : undefined;
    const parentText =
      typeof body.parentText === "string" && body.parentText ? body.parentText : undefined;
    const replyParams =
      typeof body.replyParams === "string" && body.replyParams ? body.replyParams : undefined;
    const video = parseVideoSnapshot(body.video);

    const viewer = await resolveViewer(req.headers);
    const comment = parentId
      ? await proxyCommentReply(id, parentId, text, viewer, parentText, {
          ...(replyParams ? { replyParams } : {}),
          ...(sessionUser ? { sessionUser } : {}),
          ...(video ? { video } : {}),
        })
      : await proxyCommentCreate(id, text, viewer, {
          ...(sessionUser ? { sessionUser } : {}),
          ...(video ? { video } : {}),
        });
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
