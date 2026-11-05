import { NextRequest, NextResponse } from "next/server";
import { getTikTokChannelPage } from "@/lib/tiktok/channels";
import { composedFeedExtraIds, importUserId } from "@/lib/tiktok/imports";
import { isTikTokHandle } from "@/lib/tiktok/urls";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/channel/[handle] — the P94-a derived TikTok channel page
 * (docs/research/2026-11-04-tiktok-main-interface-gap-report.md G1): the
 * composed universe (curated + public imports + the signed-in viewer's own
 * private saves) aggregated by creator handle, through the SAME honest
 * oEmbed lane every TikTok surface rides.
 *
 * - `@handle` and `handle` normalize to the same page (the URL law).
 * - A valid handle with zero shelf posts answers 200 with the honest empty
 *   page (`note` + the outbound profile link) — never a fabricated row.
 * - A format-invalid handle answers 400 (the URL law's own verdict).
 * - Viewer composition matches the feed route's (the shadow identity).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  try {
    if (!(await rateLimit(`tiktok:channel:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await ctx.params;
    if (!isTikTokHandle(handle)) {
      return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
    }
    const sessionUser = await getSessionUser(req);
    const viewerId = sessionUser ? await importUserId(sessionUser) : null;
    const { extraIds, hintByPostId } = await composedFeedExtraIds(viewerId);
    const page = await getTikTokChannelPage(handle, { extraIds, hintByPostId });
    if (!page) {
      return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
    }
    return NextResponse.json(page, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/channel/[handle] failed", err);
    return NextResponse.json({ error: "Failed to load the TikTok channel" }, { status: 502 });
  }
}
