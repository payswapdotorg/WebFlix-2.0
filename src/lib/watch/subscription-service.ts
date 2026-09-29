/**
 * WFX2-W subscription service — the subscribe state machine:
 *   Subscribe → Subscribed (bell) → bell menu All/Personalized/None,
 * persisted per channel. `bell: "off"` (or omitted) = unsubscribe.
 * subscriberCount is incremented/decremented so the displayed count always
 * equals the database truth.
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import type { BellValue, SubscriptionResultDto } from "./types";

export async function setSubscription(
  channelId: string,
  userId: string,
  bell: BellValue | "off" | undefined
): Promise<SubscriptionResultDto> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, subscriberCount: true },
  });
  if (!channel) throw notFound("Channel");

  if (!bell || bell === "off") {
    // unsubscribe
    const existing = await db.subscribe.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    if (existing) {
      await db.$transaction([
        db.subscribe.delete({ where: { userId_channelId: { userId, channelId } } }),
        db.channel.update({
          where: { id: channelId },
          data: { subscriberCount: { decrement: 1 } },
        }),
      ]);
    }
    const after = await db.channel.findUnique({
      where: { id: channelId },
      select: { subscriberCount: true },
    });
    return { subscribed: false, bell: null, subscriberCount: after?.subscriberCount ?? 0 };
  }

  const existing = await db.subscribe.findUnique({
    where: { userId_channelId: { userId, channelId } },
  });
  if (!existing) {
    await db.$transaction([
      db.subscribe.create({ data: { channelId, userId, bell } }),
      db.channel.update({
        where: { id: channelId },
        data: { subscriberCount: { increment: 1 } },
      }),
    ]);
  } else {
    await db.subscribe.update({ where: { userId_channelId: { userId, channelId } }, data: { bell } });
  }
  const after = await db.channel.findUnique({
    where: { id: channelId },
    select: { subscriberCount: true },
  });
  return {
    subscribed: true,
    bell,
    subscriberCount: after?.subscriberCount ?? 0,
  };
}
