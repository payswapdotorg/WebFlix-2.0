import { errorResponse, json } from "@/lib/watch/api";
import { proxyFeedbackUndo } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * P24-SEND (G12) — POST /api/not-interested/undo — LIVE Tier-2 write
 * (broker): clicks the VISIBLE Undo button on youtube.com's feedback toast
 * (the notification that followed the not-interested action — youtube.com's
 * own family carries the Undo affordance on BOTH feedback toasts; the app's
 * toast gains it here). The window is short — an expired window answers the
 * honest 502 ('undo-toast-not-found'), never a fake restoration. Response:
 * {ok, effect:"feedback-undo", restored:true, path}.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const result = await proxyFeedbackUndo();
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
