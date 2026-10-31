import { NextResponse } from "next/server";
import { livekitAdapter } from "@/lib/live/livekit-adapter";
import { reconcileWebhookEvent } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/livekit/webhook — the provider reconciliation receiver.
 *
 * LiveKit signs each delivery in the Authorization header (SHA-256 HMAC
 * over the raw body with the API secret). Verification happens FIRST: any
 * invalid/absent signature answers 401 and NOTHING reconciles (an
 * unsigned event can never flip app state). Valid events reconcile
 * idempotently — duplicates and late deliveries are safe; an ended
 * session is terminal.
 *
 * Note (honest limit, recorded in the work log): LiveKit Cloud delivers
 * webhooks to the URL configured in the LiveKit Cloud dashboard. Until
 * that URL is set to this deployment's /api/livekit/webhook, the host-path
 * teardown (destroyRoom + DB update, same request) still fully reconciles
 * state; the webhook is the independent backstop for provider-initiated
 * endings and participant accounting.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const authHeader = req.headers.get("authorization");
  const event = await livekitAdapter.parseWebhook(body, authHeader);
  if (!event) {
    return NextResponse.json({ error: "invalid-signature" }, { status: 401 });
  }
  try {
    const { reconciled } = await reconcileWebhookEvent(event);
    return NextResponse.json({ ok: true, reconciled });
  } catch (err) {
    console.error("POST /api/livekit/webhook reconcile failed", err);
    // 500 = ask the provider to retry (deliveries are idempotent).
    return NextResponse.json({ error: "reconcile-failed" }, { status: 500 });
  }
}
