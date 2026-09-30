import { NextResponse } from "next/server";
import { getChannelTab } from "@/lib/youtube/channel-tabs";
import { rateLimit } from "@/lib/youtube/cache";
import type { ChannelTabDTO, ChannelTabId } from "@/lib/types";

export const dynamic = "force-dynamic";

const TAB_IDS: ChannelTabId[] = [
  "home",
  "videos",
  "shorts",
  "live",
  "playlists",
  "community",
  "about",
];

/**
 * GET /api/channel/[handle]/tab?tab=home|videos|shorts|live|playlists|community|about
 * — the per-tab channel data (WFX2-B-S deep parity), lazy-loaded per tab
 * switch. Real tab data via browse {browseId, params: the channel's own tab
 * param}; Community = the Posts tab; About = the engagement-panel
 * continuation (aboutChannelViewModel).
 *
 * Every tab rides the cutover resilience contract: the walled shape is never
 * cached, last-good serves when the wall hits, and a cold walled read
 * answers HTTP 200 with `{tab, walled: true}` — the channel page renders its
 * honest unavailable state, never a fake one.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    if (!(await rateLimit(`channel-tab:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await params;
    const url = new URL(req.url);
    const tab = url.searchParams.get("tab") ?? "home";
    if (!TAB_IDS.includes(tab as ChannelTabId)) {
      return NextResponse.json(
        { error: `unknown tab (expected one of ${TAB_IDS.join("|")})` },
        { status: 400 }
      );
    }
    const payload: ChannelTabDTO = await getChannelTab(handle, tab as ChannelTabId);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/channel/[handle]/tab failed", err);
    return NextResponse.json({ error: "Failed to load channel tab" }, { status: 502 });
  }
}
