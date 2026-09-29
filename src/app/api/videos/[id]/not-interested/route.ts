import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyNotInterested } from "@/lib/watch/action-proxy";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/not-interested — LIVE Tier-2 write (broker):
 * the kebab "Not interested" action, executed as the real home-feed
 * action on youtube.com. Response keeps the {notInterested: true} contract
 * (+ok/effect/path).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const result = await proxyNotInterested(id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
