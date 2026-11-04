/**
 * ADR 0013 — the Shorts source boundary contracts (the TL freeze for
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1).
 *
 * ONE presentation experience (`/shorts`), many providers. This module owns
 * the ONLY cross-source vocabulary: the source id, the URL-state law, the
 * deep-link shapes, and the per-source action capability map. Everything
 * else (DTOs, players, action routes) stays provider-specific by the ADR:
 * a YouTube adapter never touches a TikTok DTO and vice versa.
 */

export type ShortsSource = "youtube" | "tiktok";

export const SHORTS_SOURCES: readonly ShortsSource[] = ["youtube", "tiktok"];

/** `/shorts` defaults to YouTube; anything else parses honestly to YouTube. */
export function parseShortsSource(raw: string | null | undefined): ShortsSource {
  return raw === "tiktok" ? "tiktok" : "youtube";
}

/** True when `s` is a plausible TikTok post id (the URL law's numeric shape). */
function looksLikePostId(s: string): boolean {
  return /^\d{6,32}$/.test(s);
}

/**
 * The canonical in-app href for a Shorts source. The `post` deep link is
 * TikTok-only for now (YouTube deep links already have /watch/<id> and the
 * feed's YouTube lane is a browse surface, not a permalink target).
 */
export function shortsSourceHref(source: ShortsSource, postId?: string | null): string {
  if (source === "youtube") return "/shorts";
  return postId && looksLikePostId(postId)
    ? `/shorts?source=tiktok&post=${encodeURIComponent(postId)}`
    : "/shorts?source=tiktok";
}

/**
 * The per-source action capability map (ADR 0013 §5): the UI renders
 * actions FROM this map and never hard-codes a cross-source claim.
 *
 * - youtube: every affordance the existing rail ships. like/dislike/comment
 *   ride the OFFICIAL YouTube lanes (honest 503 `youtube-not-configured` in
 *   an unconnected deployment — the P36/P37 law).
 * - tiktok: NO like/dislike/comment/follow — TikTok has no approved
 *   documented write API for third parties (ADR 0004; the work order's
 *   contract §8: never show an action that claims a TikTok write). The
 *   honest affordances are WebFlix-local (share the canonical URL, report)
 *   and the outbound "Open on TikTok".
 */
export interface ShortsSourceCapabilities {
  /** like/dislike through the provider's official write lane. */
  canLike: boolean;
  canDislike: boolean;
  /** in-feed comments sheet through the provider's own comment plane. */
  canComment: boolean;
  /** follow/subscribe through the provider's official write lane. */
  canFollow: boolean;
  /** WebFlix-local share affordance (copies the canonical share URL). */
  canShare: boolean;
  /** WebFlix-local hide / not-interested signal (M3+). */
  canHide: boolean;
  /** WebFlix report affordance. */
  canReport: boolean;
  /** an honest outbound link to the post on the provider's site. */
  canOpenOutbound: boolean;
  /** WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2 — the WebFlix-local canonical-URL
   * paste/import (a private save by default; the owner's visibility flip
   * is the curator rule). WebFlix-local ONLY — it claims no TikTok write
   * (ADR 0004). */
  canImport: boolean;
}

export const SHORTS_SOURCE_CAPABILITIES: Record<ShortsSource, ShortsSourceCapabilities> = {
  youtube: {
    canLike: true,
    canDislike: true,
    canComment: true,
    canFollow: true,
    canShare: true,
    canHide: true,
    canReport: true,
    canOpenOutbound: true,
    canImport: false,
  },
  tiktok: {
    canLike: false,
    canDislike: false,
    canComment: false,
    canFollow: false,
    canShare: true,
    canHide: true,
    canReport: true,
    canOpenOutbound: true,
    canImport: true,
  },
};
