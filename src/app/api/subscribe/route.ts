import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ channelId: z.string().min(1) });

/** POST /api/subscribe { channelId } — toggle subscription (count kept honest). */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }
    const user = await getDemoUser();
    const { channelId } = parsed.data;
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    if (channel.ownerId === user.id) {
      return NextResponse.json({ error: "You can't subscribe to your own channel" }, { status: 400 });
    }
    const existing = await db.subscribe.findUnique({
      where: { userId_channelId: { userId: user.id, channelId } },
    });
    if (existing) {
      await db.subscribe.delete({ where: { userId_channelId: { userId: user.id, channelId } } });
      await db.channel.update({
        where: { id: channelId },
        data: { subscriberCount: Math.max(0, channel.subscriberCount - 1) },
      });
      return NextResponse.json({ subscribed: false });
    }
    await db.subscribe.create({
      data: { userId: user.id, channelId, bell: "personalized" },
    });
    await db.channel.update({
      where: { id: channelId },
      data: { subscriberCount: channel.subscriberCount + 1 },
    });
    return NextResponse.json({ subscribed: true });
  } catch (err) {
    console.error("POST /api/subscribe failed", err);
    return NextResponse.json({ error: "Failed to toggle subscription" }, { status: 500 });
  }
}
