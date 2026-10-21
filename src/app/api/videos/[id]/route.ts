import { NextResponse } from "next/server";
import { getVideoDetail } from "@/lib/youtube/watch";
import { getSessionUser } from "@/lib/auth/session";
import { readLocalSavedWatchLater, resolveReadTier } from "@/lib/watch/action-proxy";
import { officialGetRating, officialSubscriptionStatus } from "@/lib/youtube/official-actions";
import type { LikeValue } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id] — live watch payload from `next {videoId}`
 * (title, channel + sub count, view count, like count, description, related
 * state). The `player` endpoint is never called (bot-flag risk — the IFrame
 * player lane owns playback).
 *
 * WFX2-P36 — the per-user state overlay: `state.like` /
 * `state.subscribed` are read with the SIGNED-IN user's OWN connected
 * account (videos.getRating + subscriptions.list), `state.savedWatchLater`
 * from their WebFlix-local list. The pre-P36 behavior (the operator
 * session's entity state baked into the SHARED cached `next` payload — one
 * person's like/subscribe state served to every user) is retired: the
 * cached payload carries no per-user state at all, and `accountConnected`
 * tells the UI whether the acting user's own truth was available.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [detail, sessionUser, tier] = await Promise.all([
      getVideoDetail(id),
      getSessionUser(req),
      resolveReadTier(req),
    ]);
    if (!detail) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    if (tier) {
      // the acting user's own truth (parallel; each call 1 quota unit)
      const [rating, sub] = await Promise.all([
        officialGetRating(tier.accessToken, id),
        officialSubscriptionStatus(tier.accessToken, detail.video.channel.id),
      ]);
      const like: LikeValue | null = rating.ok
        ? rating.data.rating === "like"
          ? "like"
          : rating.data.rating === "dislike"
            ? "dislike"
            : null
        : null;
      detail.state.like = like;
      detail.state.subscribed = sub.ok ? sub.data.subscribed : false;
      detail.state.isCreator = tier.channelId
        ? tier.channelId === detail.video.channel.id
        : false;
    }
    detail.state.savedWatchLater = await readLocalSavedWatchLater(id, sessionUser);
    return NextResponse.json({
      ...detail,
      accountConnected: Boolean(tier),
    });
  } catch (err) {
    console.error("GET /api/videos/[id] failed", err);
    return NextResponse.json({ error: "Failed to load video" }, { status: 502 });
  }
}
