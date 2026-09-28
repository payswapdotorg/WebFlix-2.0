import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toChannelLite, toVideoDTO } from "@/lib/dto";
import type { SearchPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/search?q= — case-insensitive title/description/channel match. */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q) {
      const empty: SearchPageDTO = { query: q, videos: [], channels: [] };
      return NextResponse.json(empty);
    }
    const needle = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const videos = await db.video.findMany({
      where: {
        visibility: "public",
        OR: [{ title: { contains: needle } }, { description: { contains: needle } }],
      },
      include: { channel: true },
      orderBy: { views: "desc" },
      take: 20,
    });
    const matchingChannelIds = [...new Set(videos.map((v) => v.channelId))];
    const channelsByName = await db.channel.findMany({
      where: {
        OR: [
          { name: { contains: needle } },
          { handle: { contains: needle } },
          { id: { in: matchingChannelIds } },
        ],
      },
      take: 3,
    });
    // Ranking: channels whose NAME matches first, then those only present via videos.
    channelsByName.sort((a, b) => {
      const aName = a.name.toLowerCase().includes(q.toLowerCase()) ? 0 : 1;
      const bName = b.name.toLowerCase().includes(q.toLowerCase()) ? 0 : 1;
      return aName - bName || b.subscriberCount - a.subscriberCount;
    });
    const data: SearchPageDTO = {
      query: q,
      videos: videos.map(toVideoDTO),
      channels: channelsByName.map(toChannelLite),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/search failed", err);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
