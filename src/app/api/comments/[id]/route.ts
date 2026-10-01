import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentReply, proxyCommentEdit, proxyCommentDelete } from "@/lib/watch/action-proxy";
import { commentWriteBodySchema, commentDeleteBodySchema } from "@/lib/watch/validators";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

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
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
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
    const viewer = await resolveViewer(req.headers);
    const comment = await proxyCommentReply(videoId, id, text, viewer, parentText);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PATCH /api/comments/[id] — LIVE Tier-2 write: edit own comment (broker
 * comment-edit — the ⋮ → Edit → inline editor DOM path on the watch page).
 *
 * Request: {body, videoId, commentText?} — commentText is the comment's
 * CURRENT text (the broker's DOM locator). Ownership is enforced by YouTube
 * itself (Edit only exists on the operator's own comments).
 *
 * Response: {ok, effect, body, edited: true, path?} — the UI merges the new
 * body into the row it already holds (the row's id/author stay).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const parsed = commentWriteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    }
    const result = await proxyCommentEdit(id, parsed.data.body, {
      videoId: parsed.data.videoId,
      ...(parsed.data.commentText ? { commentText: parsed.data.commentText } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * DELETE /api/comments/[id] — LIVE Tier-2 write: delete own comment (broker
 * comment-delete — the ⋮ → Delete → confirm-dialog DOM path, YouTube's exact
 * flow).
 *
 * Request: {videoId, commentText?} (commentText = the CURRENT text locator).
 * Response: {ok, deleted: true, effect, path?}.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    let raw: unknown = {};
    try {
      const text = await req.text();
      if (text) raw = JSON.parse(text);
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const parsed = commentDeleteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    }
    const result = await proxyCommentDelete(id, {
      videoId: parsed.data.videoId,
      ...(parsed.data.commentText ? { commentText: parsed.data.commentText } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
