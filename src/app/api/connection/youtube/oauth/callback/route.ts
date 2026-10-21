import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { OAUTH_STATE_COOKIE } from "../start/route";
import {
  encryptSecret,
  exchangeAuthorizationCode,
  fetchOwnChannelIdentity,
  oauthConfigured,
  oauthRedirectUri,
  verifyOAuthState,
} from "@/lib/youtube/oauth";
import { putYouTubeConnection } from "@/lib/auth/youtube-connection-store";

export const dynamic = "force-dynamic";

/** Redirect back to the settings surface with the honest outcome code. */
function back(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/settings?ytc=${encodeURIComponent(code)}`, req.url), 303);
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/connection/youtube/oauth/callback" });
  return res;
}

/**
 * WFX2-P36 — GET /api/connection/youtube/oauth/callback: finish the per-user
 * OAuth connect. The contract (each step fails honestly, never silently):
 *
 *  1. the user must STILL be the same signed-in WebFlix account (the binding
 *     anchor — the connection belongs to whoever consented);
 *  2. the state param AND the httpOnly state cookie must BOTH be present,
 *     identical, signature-valid, unexpired, and bound to this user (CSRF);
 *  3. the one-time code is exchanged server-side (the client secret never
 *     leaves the server);
 *  4. the user's own channel identity is read with the access token
 *     (channels.list mine=true — the token itself is the identity proof);
 *  5. the connection record is stored with AES-256-GCM-encrypted tokens
 *     (plaintext tokens never touch the store, the logs, or the browser).
 *
 * Outcome codes (the settings card renders the human copy):
 *   connected | denied | signin | state | exchange | identity | store
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return back(req, "signin");
  if (!oauthConfigured()) return back(req, "exchange");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return back(req, "denied");
  if (!code) return back(req, "exchange");

  // CSRF: double-submit + session binding + signature + expiry
  const stateCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
  if (!stateParam || !stateCookie || stateCookie !== stateParam) return back(req, "state");
  if (!(await verifyOAuthState(stateParam, user.id))) return back(req, "state");

  const redirectUri = oauthRedirectUri(req);
  const exchanged = await exchangeAuthorizationCode({
    code,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri,
  });
  if (!exchanged.ok) return back(req, "exchange");

  // the user's own channel (identity read; non-fatal when it degrades —
  // the card then honestly shows the account without channel details)
  const identity = await fetchOwnChannelIdentity(exchanged.data.accessToken);
  if (!identity.ok && (identity.status === 401 || identity.status === 403)) {
    return back(req, "identity");
  }
  const channel = identity.ok ? identity.data : { channelId: null, channelTitle: null, channelThumbUrl: null };

  const now = new Date().toISOString();
  try {
    await putYouTubeConnection({
      userId: user.id,
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      channelThumbUrl: channel.channelThumbUrl,
      scope: exchanged.data.scope,
      accessTokenEnc: await encryptSecret(exchanged.data.accessToken),
      refreshTokenEnc: exchanged.data.refreshToken
        ? await encryptSecret(exchanged.data.refreshToken)
        : null,
      accessExpiresAt: Date.now() + exchanged.data.expiresIn * 1000,
      status: "connected",
      connectedAt: now,
      updatedAt: now,
    });
  } catch {
    return back(req, "store");
  }
  return back(req, "connected");
}
