import { NextResponse } from "next/server";
import { getChannelJoin } from "@/lib/youtube/channel-tabs";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/channel/[handle]/join — the Join (memberships) surface:
 * `joinable` from the join button renderer; `tiers` only when genuinely
 * reachable through the operator session (the signed-in memberships
 * panel); public mode honestly reports YouTube's own logged-out Join modal
 * state (`signinRequired` — "Sign in to become a member."), never fabricated
 * tiers.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    if (!(await rateLimit(`channel-join:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await params;
    const join = await getChannelJoin(handle);
    return NextResponse.json(join);
  } catch (err) {
    console.error("GET /api/channel/[handle]/join failed", err);
    return NextResponse.json({ error: "Failed to load membership info" }, { status: 502 });
  }
}
