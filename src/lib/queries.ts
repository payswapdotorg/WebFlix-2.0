import { db } from "@/lib/db";
import { toChannelLite, toContinueVideoDTO, toVideoDTO, isUnfinishedWatch } from "@/lib/dto";
import { DEMO_HANDLE } from "@/lib/session";
import { HOME_CHIPS, normalizeCategory } from "@/lib/categories";
import type {
  ChannelLite,
  ContinueVideoDTO,
  HomeFeedDTO,
  VideoDTO,
} from "@/lib/types";
import type { Channel, Video } from "@prisma/client";

type VideoWithChannel = Video & { channel: Channel };

const RECOMMENDED_PAGE = 12;

/** Public, non-short, playable-for-user videos (members-only kept, flagged). */
const normalVideoArgs = {
  where: { visibility: "public", isShort: false },
} as const;

async function loadVideo(id: string): Promise<VideoWithChannel | null> {
  return db.video.findUnique({ where: { id }, include: { channel: true } });
}

function videoInclude() {
  return { channel: true } as const;
}

/**
 * The full home payload (ZTube layout): hero, trending rail, continue
 * watching, because-you-watched, shorts shelf, recommended grid + cursor.
 * With a category set, every rail is filtered to that category.
 */
export async function getHomeFeed(rawCategory: string | null): Promise<HomeFeedDTO> {
  const category = normalizeCategory(rawCategory);
  const filtered = category !== "All";

  const user = await db.user.findUnique({
    where: { handle: DEMO_HANDLE },
    include: { subscriptions: true },
  });
  const notInterestedIds = user
    ? (await db.notInterested.findMany({ where: { userId: user.id } })).map((n) => n.videoId)
    : [];

  const baseWhere = {
    visibility: "public" as const,
    ...(filtered ? { category } : {}),
  };

  // ---- hero: trending #1 by views in the last 120-day window -------------
  // (category mode has no hero — chips swap the feed to a flat grid, the
  // ZTube/YouTube chip pattern)
  const heroCandidates = filtered
    ? []
    : await db.video.findMany({
        where: {
          visibility: "public",
          isShort: false,
          createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) },
        },
        include: videoInclude(),
        orderBy: { views: "desc" },
        take: 1,
      });
  const hero = heroCandidates[0] ? toVideoDTO(heroCandidates[0]) : null;

  // ---- trending rail: top 8 by views (All mode only, excluding the hero) ----
  const trendingRows = filtered
    ? []
    : await db.video.findMany({
        where: { visibility: "public", isShort: false, id: { not: hero?.id ?? "" } },
        include: videoInclude(),
        orderBy: { views: "desc" },
        take: 9,
      });
  const trending: VideoDTO[] = trendingRows
    .filter((v) => v.id !== hero?.id)
    .slice(0, 8)
    .map(toVideoDTO);

  // ---- continue watching: latest event per unfinished video ----------------
  const continueWatching = user ? await getContinueWatching(user.id, category) : [];

  // ---- because you watched: same category as the most recent watch ----------
  let becauseYouWatched: HomeFeedDTO["becauseYouWatched"] = null;
  const lastWatch = user
    ? await db.viewEvent.findFirst({
        where: { userId: user.id, video: { isShort: false } },
        orderBy: { at: "desc" },
        include: { video: { include: { channel: true } } },
      })
    : null;
  if (user && lastWatch && !filtered) {
    const watchCategory = lastWatch.video.category;
    const watchedVideoIds = (
      await db.viewEvent.findMany({ where: { userId: user.id }, select: { videoId: true } })
    ).map((e) => e.videoId);
    const because = await db.video.findMany({
      where: {
        visibility: "public",
        category: watchCategory,
        id: { notIn: watchedVideoIds },
      },
      include: videoInclude(),
      orderBy: { views: "desc" },
      take: 8,
    });
    if (because.length > 0) {
      becauseYouWatched = {
        label: lastWatch.video.title,
        videos: because.map(toVideoDTO),
      };
    }
  }

  // ---- shorts shelf -----------------------------------------------------------
  const shortsRows = await db.video.findMany({
    where: { ...baseWhere, isShort: true },
    include: videoInclude(),
    orderBy: { views: "desc" },
    take: 6,
  });
  const shorts = shortsRows.map(toVideoDTO);

  // ---- recommended: the rest, views-desc, minus hidden (not-interested) -------
  // In category mode: the full category grid (minus hero / shorts), so the
  // chip click lands on a proper category page instead of an empty shell.
  const railVideoIds = new Set<string>(
    filtered
      ? [...shorts.map((v) => v.id)]
      : [
          ...(hero ? [hero.id] : []),
          ...trending.map((v) => v.id),
          ...continueWatching.map((v) => v.id),
          ...(becauseYouWatched?.videos.map((v) => v.id) ?? []),
          ...shorts.map((v) => v.id),
        ]
  );
  const recommendedRows = await db.video.findMany({
    where: { ...baseWhere, isShort: false, id: { notIn: [...railVideoIds] } },
    include: videoInclude(),
    orderBy: { views: "desc" },
    take: filtered ? 48 : RECOMMENDED_PAGE,
  });
  const recommended = recommendedRows
    .filter((v) => !notInterestedIds.includes(v.id))
    .map(toVideoDTO);
  const last = recommendedRows[recommendedRows.length - 1];
  const recommendedCursor = last ? `${last.views}:${last.id}` : null;

  return {
    hero,
    trending,
    continueWatching,
    becauseYouWatched,
    shorts,
    recommended,
    recommendedCursor,
    chips: HOME_CHIPS,
  };
}

/** Latest view event per video, unfinished (>30s, not near the end), newest first. */
export async function getContinueWatching(
  userId: string,
  category = "All"
): Promise<ContinueVideoDTO[]> {
  const events = await db.viewEvent.findMany({
    where: { userId },
    include: { video: { include: { channel: true } } },
    orderBy: { at: "desc" },
  });
  const latestPerVideo = new Map<string, { video: VideoWithChannel; watchedSec: number; at: Date }>();
  for (const e of events) {
    if (!latestPerVideo.has(e.videoId)) {
      latestPerVideo.set(e.videoId, { video: e.video, watchedSec: e.watchedSec, at: e.at });
    }
  }
  const filtered = [...latestPerVideo.values()]
    .filter(({ video, watchedSec }) => {
      if (video.isShort || video.visibility !== "public") return false;
      if (category !== "All" && video.category !== category) return false;
      return isUnfinishedWatch(watchedSec, video.durationSec);
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  return filtered.map(({ video, watchedSec, at }) =>
    toContinueVideoDTO(video, watchedSec, at)
  );
}

/** Keyset pagination on (views DESC, id ASC) for the recommended infinite scroll. */
export async function listVideos(opts: {
  cursor?: string | null;
  category?: string | null;
  limit?: number;
}): Promise<{ videos: VideoDTO[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? RECOMMENDED_PAGE, 1), 48);
  const category = normalizeCategory(opts.category);
  let cursorViews: number | undefined;
  let cursorId: string | undefined;
  if (opts.cursor) {
    const [v, id] = opts.cursor.split(":");
    const views = Number(v);
    if (!Number.isFinite(views) || !id) throw new Error("Invalid cursor");
    cursorViews = views;
    cursorId = id;
  }
  const where = {
    visibility: "public" as const,
    ...(category !== "All" ? { category } : {}),
    ...(cursorViews !== undefined && cursorId
      ? { OR: [{ views: { lt: cursorViews } }, { views: cursorViews, id: { gt: cursorId } }] }
      : {}),
  };
  const rows = await db.video.findMany({
    where,
    include: videoInclude(),
    orderBy: [{ views: "desc" }, { id: "asc" }],
    take: limit,
  });
  const last = rows[rows.length - 1];
  return {
    videos: rows.map(toVideoDTO),
    nextCursor: last && rows.length === limit ? `${last.views}:${last.id}` : null,
  };
}

export async function getSubscribedChannels(userId: string): Promise<ChannelLite[]> {
  const subs = await db.subscribe.findMany({
    where: { userId },
    include: { channel: true },
    orderBy: { createdAt: "asc" },
  });
  return subs.map((s) => toChannelLite(s.channel));
}

export async function loadVideoOr404(id: string): Promise<VideoDTO | null> {
  const v = await loadVideo(id);
  return v ? toVideoDTO(v) : null;
}

export { normalVideoArgs };
