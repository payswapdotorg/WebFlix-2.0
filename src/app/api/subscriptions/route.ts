import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { errorResponse, json } from "@/lib/watch/api";
import {
  proxySubscriptionStateMachine,
  resolveActionTier,
  resolveReadTier,
  tierError,
} from "@/lib/watch/action-proxy";
import { officialListSubscribedChannels } from "@/lib/youtube/official-actions";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import type { ChannelLite } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscriptions — WFX2-P36: the SIGNED-IN user's own subscription
 * channels, read through the official API with their connected account.
 *
 * The pre-P36 behavior (the deployment-wide operator session's SSR feed —
 * one person's subscriptions served to every signed-in user) is RETIRED:
 * that was the account-isolation defect the P36 work order closed. The
 * combined latest-videos feed has no official API — the honest notice says
 * so; the channel rail is the user's own truth.
 *
 * Envelope: { channels, videos: [], nextCursor: null, connected, notice }.
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`subscriptions:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const tier = await resolveReadTier(req);
    if (!tier) {
      return NextResponse.json({
        channels: [] as ChannelLite[],
        videos: [],
        nextCursor: null,
        loginRequired: false,
        connected: false,
        notice:
          "Connect your YouTube account to see your subscriptions — Settings → YouTube connection",
      });
    }
    const subs = await officialListSubscribedChannels(tier.accessToken);
    if (!subs.ok) {
      return NextResponse.json({
        channels: [] as ChannelLite[],
        videos: [],
        nextCursor: null,
        loginRequired: false,
        connected: true,
        notice:
          "Your subscription list could not be read just now (the YouTube API answered honestly with an error) — try again shortly",
      });
    }
    const channels: ChannelLite[] = subs.data.map((c) => ({
      id: c.channelId,
      handle: c.title,
      name: c.title,
      avatarUrl: c.thumbUrl ?? "",
      verified: false,
      subscriberCount: 0,
    }));
    return NextResponse.json({
      channels,
      videos: [],
      nextCursor: null,
      loginRequired: false,
      connected: true,
      notice:
        "Your channels, read through your connected account. The combined latest-videos feed has no official YouTube API — open youtube.com/feed/subscriptions for it.",
    });
  } catch (err) {
    console.error("GET /api/subscriptions failed", err);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 502 });
  }
}

/**
 * POST /api/subscriptions { channelId, bell, subscriberCount?, videoId? } —
 * WFX2-P36: the watch page subscribe state machine on the per-user official
 * lane. bell off/omitted → unsubscribe; all|personalized|none → subscribe;
 * the bell PREF itself has no official API — the response says so honestly
 * (bell:null + note) instead of pretending it was set.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!channelId) return json({ error: "channelId is required" }, 400);
    const bellRaw = typeof body.bell === "string" ? body.bell : undefined;
    if (bellRaw && !["all", "personalized", "none", "off"].includes(bellRaw)) {
      return json({ error: "bell must be all|personalized|none|off" }, 400);
    }
    const countBaseline =
      typeof body.subscriberCount === "number" && Number.isFinite(body.subscriberCount)
        ? body.subscriberCount
        : null;
    // P35's threading kept: the watch page passes the video it's on so a
    // successful write also drops the cached `next` response
    const videoId = typeof body.videoId === "string" && body.videoId ? body.videoId : null;
    const tier = await resolveActionTier(req);
    if (!tier.ok) throw tierError(tier.kind);
    const result = await proxySubscriptionStateMachine(
      channelId,
      bellRaw as "all" | "personalized" | "none" | "off" | undefined,
      countBaseline,
      tier,
      { videoId },
    );
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
