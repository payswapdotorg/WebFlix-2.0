import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  getTikTokConnection,
  putTikTokConnection,
} from "@/lib/auth/tiktok-connection-store";
import {
  encryptSecret,
  exchangeTikTokCode,
  fetchTikTokUserInfo,
  oauthRedirectUri,
  TIKTOK_STATE_COOKIE,
  verifyTikTokOAuthState,
} from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/**
 * P94-b — GET /api/connection/tiktok/oauth/callback: the Login Kit consent
 * verdict (the P36 callback's second-source twin). TikTok redirects here
 * with `?code=&state=` (or `?error=`); the route:
 *
 *  1. requires the signed-in WebFlix user (ttc=signin otherwise);
 *  2. verifies the HMAC state AND the httpOnly double-submit cookie,
 *     bound to the same user (ttc=state);
 *  3. honors a user-declined consent (ttc=denied);
 *  4. exchanges the code (ttc=exchange) and reads the consented identity
 *     (ttc=identity);
 *  5. stores the binding — mode "oauth", tokens AES-256-GCM sealed
 *     (plaintext never touches the store, the logs, or the browser) — and
 *     redirects to /settings?ttc=connected.
 *
 * The outcome codes ride the settings card's banner (the ?ytc= idiom, now
 * ?ttc=). An existing profile_link binding is UPGRADED in place (the same
 * connectedAt — the identity is affirmed, not restarted).
 */
export async function GET(req: NextRequest) {
  const back = (code: string) =>
    NextResponse.redirect(new URL(`/settings?ttc=${code}#tiktok-connection`, req.nextUrl), 303);

  const user = await getSessionUser(req);
  if (!user) return back("signin");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const state = params.get("state");
  const cookie = req.cookies.get(TIKTOK_STATE_COOKIE)?.value ?? null;
  const verified = verifyTikTokOAuthState(state, cookie);
  if (!verified.ok || verified.userId !== user.id) return back("state");

  const code = params.get("code");
  if (!code) return back("denied");

  const token = await exchangeTikTokCode({ code, redirectUri: oauthRedirectUri(req) });
  if (!token) return back("exchange");

  const userInfo = await fetchTikTokUserInfo(token.accessToken);
  if (!userInfo) return back("identity");

  const now = new Date().toISOString();
  const existing = await getTikTokConnection(user.id).catch(() => null);

  try {
    await putTikTokConnection({
      userId: user.id,
      mode: "oauth",
      handle: userInfo.handle ?? existing?.handle ?? "",
      nickname: userInfo.displayName ?? existing?.nickname ?? null,
      avatarUrl: userInfo.avatarUrl ?? existing?.avatarUrl ?? null,
      openId: token.openId ?? userInfo.openId,
      unionId: userInfo.unionId,
      scope: token.scope,
      accessTokenEnc: encryptSecret(token.accessToken),
      refreshTokenEnc: token.refreshToken ? encryptSecret(token.refreshToken) : null,
      accessExpiresAt: Date.now() + Math.max(0, token.expiresIn) * 1000,
      status: "connected",
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    });
  } catch {
    return back("store");
  }

  // The state cookie's job is done — clear it on the way out.
  const res = back("connected");
  res.cookies.set({
    name: TIKTOK_STATE_COOKIE,
    value: "",
    httpOnly: true,
    path: "/api/connection/tiktok/oauth/callback",
    maxAge: 0,
  });
  return res;
}
