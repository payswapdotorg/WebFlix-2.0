import { NextRequest } from "next/server";
import { json, errorResponse, badRequest } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { getWatchedMap } from "@/lib/watch/insights-service";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/** Max ids per batch — surfaces batch once per grid/rail, never per card. */
const MAP_CAP = 50;

/**
 * WFX2-P7-AN — POST /api/watch/watched-map {videoIds: string[]}: the
 * viewer's {videoId: watchedSec} map for the batch (the WATCHED badge
 * source). Ids with no ViewEvent row are absent from the map.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await rateLimit(`watched-map:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return json({ error: "Too many requests" }, 429);
    }
    const viewer = await resolveViewer(req.headers);
    let body: { videoIds?: unknown };
    try {
      body = (await req.json()) as { videoIds?: unknown };
    } catch {
      // malformed JSON is a client error — a garbage body is never a 500
      throw badRequest("Invalid JSON body");
    }
    if (!Array.isArray(body.videoIds) || body.videoIds.some((id) => typeof id !== "string")) {
      throw badRequest("videoIds must be an array of strings");
    }
    const videoIds = body.videoIds as string[];
    if (videoIds.length > MAP_CAP) {
      throw badRequest(`videoIds is capped at ${MAP_CAP} per batch`);
    }
    if (!viewer.id || videoIds.length === 0) {
      return json({ map: {} });
    }
    return json({ map: await getWatchedMap(viewer.id, videoIds) });
  } catch (e) {
    return errorResponse(e);
  }
}
