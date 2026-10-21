import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxySubscribe, resolveActionTier } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscribe { channelId, on? } — WFX2-P36: the per-user OFFICIAL
 * lane (subscriptions.insert / subscriptions.delete with the authenticated
 * subscriptions.list read-back). `on` omitted → toggle, resolved from the
 * acting user's OWN subscription state — never the operator session's.
 *
 * Response: { ok, effect, subscribed, verified, path } — verified:true means
 * the user's own subscription state was re-read and confirmed. Failures are
 * typed (403 youtube-not-connected / youtube-needs-reauth; 502 quota etc.).
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
    const on = body.on === undefined ? null : body.on === true;
    if (body.on !== undefined && body.on !== true && body.on !== false) {
      return json({ error: "on must be a boolean" }, 400);
    }
    const tier = await resolveActionTier(req);
    const result = await proxySubscribe(channelId, on, tier);
    return json({ ...result, subscribed: result.subscribed });
  } catch (e) {
    return errorResponse(e);
  }
}
