import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentCreate, proxyCommentReply } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import type { CommentVideoSnapshotDto } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/** YouTube's comment-length limit (the composer's char counter). */
export const MAX_COMMENT_LENGTH = 10_000;

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
 * POST /api/comments — comment create/reply through the three-rung chain
 * (WFX2-P6-CR): direct-first (InnerTube `comment/create_comment` + the
 * operator session's SAPISIDHASH — replies carry the live payload's
 * createCommentParams), broker fallback (the watch page's DOM paths), then
 * the honest LOCAL rung — the WebFlix store, disclosed as `local: true`
 * (never claims a YouTube write).
 *
 * Request (UI shapes kept, additive):
 *   { videoId, body | text, parentId?, parentText?, replyParams?, video? }
 *     — `body` is the composer's field; `text` is the canonical alias.
 *     — parentId + parentText make this a reply.
 *     — replyParams: the parent comment's live replyParams (the direct reply
 *       rung's parameter — the composer forwards it from the parent row).
 *     — video: { title, channelId?, channelHandle?, channelName?,
 *       channelAvatarUrl? } — the watch payload's snapshot so the local rung
 *       can mirror the real video/channel as shadow rows.
 *
 * Response: the CommentDto (+ok/effect/path, +local for local writes) with
 * 201 — for YouTube-path writes the real id/author come from YouTube on the
 * next live read; for local writes the row IS the store row.
 */
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
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
    const replyParams =
      typeof body.replyParams === "string" && body.replyParams ? body.replyParams : undefined;
    const video = parseVideoSnapshot(body.video);

    const viewer = await resolveViewer(req.headers);
    const comment = parentId
      ? await proxyCommentReply(videoId, parentId, text, viewer, parentText, {
          ...(replyParams ? { replyParams } : {}),
          sessionUser,
          ...(video ? { video } : {}),
        })
      : await proxyCommentCreate(videoId, text, viewer, {
          sessionUser,
          ...(video ? { video } : {}),
        });
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
