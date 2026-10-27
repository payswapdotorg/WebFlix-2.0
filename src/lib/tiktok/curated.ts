/**
 * P59-R1 — the curated universe with FACTUAL provenance.
 *
 * The P58 seed was a single post (TikTok's docs example) — a hollow universe
 * that made the whole hub look broken when its metadata lane walled or the
 * player reported the post dead. Every entry here is a REAL cited URL:
 *
 * - `6718335390845095173` rides TikTok's own embed docs
 *   (developers.tiktok.com, the documented example post by @scout2015).
 * - the other 16 were harvested from public Hacker News citations (Algolia
 *   open API, scripts/ops/harvest-tiktok-cited.ts) — each `@handle` and
 *   numeric id appears VERBATIM in a cited tiktok.com URL. Zero guessed ids
 *   (the ADR-0004 law holds: an unknown id would be a 1001 INVALID_VIDEO,
 *   surfaced as data, never manufactured here).
 *
 * The citation ledger lives at scripts/ops/tiktok-curated-citations.json.
 * `TIKTOK_CURATED_IDS` still overrides this list wholesale (env-first, cap
 * 40) — this file is the no-config default, not a lock.
 */

export interface CuratedTikTokPost {
  postId: string;
  /** The handle exactly as the citation carried it (factual, best-effort). */
  author: string;
}

export const TIKTOK_CURATED_UNIVERSE: readonly CuratedTikTokPost[] = [
  // TikTok's own documented example (the P58 seed, kept for continuity).
  { postId: "6718335390845095173", author: "scout2015" },
  // Hacker News citations (harvest order preserved = reproducible).
  { postId: "7206561191609716014", author: "melodizeai" },
  { postId: "7157587293451062574", author: "bsmachinist" },
  { postId: "7322301313134415134", author: "brittanypeachhh" },
  { postId: "7371838707747278122", author: "decoderpod" },
  { postId: "7212953186724842795", author: "tiktok" },
  { postId: "7323004085043612959", author: "brittanypeachhh" },
  { postId: "7384528123192200490", author: "hasslotumismo" },
  { postId: "7213856534080605483", author: "nowthispolitics" },
  { postId: "7043083660093869318", author: "digitalsamaritan" },
  { postId: "7294761545605680426", author: "jessicaelawson" },
  { postId: "7162192484611722542", author: "mattxshaver" },
  { postId: "7078825219833580843", author: "latercam" },
  { postId: "7186009974852586795", author: "showbizpizzaman" },
  { postId: "6968868536114482438", author: "sheridanellis" },
  { postId: "7191244761821465898", author: "wellandsepticlife" },
  { postId: "7243513794436123950", author: "malwaretech" },
];

/** postId → curated entry, for the fallback DTO + the UI's handle badge. */
export function curatedAuthorMap(): Map<string, CuratedTikTokPost> {
  return new Map(TIKTOK_CURATED_UNIVERSE.map((p) => [p.postId, p]));
}
