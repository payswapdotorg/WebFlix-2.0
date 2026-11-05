/**
 * P58-TIKTOK-SOURCE — ADR 0004 §1: the ONLY place in the codebase allowed to
 * construct a tiktok.com URL (the law mirrors `netflix/deeplink.ts`).
 *
 * The embed lane rides TikTok's official Embed Player —
 * `https://www.tiktok.com/player/v1/{postId}` (developers.tiktok.com/docs/en/
 * embed-player, updated 2026-10-22) — which the VIEWER's browser fetches
 * directly from TikTok. WebFlix servers never fetch these URLs except the
 * keyless oEmbed metadata call through the upstream seam.
 *
 * Post ids are numeric strings (the docs example: 6718335390845095173, a
 * 19-digit id). `vm.tiktok.com` short links CANNOT be resolved without a
 * network hop — parseTikTokVideoUrl honestly nulls them rather than guessing.
 */

const POST_ID_RE = /^\d{6,32}$/;

export interface ParsedTikTokVideo {
  postId: string;
  /** The `@handle` when the input carried it (oEmbed enrichment may add the
   * canonical author later); null for bare ids / player URLs. */
  author: string | null;
}

/** True when `s` is a plausible TikTok post id (numeric string). */
export function isTikTokPostId(s: string): boolean {
  return POST_ID_RE.test(s);
}

/**
 * Parse any TikTok video reference into its post id:
 * - `https://www.tiktok.com/@user/video/6718335390845095173?is_from_webapp=1`
 * - `https://m.tiktok.com/v/6718335390845095173.html`
 * - `https://www.tiktok.com/player/v1/6718335390845095173`
 * - a bare post id `6718335390845095173`
 * Short links (`vm.tiktok.com/…`, `/t/…`) honestly null — they require a
 * network resolution WebFlix refuses to perform for input parsing.
 */
export function parseTikTokVideoUrl(input: string): ParsedTikTokVideo | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (POST_ID_RE.test(raw)) return { postId: raw, author: null };
  if (/[?#\s]/.test(raw) === false && !raw.includes("/")) return null;
  // The short-link family: unresolvable without a network hop — honest null.
  if (/^https?:\/\/(vm|vt)\.tiktok\.com\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "www.tiktok.com" && host !== "m.tiktok.com" && host !== "tiktok.com") {
    return null;
  }
  const segs = url.pathname.split("/").filter(Boolean);
  // /player/v1/<id> — the Embed Player's own URL shape.
  const playerIdx = segs.indexOf("player");
  if (playerIdx !== -1 && segs[playerIdx + 1] === "v1") {
    const id = segs[playerIdx + 2] ?? "";
    return POST_ID_RE.test(id) ? { postId: id, author: null } : null;
  }
  // /@user/video/<id> (www) and /v/<id>(.html) (m.)
  const videoIdx = segs.findIndex((s) => s === "video" || s === "v");
  if (videoIdx === -1 || videoIdx === segs.length - 1) return null;
  const id = segs[videoIdx + 1].replace(/\.html?$/i, "");
  if (!POST_ID_RE.test(id)) return null;
  const atUser = segs.find((s) => s.startsWith("@"));
  return { postId: id, author: atUser ? atUser.slice(1) || null : null };
}

/** The official Embed Player's origin — the narrowest postMessage
 * targetOrigin and the inbound-message origin check (the feed protocol's
 * law, ADR 0013; this lives here because ADR 0004 §1 makes this file the
 * only tiktok.com string source in the codebase). */
export const TIKTOK_PLAYER_ORIGIN = "https://www.tiktok.com";

export interface TikTokPlayerOptions {
  /** Show music info (official param, default 0 — WebFlix ships 1: attribution). */
  musicInfo?: boolean;
  /** Show the video description (official param, default 0 — WebFlix ships 1). */
  description?: boolean;
  /** Related videos: 1 = recommendations, 0 = the author's videos (default 1
   * on TikTok's side; WebFlix ships 0 — the hub, not TikTok, owns discovery). */
  rel?: boolean;
  loop?: boolean;
  autoplay?: boolean;
  /** WFX2-TIKTOK-SHORTS-EXPERIENCE-1 param audit (the work order's mandatory
   * audit against the embed-player docs updated 2026-10-28): the documented
   * start-muted param is `force_muted` — the pre-2026-10-28 docs' `muted`
   * name this file previously built is NOT in the current contract. */
  forceMuted?: boolean;
  controls?: boolean;
  timestamp?: boolean;
  closedCaption?: boolean;
}

function flag(v: boolean | undefined, defaultOn: boolean): string {
  return (v ?? defaultOn) ? "1" : "0";
}

/**
 * The official Embed Player URL with WebFlix's documented-param defaults:
 * attribution ON (music_info + description), discovery stays in the hub
 * (rel=0), autoplay OFF (honest — browsers block it anyway, and the
 * AUTOPLAY_ERROR path stays reserved for genuine cases).
 */
export function tiktokPlayerEmbedUrl(postId: string, opts: TikTokPlayerOptions = {}): string {
  if (!POST_ID_RE.test(postId)) {
    throw new Error(`invalid TikTok post id: ${postId}`);
  }
  const params = new URLSearchParams({
    music_info: flag(opts.musicInfo, true),
    description: flag(opts.description, true),
    rel: flag(opts.rel, false),
    controls: flag(opts.controls, true),
    timestamp: flag(opts.timestamp, true),
    closed_caption: flag(opts.closedCaption, true),
  });
  if (opts.loop) params.set("loop", "1");
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.forceMuted) params.set("force_muted", "1");
  return `https://www.tiktok.com/player/v1/${postId}?${params.toString()}`;
}

/** The keyless oEmbed endpoint for one video URL (the only tiktok.com URL
 * WebFlix's servers fetch — always through lib/tiktok/upstream.ts). */
export function tiktokOEmbedApiUrl(videoUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * The canonical tiktok.com URL for a post — the oEmbed request shape when the
 * author is known, the player page otherwise (a valid outbound page).
 */
export function tiktokVideoUrl(author: string | null, postId: string): string {
  if (!POST_ID_RE.test(postId)) {
    throw new Error(`invalid TikTok post id: ${postId}`);
  }
  return author
    ? `https://www.tiktok.com/@${encodeURIComponent(author)}/video/${postId}`
    : `https://www.tiktok.com/player/v1/${postId}`;
}

/** The creator profile URL (P59: the curated citations carry factual handles;
 * the URL law owns every tiktok.com shape, this one included). */
export function tiktokAuthorUrl(author: string): string {
  const handle = author.replace(/^@/, "").trim();
  if (!/^[\w.\-]{1,30}$/.test(handle)) {
    throw new Error(`invalid TikTok author handle: ${author}`);
  }
  return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
}

// ---------------------------------------------------------------------------
// P94-a — the channel lane (the same URL law, extended to profile shapes)
// ---------------------------------------------------------------------------

/** A plausible TikTok handle: 1–30 word/dot/dash chars (the same shape
 * tiktokAuthorUrl has always enforced, now shared). */
export const TIKTOK_HANDLE_RE = /^[\w.\-]{1,30}$/;

/** Strip the leading `@` (and trim) — the canonical in-corpus handle form. */
export function normalizeTikTokHandle(raw: string): string {
  return raw.replace(/^@/, "").trim();
}

/** True when `raw` is a format-valid TikTok handle. */
export function isTikTokHandle(raw: string): boolean {
  return TIKTOK_HANDLE_RE.test(normalizeTikTokHandle(raw));
}

/**
 * Parse a TikTok profile reference into its handle — the P94-b profile-link
 * lane's input law. Accepts:
 * - `https://www.tiktok.com/@handle` (+ `m.tiktok.com/@handle`, `tiktok.com/@handle`,
 *   with any query/hash — the share shape carries `?lang=en` etc.)
 * - a bare `@handle` / `handle`
 * Video/player URLs honestly null (they are post references, not profiles —
 * parseTikTokVideoUrl owns those). Short links (`vm.tiktok.com`) null — the
 * same no-network-hop law as the post parser.
 */
export function parseTikTokProfileUrl(input: string): { handle: string } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (!raw.includes("/") && !raw.includes("?")) {
    const bare = normalizeTikTokHandle(raw);
    return TIKTOK_HANDLE_RE.test(bare) ? { handle: bare } : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Scheme-less pastes ("tiktok.com/@handle" — exactly what the settings
    // card's own placeholder advertises) get the https default once.
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
  const host = url.hostname.toLowerCase();
  if (host !== "www.tiktok.com" && host !== "m.tiktok.com" && host !== "tiktok.com") {
    return null;
  }
  const segs = url.pathname.split("/").filter(Boolean);
  const atIdx = segs.findIndex((s) => s.startsWith("@"));
  if (atIdx === -1) return null;
  // A profile path ENDS at the @handle — `/@user/video/<id>` is a POST
  // reference (parseTikTokVideoUrl's business), never a profile; the
  // profile-link lane must not swallow post URLs.
  if (atIdx !== segs.length - 1) return null;
  const handle = normalizeTikTokHandle(segs[atIdx]);
  return TIKTOK_HANDLE_RE.test(handle) ? { handle } : null;
}

/**
 * The canonical IN-APP href for a TikTok creator's channel page
 * (`/tiktok/<handle>` — the P94-a surface; the /@handle form normalizes to
 * the same route). Lives here beside tiktokAuthorUrl so every surface links
 * creators through one builder.
 */
export function tiktokChannelHref(handle: string): string {
  const clean = normalizeTikTokHandle(handle);
  if (!TIKTOK_HANDLE_RE.test(clean)) {
    throw new Error(`invalid TikTok author handle: ${handle}`);
  }
  return `/tiktok/${encodeURIComponent(clean)}`;
}

/** The TikTok Login Kit authorize URL (P94-b) — built here so the OAuth
 * seam stays within the URL law like every other tiktok.com consumer. */
export function tiktokAuthorizeUrl(opts: {
  clientKey: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge?: string | null;
}): string {
  const params = new URLSearchParams({
    client_key: opts.clientKey,
    response_type: "code",
    scope: opts.scope,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  if (opts.codeChallenge) params.set("code_challenge", opts.codeChallenge);
  // Login Kit v2 (developers.tiktok.com — the web authorization endpoint).
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}
