import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { createClip, ClipValidationError, CLIP_CREATE_NOTE } from "@/lib/clip/clip-service";

export const dynamic = "force-dynamic";

/**
 * WFX2-P23-A — POST /api/clip — CREATE a WebFlix-local clip (the watch
 * page's Share dialog → Clip tab → Create clip).
 *
 * Body: { videoId, title, startSec, endSec } — the [start, end) window
 * over the source video's timeline. The 15–60s law and the title law are
 * enforced server-side (validateClipInput); the window's end is bounded
 * by the (cached) watch metadata read.
 *
 * Response: { ok, clipId, url, note } — the note is the honest upstream
 * disclosure (the clip is WebFlix-local; youtube.com's own web create
 * seam is gone — measured 2026-10-17 — so no YouTube-side object is
 * created, and the response never claims one).
 *
 * Guests: 401 (the AU signed-out law — the dialog routes them to /signin).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    const title = typeof body.title === "string" ? body.title : "";
    const startSec = Number(body.startSec);
    const endSec = Number(body.endSec);
    if (!videoId) return json({ error: "videoId is required" }, 400);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      return json({ error: "startSec and endSec are required numbers" }, 400);
    }
    const result = await createClip({
      creatorId: user.id,
      videoId,
      title,
      startSec,
      endSec,
    });
    return json(result);
  } catch (e) {
    if (e instanceof ClipValidationError) {
      return json({ error: e.message }, e.status);
    }
    return errorResponse(e);
  }
}

/** The note rides GET too (the dialog reads it for the share sheet copy). */
export async function GET() {
  return json({ note: CLIP_CREATE_NOTE, minSec: 15, maxSec: 60 });
}
