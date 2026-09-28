import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toVideoDTO } from "@/lib/dto";
import { normalizeCategory } from "@/lib/categories";
import type { TrendingPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/trending?category=All — the ranked list, views desc. */
export async function GET(req: Request) {
  try {
    const category = normalizeCategory(new URL(req.url).searchParams.get("category"));
    const rows = await db.video.findMany({
      where: {
        visibility: "public",
        ...(category !== "All" ? { category } : {}),
      },
      include: { channel: true },
      orderBy: { views: "desc" },
      take: 24,
    });
    const data: TrendingPageDTO = { category, videos: rows.map(toVideoDTO) };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/trending failed", err);
    return NextResponse.json({ error: "Failed to load trending" }, { status: 500 });
  }
}
