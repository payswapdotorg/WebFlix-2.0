import { NextResponse } from "next/server";
import { getVideoDetail } from "@/lib/youtube/watch";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id] — live watch payload from `next {videoId}`
 * (title, channel + sub count, view count, like count, description, related
 * state). The `player` endpoint is never called (bot-flag risk — the IFrame
 * player lane owns playback).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const detail = await getVideoDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    console.error("GET /api/videos/[id] failed", err);
    return NextResponse.json({ error: "Failed to load video" }, { status: 502 });
  }
}
