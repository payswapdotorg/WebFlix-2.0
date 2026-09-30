import { NextResponse } from "next/server";
import { searchInChannel } from "@/lib/youtube/channel-search";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/channel/[handle]/search?q=&cursor= — the "Search this channel"
 * flow (WFX2-B-W). Mechanism (live-verified): browse {browseId: UC…,
 * params: <the channel's own Search tab params>, query} → the response's
 * Search tab carries the channel-scoped videoRenderers.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    if (!(await rateLimit(`channel-search:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await params;
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const cursor = url.searchParams.get("cursor") ?? undefined;
    if (!q && !cursor) {
      return NextResponse.json({ error: "q is required" }, { status: 400 });
    }
    const page = await searchInChannel(handle, q, cursor);
    if (!page) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/channel/[handle]/search failed", err);
    return NextResponse.json({ error: "Channel search failed — try again" }, { status: 502 });
  }
}
