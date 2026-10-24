/**
 * P42-NETFLIX-SOURCE — the Netflix DTO family (ADR 0002 §3: every DTO carries
 * the honest `source` provenance; §4: Netflix titles carry their own DTO, the
 * YouTube `VideoDTO` stays YouTube-owned).
 */

/** The bounded Tudum Top 10 pool matrix (research record §3). */
export type NetflixPoolKey =
  | "weekly-films"
  | "weekly-tv"
  | "weekly-nonenglish-films"
  | "weekly-nonenglish-tv"
  | "alltime-films"
  | "alltime-tv"
  | "alltime-nonenglish-films"
  | "alltime-nonenglish-tv";

export type NetflixTitleKind = "movie" | "series";

/** Where a DTO's rows came from — the provenance law, Netflix edition. */
export type NetflixSource =
  | "netflix-top10"
  | "netflix-most-popular"
  | "netflix-catalog"
  | "netflix-my-list"
  | "last-good"
  | "";

/**
 * One Netflix title as WebFlix knows it. Sourced from Netflix's own public
 * Top 10 data (unauthenticated); never a fake row.
 */
export interface NetflixTitleDTO {
  /** The real Netflix video id — the deep-link key. */
  netflixId: number;
  title: string;
  kind: NetflixTitleKind;
  synopsis: string;
  releaseYear: number | null;
  maturityRating: string | null;
  /** Landscape story art (1200×675) — hero/backdrop. */
  backdropUrl: string | null;
  /** 16:9 boxart (390×219) — cards. */
  posterUrl: string | null;
  /** Title-logo art (360×153) — hero overlay. */
  logoUrl: string | null;
  /** Global weekly rank within its pool (1..10); null for all-time pools. */
  weeklyRank: number | null;
  /** All-time most-popular rank (1..10); null for weekly pools. */
  allTimeRank: number | null;
  weeksInTop10: number | null;
  weeklyHoursViewed: number | null;
  weeklyViews: number | null;
  /** ISO country code → rank in that country's Top 10 (~93 countries when present). */
  countryRanks: Record<string, number>;
  /** Week end date (YYYY-MM-DD) for weekly pools; null = all-time. */
  weekEndDate: string | null;
  pool: NetflixPoolKey | null;
  isPlayable: boolean;
  /** ADR 0002 §1 — deep links are built ONLY by src/lib/netflix/deeplink.ts. */
  deepLinkUrl: string;
  titlePageUrl: string;
}

/** One browsable rail on the Netflix hub. */
export interface NetflixRailDTO {
  key: NetflixPoolKey;
  label: string;
  kind: NetflixTitleKind;
  /** "Global" or an ISO country code the rail was ranked for. */
  country: string;
  /** "weekly" | "alltime" — rank semantics follow. */
  ranking: "weekly" | "alltime";
  weekEndDate: string | null;
  titles: NetflixTitleDTO[];
  source: NetflixSource;
}

export interface NetflixHomeDTO {
  rails: NetflixRailDTO[];
  catalogSize: number;
  source: NetflixSource;
  /** Honest degradation (ADR 0002 §3): Netflix upstream unreachable → notice, never fakes. */
  unavailable: boolean;
  unavailableReason: string | null;
  fetchedAt: string;
}

/** A country where the title currently ranks, ordered best-first. */
export interface NetflixCountryRank {
  countryId: string;
  rank: number;
}

export interface NetflixTitlePageDTO {
  title: NetflixTitleDTO;
  /** Where it ranks today, best-first (capped for display). */
  countryRanks: NetflixCountryRank[];
  /** Same-pool neighbors — "More like this" stays honest (the Top 10 universe). */
  relatedTitles: NetflixTitleDTO[];
  /** The viewer's WebFlix-local My Netflix List state. */
  myList: boolean;
  source: NetflixSource;
  unavailable: boolean;
  unavailableReason: string | null;
}

export interface NetflixSearchResultsDTO {
  q: string;
  titles: NetflixTitleDTO[];
  catalogSize: number;
  source: NetflixSource;
  /** Honest scope note surfaced by the UI (the Top-10 universe, not all of Netflix). */
  note: string | null;
}
