import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { ApiError, errorResponse } from "@/lib/watch/api";
import { resolveReadTier } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/history?cursor= — WFX2-P36: the HONEST per-user envelope. YouTube's
 * watch history has NO official Data API (it is account-private on
 * youtube.com), and the pre-P36 read served the OPERATOR's SSR /feed/history
 * to every signed-in user — one person's history rendered as another's, the
 * exact cross-user leak the P36 work order closes. So this route never reads
 * anyone's history anymore: it answers the honest empty + notice (the view
 * renders it as the notice banner), with `connected` disclosing whether the
 * acting user's own YouTube account is connected.
 *
 * WFX2-P2-AU kept: guests (no WebFlix session) get the uniform 401 before
 * anything runs — the client degrades on it (the signed-out screen).
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`history:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const tier = await resolveReadTier(req);
    return NextResponse.json({
      groups: [],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: null,
      searchHistoryPaused: null,
      total: 0,
      session: hasSession(),
      connected: tier !== null,
      notice:
        "Your YouTube watch history has no official API — WebFlix never reads one person's history for another. Open youtube.com/feed/history for yours.",
    });
  } catch (err) {
    console.error("GET /api/history failed", err);
    return NextResponse.json({ error: "Failed to load history" }, { status: 502 });
  }
}

/**
 * DELETE /api/history?videoId= — WFX2-P36: the HONEST UNSUPPORTED lane.
 * History writes (remove one video / clear all) have no official YouTube API,
 * and the pre-P36 broker drive acted on the OPERATOR's account — retired with
 * the shared identity itself. The response is the honest 501 with the
 * machine-stable kind, the handoff to YouTube's own history page.
 */
export async function DELETE(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const videoId = new URL(req.url).searchParams.get("videoId") ?? "";
    if (videoId && !/^[\w-]{6,20}$/.test(videoId)) {
      return NextResponse.json({ error: "videoId is invalid" }, { status: 400 });
    }
    throw new ApiError(
      501,
      videoId
        ? "Removing a video from your YouTube watch history isn't supported by the official API — open youtube.com/feed/history to remove it there"
        : "Clearing your YouTube watch history isn't supported by the official API — open youtube.com/feed/history to clear it there",
      "youtube-unsupported",
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/history {paused: boolean, type?: "watch"|"search"} — WFX2-P36:
 * the HONEST UNSUPPORTED lane. The pause/resume toggles are YouTube account
 * settings with no official API, and the pre-P36 broker drive acted on the
 * OPERATOR's account — retired. The response is the honest 501 with the
 * machine-stable kind, the handoff to YouTube's own history settings.
 */
export async function PATCH(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const type = body.type === "search" ? "search" : "watch";
    throw new ApiError(
      501,
      `Pausing or resuming your ${type === "search" ? "search " : ""}watch history on YouTube isn't supported by the official API — open youtube.com/feed/history to change it there`,
      "youtube-unsupported",
    );
  } catch (err) {
    return errorResponse(err);
  }
}
