import { NextResponse } from "next/server";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { resolveReadTier } from "@/lib/watch/action-proxy";
import { oauthConfigured } from "@/lib/youtube/oauth";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/liked?cursor= — WFX2-P36: the HONEST per-user notice envelope.
 * The list of videos you liked on YouTube has NO official Data API (YouTube's
 * own `LL` playlist is a system list the API neither reads nor serves per
 * user), and the pre-P36 read served the OPERATOR's browse `VLLL` to every
 * signed-in user — one person's liked list rendered as another's, the exact
 * cross-user leak the P36 work order closes. So this route never reads
 * anyone's liked list anymore: it answers the honest empty + notice (the view
 * renders it as the notice banner), with `connected` disclosing whether the
 * acting user's own YouTube account is connected. The LIKE BUTTON still acts
 * on your own account — through the official videos.rate lane.
 *
 * WFX2-P38 — the envelope also carries `oauthConfigured` (the deployment
 * truth) so the view banners can gate their Connect links: a deployment
 * without the Google OAuth env never sends the user on a connect errand.
 * The notice text is unchanged (capability-honest, not a connect errand).
 */
export async function GET(req: Request) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`liked:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const tier = await resolveReadTier(req);
    return NextResponse.json({
      videos: [],
      playlist: null,
      nextCursor: null,
      loginRequired: false,
      unavailable: false,
      session: hasSession(),
      connected: tier !== null,
      oauthConfigured: oauthConfigured(),
      notice:
        "The list of videos you liked on YouTube has no official API — your likes still act on your account (the like button); the list lives on youtube.com/feed/liked",
    });
  } catch (err) {
    console.error("GET /api/liked failed", err);
    return NextResponse.json({ error: "Failed to load liked videos" }, { status: 502 });
  }
}
