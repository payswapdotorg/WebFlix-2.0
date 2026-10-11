import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { getSubscribedChannels } from "@/lib/youtube/subscriptions";
import { hasSession } from "@/lib/youtube/session";
import { operatorChannelLookup } from "@/lib/youtube/studio";
import type { MeDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/me — the WebFlix-local profile (UI prefs lane) + the operator's
 * REAL subscribed channels for the sidebar's SUBSCRIPTIONS section (live
 * from the subscriptions feed; the YouTube account is the source of truth).
 * Public mode (no YT_COOKIES): subscriptions = [] — the sidebar shows its
 * own honest "no subscriptions" hint.
 *
 * P22-B: `ownedChannel` now resolves through the operator-channel seam FIRST
 * (the operator's REAL YouTube channel — "Your channel" on youtube.com),
 * with the WebFlix-local DB channel as the fallback (the mirror domain).
 * Honest null when neither resolves (the sidebar hides the row — never a
 * guess). The seam is cached server-side; this route is called by the
 * sidebar on every page.
 */
export async function GET() {
  try {
    const user = await getDemoUser();
    const dbOwned = await db.channel.findFirst({
      where: { ownerId: user.id },
      select: { handle: true, name: true },
    });
    // the operator's REAL channel first (youtube.com parity for "Your
    // channel"); the DB channel is the WebFlix-mirror fallback
    let ownedChannel: MeDTO["ownedChannel"] = null;
    if (hasSession()) {
      const lookup = await operatorChannelLookup().catch(() => null);
      if (lookup?.header) {
        ownedChannel = { handle: lookup.handle, name: lookup.header.name };
      }
    }
    if (!ownedChannel && dbOwned) {
      ownedChannel = { handle: dbOwned.handle, name: dbOwned.name };
    }
    const channels = hasSession() ? await getSubscribedChannels() : [];
    const me: MeDTO = {
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatarUrl,
        description: user.description,
      },
      ownedChannel,
      subscriptions: channels.map((ch) => ({
        ...ch,
        bell: "personalized" as const,
      })),
    };
    return NextResponse.json(me);
  } catch (err) {
    console.error("GET /api/me failed", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
