import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/read — WFX2-P36: the HONEST UNSUPPORTED lane for
 * the YouTube upstream (marking YouTube notifications read has no official
 * end-user API), now with the Parity P73 LOCAL branch: the caller's own
 * go-live rows (kind "live", written by the fan-out) MARK READ durably —
 * the local lane is fully ours, so it never pretends to be upstream.
 * The 501 answer stands for the YouTube part (kind "youtube-unsupported",
 * the machine-stable taxonomy) with `markedLocal` carrying the honest
 * count of rows the LOCAL branch did settle.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  // The local branch FIRST (always honest, always ours).
  let markedLocal = 0;
  try {
    const sessionUser = await getSessionUser(req);
    if (sessionUser) {
      const identity = await ensureShadowUser(sessionUser);
      const updated = await db.notification.updateMany({
        where: { userId: identity.id, kind: "live" },
        data: { read: true },
      });
      markedLocal = updated.count;
    }
  } catch (err) {
    console.error("local live notification read-mark failed", err);
  }
  try {
    throw new ApiError(
      501,
      "Marking your YouTube notifications read isn't supported by the official API — open the bell on youtube.com",
      "youtube-unsupported",
    );
  } catch (err) {
    // The honest 501 stands for the upstream lane; the LOCAL branch's count
    // rides the body so the client knows what DID settle.
    const base = errorResponse(err);
    const body = (await base.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ ...body, markedLocal }, { status: base.status });
  }
}
