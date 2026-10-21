import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyCommentReport } from "@/lib/watch/action-proxy";
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
 * POST /api/comments/[id]/report — WFX2-P36: the HONEST UNSUPPORTED lane.
 * Reporting YouTube comments has no official end-user API, and the pre-P36
 * broker DOM drive (which rode the operator's youtube.com session) is
 * retired with the shared operator identity — the proxy answers the honest
 * 501 (kind "youtube-unsupported"), rendered verbatim by errorResponse (the
 * pre-P36 public-mode 403 is retired with it: reporting was never a
 * WebFlix-side capability to gate on the operator session).
 *
 * Request: {videoId, commentText?, reason?} — reason is one of YouTube's
 * report-dialog labels (see COMMENT_REPORT_REASONS; kept for the request
 * contract).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — report on YouTube.
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
