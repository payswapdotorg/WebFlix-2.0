import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { getTikTokConnection } from "@/lib/auth/tiktok-connection-store";
import { oauthConfigured, oauthMissingEnv, oauthRedirectUri } from "@/lib/tiktok/oauth";
import { isTikTokHandle, tiktokAuthorUrl } from "@/lib/tiktok/urls";

export const dynamic = "force-dynamic";

/**
 * P94-b — GET /api/connection/tiktok: the SIGNED-IN user's own TikTok
 * account connection status (the settings card's truth — the P36 status
 * route's second-source twin).
 *
 *   status "connected"      — the user's own TikTok account is connected
 *                             through the official Login Kit grant;
 *   status "needs-reauth"   — the grant exists but expired/revoked — re-connect;
 *   status "linked"         — the INTERIM binding: the user linked their own
 *                             profile URL (unverified — no TikTok
 *                             authorization is claimed; the channel page
 *                             and the local lanes know this creator is
 *                             "yours");
 *   status "not-connected"  — no binding for this user;
 *   status "not-configured" — the deployment lacks TIKTOK_CLIENT_KEY/SECRET
 *                             (the OAuth lane's honest operator setup state;
 *                             the profile-link lane stays available).
 *
 * `actions` is the honest capability map: TikTok has NO third-party write
 * API (ADR 0004), so every provider-side action is "unsupported" and the
 * real affordances are the WebFlix-local ones. NEVER a 5xx.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();

  const checkedAt = new Date().toISOString();
  const configured = oauthConfigured();

  let connection = null;
  try {
    connection = await getTikTokConnection(user.id);
  } catch {
    connection = null; // store outage → the honest not-connected read
  }

  const actions = {
    like: "unsupported",
    comment: "unsupported",
    follow: "unsupported",
    saveToShelf: "local",
    share: "local",
    openOutbound: "local",
    visibilityFlip: "local",
  } as const;

  const oauth = {
    configured,
    missingEnv: oauthMissingEnv(),
    redirectUri: oauthRedirectUri(req),
    connectUrl: "/api/connection/tiktok/oauth/start",
    disconnectUrl: "/api/connection/tiktok/disconnect",
  };

  if (!connection) {
    return NextResponse.json({
      mode: "oauth-or-link",
      status: configured ? "not-connected" : "not-configured",
      connected: false,
      actions,
      oauth,
      checkedAt,
    });
  }

  // The outbound profile URL rides the URL law's own builder (the ADR 0004
  // §1 string law) — only when the stored handle is format-valid.
  const linkedProfileUrl =
    connection.mode === "profile_link" && isTikTokHandle(connection.handle)
      ? tiktokAuthorUrl(connection.handle)
      : null;

  return NextResponse.json({
    mode: connection.mode,
    status:
      connection.status === "linked"
        ? "linked"
        : connection.status === "connected"
          ? "connected"
          : "needs-reauth",
    connected: connection.status === "connected",
    account: {
      handle: connection.handle,
      nickname: connection.nickname,
      avatarUrl: connection.avatarUrl,
      scope: connection.scope,
      connectedAt: connection.connectedAt,
    },
    linked:
      connection.mode === "profile_link"
        ? {
            handle: connection.handle,
            profileUrl: linkedProfileUrl,
            connectedAt: connection.connectedAt,
          }
        : null,
    actions,
    oauth,
    checkedAt,
  });
}
