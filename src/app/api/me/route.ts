import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { getSubscribedChannels } from "@/lib/youtube/subscriptions";
import { hasSession } from "@/lib/youtube/session";
import type { MeDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/me — the WebFlix-local profile (UI prefs lane) + the operator's
 * REAL subscribed channels for the sidebar's SUBSCRIPTIONS section (live
 * from the subscriptions feed; the YouTube account is the source of truth).
 * Public mode (no YT_COOKIES): subscriptions = [] — the sidebar shows its
 * own honest "no subscriptions" hint.
 */
export async function GET() {
  try {
    const user = await getDemoUser();
    const owned = await db.channel.findFirst({
      where: { ownerId: user.id },
      select: { handle: true, name: true },
    });
    const channels = hasSession() ? await getSubscribedChannels() : [];
    const me: MeDTO = {
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatarUrl,
        description: user.description,
      },
      ownedChannel: owned ? { handle: owned.handle, name: owned.name } : null,
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
