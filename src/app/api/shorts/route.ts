import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toVideoDTO } from "@/lib/dto";
import type { ShortsPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.video.findMany({
      where: { isShort: true, visibility: "public" },
      include: { channel: true },
      orderBy: { views: "desc" },
    });
    const data: ShortsPageDTO = { shorts: rows.map(toVideoDTO) };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/shorts failed", err);
    return NextResponse.json({ error: "Failed to load shorts" }, { status: 500 });
  }
}
