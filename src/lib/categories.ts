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

/** Chips row: All + the 14 categories (WebFlix order). */
export const HOME_CHIPS: string[] = [ALL_CHIP, ...CATEGORIES];

export function isCategory(value: string | null | undefined): value is string {
  return !!value && (value === ALL_CHIP || CATEGORIES.includes(value));
}

/** Normalize any query param into a valid chip value (default: "All"). */
export function normalizeCategory(value: string | null | undefined): string {
  return isCategory(value) ? value : ALL_CHIP;
}

/**
 * The real destination for a sidebar EXPLORE / explore-hub category link
 * (WFX2-B-W): every link lands on a real-data page with the category
 * pre-applied —
 *  - Music / Gaming → the real youtube.com trending category pages
 *    (/trending?category=…, SSR category pages + search-backed fallback);
 *  - Live → the Live surface (/explore/live — the Features→Live filter
 *    search, real live streams);
 *  - the rest → scoped search (/search?q=<Category>&type=video).
 */
export function categoryDestination(category: string): string {
  if (category === "Music" || category === "Gaming") {
    return `/trending?category=${encodeURIComponent(category)}`;
  }
  if (category === "Live") return "/explore/live";
  return `/search?q=${encodeURIComponent(category)}&type=video`;
}

/** Pure chip-filter used by the home feed and the tests. */
export function filterVideosByCategory(
  videos: VideoDTO[],
  category: string
): VideoDTO[] {
  if (category === ALL_CHIP || !category) return videos;
  return videos.filter((v) => v.category === category);
}
