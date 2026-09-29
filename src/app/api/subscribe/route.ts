import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxySubscribe } from "@/lib/watch/action-proxy";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscribe { channelId, on? } — LIVE Tier-2 write.
 *
 * Direct-first (subscription/subscribe|unsubscribe with SAPISIDHASH —
 * verified server-side, log §16/§17), broker fallback (the logged-in
 * browser tab over CDP). `on` omitted → toggle (state read, then direct;
 * broker toggle as the fallback) — the channel page's contract.
 *
 * Response: { ok, effect, subscribed, path } — plus `subscribed` for the
 * channel page toast. Broker+direct both unreachable → 502 honest.
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
    if (!channelId) return json({ error: "channelId is required" }, 400);
    const on = body.on === undefined ? null : body.on === true;
    if (body.on !== undefined && body.on !== true && body.on !== false) {
      return json({ error: "on must be a boolean" }, 400);
    }
    const result = await proxySubscribe(channelId, on);
    return json({ ...result, subscribed: result.subscribed });
  } catch (e) {
    return errorResponse(e);
  }
}
