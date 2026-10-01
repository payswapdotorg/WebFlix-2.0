import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyCommentReport } from "@/lib/watch/action-proxy";
import { hasSession } from "@/lib/youtube/session";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** YouTube's comment report-dialog reason labels (parity copy). */
export const COMMENT_REPORT_REASONS = [
  "Spam or misleading",
  "Harassment or bullying",
  "Hate speech or graphic violence",
  "Promotes terrorism",
  "Impersonation",
] as const;

/**
 * POST /api/comments/[id]/report — LIVE Tier-2 write: report a comment
 * (broker comment-report — the ⋮ → Report → reasons dialog DOM path).
 *
 * Request: {videoId, commentText?, reason?} — reason is one of YouTube's
 * report-dialog labels (see COMMENT_REPORT_REASONS; default: the dialog's
 * first row). commentText is the comment's CURRENT text (DOM locator).
 *
 * Public mode (no operator session) degrades HONESTLY: 403 with
 * needsSession — no fake "reported" state, ever.
 *
 * Response: {ok, effect, reported: true, reason?, path?}.
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
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400);

    // honest public-mode degradation: reporting acts on the operator's
    // youtube.com session — without it there is nothing to act through
    if (!hasSession()) {
      return json(
        {
          error:
            "Comment reports act on the operator's YouTube session — no session is configured (public mode).",
          needsSession: true,
        },
        403
      );
    }

    const commentText =
      typeof body.commentText === "string" && body.commentText ? body.commentText : undefined;
    const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
    const reason = COMMENT_REPORT_REASONS.find((r) => r.toLowerCase() === reasonRaw.toLowerCase());

    const result = await proxyCommentReport(id, {
      videoId,
      ...(commentText ? { commentText } : {}),
      ...(reason ? { reason } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
