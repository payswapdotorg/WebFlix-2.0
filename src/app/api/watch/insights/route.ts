import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { getWatchInsights } from "@/lib/watch/insights-service";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * WFX2-P7-AN — GET /api/watch/insights: the viewer's real watch analytics
 * (totals + the zero-filled 28-day UTC series + top videos by watchedSec).
 * Session resolution follows the /api/watch/session idiom (wfx2_uid cookie /
 * x-wfx2-user header / demo fallback); an anonymous viewer (DB unreachable)
 * gets the honest all-zero payload, never a 500.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`watch-insights:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return json({ error: "Too many requests" }, 429);
    }
    const viewer = await resolveViewer(req.headers);
    if (!viewer.id) {
      // honest anonymous degrade: nothing fabricated, never a 500
      return json({
        totals: {
          watchedSecAllTime: 0,
          videosWatched: 0,
          activeDays: 0,
          avgSecPerActiveDay: 0,
          streakDays: 0,
        },
        series28d: [],
        topVideos: [],
      });
    }
    return json(await getWatchInsights(viewer.id));
  } catch (e) {
    return errorResponse(e);
  }
}
