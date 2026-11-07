/**
 * P58-TIKTOK-SOURCE — the TikTok DTOs (ADR 0004 §2). Every payload carries
 * the honest provenance `source` + `unavailable`/reason (the ADR 0002 §3
 * doctrine, applied to the third source). The embed contract is the official
 * Embed Player (`www.tiktok.com/player/v1/<postId>`) — TikTok owns the
 * player and the stream; WebFlix owns browse, curation, and the error
 * surface. Remote oEmbed `html` is deliberately NEVER rendered — WebFlix
 * builds its own iframe from the documented params (no remote HTML injection).
 */

export type TikTokSource =
  | "tiktok-oembed"
  | "tiktok-curated"
  | "tiktok-imported"
  | "last-good"
  | "";

/** WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2 — the import visibility law (ADR 0013
 * §7): "private" rides only the owner's feed; "public" admits the post to
 * every viewer's composed universe. SQLite has no enums — the DB column is
 * a String with this union (schema comment law). */
export type TikTokImportVisibility = "private" | "public";

/**
 * VIEWER-SCOPED stamps — set ONLY by the request layer (import/feed routes)
 * AFTER the shared cached DTO resolves; the cached lane itself never stores
 * them (one cached DTO serves every viewer — a session field inside it
 * would leak one viewer's shelf into another's). `undefined` = the row is
 * not DB-backed (curated) or the caller is a guest.
 */
export interface TikTokViewerStamp {
  /** The post's import visibility when DB-backed (curated rows: null). */
  visibility?: TikTokImportVisibility | null;
  /** True when the ACTING viewer imported this row (drives the owner's
   * manage affordances; never derivable from a shared cache). */
  owned?: boolean | null;
}

/** One curated TikTok post, as the hub/cards/player pages consume it. */
export interface TikTokVideoDTO extends TikTokViewerStamp {
  /** Numeric-string TikTok post id (the oEmbed `embed_product_id`). */
  postId: string;
  /** oEmbed enrichment — optional by contract (a minimal oEmbed answer
   * must still render an honest card; the player carries its own title). */
  author: string | null;
  authorUrl: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  /** The official Embed Player URL, built locally by lib/tiktok/urls.ts. */
  embedUrl: string;
  /** The outbound tiktok.com link (user-initiated navigation only). */
  deepLinkUrl: string;
  source: TikTokSource;
  unavailable: boolean;
  unavailableReason: string | null;
}

/** The hub payload: the curated universe, each video honestly resolved. */
export interface TikTokRailDTO {
  videos: TikTokVideoDTO[];
  /** The curated list length (with env override applied). */
  universeSize: number;
  source: TikTokSource;
  unavailable: boolean;
  unavailableReason: string | null;
  fetchedAt: string;
}

/** The global-search shelf payload (curated-library matches only). */
export interface TikTokSearchResultsDTO {
  q: string;
  videos: TikTokVideoDTO[];
  universeSize: number;
  source: TikTokSource;
  note: string | null;
}

/**
 * The official player→host error surface (developers.tiktok.com/docs/en/
 * embed-player, 2026-10-22): onPlayerError { errorCode, errorType }.
 * 1001 INVALID_VIDEO · 2001 SERVER_ERROR · 3001 PLAYBACK_ERROR ·
 * 3002 AUTOPLAY_ERROR.
 */
export type TikTokPlayerError = {
  code: number;
  type: string;
  message: string;
};

// ---------------------------------------------------------------------------
// P94-a — the channel lane (the derived creator page, the mandate's surface)
// ---------------------------------------------------------------------------

/**
 * One TikTok creator's channel — DERIVED from the composed corpus (curated +
 * community imports), never fabricated. oEmbed carries no avatar/banner/
 * stats, so every field here is either factual (handle, postCount, the
 * outbound profile URL) or a verified-metadata best-effort (nickname,
 * banner) with honest nulls the UI renders as labeled fallbacks.
 */
export interface TikTokChannelDTO {
  /** The canonical in-corpus handle (no leading @). */
  handle: string;
  /** oEmbed `author_name` when any of the creator's posts verified it; null
   * renders the handle (the attribution law: verified fields only). */
  nickname: string | null;
  /**
   * An avatar CANDIDATE only — the aggregator (`unavatar.io/tiktok/<handle>`)
   * resolves viewer-side; the UI keeps an initials/glyph fallback for the
   * honest miss. Null when the handle is avatar-unbuildable (never today).
   */
  avatarUrl: string | null;
  /** The outbound tiktok.com profile URL (the URL law's own builder). */
  profileUrl: string;
  /** How many of the creator's posts ride WebFlix's composed shelf (real). */
  postCount: number;
  /** The latest verified post thumbnail — the banner candidate; null keeps
   * the honest gradient banner. */
  bannerUrl: string | null;
}

/** The channel-page payload: the derived channel + its posts + the honest
 * depth disclosure (universeSize = how many posts the shelf searched). */
export interface TikTokChannelPageDTO {
  channel: TikTokChannelDTO;
  videos: TikTokVideoDTO[];
  universeSize: number;
  /** Set when the shelf holds none of this creator's posts yet — the page
   * still renders (a real handle with an honest empty grid + outbound). */
  note: string | null;
  /** P98 (docs/research/2026-11-05-p98-signed-in-walk-report.md G21): the
   * acting viewer's LINKED TikTok identity IS this channel's handle — the
   * page may acknowledge the link instead of showing the stranger-facing
   * "Is this you?" prompt. Additive (the P95 local:true pattern): false
   * for guests and for every non-owner viewer. Never a capability claim —
   * an unverified profile link names the identity; it authorizes nothing. */
  viewerLinked: boolean;
}
