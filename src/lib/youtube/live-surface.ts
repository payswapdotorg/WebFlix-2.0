/**
 * WFX2-B-W Live surface — real currently-live videos for /explore/live.
 *
 * Mechanism (LIVE-VERIFIED — evidence/wfx2bw/DISCOVERY.md): the Features→Live
 * search filter (`params: EgJAAQ==` = SearchParam.Filters{4:1}, the option
 * YouTube's own filter menu ships). A live-scoped SET of searches runs with
 * that filter applied — {"live", "news live", "gaming live", "music live"} —
 * and the merged, de-duplicated, isLive-flagged results form the Live rail.
 *
 * Why this and not the alternatives:
 *  - `search {params: type-live}` with an empty query is unreliable (the
 *    endpoint requires a query; documented in the packet itself);
 *  - `browse FElive` / `browse FEexplore` → 400 (research log §6);
 *  - the trending live shelf is session-gated and the public /feed/trending
 *    redirects to the nudge (probed live).
 * Every result carries the real LIVE badge (BADGE_STYLE_TYPE_LIVE_NOW →
 * isLive) + the real watching count ("1,001 watching" → viewsText).
 *
 * P21-LIVE-PREMIERES — the same live-scoped seed queries also surface
 * UPCOMING items (video premieres / scheduled live streams carrying
 * upcomingEventData.startTime → premieredAt). Those split into a
 * "premiering soon" set: upcoming-only, soonest-first, never mixed into the
 * watching-now grid. When the searches can't reach them (public mode, or no
 * upstream carries any), the set is honestly EMPTY — never faked.
 */
import { searchYouTube } from "./search";
import { isUpcomingPremiere } from "@/lib/format";
import type { VideoDTO } from "@/lib/types";

/** The live-scoped query set (each cached separately at the search TTL). */
export const LIVE_QUERIES = ["live", "news live", "gaming live", "music live"] as const;

/**
 * Round-robin interleave across the per-query lists, de-duplicated by id,
 * capped at `limit` (the established merge from WFX2-B-W, extracted so both
 * Live-surface sets share it).
 */
function interleave(perQuery: VideoDTO[][], limit: number): VideoDTO[] {
  const seen = new Set<string>();
  const out: VideoDTO[] = [];
  const maxLen = Math.max(0, ...perQuery.map((v) => v.length));
  for (let i = 0; i < maxLen; i++) {
    for (const results of perQuery) {
      const video = results[i];
      if (!video || seen.has(video.id)) continue;
      seen.add(video.id);
      out.push(video);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The two Live-surface sets (the /api/live payload). */
export interface LiveSurface {
  /** currently-live streams (real LIVE badge + watching count) */
  watchingNow: VideoDTO[];
  /**
   * P21: upcoming premieres / scheduled live streams (premieredAt in the
   * future) — soonest first, links to the watch page's premiere state.
   */
  premieringSoon: VideoDTO[];
}

/**
 * The Live surface in one pass: the live-scoped query set is searched once
 * (each search cached at the search TTL), then split by state —
 *  - watchingNow: isLive items only (the belt-and-braces filter that has
 *    always protected against upstream drift), interleave-merged;
 *  - premieringSoon: upcoming items (premieredAt future), soonest first,
 *    capped, with anything already watching-live excluded (a live-now
 *    snapshot is the fresher truth than a stale UPCOMING copy).
 * One failed live-scoped search must not sink the surface (swallowed);
 * when upstream can't be reached at all, both sets are honestly empty.
 */
export async function getLiveSurface(
  watchingLimit = 24,
  premieringLimit = 12
): Promise<LiveSurface> {
  const perQuery: VideoDTO[][] = [];
  for (const q of LIVE_QUERIES) {
    try {
      const results = await searchYouTube(q, { live: true });
      perQuery.push(results.videos);
    } catch {
      // one failed live-scoped search must not sink the surface
    }
  }
  const watchingNow = interleave(
    perQuery.map((videos) => videos.filter((v) => v.isLive)),
    watchingLimit
  );
  const liveIds = new Set(watchingNow.map((v) => v.id));
  const premieringSoon = interleave(
    perQuery.map((videos) => videos.filter((v) => isUpcomingPremiere(v))),
    watchingLimit + premieringLimit
  )
    .filter((v) => !liveIds.has(v.id))
    .sort((a, b) => Date.parse(a.premieredAt ?? "") - Date.parse(b.premieredAt ?? ""))
    .slice(0, premieringLimit);
  return { watchingNow, premieringSoon };
}
