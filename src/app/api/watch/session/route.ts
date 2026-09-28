import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer, VIEWER_COOKIE } from "@/lib/watch/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/session — establishes the demo identity cookie (wfx2_uid)
 * and returns the viewer. The watch page calls this once on mount so
 * subsequent requests carry a stable identity (header override still wins).
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const res = json({ viewer });
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
