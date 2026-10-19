import type { VideoDTO } from "./types";

/**
 * The 14 explore categories from the WebFlix reference sidebar,
 * plus "All" for the home chips row.
 */
export const CATEGORY_ICONS: Record<string, string> = {
  Music: "Music",
  Gaming: "Gamepad2",
  Live: "Radio",
  News: "Newspaper",
  Sports: "Trophy",
  Coding: "Code",
  Tech: "Cpu",
  Education: "GraduationCap",
  Travel: "Plane",
  Cooking: "ChefHat",
  Fitness: "Dumbbell",
  Comedy: "Laugh",
  Mixes: "Disc3",
  Podcasts: "Mic",
};

export const CATEGORIES = Object.keys(CATEGORY_ICONS);

export const ALL_CHIP = "All";

/**
 * REA-3 — youtube.com's home chip ladder, measured logged-in 2026-10-17
 * (the station pack): the DYNAMIC chip family rides directly after "All"
 * ("New to you", "Mixes", "Recently uploaded", "Live"), then the category
 * chips. WebFlix ships the honest subset of that family:
 *   - "Mixes" and "Live" (already real chip modes — Live is live-scoped, see
 *     feeds.ts getHomeFeed);
 *   - "Recently uploaded" — the compose seed queries searched with the
 *     EXISTING date sort (real recently-uploaded-first results);
 *   - "New to you" is HONESTLY ABSENT: it needs per-user personalization
 *     (videos from channels you haven't seen), and no such seam exists —
 *     never a fake chip (the REA-3 parity-debt ledger records it).
 */
export const RECENTLY_UPLOADED_CHIP = "Recently uploaded";

/** The dynamic block (the honest subset of youtube.com's measured family). */
export const HOME_DYNAMIC_CHIPS: readonly string[] = [
  "Mixes",
  RECENTLY_UPLOADED_CHIP,
  "Live",
];

/** The category block — Live/Mixes deduped (they ride the dynamic block). */
export const HOME_CATEGORY_CHIPS: readonly string[] = CATEGORIES.filter(
  (c) => !HOME_DYNAMIC_CHIPS.includes(c)
);

/** Chips row: All + the dynamic family + the categories (youtube.com order). */
export const HOME_CHIPS: string[] = [
  ALL_CHIP,
  ...HOME_DYNAMIC_CHIPS,
  ...HOME_CATEGORY_CHIPS,
];

/** The category browse ladder (the explore/category chip row) — All + 14. */
export const CATEGORY_CHIPS: string[] = [ALL_CHIP, ...CATEGORIES];

/** The chip family whose URL state the home feed understands. */
export function isHomeChip(value: string | null | undefined): value is string {
  return !!value && (value === ALL_CHIP || HOME_CHIPS.includes(value));
}

export function isCategory(value: string | null | undefined): value is string {
  return !!value && (value === ALL_CHIP || CATEGORIES.includes(value));
}

/** Normalize any query param into a valid home-chip value (default: "All"). */
export function normalizeCategory(value: string | null | undefined): string {
  return isHomeChip(value) ? value : ALL_CHIP;
}

/**
 * The real destination for a sidebar EXPLORE / explore-hub category link
 * (WFX2-B-W; WFX2-P19-EXPL): every link lands on a real-data page with the
 * category pre-applied —
 *  - the 13 browse categories → the category's own browse page
 *    (/explore/category/<key> — the ranked grid composed from per-category
 *    seed searches, infinite scroll through live search continuations);
 *  - Live → the Live surface (/explore/live — the Features→Live filter
 *    search, real live streams);
 *  - Podcasts → the dedicated podcasts destination (/podcasts — P25 G13:
 *    youtube.com's own Podcasts card routes to its dedicated
 *    FEpodcasts_destination surface, measured live 2026-10-19 — the
 *    explore-category compose stays reachable but is no longer the
 *    Podcasts destination; the home chip row keeps its own family
 *    (/?category=Podcasts — youtube.com's home chip stays on home)).
 */
export function categoryDestination(category: string): string {
  if (category === "Live") return "/explore/live";
  if (category === "Podcasts") return "/podcasts";
  return `/explore/category/${encodeURIComponent(category)}`;
}

/** Pure chip-filter used by the home feed and the tests. */
export function filterVideosByCategory(
  videos: VideoDTO[],
  category: string
): VideoDTO[] {
  if (category === ALL_CHIP || !category) return videos;
  return videos.filter((v) => v.category === category);
}
