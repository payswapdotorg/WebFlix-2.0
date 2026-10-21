import { NextRequest, NextResponse } from "next/server";
import { getNotificationReadStates } from "@/lib/youtube/notifications";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/[id]/read — the CENTER's per-item mark-read
 * (WFX2-P4-NC), implemented as THE MENU RE-READ — the choice documented
 * honestly:
 *
 *  - No per-item upstream WRITE exists: the official YouTube Data API has no
 *    end-user mark-read (WFX2-P36 — the pre-P36 broker drive that opened the
 *    bell menu in the OPERATOR's tab is retired with the shared operator
 *    identity; the sibling POST /api/notifications/read now answers the
 *    honest 501 "youtube-unsupported"). The wrong-granularity concern is
 *    gone with it: nothing is ever written upstream from this route.
 *  - This route therefore re-reads the menu (cache-bypassed, the verified
 *    read endpoint) and answers the item's CURRENT upstream read state — the
 *    honest source. The opened item's read state in the UI is the client's
 *    session-local view state (the local-only branch) until the account's
 *    own menu-open clears it upstream.
 *
 * Response: { ok, id, read, loginRequired, upstreamWrite: false, note } —
 * `upstreamWrite: false` is the disclosure: nothing was written upstream.
 * 401 guests · 404 ids the account's inbox does not carry · 502 upstream
 * down (honest error, never a synthesized read state).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (
      !(await rateLimit(`notifications-read:${req.headers.get("x-forwarded-for") ?? "local"}`))
    ) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await ctx.params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "notification id required" }, { status: 400 });
    }
    const { readById, loginRequired } = await getNotificationReadStates();
    if (!(id in readById)) {
      return NextResponse.json(
        { error: "Notification not found in the account's inbox" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      id,
      read: readById[id],
      loginRequired,
      upstreamWrite: false,
      note: "per-item upstream write unverified — this is the menu re-read (the honest source); the opened item's read state is the client's view state until the account's own menu-open clears it",
    });
  } catch (err) {
    console.error("POST /api/notifications/[id]/read failed", err);
    return NextResponse.json({ error: "Failed to refresh notification read state" }, { status: 502 });
  }
}
