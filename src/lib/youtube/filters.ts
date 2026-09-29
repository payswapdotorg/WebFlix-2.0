/**
 * WFX2-A-B search filter `params` builder — the base64 protobuf InnerTube's
 * `search` endpoint takes in the request body.
 *
 * The field/value table below is ground-truthed two ways:
 * 1. `tests/fixtures/yt/search_lofi.json` — the recorded filter menu carries
 *    the real `params` for every option (Videos EgIQAQ==, Shorts EgIQCQ==,
 *    Today EgIIAg==, Under 3 minutes EgIYBA==, …).
 * 2. Live probing (see evidence/wfx2ab/CORE.md) — combined params were sent
 *    to the real endpoint and returned correctly filtered results.
 *
 * Encoding (little protobuf):
 *   SearchParam {                       // top-level message
 *     1: varint  sort                   // 1=rating, 2=upload_date, 3=view_count
 *     2: len    Filters {
 *       1: varint  upload_date          // 1=hour 2=today 3=week 4=month 5=year
 *       2: varint  type                 // 1=video 2=channel 3=playlist 4=movie 9=shorts
 *       3: varint  duration             // 1=short(legacy) 2=over20 4=under3 5=mid(3-20)
 *     }
 *   }
 */

// --- minimal protobuf writer (no dependencies) ------------------------------

function varintBytes(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function varintField(field: number, value: number): number[] {
  return [...varintBytes((field << 3) | 0), ...varintBytes(value)];
}

function lenDelimited(field: number, payload: number[]): number[] {
  return [...varintBytes((field << 3) | 2), ...varintBytes(payload.length), ...payload];
}

function bytesToBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

// --- filter vocabulary --------------------------------------------------------

export type SearchSort = "relevance" | "date" | "views" | "rating";
export type SearchUploadDate = "hour" | "today" | "week" | "month" | "year";
export type SearchDuration = "short" | "medium" | "long";
export type SearchType = "video" | "channel" | "playlist" | "shorts" | "movie";

export interface SearchFilters {
  sort?: SearchSort;
  uploadDate?: SearchUploadDate;
  duration?: SearchDuration;
  type?: SearchType;
  /**
   * Features → Live filter (the real menu option `EgJAAQ==` = Filters{4:1}).
   * Added by WFX2-B-W for the Live surface (search live-scoped).
   */
  live?: boolean;
  /**
   * Skip spell autocorrection — the flag YouTube's own "Search instead for"
   * link sends (recorded in search_misspelled.json: params `QgIIAQ==` =
   * SearchParam{8: {1: 1}}).
   */
  verbatim?: boolean;
}

const SORT_VALUES: Record<SearchSort, number | undefined> = {
  relevance: undefined,
  rating: 1,
  date: 2,
  views: 3,
};

const UPLOAD_DATE_VALUES: Record<SearchUploadDate, number> = {
  hour: 1,
  today: 2,
  week: 3,
  month: 4,
  year: 5,
};

const TYPE_VALUES: Record<SearchType, number> = {
  video: 1,
  channel: 2,
  playlist: 3,
  movie: 4,
  shorts: 9,
};

/**
 * Duration semantics (ground truth: the recorded filter menu in
 * search_lofi.json + live probing — see evidence/wfx2bw/DISCOVERY.md):
 *   "short"  = Under 3 minutes  (field3=4, `EgIYBA==`)
 *   "medium" = 3 - 20 minutes   (field3=5, `EgIYBQ==`)
 *   "long"   = Over 20 minutes  (field3=2, `EgIYAg==`)
 */
const DURATION_VALUES: Record<SearchDuration, number> = {
  short: 4,
  medium: 5,
  long: 2,
};

/**
 * Build the base64 `params` for a search request. Empty/irrelevant-only
 * filters yield "" (the API treats a missing param as relevance/no filters).
 */
export function buildSearchParam(filters: SearchFilters = {}): string {
  const filterMessage: number[] = [];
  if (filters.uploadDate) {
    filterMessage.push(...varintField(1, UPLOAD_DATE_VALUES[filters.uploadDate]));
  }
  if (filters.type) {
    filterMessage.push(...varintField(2, TYPE_VALUES[filters.type]));
  }
  if (filters.duration) {
    filterMessage.push(...varintField(3, DURATION_VALUES[filters.duration]));
  }
  if (filters.live) {
    // Features → Live (the real menu option `EgJAAQ==` = Filters{8:1} —
    // byte-decoded from the recorded menu; field 8, NOT field 4)
    filterMessage.push(...varintField(8, 1));
  }

  const message: number[] = [];
  const sortValue = filters.sort ? SORT_VALUES[filters.sort] : undefined;
  if (sortValue !== undefined) {
    message.push(...varintField(1, sortValue));
  }
  if (filterMessage.length > 0) {
    message.push(...lenDelimited(2, filterMessage));
  }
  if (filters.verbatim) {
    // skip-autocorrect flag — SearchParam{8: {1: 1}} (`QgIIAQ==`, recorded)
    message.push(...lenDelimited(8, varintField(1, 1)));
  }
  return bytesToBase64(message);
}

/** Parse + validate loose query params into typed filters (unknown → ignored). */
export function parseSearchFilters(input: {
  sort?: string | null;
  uploadDate?: string | null;
  duration?: string | null;
  type?: string | null;
  live?: string | boolean | null;
  verbatim?: string | boolean | null;
}): SearchFilters {
  const filters: SearchFilters = {};
  if (input.sort && input.sort in SORT_VALUES) filters.sort = input.sort as SearchSort;
  if (input.uploadDate && input.uploadDate in UPLOAD_DATE_VALUES) {
    filters.uploadDate = input.uploadDate as SearchUploadDate;
  }
  if (input.duration && input.duration in DURATION_VALUES) {
    filters.duration = input.duration as SearchDuration;
  }
  if (input.type && input.type in TYPE_VALUES) filters.type = input.type as SearchType;
  if (input.live === true || input.live === "1" || input.live === "true") filters.live = true;
  if (input.verbatim === true || input.verbatim === "1" || input.verbatim === "true") {
    filters.verbatim = true;
  }
  return filters;
}
