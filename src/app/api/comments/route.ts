import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentCreate, proxyCommentReply } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** YouTube's comment-length limit (the composer's char counter). */
export const MAX_COMMENT_LENGTH = 10_000;

/**
 * POST /api/comments — LIVE Tier-2 write: comment create (canonical route).
 *
 * Direct-first (InnerTube `comment/create_comment` with the operator session
 * + SAPISIDHASH — the subscribe lane's pattern), broker fallback (the watch
 * page's simplebox → editor → submit DOM path).
 *
 * Request (UI shapes kept, additive):
 *   { videoId, body | text, parentId?, parentText? }
 *     — `body` is the composer's field; `text` is the canonical alias.
 *     — parentId + parentText make this a reply (broker comment-reply; the
 *       reply UI path needs the parent comment's text for the DOM locator).
 *
 * Response: the synthesized CommentDto (+ok/effect/path) with 201 — the
 * comment's real id/author come from YouTube on the next live read.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const textRaw = body.body ?? body.text;
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!text) return json({ error: "body is required" }, 400);
    if (text.length > MAX_COMMENT_LENGTH) {
      return json({ error: `body must be ≤ ${MAX_COMMENT_LENGTH} chars` }, 400);
    }
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : undefined;
    const parentText =
      typeof body.parentText === "string" && body.parentText ? body.parentText : undefined;

    const viewer = await resolveViewer(req.headers);
    const comment = parentId
      ? await proxyCommentReply(videoId, parentId, text, viewer, parentText)
      : await proxyCommentCreate(videoId, text, viewer);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
