import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { editComment, deleteComment } from "@/lib/watch/comment-service";
import { proxyCommentReply } from "@/lib/watch/action-proxy";
import { commentEditBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id] {text, videoId?, parentText?} — LIVE Tier-2 write:
 * reply to comment [id] (broker comment-reply). The canonical broker-API
 * route; the composer path (/api/videos/[id]/comments with parentId) maps
 * here internally. parentText enables the broker's DOM-locator UI path.
 *
 * Response: the synthesized CommentDto (+ok/effect) with 201.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!text) return json({ error: "text is required" }, 400);
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const parentText =
      typeof body.parentText === "string" && body.parentText ? body.parentText : undefined;
    const comment = await proxyCommentReply(videoId, id, text, viewer, parentText);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PATCH /api/comments/[id] {body} — edit own comment (inline). Seed-backed
 * until the comment-write lane (B-S) swaps it to the broker tier.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = commentEditBodySchema.parse(await req.json());
    const comment = await editComment(id, viewer.id, body.body);
    return json(comment);
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/comments/[id] — soft-delete own comment (undo toast restores). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const result = await deleteComment(id, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
