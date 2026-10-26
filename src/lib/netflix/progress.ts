/**
 * P49-CONTINUE-WATCHING — the viewer's WebFlix-local play memory for Netflix
 * titles (ADR 0002 §5: no Netflix credentials anywhere, so playback memory
 * lives in WebFlix's own DB — the same honest-local law as My List).
 *
 * WHO writes: the watch lane's session kick (an in-app play intent) and the
 * hand-off dialog's deep-link click (a play on netflix.com itself). Both are
 * fire-and-forget from the UI — a failed write never blocks playback.
 * WHO reads: the hub's Continue Watching rail (and any future surface).
 *
 * HONESTY LAW: `playCount` is literally "you pressed play N times". The
 * streamed Netflix player exposes no playback position to WebFlix, so there
 * is NO percent-watched here and the UI never fakes a progress bar.
 */
import { db } from "@/lib/db";
import { toBig } from "@/lib/netflix/bigint";
import { mirrorRowToDTO } from "./catalog";
import { getNetflixTitle } from "./catalog";
import type { NetflixTitleDTO } from "./types";

export interface ContinueWatchingItem {
  title: NetflixTitleDTO;
  lastPlayedAt: string;
  playCount: number;
}

export const CONTINUE_WATCHING_CAP = 12;

/**
 * Record one play: the mirror row must exist first (the FK law, the same
 * upsert-from-pools move My List makes), then the event upserts — a replay
 * bumps playCount and refreshes lastPlayedAt instead of stacking rows.
 */
export async function recordWatch(userId: string, netflixId: number): Promise<void> {
  const title = await getNetflixTitle(netflixId);
  if (!title) {
    // Not in the tracked universe — a play intent for an unknown id is a
    // caller bug; the route surfaces 404 before this matters.
    throw new Error("title-not-in-catalog");
  }
  await db.netflixTitle.upsert({
    where: { netflixId },
    create: {
      netflixId,
      title: title.title,
      kind: title.kind,
      synopsis: title.synopsis,
      releaseYear: title.releaseYear,
      maturityRating: title.maturityRating,
      posterUrl: title.posterUrl,
      backdropUrl: title.backdropUrl,
      logoUrl: title.logoUrl,
      weeklyRank: title.weeklyRank,
      allTimeRank: title.allTimeRank,
      weeksInTop10: title.weeksInTop10,
      weeklyHoursViewed: toBig(title.weeklyHoursViewed),
      weeklyViews: toBig(title.weeklyViews),
      weekEndDate: title.weekEndDate,
      pool: title.pool,
      isPlayable: title.isPlayable,
      countryRanks: Object.entries(title.countryRanks)
        .map(([cc, rank]) => `${cc}:${rank}`)
        .join(","),
    },
    update: {},
  });
  await db.netflixWatchEvent.upsert({
    where: { userId_netflixId: { userId, netflixId } },
    create: { userId, netflixId, playCount: 1, lastPlayedAt: new Date() },
    update: { playCount: { increment: 1 }, lastPlayedAt: new Date() },
  });
}

/** The viewer's recent plays, newest first, joined onto the mirror titles. */
export async function listContinueWatching(
  userId: string,
  cap: number = CONTINUE_WATCHING_CAP
): Promise<ContinueWatchingItem[]> {
  const rows = await db.netflixWatchEvent.findMany({
    where: { userId },
    orderBy: { lastPlayedAt: "desc" },
    take: Math.max(1, Math.min(cap, 50)),
    include: { title: true },
  });
  return rows.map((r) => ({
    title: mirrorRowToDTO(r.title),
    lastPlayedAt: r.lastPlayedAt.toISOString(),
    playCount: r.playCount,
  }));
}

/** Remove one title from the rail (Netflix's own "Remove From Row" affordance). */
export async function removeWatch(userId: string, netflixId: number): Promise<void> {
  await db.netflixWatchEvent.deleteMany({ where: { userId, netflixId } });
}
