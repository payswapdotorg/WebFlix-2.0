import { NextResponse } from "next/server";
import { getChannelPage } from "@/lib/youtube/channels";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/channel/[handle] — the live channel page. `handle` accepts
 * "@name" or "UC…" (video cards link whichever the response carried);
 * resolution: SSR channel page → browse UC… → header + videos tab + shorts.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    if (!rateLimit(`channel:${_req.headers.get("x-forwarded-for") ?? "local"}`)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await params;
    const page = await getChannelPage(handle);
    if (!page) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/channel/[handle] failed", err);
    return NextResponse.json({ error: "Failed to load channel" }, { status: 502 });
  }
}
