import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { deleteTikTokConnection } from "@/lib/auth/tiktok-connection-store";

export const dynamic = "force-dynamic";

/**
 * P94-b — POST /api/connection/tiktok/disconnect: remove the user's TikTok
 * binding (either mode — the OAuth grant record or the interim profile
 * link). The P36 disconnect's second-source twin: with no TikTok revocation
 * endpoint to honor for a profile link, the store delete is the whole
 * effect; an OAuth binding's refresh token is simply discarded (TikTok's
 * documented revocation path is operator/consent-side — nothing is claimed
 * beyond the delete that happened).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();
  try {
    await deleteTikTokConnection(user.id);
  } catch {
    return NextResponse.json(
      { error: "The connection store is unreachable — try again in a moment" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, effect: "unlinked" });
}
