import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyNotInterested } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/not-interested {videoId} — LIVE Tier-2 write (broker): hides
 * the video from recommendations — the real home-feed "Not interested"
 * action on youtube.com. Response keeps the {hidden: true} contract the
 * video-card kebab consumes (+ok/effect).
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const result = await proxyNotInterested(videoId);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
