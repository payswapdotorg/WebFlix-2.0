import { NextResponse } from "next/server";
import { getChannelTab, getChannelMembershipTab } from "@/lib/youtube/channel-tabs";
import { getCommunityTab } from "@/lib/youtube/community";
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
  "membership",
  "about",
];

/**
 * GET /api/channel/[handle]/tab?tab=home|videos|shorts|live|playlists|community|membership|about
 * — the per-tab channel data (WFX2-B-S deep parity), lazy-loaded per tab
 * switch. Real tab data via browse {browseId, params: the channel's own tab
 * param}; Community = the Posts tab; About = the engagement-panel
 * continuation (aboutChannelViewModel).
 *
 * WFX2-P6-CH: `?tab=videos&chip=<token>` — the Videos tab's sort chips.
 * The clicked chip's own continuation token swaps the fetch to
 * browse {continuation}; the response carries the sorted grid + the
 * re-marked chip bar (the chosen sort selected). The chip list itself is
 * never refetched per click — the page reuses its bar, only the grid data
 * changes.
 *
 * WFX2-P7-CH: `?tab=membership` — the tab route's per-tab switch branches to
 * getChannelMembershipTab (the same branch shape the Community tab uses —
 * the code's natural place, chosen over extending the /join response): the
 * tab's tier data comes from the SAME join surface /join serves, through the
 * single shared memberships-panel walk (getChannelJoin), so the tab and the
 * sheet can never diverge.
 *
 * Every tab rides the cutover resilience contract: the walled shape is never
 * cached, last-good serves when the wall hits, and a cold walled read
 * answers HTTP 200 with `{tab, walled: true}` — the channel page renders its
 * honest unavailable state, never a fake one.
 *
 * WFX2-P2-SO: the Community tab climbs the wall ladder
 * (browse-fresh → Tier-2 broker-read → Upstash last-good → honest empty) and
 * answers the mapped posts with the additive `source` rung flag + `compose`
 * (the operator session owns this channel — the composer affordance).
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
    // WFX2-P6-CH: the sort-chip continuation token (honored on the Videos
    // tab only; absent/empty on every other tab — the default fetch)
    const chip = url.searchParams.get("chip");
    // WFX2-P7-CH: the membership tab branches to the shared join walk (the
    // per-tab switch — the same shape the Community tab's branch takes)
    const payload: ChannelTabDTO =
      tab === "community"
        ? await getCommunityTab(handle)
        : tab === "membership"
          ? await getChannelMembershipTab(handle)
          : await getChannelTab(handle, tab as ChannelTabId, chip ?? undefined);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/channel/[handle]/tab failed", err);
    return NextResponse.json({ error: "Failed to load channel tab" }, { status: 502 });
  }
}
