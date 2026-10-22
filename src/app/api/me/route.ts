import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser, localAvatarUrl } from "@/lib/watch/local-comments";
import { resolveReadTier } from "@/lib/watch/action-proxy";
import { officialListSubscribedChannels } from "@/lib/youtube/official-actions";
import type { MeDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/me — the acting user's own profile + subscriptions.
 *
 * WFX2-P37 — THE PER-USER TRUTH (the last shared-identity READ lane retired):
 * the pre-P37 route answered `getDemoUser()` (the boot-lane "@you" demo
 * identity) for EVERY caller — signed-in users included — and, worse, served
 * `getSubscribedChannels()` (the OPERATOR's YouTube session via YT_COOKIES)
 * as "your" subscriptions to guests and signed-in users alike: one
 * deployment-wide person's sidebar data wearing every user's name (measured
 * 2026-10-22 in production by the station QA user: canned channels like
 * YogaDaily rendered for a brand-new account). The P36 work order closed
 * this class on the WRITE routes; this is the READ lane's turn:
 *  - a signed-in user gets THEIR WebFlix identity (the shadow-user row),
 *    THEIR DB channel as ownedChannel (the operator-channel seam is retired
 *    from this route), and THEIR OWN subscriptions — read through their own
 *    connected YouTube account (official subscriptions.list) or the honest
 *    empty list when not connected (never the operator's);
 *  - a guest keeps the demo identity (the anonymous UI lane) with the
 *    honest empty subscription list.
 */
export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getSessionUser(req);
    // the acting user's WebFlix identity — signed-in: their own shadow row;
    // guest: the boot-lane demo identity (the anonymous UI lane)
    const user = sessionUser
      ? await ensureShadowUser(sessionUser)
      : await getDemoUser();
    const dbOwned = await db.channel.findFirst({
      where: { ownerId: user.id },
      select: { handle: true, name: true },
    });
    // P37 — the operator-channel seam is RETIRED here (it resolved through
    // YT_COOKIES: the operator's real channel as every user's "Your
    // channel"); the acting user's own DB channel is the honest answer.
    const ownedChannel: MeDTO["ownedChannel"] = dbOwned
      ? { handle: dbOwned.handle, name: dbOwned.name }
      : null;
    // P37 — subscriptions: the acting user's OWN list through their own
    // connected account; the honest empty list otherwise. NEVER the
    // operator's session feed (the pre-P37 cross-user read leak).
    let channels: MeDTO["subscriptions"] = [];
    if (sessionUser) {
      const tier = await resolveReadTier(req);
      if (tier) {
        const official = await officialListSubscribedChannels(tier.accessToken);
        if (official.ok) {
          channels = official.data.map((ch) => ({
            id: ch.channelId,
            // subscriptions.list carries no handle — the UC id resolves
            // through /api/channel/[handle] exactly like an @handle
            handle: ch.channelId,
            name: ch.title,
            avatarUrl: ch.thumbUrl ?? localAvatarUrl(channelSeed(ch.channelId), ch.title),
            verified: false, // the official list carries no verified flag — honest false
            subscriberCount: 0, // not in the subscriptions.list snippet — honest 0
            bell: "personalized" as const,
          }));
        }
        // an official read failure keeps the honest empty list (the sidebar's
        // own hint renders); never the operator's, never a fabricated row
      }
    }
    const me: MeDTO = {
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatarUrl,
        description: null, // the WebFlix identity carries no description — honest null
      },
      ownedChannel,
      subscriptions: channels,
    };
    return NextResponse.json(me);
  } catch (err) {
    console.error("GET /api/me failed", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

/** A deterministic avatar seed for a channel id (the fallback avatar's hue). */
function channelSeed(channelId: string): number {
  let h = 0;
  for (let i = 0; i < channelId.length; i++) {
    h = (h * 31 + channelId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
