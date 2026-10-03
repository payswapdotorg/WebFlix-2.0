import { NextRequest } from "next/server";
import { json } from "@/lib/watch/api";
import { ANON_VIEWER, resolveViewer, VIEWER_COOKIE } from "@/lib/watch/session";
import { hasSession } from "@/lib/youtube/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/session — establishes the demo identity cookie (wfx2_uid)
 * and returns the viewer + `operatorSession` (additive, WFX2-B-S): whether
 * the operator's youtube.com session (YT_COOKIES) is configured. The comment
 * surfaces use it to render YouTube-parity signed-out states in public mode
 * (the "Sign in to comment" box) instead of fake-write UI.
 *
 * WFX2-P6-CR — NEVER 500: resolveViewer is total (DB unreachable / fallback
 * users missing → the honest anonymous viewer, id ""), so the comments
 * section renders for logged-out viewers exactly like youtube.com. The
 * identity cookie is only established for a REAL viewer (never for the
 * anonymous one).
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    return sessionResponse(req, viewer);
  } catch {
    // belt over the total resolveViewer: an anonymous 200, never a 500
    return sessionResponse(req, ANON_VIEWER);
  }
}

function sessionResponse(req: NextRequest, viewer: { id: string }) {
  const res = json({ viewer, operatorSession: hasSession() });
  const existing = req.cookies.get(VIEWER_COOKIE)?.value;
  if (viewer.id && existing !== viewer.id) {
    res.cookies.set(VIEWER_COOKIE, viewer.id, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
