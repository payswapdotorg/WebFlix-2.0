import { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/read — WFX2-P36: the HONEST UNSUPPORTED lane.
 * Marking notifications read on YouTube has no official end-user API (the
 * pre-P36 lane opened the bell menu in the OPERATOR's logged-in browser tab
 * through the broker — a shared-identity write the P36 work order retires),
 * so this route answers the honest 501 (kind "youtube-unsupported", the
 * machine-stable taxonomy) with the handoff to YouTube. The local-only
 * branch (the client's session-local "seen" view state) is untouched client
 * side — nothing upstream is ever claimed.
 *
 * Response: 501 { error, kind: "youtube-unsupported" }.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    throw new ApiError(
      501,
      "Marking your YouTube notifications read isn't supported by the official API — open the bell on youtube.com",
      "youtube-unsupported",
    );
  } catch (err) {
    return errorResponse(err);
  }
}
