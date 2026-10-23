import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentReply, proxyCommentEdit, proxyCommentDelete } from "@/lib/watch/action-proxy";
import { findLocalActionRow, localEditComment, localDeleteComment } from "@/lib/watch/local-comments";
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
 * PATCH /api/comments/[id] — two honest tiers (WFX2-P40):
 *  - a LOCAL row the store owns → the store-backed edit (own rows only,
 *    body + edited:true, disclosed local:true);
 *  - a YouTube comment → the HONEST UNSUPPORTED lane. Editing YouTube
 *    comments has no official end-user API (commentThreads is
 *    channel-moderation scoped), and the pre-P36 broker DOM drive is
 *    retired with the shared operator identity — the proxy answers the
 *    honest 501 (kind "youtube-unsupported"), rendered verbatim by
 *    errorResponse.
 *
 * Request: {body, videoId, commentText?} (commentText kept for the request
 * contract; ownership on YouTube is enforced by YouTube itself).
 *
 * Response: local tier → 200 {ok, effect, body, edited:true, path:"local",
 * local:true}; YouTube tier → 501 { error, kind: "youtube-unsupported" }.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
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
    // WFX2-P40 — the local-row tier first: a row the store owns gets a
    // store-backed edit (own rows only); the lookup is best-effort so a
    // store outage keeps the honest YouTube lane.
    const localRow = await findLocalActionRow(id).catch(() => null);
    if (localRow) {
      const result = await localEditComment(id, sessionUser, parsed.data.body);
      return json(result);
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
 * DELETE /api/comments/[id] — two honest tiers (WFX2-P40):
 *  - a LOCAL row the store owns → the store-backed soft delete (own rows
 *    only, moderation "deleted" — restorable via the restore route);
 *  - a YouTube comment → the HONEST UNSUPPORTED lane. Deleting YouTube
 *    comments has no official end-user API, and the pre-P36 broker DOM
 *    drive is retired — the proxy answers the honest 501 (kind
 *    "youtube-unsupported"), rendered verbatim by errorResponse.
 *
 * Request: {videoId, commentText?} (commentText kept for the request
 * contract).
 *
 * Response: local tier → 200 {ok, effect, deleted:true, path:"local",
 * local:true}; YouTube tier → 501 { error, kind: "youtube-unsupported" }.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
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
    // WFX2-P40 — the local-row tier first (own rows only, best-effort
    // lookup — a store outage keeps the honest YouTube lane).
    const localRow = await findLocalActionRow(id).catch(() => null);
    if (localRow) {
      const result = await localDeleteComment(id, sessionUser);
      return json(result);
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
