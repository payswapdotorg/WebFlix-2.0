import { NextResponse } from "next/server";
import {
  clampCenterPaging,
  getNotificationsFeed,
  orderNotificationsUnreadFirst,
  pageNotifications,
} from "@/lib/youtube/notifications";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/center — the notification CENTER's paginated feed
 * (WFX2-P4-NC). The same §12-verified read path as the bell menu (one
 * shared cached call — the menu IS the account's full inbox; no
 * continuation endpoint is verified, so none is chased or pretended),
 * deepened honestly:
 *  - unread-first ordering (upstream order preserved within each group);
 *  - server-side page slicing of the TRUE items — never fabricated pages;
 *  - the same honest flags (loginRequired / pollIntervalMs / session);
 *  - upstream down → the honest 502, never fake items.
 *
 * Response: { items, total, unread, loginRequired, pollIntervalMs, session,
 *             page, pageSize, hasMore }.
 */
export async function GET(req: Request) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (
      !(await rateLimit(`notifications-center:${req.headers.get("x-forwarded-for") ?? "local"}`))
    ) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const params = new URL(req.url).searchParams;
    const { page, pageSize } = clampCenterPaging(params.get("page"), params.get("pageSize"));
    const feed = await getNotificationsFeed();
    const ordered = orderNotificationsUnreadFirst(feed.items);
    const { items, hasMore } = pageNotifications(ordered, page, pageSize);
    return NextResponse.json({
      items,
      total: ordered.length,
      unread: feed.unread,
      loginRequired: feed.loginRequired,
      pollIntervalMs: feed.pollIntervalMs,
      session: hasSession(),
      page,
      pageSize,
      hasMore,
    });
  } catch (err) {
    console.error("GET /api/notifications/center failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 502 });
  }
}
