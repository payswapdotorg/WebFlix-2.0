/**
 * WFX2-B-W search filters — the UI-facing vocabulary mirroring the REAL
 * youtube.com search filter menu, plus the URL round-trip (?q=&sort=&date=
 * &type=&duration=&live= — shareable filtered searches).
 *
 * Ground truth: the LIVE 2026 youtube.com filter dialog (measured on the
 * operator session, 2026-10-06 — the dialog's exact groups, order and labels):
 *   Type: Videos, Shorts, Channels, Playlists, Movies
 *   Duration: Under 3 minutes, 3 - 20 minutes, Over 20 minutes
 *   Upload date: Today, This week, This month, This year
 *   Features: Live, 4K, HD, Subtitles/CC, Creative Commons, 360°, VR180,
 *             3D, HDR, Location, Purchased   (only Live is backend-wired —
 *             the rest are omitted, never dead controls)
 *   Prioritize: Relevance, Popularity
 * (the recorded `tests/fixtures/yt/search_lofi.json` menu + live probing from
 * the A-B lane remain the params ground truth — `filters.ts`.)
 *
 * Real YouTube semantics: single-select per group (picking an option in a
 * group replaces that group's previous selection; the full selection set
 * composes into ONE params value).
 */
import type { SearchFilters } from "./filters";

export type FilterGroupId = "uploadDate" | "type" | "duration" | "sort" | "features";

export interface FilterOption {
  /** canonical URL value (also the SearchFilters field value) */
  value: string;
  /** the real YouTube menu label */
  label: string;
}

export interface FilterGroup {
  id: FilterGroupId;
  title: string;
  options: FilterOption[];
}

/** Ordered + labeled to match the LIVE 2026 dialog exactly. */
export const FILTER_GROUPS: FilterGroup[] = [
  {
    id: "type",
    title: "Type",
    options: [
      { value: "video", label: "Videos" },
      { value: "shorts", label: "Shorts" },
      { value: "channel", label: "Channels" },
      { value: "playlist", label: "Playlists" },
      { value: "movie", label: "Movies" },
    ],
  },
  {
    id: "duration",
    title: "Duration",
    options: [
      { value: "short", label: "Under 3 minutes" },
      { value: "medium", label: "3 - 20 minutes" },
      { value: "long", label: "Over 20 minutes" },
    ],
  },
  {
    id: "uploadDate",
    title: "Upload date",
    options: [
      { value: "today", label: "Today" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" },
      { value: "year", label: "This year" },
    ],
  },
  {
    // Features — only the backend-wired option (live) ships; the dialog's
    // other feature toggles have no param and are omitted (never dead).
    id: "features",
    title: "Features",
    options: [{ value: "live", label: "Live" }],
  },
  {
    id: "sort",
    title: "Prioritize",
    options: [
      { value: "relevance", label: "Relevance" },
      { value: "views", label: "Popularity" },
    ],
  },
];

/** The URL key for each group (`sort`, `date`, `type`, `duration`, `live`). */
export const FILTER_URL_KEYS: Record<FilterGroupId, string> = {
  uploadDate: "date",
  type: "type",
  duration: "duration",
  sort: "sort",
  features: "live",
};

/** The filter state the search page URL carries (q lives alongside). */
export interface SearchFilterState {
  uploadDate?: SearchFilters["uploadDate"];
  type?: SearchFilters["type"];
  duration?: SearchFilters["duration"];
  sort?: SearchFilters["sort"];
  /** Features → Live (the one backend-wired feature toggle) */
  live?: boolean;
  /** passthrough flag for the "Search instead for" correction link */
  verbatim?: boolean;
}

const VALID: Record<FilterGroupId, Set<string>> = {
  uploadDate: new Set(["hour", "today", "week", "month", "year"]),
  type: new Set(["video", "shorts", "channel", "playlist", "movie"]),
  duration: new Set(["short", "medium", "long"]),
  // "date" + "rating" stay URL-valid (backend-wired sorts, legacy share links)
  // even though the live dialog only surfaces Relevance + Popularity.
  sort: new Set(["relevance", "date", "views", "rating"]),
  features: new Set(["live"]),
};

/** Is one option the active selection for its group? (features → live flag) */
export function isOptionActive(
  state: SearchFilterState,
  group: FilterGroupId,
  value: string
): boolean {
  if (group === "features") return value === "live" && state.live === true;
  return state[group] === value;
}

function isTruthyFlag(v: string | null | undefined): boolean {
  return v === "1" || v === "true";
}

/**
 * Loose input → typed state. Unknown values are dropped (never 500 on a
 * hand-edited URL). Accepts `uploadDate` as the alias of `date` (A-B's
 * documented /api/search contract uses `uploadDate`; the shareable page URL
 * uses `date` per the WFX2-B-W packet).
 */
export function filtersFromParams(input: {
  q?: string | null;
  sort?: string | null;
  date?: string | null;
  uploadDate?: string | null;
  type?: string | null;
  duration?: string | null;
  live?: string | null;
  verbatim?: string | null;
}): { q: string; state: SearchFilterState } {
  const q = (input.q ?? "").trim();
  const state: SearchFilterState = {};
  const date = input.date ?? input.uploadDate;
  if (date && VALID.uploadDate.has(date)) state.uploadDate = date as SearchFilters["uploadDate"];
  if (input.type && VALID.type.has(input.type)) state.type = input.type as SearchFilters["type"];
  if (input.duration && VALID.duration.has(input.duration)) {
    state.duration = input.duration as SearchFilters["duration"];
  }
  // "relevance" is the default, not a set filter — parsed away like YouTube's own menu
  if (input.sort && VALID.sort.has(input.sort) && input.sort !== "relevance") {
    state.sort = input.sort as SearchFilterState["sort"];
  }
  if (isTruthyFlag(input.live)) state.live = true;
  if (isTruthyFlag(input.verbatim)) state.verbatim = true;
  return { q, state };
}

/** The URL search params entries for a state (q + set groups + live + verbatim). */
export function filtersToEntries(q: string, state: SearchFilterState): [string, string][] {
  const entries: [string, string][] = [];
  if (q) entries.push(["q", q]);
  if (state.uploadDate) entries.push([FILTER_URL_KEYS.uploadDate, state.uploadDate]);
  if (state.type) entries.push([FILTER_URL_KEYS.type, state.type]);
  if (state.duration) entries.push([FILTER_URL_KEYS.duration, state.duration]);
  if (state.sort && state.sort !== "relevance") entries.push([FILTER_URL_KEYS.sort, state.sort]);
  if (state.live) entries.push([FILTER_URL_KEYS.features, "1"]);
  if (state.verbatim) entries.push(["verbatim", "1"]);
  return entries;
}

/** `/search?…` href for a query + filter state (shareable). */
export function searchHref(q: string, state: SearchFilterState = {}): string {
  const entries = filtersToEntries(q, state);
  const qs = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return qs ? `/search?${qs}` : "/search";
}

/** One group's selection replaced (real single-select semantics). */
export function withGroupValue(
  state: SearchFilterState,
  group: FilterGroupId,
  value: string | null
): SearchFilterState {
  const next: SearchFilterState = { ...state };
  if (group === "sort") {
    next.sort = value === null ? undefined : (value as SearchFilterState["sort"]);
    if (next.sort === "relevance") next.sort = undefined;
  } else if (group === "uploadDate") {
    next.uploadDate = value === null ? undefined : (value as SearchFilterState["uploadDate"]);
  } else if (group === "type") {
    next.type = value === null ? undefined : (value as SearchFilterState["type"]);
  } else if (group === "duration") {
    next.duration = value === null ? undefined : (value as SearchFilterState["duration"]);
  } else if (group === "features") {
    next.live = value === null ? undefined : true;
  }
  if (
    !next.uploadDate &&
    !next.type &&
    !next.duration &&
    !next.sort &&
    !next.live &&
    !next.verbatim
  ) {
    return clearFilters(next);
  }
  return next;
}

/** Drop every filter (the "Clear all" button). */
export function clearFilters(state: SearchFilterState): SearchFilterState {
  return { verbatim: state.verbatim };
}

export function hasActiveFilters(state: SearchFilterState): boolean {
  return Boolean(
    state.uploadDate ||
      state.type ||
      state.duration ||
      state.live ||
      (state.sort && state.sort !== "relevance")
  );
}

/** The applied-filter chips row (one chip per selected group). */
export interface AppliedFilterChip {
  group: FilterGroupId;
  value: string;
  label: string;
}

export function appliedFilterChips(state: SearchFilterState): AppliedFilterChip[] {
  const chips: AppliedFilterChip[] = [];
  for (const group of FILTER_GROUPS) {
    if (group.id === "features") {
      if (state.live) chips.push({ group: "features", value: "live", label: "Live" });
      continue;
    }
    const value = state[group.id];
    if (!value) continue;
    if (group.id === "sort" && value === "relevance") continue;
    const option = group.options.find((o) => o.value === value);
    if (option) chips.push({ group: group.id, value, label: option.label });
  }
  return chips;
}

/** The label for one option value (used by the panel to mark the selected row). */
export function optionLabel(group: FilterGroupId, value: string): string | undefined {
  return FILTER_GROUPS.find((g) => g.id === group)?.options.find((o) => o.value === value)?.label;
}
