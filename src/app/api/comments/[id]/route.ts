import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentReply, proxyCommentEdit, proxyCommentDelete } from "@/lib/watch/action-proxy";
import { commentWriteBodySchema, commentDeleteBodySchema } from "@/lib/watch/validators";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id] {text, videoId?, parentText?, replyParams?, video?}
 * — WFX2-P36: reply to comment [id] on the honest LOCAL lane (the official
 * Data API only lets channels comment on their own videos — the reply is
 * stored on WebFlix and disclosed as local:true, never a YouTube write
 * claimed). The canonical composer route; the watch-page path
 * (/api/videos/[id]/comments with parentId) forwards the same contract.
 *
 * Response: the CommentDto (+ok/effect, +local for local writes) with 201.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
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
    const replyParams =
      typeof body.replyParams === "string" && body.replyParams ? body.replyParams : undefined;
    const viewer = await resolveViewer(req.headers);
    const comment = await proxyCommentReply(videoId, id, text, viewer, parentText, {
      ...(replyParams ? { replyParams } : {}),
      sessionUser,
    });
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PATCH /api/comments/[id] — WFX2-P36: the HONEST UNSUPPORTED lane. Editing
 * YouTube comments has no official end-user API (commentThreads is
 * channel-moderation scoped), and the pre-P36 broker DOM drive is retired
 * with the shared operator identity — the proxy answers the honest 501
 * (kind "youtube-unsupported"), rendered verbatim by errorResponse.
 *
 * Request: {body, videoId, commentText?} (commentText kept for the request
 * contract; ownership on YouTube is enforced by YouTube itself).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — edit on YouTube.
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
 * DELETE /api/comments/[id] — WFX2-P36: the HONEST UNSUPPORTED lane.
 * Deleting YouTube comments has no official end-user API, and the pre-P36
 * broker DOM drive is retired — the proxy answers the honest 501 (kind
 * "youtube-unsupported"), rendered verbatim by errorResponse. (Deleting a
 * LOCAL WebFlix comment has its own route — the restore/delete family in
 * comment-service.)
 *
 * Request: {videoId, commentText?} (commentText kept for the request
 * contract).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — delete on YouTube.
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
