import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  buildTikTokAuthorizeUrl,
  mintTikTokOAuthState,
  oauthConfigured,
  oauthMissingEnv,
  oauthRedirectUri,
  TIKTOK_STATE_COOKIE,
} from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/**
 * P94-b — GET /api/connection/tiktok/oauth/start: begin the per-user TikTok
 * Login Kit consent flow (the P36 start route's second-source twin).
 *
 * The P36 law, restated: app sign-in is a WebFlix identity, not TikTok
 * authorization. This route sends the signed-in user to TikTok's consent
 * page with the narrow user-info scope and an HMAC state bound to their
 * user id, mirrored in a short-lived httpOnly cookie the callback requires.
 *
 * Not configured (missing TIKTOK_CLIENT_KEY/SECRET) → the honest 503
 * envelope (exact missing vars + the redirect URI to register); a real
 * BROWSER navigation 303s to /settings#tiktok-connection (the P38
 * deployment-truth law — the card explains the setup state, never a
 * stranded JSON page).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();

  if (!oauthConfigured()) {
    if ((req.headers.get("accept") ?? "").includes("text/html")) {
      // a human followed a Connect link — land them on the settings card
      // that explains the deployment's setup state (the P38 law)
      return NextResponse.redirect(
        new URL("/settings#tiktok-connection", req.nextUrl),
        303,
      );
    }
    return NextResponse.json(
      {
        error: "tiktok-oauth-not-configured",
        missing: oauthMissingEnv(),
        redirectUri: oauthRedirectUri(req),
        setup:
          "create a TikTok for Developers app with Login Kit, set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET, and register the redirectUri above",
      },
      { status: 503 },
    );
  }

  const redirectUri = oauthRedirectUri(req);
  const { state, cookie } = mintTikTokOAuthState(user.id);
  const consentUrl = buildTikTokAuthorizeUrl({
    clientKey: process.env.TIKTOK_CLIENT_KEY!,
    redirectUri,
    state,
  });

  const res = NextResponse.redirect(consentUrl, 303);
  res.cookies.set({
    name: TIKTOK_STATE_COOKIE,
    value: cookie,
    httpOnly: true,
    sameSite: "lax",
    path: "/api/connection/tiktok/oauth/callback",
    maxAge: 600,
  });
  return res;
}
