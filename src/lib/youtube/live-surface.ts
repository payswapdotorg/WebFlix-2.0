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
 */
import { searchYouTube } from "./search";
import type { VideoDTO } from "@/lib/types";

/** The live-scoped query set (each cached separately at the search TTL). */
export const LIVE_QUERIES = ["live", "news live", "gaming live", "music live"] as const;

/**
 * Real live streams, merged across the query set. Results are interleaved
 * query-by-query for variety, de-duplicated by id, and only live-flagged
 * items are kept (the filter already scopes them; the belt-and-braces check
 * protects against upstream drift).
 */
export async function getLiveVideos(limit = 24): Promise<VideoDTO[]> {
  const perQuery: VideoDTO[][] = [];
  for (const q of LIVE_QUERIES) {
    try {
      const results = await searchYouTube(q, { live: true });
      perQuery.push(results.videos.filter((v) => v.isLive));
    } catch {
      // one failed live-scoped search must not sink the surface
    }
  }
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
