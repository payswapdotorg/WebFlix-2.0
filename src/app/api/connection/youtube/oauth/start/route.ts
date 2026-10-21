import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  oauthConfigured,
  oauthMissingEnv,
  oauthRedirectUri,
} from "@/lib/youtube/oauth";

export const dynamic = "force-dynamic";

/** The double-submit cookie name (httpOnly; the callback requires it). */
export const OAUTH_STATE_COOKIE = "wf_yt_oauth_state";

/**
 * WFX2-P36 — GET /api/connection/youtube/oauth/start: begin the per-user
 * Google OAuth consent flow for the SIGNED-IN WebFlix user.
 *
 * The P36 law: app sign-in is a WebFlix identity, not YouTube authorization.
 * This route sends the user to Google's consent page with:
 *  - the narrowly-required scope (youtube.force-ssl — rate/getRating,
 *    subscriptions, playlists);
 *  - access_type=offline + prompt=consent → a refresh token every connect;
 *  - a CSRF state signed over {uid, nonce, exp} and mirrored in a short-lived
 *    httpOnly cookie (the callback requires BOTH to match this user).
 *
 * Not configured (missing GOOGLE_CLIENT_ID/SECRET) → the honest 503 envelope
 * with the exact missing vars + the redirect URI to register (the operator's
 * setup path — never a silent failure).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();

  if (!oauthConfigured()) {
    return NextResponse.json(
      {
        error: "youtube-oauth-not-configured",
        missing: oauthMissingEnv(),
        redirectUri: oauthRedirectUri(req),
        setup:
          "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (the Google Cloud OAuth client), and register the redirectUri above in the console",
      },
      { status: 503 },
    );
  }

  const redirectUri = oauthRedirectUri(req);
  const { state, cookieValue, maxAge } = await createOAuthState(user.id);
  const consentUrl = buildGoogleAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri,
    state,
  });

  const res = NextResponse.redirect(consentUrl, 303);
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: "lax",
    path: "/api/connection/youtube/oauth/callback",
    maxAge,
  });
  return res;
}
