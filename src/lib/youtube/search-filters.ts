/**
 * WFX2-B-W search filters — the UI-facing vocabulary mirroring the REAL
 * youtube.com search filter menu, plus the URL round-trip (?q=&sort=&date=
 * &type=&duration= — shareable filtered searches).
 *
 * Ground truth: the recorded filter menu in `tests/fixtures/yt/search_lofi.json`
 * (`searchHeaderRenderer.searchFilterButton…searchFilterOptionsDialogRenderer.groups`)
 * + live probing from this lane's sandbox (evidence/wfx2bw/DISCOVERY.md). Every
 * label below is the real YouTube label; the params come from A-B's
 * `filters.ts` builder (verified byte-for-byte against the menu's param
 * strings).
 *
 * Real YouTube semantics: single-select per group (picking an option in a
 * group replaces that group's previous selection; the full selection set
 * composes into ONE params value).
 */
import type { SearchFilters } from "./filters";

export type FilterGroupId = "uploadDate" | "type" | "duration" | "sort";

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

/** Ordered to match the recorded menu (Type, Duration, Upload date) + the classic sort group. */
export const FILTER_GROUPS: FilterGroup[] = [
  {
    id: "uploadDate",
    title: "Upload date",
    options: [
      { value: "hour", label: "Last hour" },
      { value: "today", label: "Today" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" },
      { value: "year", label: "This year" },
    ],
  },
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
    id: "sort",
    title: "Sort by",
    options: [
      { value: "relevance", label: "Relevance" },
      { value: "date", label: "Upload date" },
      { value: "views", label: "View count" },
      { value: "rating", label: "Rating" },
    ],
  },
];

/** The URL key for each group (`sort`, `date`, `type`, `duration`). */
export const FILTER_URL_KEYS: Record<FilterGroupId, string> = {
  uploadDate: "date",
  type: "type",
  duration: "duration",
  sort: "sort",
};

/** The filter state the search page URL carries (q lives alongside). */
export interface SearchFilterState {
  uploadDate?: SearchFilters["uploadDate"];
  type?: SearchFilters["type"];
  duration?: SearchFilters["duration"];
  sort?: SearchFilters["sort"];
  /** passthrough flag for the "Search instead for" correction link */
  verbatim?: boolean;
}

const VALID: Record<FilterGroupId, Set<string>> = {
  uploadDate: new Set(FILTER_GROUPS[0].options.map((o) => o.value)),
  type: new Set(FILTER_GROUPS[1].options.map((o) => o.value)),
  duration: new Set(FILTER_GROUPS[2].options.map((o) => o.value)),
  sort: new Set(FILTER_GROUPS[3].options.map((o) => o.value)),
};

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
  if (isTruthyFlag(input.verbatim)) state.verbatim = true;
  return { q, state };
}

/** The URL search params entries for a state (q + set groups + verbatim). */
export function filtersToEntries(q: string, state: SearchFilterState): [string, string][] {
  const entries: [string, string][] = [];
  if (q) entries.push(["q", q]);
  if (state.uploadDate) entries.push([FILTER_URL_KEYS.uploadDate, state.uploadDate]);
  if (state.type) entries.push([FILTER_URL_KEYS.type, state.type]);
  if (state.duration) entries.push([FILTER_URL_KEYS.duration, state.duration]);
  if (state.sort && state.sort !== "relevance") entries.push([FILTER_URL_KEYS.sort, state.sort]);
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
  }
  if (!next.uploadDate && !next.type && !next.duration && !next.sort && !next.verbatim) {
    return clearFilters(next);
  }
  return next;
}

/** Drop every filter (the "Clear all" button). */
export function clearFilters(state: SearchFilterState): SearchFilterState {
  return { verbatim: state.verbatim };
}

export function hasActiveFilters(state: SearchFilterState): boolean {
  return Boolean(state.uploadDate || state.type || state.duration || (state.sort && state.sort !== "relevance"));
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
