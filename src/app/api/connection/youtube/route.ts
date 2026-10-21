import { NextRequest } from "next/server";
import { json } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { getYouTubeConnection } from "@/lib/auth/youtube-connection-store";
import { oauthConfigured, oauthMissingEnv, oauthRedirectUri } from "@/lib/youtube/oauth";
import { hasSession } from "@/lib/youtube/session";

export const dynamic = "force-dynamic";

/**
 * WFX2-P36 — GET /api/connection/youtube: the SIGNED-IN user's own YouTube
 * account connection status (the settings card's truth).
 *
 * The pre-P36 envelope (mode direct/broker/none — the deployment-wide
 * operator session + the shared browser tab) is RETIRED: neither tier may
 * serve an end-user write anymore. The new truth is per-user OAuth:
 *
 *   status "connected"     — the user's own account is connected (their
 *                            actions run through the official API with
 *                            read-back verification);
 *   status "needs-reauth"  — the connection exists but Google revoked/expired
 *                            the grant — re-connect (a revoked consent
 *                            surfaces here after the first honest failure,
 *                            because that failure flips the record);
 *   status "not-connected" — no connection for this user (the card's
 *                            Connect button);
 *   status "not-configured"— the deployment lacks GOOGLE_CLIENT_ID/SECRET —
 *                            the honest operator setup state, with the exact
 *                            missing vars + the redirect URI to register.
 *
 * `actions` is the honest capability map the card renders: what runs on
 * your own account (official), what is WebFlix-local (fully disclosed), and
 * what has no official API (the handoff to YouTube). `serverReadSession`
 * discloses the deployment-wide READ session — it may still enrich public
 * server-side reads, and it is NEVER used for any user action.
 *
 * NEVER a 5xx: every shape degrades to the honest envelope with 200.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();

  const checkedAt = new Date().toISOString();
  const configured = oauthConfigured();

  let connection = null;
  try {
    connection = await getYouTubeConnection(user.id);
  } catch {
    connection = null; // store outage → the honest not-connected read
  }

  const actions = {
    like: "official",
    dislike: "official",
    subscribe: "official",
    playlists: "official",
    watchLater: "local",
    comments: "local",
    notInterested: "local",
    bell: "unsupported",
    history: "unsupported",
  } as const;

  const oauth = {
    configured,
    missingEnv: oauthMissingEnv(),
    redirectUri: oauthRedirectUri(req),
    connectUrl: "/api/connection/youtube/oauth/start",
    disconnectUrl: "/api/connection/youtube/disconnect",
  };

  if (!configured) {
    return json({
      mode: "oauth",
      status: "not-configured",
      connected: false,
      actions,
      oauth,
      serverReadSession: { configured: hasSession() },
      checkedAt,
    });
  }

  if (!connection) {
    return json({
      mode: "oauth",
      status: "not-connected",
      connected: false,
      actions,
      oauth,
      serverReadSession: { configured: hasSession() },
      checkedAt,
    });
  }

  // a connection without a refresh grant and an expired access token can
  // never serve an action — the honest needs-reauth (the same verdict the
  // action tier would reach)
  const tokenUnusable =
    connection.status === "needs_reauth" ||
    (connection.accessExpiresAt <= Date.now() && !connection.refreshTokenEnc);

  return json({
    mode: "oauth",
    status: tokenUnusable ? "needs-reauth" : "connected",
    connected: !tokenUnusable,
    account: {
      channelId: connection.channelId,
      channelTitle: connection.channelTitle,
      channelThumbUrl: connection.channelThumbUrl,
      scope: connection.scope,
      connectedAt: connection.connectedAt,
    },
    actions,
    oauth,
    serverReadSession: { configured: hasSession() },
    checkedAt,
  });
}
