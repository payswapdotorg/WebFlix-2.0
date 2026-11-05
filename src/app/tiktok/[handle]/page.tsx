import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isTikTokHandle, normalizeTikTokHandle } from "@/lib/tiktok/urls";
import { TikTokChannelView } from "./view";

/**
 * P94-a — the TikTok channel page (G1 in
 * docs/research/2026-11-04-tiktok-main-interface-gap-report.md): the derived
 * creator surface, visually mirroring the YouTube channel page. `/tiktok/
 * @handle` and `/tiktok/handle` normalize to the same route; all data rides
 * client-side from the dynamic /api/tiktok/channel/[handle] lane (the hub's
 * own pattern — the page stays a thin shell).
 */
export async function generateMetadata(ctx: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await ctx.params;
  const clean = normalizeTikTokHandle(decodeURIComponent(handle));
  if (!isTikTokHandle(clean)) return { title: { absolute: "TikTok channel · WebFlix" } };
  return {
    title: { absolute: `@${clean} — TikTok on WebFlix` },
    description: `Watch @${clean}'s TikTok posts on WebFlix — the official embed player, attribution intact, playback rides TikTok.`,
  };
}

export default async function Page(ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const clean = normalizeTikTokHandle(decodeURIComponent(handle));
  if (!isTikTokHandle(clean)) notFound();
  return <TikTokChannelView handle={clean} />;
}
