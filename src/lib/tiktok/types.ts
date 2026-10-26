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
  | "last-good"
  | "";

/** One curated TikTok post, as the hub/cards/player pages consume it. */
export interface TikTokVideoDTO {
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
