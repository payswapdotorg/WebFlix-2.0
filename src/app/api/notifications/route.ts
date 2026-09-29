import { NextResponse } from "next/server";
import { getNotificationsFeed } from "@/lib/youtube/notifications";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the operator's REAL notification menu
 * (notification/get_notification_menu + get_unseen_count — both verified
 * endpoints, research log §12). Empty is VALID (the account simply has
 * none; the public menu answers the "Your notifications live here" promo).
 * Response keeps the bell's { unread, items } contract, plus pollIntervalMs
 * (the upstream's own cadence) and the honest loginRequired flag.
 */
export async function GET(req: Request) {
  try {
    if (!rateLimit(`notifications:${req.headers.get("x-forwarded-for") ?? "local"}`)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const feed = await getNotificationsFeed();
    return NextResponse.json({
      unread: feed.unread,
      items: feed.items,
      pollIntervalMs: feed.pollIntervalMs,
      loginRequired: feed.loginRequired,
      session: hasSession(),
    });
  } catch (err) {
    console.error("GET /api/notifications failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 502 });
  }
}
