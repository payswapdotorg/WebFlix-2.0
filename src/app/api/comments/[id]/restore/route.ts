import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyCommentRestore } from "@/lib/watch/action-proxy";
import { findLocalActionRow, localRestoreComment } from "@/lib/watch/local-comments";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/restore — two honest tiers (WFX2-P40):
 *  - a LOCAL row the store owns → the store-backed restore (own rows only,
 *    moderation "deleted" → "approved", the row's fresh DTO returned with
 *    local:true);
 *  - a YouTube comment (unknown id or a "shadow" anchor) → the HONEST
 *    UNSUPPORTED lane (kind "youtube-unsupported") — there is no restore
 *    path for YouTube comments through the official API.
 *
 * Pre-P40 this route shelled to the LOCAL-VIDEO comment-service with the
 * wfx2_uid viewer id — an identity space the YouTube-video shadow rows
 * never inhabit (their author is the session's shadow user), so restoring
 * one's own YouTube-video comment 403'd, and a YouTube comment id 404'd
 * bare. The two-tier law fixes both honestly.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    // WFX2-P40 — the local-row tier first (own rows only, best-effort
    // lookup — a store outage keeps the honest YouTube lane).
    const localRow = await findLocalActionRow(id).catch(() => null);
    if (localRow) {
      const comment = await localRestoreComment(id, sessionUser);
      return json(comment);
    }
    const result = await proxyCommentRestore(id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
