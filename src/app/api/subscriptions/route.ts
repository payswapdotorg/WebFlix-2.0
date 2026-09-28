import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { setSubscription } from "@/lib/watch/subscription-service";
import { subscriptionBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscriptions {channelId, bell} — subscribe / bell preference /
 * unsubscribe. bell: "all" | "personalized" | "none" subscribes (or updates);
 * bell "off" (or omitted) unsubscribes.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const body = subscriptionBodySchema.parse(await req.json());
    const result = await setSubscription(body.channelId, viewer.id, body.bell);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
