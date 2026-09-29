import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyVideoLike } from "@/lib/watch/action-proxy";
import type { LikeValue } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/like — LIVE Tier-2 write (broker proxy).
 *
 * Request (UI shapes kept; both accepted):
 *   { value: "like" | "dislike" }              legacy — YouTube toggle semantics
 *   { action: "like" | "dislike" | "none" }    canonical — set semantics
 *   { baseline?: { likes, dislikes, yourLike } } optional — the UI's current
 *     counts so the response stays honest (YouTube's post-action count is
 *     only observable in the broker tab's DOM).
 *
 * Response: { ok, effect, likes, dislikes, yourLike } — same contract the
 * ActionRow consumes, plus ok/effect. Broker unreachable → 502 with the
 * honest offline message.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    const result = await proxyVideoLike(id, { value, action, baseline });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
