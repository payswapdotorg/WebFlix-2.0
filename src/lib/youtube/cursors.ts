/**
 * WFX2-P6-IS — opaque pagination cursors for the infinite-scroll surfaces.
 *
 * A cursor is base64url(JSON): a self-contained envelope the server issues and
 * the client passes back verbatim (never parsed, never composed client-side).
 * Three shapes live here:
 *
 *  {s:"pool",   o, t}   rung-3 home compose — offset paging through the cached
 *                       merged search pool; `t` carries each seed query's
 *                       first-page continuation token captured at compose
 *                       time, so the pool→search handoff is self-contained;
 *  {s:"search", qi, t}  rung-3 home compose — live search-continuation paging
 *                       for seed query `qi` (t = that query's current token);
 *  {s:"page",   t}      /api/search results — one InnerTube search
 *                       continuation token for the (possibly filtered) query;
 *                       the filter chain is baked into the token itself;
 *  {s:"ecat",   k, o, t}   P19 explore category browse — offset window
 *                       through category k's cached merged seed pool (t =
 *                       each seed query's first-page continuation token,
 *                       captured at compose time; k never crosses categories);
 *  {s:"ecats",  k, qi, t}  P19 explore category browse — live
 *                       search-continuation paging for category k's seed
 *                       query `qi` (t = that query's current token).
 *
 * Laws:
 *  - decode NEVER throws — garbage yields null and callers answer honestly
 *    (/api/search 400s; /api/videos falls through to the native token path);
 *  - a NATIVE InnerTube continuation token (browse/search, issued upstream,
 *    not here) never decodes as an envelope — the ladder's rungs 1–2 keep
 *    flowing their own tokens exactly as before.
 */

/** Rung-3 compose: offset page through the merged search pool. */
export interface PoolCursor {
  s: "pool";
  /** the next window's offset into the merged compose pool */
  o: number;
  /** per-seed-query first-page continuation tokens (null = query failed/none) */
  t: (string | null)[];
}

/** Rung-3 compose: live continuation page for seed query `qi`. */
export interface ComposeSearchCursor {
  s: "search";
  /** the seed-query index this chain pages through */
  qi: number;
  /** the query's current InnerTube search continuation token */
  t: string;
}

/** /api/search: one results continuation for the filtered query. */
export interface SearchPageCursor {
  s: "page";
  /** the results page's InnerTube search continuation token */
  t: string;
}

/** Explore category browse (P19): offset window through category k's pool. */
export interface ExploreCategoryPoolCursor {
  s: "ecat";
  /** the category key the pool was composed for ("Music", …) */
  k: string;
  /** the next window's offset into the category's merged pool */
  o: number;
  /** per-seed-query first-page continuation tokens (null = failed/none) */
  t: (string | null)[];
}

/** Explore category browse (P19): live continuation for category k's seed qi. */
export interface ExploreCategorySearchCursor {
  s: "ecats";
  /** the category key the chain pages for */
  k: string;
  /** the seed-query index this chain pages through */
  qi: number;
  /** the query's current InnerTube search continuation token */
  t: string;
}

/** The rung-3 compose shapes (what feeds.ts routes). */
export type ComposeCursor = PoolCursor | ComposeSearchCursor;

/** Every envelope this module issues. */
export type Cursor =
  | ComposeCursor
  | SearchPageCursor
  | ExploreCategoryPoolCursor
  | ExploreCategorySearchCursor;

/** base64url(JSON) — URL-safe, unpadded, opaque to the client. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** The base64url alphabet (native InnerTube tokens may carry +/=, which fail
 *  this guard immediately — they are not ours and must never decode). */
const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

/** A cursor length guard — honest cursors stay well under this. */
const MAX_CURSOR_LEN = 8_192;

/**
 * Decode an envelope, validating the shape strictly. Returns null for
 * anything that is not one of ours (garbage, truncated, a native token) —
 * never throws.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LEN) return null;
  if (!BASE64URL_RE.test(raw)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const env = parsed as Record<string, unknown>;
  if (env.s === "pool") {
    if (!Number.isInteger(env.o) || (env.o as number) < 0) return null;
    if (!Array.isArray(env.t)) return null;
    if (!env.t.every((tok) => tok === null || typeof tok === "string")) return null;
    return { s: "pool", o: env.o as number, t: env.t as (string | null)[] };
  }
  if (env.s === "search") {
    if (!Number.isInteger(env.qi) || (env.qi as number) < 0) return null;
    if (typeof env.t !== "string" || env.t.length === 0) return null;
    return { s: "search", qi: env.qi as number, t: env.t };
  }
  if (env.s === "page") {
    if (typeof env.t !== "string" || env.t.length === 0) return null;
    return { s: "page", t: env.t };
  }
  if (env.s === "ecat") {
    if (typeof env.k !== "string" || env.k.length === 0 || env.k.length > 64) return null;
    if (!Number.isInteger(env.o) || (env.o as number) < 0) return null;
    if (!Array.isArray(env.t)) return null;
    if (!env.t.every((tok) => tok === null || typeof tok === "string")) return null;
    return { s: "ecat", k: env.k, o: env.o as number, t: env.t as (string | null)[] };
  }
  if (env.s === "ecats") {
    if (typeof env.k !== "string" || env.k.length === 0 || env.k.length > 64) return null;
    if (!Number.isInteger(env.qi) || (env.qi as number) < 0) return null;
    if (typeof env.t !== "string" || env.t.length === 0) return null;
    return { s: "ecats", k: env.k, qi: env.qi as number, t: env.t };
  }
  return null;
}

/**
 * Decode ONLY the rung-3 compose shapes (pool/search), bounding `qi` to the
 * seed-query count — a stray /api/search "page" envelope or a native
 * continuation token returns null, so the caller keeps its native flow.
 */
export function decodeComposeCursor(
  raw: string | null | undefined,
  seedQueryCount: number,
): ComposeCursor | null {
  const cursor = decodeCursor(raw);
  if (!cursor) return null;
  if (cursor.s === "pool") return cursor;
  if (cursor.s === "search") return cursor.qi < seedQueryCount ? cursor : null;
  return null;
}

/** Decode ONLY the /api/search results shape ("page"). */
export function decodeSearchCursor(raw: string | null | undefined): SearchPageCursor | null {
  const cursor = decodeCursor(raw);
  return cursor?.s === "page" ? cursor : null;
}

/** The P19 explore-category envelope shapes (what explore-categories.ts routes). */
export type ExploreCategoryCursor = ExploreCategoryPoolCursor | ExploreCategorySearchCursor;

/**
 * Decode ONLY the explore-category shapes ("ecat"/"ecats"), scoped to the
 * requested category and bounded to its seed-query count — a cursor minted
 * for another category (or any other surface's envelope, or a native
 * InnerTube token) returns null, so the caller answers its honest 400.
 */
export function decodeExploreCategoryCursor(
  raw: string | null | undefined,
  key: string,
  seedQueryCount: number,
): ExploreCategoryCursor | null {
  const cursor = decodeCursor(raw);
  if (!cursor) return null;
  if (cursor.s !== "ecat" && cursor.s !== "ecats") return null;
  if (cursor.k !== key) return null;
  if (cursor.s === "ecat") return cursor;
  return cursor.qi < seedQueryCount ? cursor : null;
}
