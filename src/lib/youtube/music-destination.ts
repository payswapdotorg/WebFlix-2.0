/**
 * P30 — the music destination compose (/music).
 *
 * youtube.com's own Music surface (youtube.com/music — the Music channel /
 * destination the operator referenced, measured live 2026-10-20 from this
 * egress: the channel-style header + the shelf family of SQUARE lockups,
 * ~249px covers, "N songs"-style meta) is session-shaped: signed-out from a
 * datacenter it redirects to the Music channel page. The honest public path
 * for the SAME LOOK is the machinery the category compose, the home ladder's
 * rung 3 and the Live surface already use: REAL per-seed search first pages
 * — here kept PER SHELF instead of merged into one grid, so the destination
 * reads as shelves exactly like the reference (the shelf titles are the
 * seed queries themselves, sentence-cased — never invented).
 *
 * Mechanism: the Music entry of EXPLORE_CATEGORY_SEEDS (the ONE seed table,
 * so the destination and the category compose can never drift) feeds one
 * getSearchVideoPage per query — each riding the EXISTING per-query cache
 * (yt:searchpage:…, the same pages the category pool reads), type=video,
 * non-shorts only, de-duplicated ACROSS shelves (a card appears once on the
 * page — the first shelf that found it keeps it). Per-query failures are
 * tolerated (that shelf renders honestly empty); only when EVERY query
 * fails — search itself down — does this throw, surfacing the route's
 * honest 502.
 */
import { getSearchVideoPage } from "./feeds";
import { EXPLORE_CATEGORY_SEEDS } from "./explore-categories";
import type { MusicShelfDTO } from "@/lib/types";

/** The music shelf's first-page size (the reference's visible row runs
 * 4-5 square covers per viewport; 12 tiles ≈ 2-3 viewports of rail). */
const SHELF_LIMIT = 12;

/** Sentence-case a seed query for its shelf title ("music videos" →
 * "Music videos") — the reference's own shelf-title casing. */
function shelfTitle(query: string): string {
  return query.charAt(0).toUpperCase() + query.slice(1);
}

/** The music destination's shelf family — one shelf per Music seed query. */
export async function getMusicDestinationShelves(): Promise<MusicShelfDTO[]> {
  const queries = EXPLORE_CATEGORY_SEEDS.Music;
  const pages = await Promise.all(
    queries.map((query) =>
      getSearchVideoPage(query, { type: "video" }, undefined, SHELF_LIMIT).catch(() => null),
    ),
  );
  if (pages.every((page) => page === null)) {
    throw new Error("music destination: every seed query failed (search is down)");
  }
  const seen = new Set<string>();
  return queries.map((query, i) => {
    const videos = (pages[i]?.videos ?? [])
      .filter((v) => !v.isShort && !seen.has(v.id))
      .slice(0, SHELF_LIMIT);
    for (const v of videos) seen.add(v.id);
    return { title: shelfTitle(query), videos };
  });
}
