import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyVideoLike, resolveActionTier } from "@/lib/watch/action-proxy";
import type { LikeValue } from "@/lib/watch/types";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/like — WFX2-P36: the per-user OFFICIAL lane.
 *
 * The write acts on the signed-in user's OWN connected YouTube account
 * (videos.rate) and is confirmed by the authenticated read-back
 * (videos.getRating) before success is claimed — `verified:true` in the
 * response means YouTube itself confirmed the acting user's rating.
 *
 * Request (UI shapes kept; both accepted):
 *   { value: "like" | "dislike" }              legacy — YouTube toggle semantics
 *   { action: "like" | "dislike" | "none" }    canonical — set semantics
 *   { baseline?: { likes, dislikes, yourLike } } optional — the UI's current
 *     counts so the response stays honest (the official API exposes no
 *     per-write count refresh).
 *
 * Response: { ok, effect, likes, dislikes, yourLike, verified, path }.
 * Failures are typed: 403 kind "youtube-not-connected" /
 * "youtube-needs-reauth" (connect or re-connect in Settings), 502 kind
 * "youtube-quota" / "youtube-provider-error" (honest provider truth).
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
    const value = typeof body.value === "string" ? (body.value as LikeValue) : undefined;
    const action = typeof body.action === "string" ? (body.action as "like" | "dislike" | "none") : undefined;
    if (!value && !action) {
      return json({ error: "value (like|dislike) or action (like|dislike|none) is required" }, 400);
    }
    const baselineRaw = body.baseline as
      | { likes?: number; dislikes?: number; yourLike?: LikeValue | null }
      | undefined;
    const baseline =
      baselineRaw && typeof baselineRaw === "object"
        ? {
            likes: Number.isFinite(baselineRaw.likes) ? Number(baselineRaw.likes) : undefined,
            dislikes: Number.isFinite(baselineRaw.dislikes) ? Number(baselineRaw.dislikes) : undefined,
            yourLike:
              baselineRaw.yourLike === "like" || baselineRaw.yourLike === "dislike"
                ? baselineRaw.yourLike
                : null,
          }
        : undefined;
    const tier = await resolveActionTier(req);
    const result = await proxyVideoLike(id, { value, action, baseline }, tier);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
