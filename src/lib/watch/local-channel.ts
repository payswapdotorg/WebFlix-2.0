import { db } from "@/lib/db";
import { toChannelLite, toVideoDTO } from "@/lib/dto";
import { compactCount } from "@/lib/watch/format";
import type { ChannelAboutDTO, ChannelPageDTO, ChannelTabDTO, ChannelTabId } from "@/lib/types";

/**
 * P95 (G14) — the local-universe channel page.
 *
 * The channel API is live-first for everything else, but a handle a LOCAL
 * Channel row owns answers here FIRST: the live ladder's search-compose
 * rung resolves almost any handle-ish string to a real-but-unrelated
 * channel (the P95 re-walk's measured mis-attribution), and the demo
 * universe's pages must render the demo universe's own rows. Its handles
 * carry the `-wf` suffix so they can never shadow a real channel a viewer
 * might want live. The mapper serves the SAME ChannelPageDTO the client
 * page already renders — banner/description/createdAt from the row, the
 * row's real videos (public only), joinable: false, and the additive
 * `local: true` marker (the composed/brokered pattern: the payload says
 * what shaped it). Nothing is invented: every field is the row's own.
 *
 * The bare-handle law matches the live mapper: the handle is decoded first
 * (the client page's double-encoded "%40" form reaches this route — the
 * live read path decodes the same way), then trimmed, then any leading
 * "@"/"/" is stripped; the lookup is case-insensitive (the rows are
 * lowercase).
 */
export async function localChannelPage(rawHandle: string): Promise<ChannelPageDTO | null> {
  const handle = decodeURIComponent(rawHandle)
    .trim()
    .toLowerCase()
    .replace(/^[@/]+/, "");
  if (!handle) return null;
  const channel = await db.channel.findUnique({ where: { handle } });
  if (!channel) return null;
  const rows = await db.video.findMany({
    where: { channelId: channel.id, visibility: "public" },
    orderBy: { createdAt: "desc" },
    include: { channel: true },
  });
  const videos = rows.filter((v) => !v.isShort).map(toVideoDTO);
  const shorts = rows.filter((v) => v.isShort).map(toVideoDTO);
  return {
    channel: {
      ...toChannelLite(channel),
      bannerUrl: channel.bannerUrl,
      description: channel.description,
      createdAt: channel.createdAt.toISOString(),
      isSubscribed: false,
      isOwner: false,
      videoCount: rows.length,
      local: true,
    },
    videos,
    shorts,
    tabs: ["home", "videos", "about"],
    joinable: false,
    local: true,
  };
}

/**
 * The local universe's lazy About tab (P95 G14): the page DTO's tabs send
 * the client here for `about` (the only non-seeded tab the local pages
 * carry), and the live read would wall. Every field is the ROW's own —
 * the view total is the real sum of the row's own videos, never a
 * fabrication. Other tabs never arrive for a local page (home/videos are
 * seeded from the page DTO), so they answer null and the caller falls
 * through to the live ladder untouched.
 */
export async function localChannelTab(
  rawHandle: string,
  tab: ChannelTabId
): Promise<ChannelTabDTO | null> {
  if (tab !== "about") return null;
  const handle = decodeURIComponent(rawHandle)
    .trim()
    .toLowerCase()
    .replace(/^[@/]+/, "");
  if (!handle) return null;
  const channel = await db.channel.findUnique({ where: { handle } });
  if (!channel) return null;
  const rows = await db.video.findMany({
    where: { channelId: channel.id, visibility: "public" },
    select: { views: true },
  });
  const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
  const about: ChannelAboutDTO = {
    description: channel.description,
    joinedDateText: channel.createdAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    viewCountText: `${compactCount(totalViews)} views`,
    subscriberCountText: `${compactCount(channel.subscriberCount)} subscribers`,
    videoCountText: `${rows.length} videos`,
    country: null,
    links: [],
  };
  return { tab: "about", about, local: true };
}
