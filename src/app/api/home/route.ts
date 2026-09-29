import { NextResponse } from "next/server";
import { getHomeFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const category = new URL(req.url).searchParams.get("category");
    const feed = await getHomeFeed(category);
    return NextResponse.json(feed);
  } catch (err) {
    console.error("GET /api/home failed", err);
    return NextResponse.json({ error: "Failed to load home feed" }, { status: 500 });
  }
}
