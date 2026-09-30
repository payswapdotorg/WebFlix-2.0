import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer, VIEWER_COOKIE } from "@/lib/watch/session";
import { hasSession } from "@/lib/youtube/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/session — establishes the demo identity cookie (wfx2_uid)
 * and returns the viewer + `operatorSession` (additive, WFX2-B-S): whether
 * the operator's youtube.com session (YT_COOKIES) is configured. The comment
 * surfaces use it to render YouTube-parity signed-out states in public mode
 * (the "Sign in to comment" box) instead of fake-write UI.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const res = json({ viewer, operatorSession: hasSession() });
    const existing = req.cookies.get(VIEWER_COOKIE)?.value;
    if (existing !== viewer.id) {
      res.cookies.set(VIEWER_COOKIE, viewer.id, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
