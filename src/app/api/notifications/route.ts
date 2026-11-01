import { NextResponse } from "next/server";
import { getNotificationsFeed } from "@/lib/youtube/notifications";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { localLiveNotifications } from "@/lib/notifications/live-merge";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the operator's REAL notification menu
 * (notification/get_notification_menu + get_unseen_count — both verified
 * endpoints, research log §12). Empty is VALID (the account simply has
 * none; the public menu answers the "Your notifications live here" promo).
 * Response keeps the bell's { unread, items } contract, plus pollIntervalMs
 * (the upstream's own cadence) and the honest loginRequired flag.
 *
 * Parity P73-3 (additive): the caller's LOCAL unread go-live rows prepend
 * the broker feed (bounded 10; the (userId, liveRoomId) fan-out rows); DB
 * trouble → broker-feed-only (the honest fallback in live-merge.ts).
 */
export async function GET(req: Request) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    if (!(await rateLimit(`notifications:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const [feed, local] = await Promise.all([
      getNotificationsFeed(),
      (async () => {
        try {
          const identity = await ensureShadowUser(sessionUser);
          return await localLiveNotifications(identity.id);
        } catch {
          return []; // identity trouble → broker-feed-only (the honest fallback)
        }
      })(),
    ]);
    const localUnread = local.filter((n) => !n.read).length;
    return NextResponse.json({
      unread: feed.unread + localUnread,
      items: [...local, ...feed.items],
      pollIntervalMs: feed.pollIntervalMs,
      loginRequired: feed.loginRequired,
      session: hasSession(),
    });
  } catch (err) {
    console.error("GET /api/notifications failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 502 });
  }
}
