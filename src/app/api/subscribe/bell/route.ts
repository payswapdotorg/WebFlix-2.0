import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyBell, resolveActionTier, tierError } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscribe/bell { channelId, pref } — WFX2-P36. pref "off" → the
 * official unsubscribe lane (supported). any other pref → the honest 501
 * unsupported envelope: bell preferences have no official end-user API, and
 * WebFlix never pretends the operator's browser set them.
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
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!channelId) return json({ error: "channelId is required" }, 400);
    const prefRaw = typeof body.pref === "string" ? body.pref : "";
    if (!["all", "personalized", "none", "off"].includes(prefRaw)) {
      return json({ error: "pref must be all|personalized|none|off" }, 400);
    }
    const tier = await resolveActionTier(req);
    if (!tier.ok) throw tierError(tier.kind);
    const result = await proxyBell(channelId, prefRaw as "all" | "personalized" | "none" | "off", tier);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
