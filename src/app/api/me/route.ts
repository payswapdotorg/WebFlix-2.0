import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import type { MeDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getDemoUser();
    const subs = await db.subscribe.findMany({
      where: { userId: user.id },
      include: { channel: true },
      orderBy: { createdAt: "asc" },
    });
    const owned = await db.channel.findFirst({
      where: { ownerId: user.id },
      select: { handle: true, name: true },
    });
    const me: MeDTO = {
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatarUrl,
        description: user.description,
      },
      ownedChannel: owned ? { handle: owned.handle, name: owned.name } : null,
      subscriptions: subs.map((s) => ({
        id: s.channel.id,
        handle: s.channel.handle,
        name: s.channel.name,
        avatarUrl: s.channel.avatarUrl,
        verified: s.channel.verified,
        subscriberCount: s.channel.subscriberCount,
        bell: s.bell as "off" | "personalized" | "all",
      })),
    };
    return NextResponse.json(me);
  } catch (err) {
    console.error("GET /api/me failed", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
