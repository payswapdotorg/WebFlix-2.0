import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyNotInterested } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/not-interested — WFX2-P36: the WebFlix-LOCAL
 * personalization signal (fully disclosed — no YouTube-side write claimed).
 * Response keeps the {notInterested: true} contract (+ok/effect/local/note).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    const result = await proxyNotInterested(id, sessionUser);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
