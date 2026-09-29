import { NextResponse } from "next/server";
import { listVideos } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/videos?cursor=views:id&category=All&limit=12 — keyset pagination (views desc). */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const result = await listVideos({
      cursor: params.get("cursor"),
      category: params.get("category"),
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/videos failed", err);
    return NextResponse.json({ error: "Failed to list videos" }, { status: 500 });
  }
}
