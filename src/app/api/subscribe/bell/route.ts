import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyBell } from "@/lib/watch/action-proxy";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscribe/bell { channelId, pref } — LIVE Tier-2 write.
 *
 * pref: all | personalized | none (notification level — broker tier, the
 * logged-in tab's bell menu) | off (unsubscribe, direct-first).
 * Response: { ok, effect, bell }.
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const pref = typeof body.pref === "string" ? body.pref : "";
    if (!channelId) return json({ error: "channelId is required" }, 400);
    if (!["all", "personalized", "none", "off"].includes(pref)) {
      return json({ error: "pref must be all|personalized|none|off" }, 400);
    }
    const result = await proxyBell(channelId, pref as "all" | "personalized" | "none" | "off");
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
