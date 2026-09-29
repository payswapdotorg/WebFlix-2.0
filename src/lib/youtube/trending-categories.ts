/**
 * WFX2-B-W trending categories — the real youtube.com /feed/trending
 * category set (Now / Music / Gaming / Movies) over the SSR mechanism.
 *
 * Mechanism (live-verified from this lane's sandbox — see
 * evidence/wfx2bw/DISCOVERY.md):
 *  1. Primary: SSR parse of the category page. The real youtube.com URLs are
 *     the semantic paths `/feed/trending/{music,gaming,movies}` (plus the
 *     base page). The chip navigation on a logged-in trending page emits
 *     `browseEndpoint.params` (`?bp=…`) — `extractTrendingChips()` parses
 *     those when present and `chipParamsFor()` prefers them.
 *  2. Public mode: /feed/trending (and its category paths) redirect to the
 *     What-to-Watch nudge (no grid, no chips — probed live). When the SSR
 *     category page yields no videos, the rail is filled with REAL
 *     search-backed data: search {query: category, sort: views,
 *     uploadDate: week, type: video} — popular videos in the category this
 *     week. The response's `source` field tells the UI which path produced
 *     the rail ("trending" | "search") so the page can label it honestly.
 */
import { fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { mapVideos, walkTree, runsText } from "./mappers";
import { getSearchVideoPage } from "./feeds";
import type { VideoDTO } from "@/lib/types";

export interface TrendingCategory {
  /** URL value (?category=) */
  key: string;
  label: string;
  /** the real youtube.com category path ("" = the base page) */
  path: string;
}

/** The real /feed/trending categories (youtube.com's own tab set). */
export const TRENDING_CATEGORIES: TrendingCategory[] = [
  { key: "Now", label: "Now", path: "" },
  { key: "Music", label: "Music", path: "/music" },
  { key: "Gaming", label: "Gaming", path: "/gaming" },
  { key: "Movies", label: "Movies", path: "/movies" },
];

export const TRENDING_CATEGORY_KEYS = TRENDING_CATEGORIES.map((c) => c.key);

/** Normalize any ?category= value into the real set (default: Now). */
export function normalizeTrendingCategory(value: string | null | undefined): string {
  return value && TRENDING_CATEGORY_KEYS.includes(value) ? value : "Now";
}

/**
 * The category page path: `?bp=` param when the live page's own chip
 * navigation carried one (chipParamsFor), else the semantic category path.
 */
export function trendingCategoryPath(category: string): string {
  const normalized = normalizeTrendingCategory(category);
  if (normalized === "Now") return "/feed/trending";
  const cat = TRENDING_CATEGORIES.find((c) => c.key === normalized);
  return cat ? `/feed/trending${cat.path}` : "/feed/trending";
}

/**
 * Parse a real trending page's category chip navigation for `bp` params.
 * Chip shape (chipCloudChipRenderer with a browseEndpoint — the shape every
 * YouTube chip bar uses): {text, navigationEndpoint: {browseEndpoint:
 * {params, browseId?}}}. On the logged-out 2026 page the chips are absent —
 * the extractor returns [] and the semantic paths take over.
 */
export function extractTrendingChips(response: unknown): { label: string; params: string }[] {
  const out: { label: string; params: string }[] = [];
  const seen = new Set<string>();
  for (const chip of walkTree(response, "chipCloudChipRenderer")) {
    const label = runsText(chip?.text);
    const browse = chip?.navigationEndpoint?.browseEndpoint ?? chip?.navigationEndpoint?.trendingBrowseEndpoint;
    const params = typeof browse?.params === "string" ? browse.params : null;
    if (!label || !params || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, params });
  }
  return out;
}

/** The bp param for a category, when the live chip navigation carried one. */
export function chipParamsFor(
  chips: { label: string; params: string }[],
  category: string
): string | null {
  const normalized = normalizeTrendingCategory(category);
  const chip = chips.find((c) => c.label.toLowerCase() === normalized.toLowerCase());
  return chip?.params ?? null;
}

/** The search-term enrichment per category (Now included). */
const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  Now: "trending",
  Music: "music",
  Gaming: "gaming",
  Movies: "movies",
};

export interface TrendingPage {
  category: string;
  videos: VideoDTO[];
  /** "trending" = the SSR category page grid · "search" = the popular-this-week fallback */
  source: "trending" | "search";
}

/**
 * The trending page payload for a category. SSR category page first; when it
 * yields no videos (public mode — the What-to-Watch nudge), real search-backed
 * popular-this-week videos fill the rail.
 */
export async function getTrendingPage(category: string): Promise<TrendingPage> {
  const normalized = normalizeTrendingCategory(category);
  const path = trendingCategoryPath(normalized);
  let response: Record<string, any> | null = null;
  try {
    response = await cached(`yt:trending:${path}`, TTL.FEED_MS, () =>
      fetchYtInitialData(path)
    );
  } catch {
    response = null; // SSR failure → the search-backed rail still serves real data
  }
  const videos = response ? mapVideos(response, { dedupe: true, limit: 48 }) : [];
  if (videos.length > 0) {
    return { category: normalized, videos, source: "trending" };
  }
  // public-mode fallback: real popular-this-week videos per category
  const term = CATEGORY_SEARCH_TERMS[normalized] ?? normalized.toLowerCase();
  const page = await getSearchVideoPage(
    term,
    { sort: "views", uploadDate: "week", type: "video" },
    undefined,
    48
  );
  return { category: normalized, videos: page.videos, source: "search" };
}
