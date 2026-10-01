import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { getCaptionTracks } from "@/lib/youtube/captions";

export const dynamic = "force-dynamic";

/**
 * WFX2-P4-QT — GET /api/videos/[id]/transcript/languages: the InnerTube
 * caption-tracks list for the video (name + languageCode per track, read
 * from the real watch page's player response; live call, cached).
 *
 * Honest states: [] when the video has no caption tracks; 502 when YouTube
 * does not answer (the panel keeps the default transcript either way).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const tracks = await getCaptionTracks(id);
    return json({ tracks });
  } catch (e) {
    return errorResponse(e);
  }
}
