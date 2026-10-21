import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { deleteYouTubeConnection, getYouTubeConnection } from "@/lib/auth/youtube-connection-store";
import { decryptSecret, revokeToken } from "@/lib/youtube/oauth";

export const dynamic = "force-dynamic";

/**
 * WFX2-P36 — POST /api/connection/youtube/disconnect: remove the signed-in
 * user's YouTube account connection. The stored refresh token is revoked at
 * Google first (best-effort — Google being unreachable still deletes the
 * local binding; a revoked token is inert either way), then the record is
 * deleted. After this, the user's actions honestly require a re-connect.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();
  try {
    const connection = await getYouTubeConnection(user.id);
    if (connection?.refreshTokenEnc) {
      const refreshToken = await decryptSecret(connection.refreshTokenEnc);
      if (refreshToken) await revokeToken(refreshToken);
    }
    await deleteYouTubeConnection(user.id);
    return json({ ok: true, effect: "disconnected" });
  } catch (e) {
    return errorResponse(e);
  }
}
