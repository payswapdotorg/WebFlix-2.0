/**
 * WFX2-B-B playlists — the operator's playlists (read): the list from
 * /feed/playlists SSR, items via browse `VL<playlistId>` (+ continuations),
 * and YouTube's special lists — Watch Later `WL` and Liked `LL` (items via
 * browse VLWL / VLLL — auth-gated).
 *
 * Fixtures:
 *  - `ssr_playlist_public.json` / `browse_vl_public.json` — REAL captures of
 *    a public playlist page + its browse VL items XHR (public, no cookies —
 *    runtime curls from the B-B sandbox). Item shape: lockupViewModel
 *    (contentType LOCKUP_CONTENT_TYPE_VIDEO) inside itemSectionRenderer, tail
 *    continuationItemViewModel.continuationCommand.innertubeCommand
 *    .continuationCommand.token.
 *  - `ssr_playlists_synth.json` — SYNTHETIC-shaped (the B-B sandbox has no
 *    browser to harvest the operator session; /feed/playlists requires auth —
 *    public probe answers a 640-byte empty skeleton, fixture
 *    ssr_playlists_public.json). Built on the structural pattern of the real
 *    subscriptions grid + real playlist lockups; the lead re-captures on merge.
 *  - `browse_vl_continuation_synth.json` — SYNTHETIC continuation page (the
 *    standard appendContinuationItemsCommand shape A-B verified for feeds).
 *
 * Writes (add/remove/create/delete) are broker-tier (executor kinds
 * playlist-remove-item, playlist-create, playlist-delete) — Tier-2 law.
 */
import { innertubeBrowse } from "./innertube";
import { fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import { walkTree, runsText, mapLockupViewModel, parseCompactCount, relativeAgeToDate } from "./mappers";
import type { PlaylistDTO, VideoDTO } from "@/lib/types";

export interface PlaylistItemsPage {
  playlist: PlaylistDTO | null;
  videos: VideoDTO[];
  nextCursor: string | null;
  /** true when the list exists but is auth-gated (WL/LL without a session) */
  loginRequired: boolean;
  /** true when the playlist id is genuinely unknown upstream */
  notFound: boolean;
}

/** YouTube's special playlist ids (auth-gated always). */
export function isSpecialPlaylistId(id: string): boolean {
  return id === "WL" || id === "LL";
}

/** The browse browseId for a playlist page (VL-prefixed). */
export function playlistBrowseId(playlistId: string): string {
  return playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
}

// ---------------------------------------------------------------------------
// playlist list (the /feed/playlists page)
// ---------------------------------------------------------------------------

function visibilityFromBadge(badge: string): PlaylistDTO["visibility"] {
  if (/public/i.test(badge)) return "public";
  if (/unlisted/i.test(badge)) return "unlisted";
  return "private"; // YouTube's own default for created playlists
}

/** One playlist lockup → PlaylistDTO (no items — those lazy-load per list). */
export function mapPlaylistLockup(l: any): PlaylistDTO | null {
  const id = l?.contentId;
  if (typeof id !== "string" || !id) return null;
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const title = lmv?.title?.content ?? "";
  if (!title) return null;
  const parts = (lmv?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap(
    (r: any) => r?.metadataParts ?? []
  );
  let videoCount = 0;
  let updatedText: string | null = null;
  for (const part of parts) {
    const text = part?.text?.content ?? "";
    const countMatch = /^(\d[\d,]*)\s+videos?$/i.exec(text);
    if (countMatch) {
      videoCount = parseCompactCount(countMatch[1]) ?? 0;
      continue;
    }
    if (/^(updated\s+)/i.test(text) || /^\d+\s+\w+\s+ago$/i.test(text)) {
      updatedText = updatedText ?? text.replace(/^updated\s+/i, "");
    }
  }
  // visibility badge on the thumbnail overlay (Private / Public / Unlisted)
  let visibility: PlaylistDTO["visibility"] = "private";
  for (const overlay of l?.contentImage?.thumbnailViewModel?.overlays ?? []) {
    for (const badge of overlay?.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const text = badge?.thumbnailBadgeViewModel?.text ?? "";
      if (/^(public|unlisted|private)$/i.test(text)) visibility = visibilityFromBadge(text);
    }
  }
  const sources = l?.contentImage?.thumbnailViewModel?.image?.sources ?? [];
  const coverUrl = sources.length > 0 ? sources[sources.length - 1]?.url ?? null : null;
  return {
    id,
    title,
    visibility,
    isWatchLater: id === "WL",
    createdAt: updatedText ? (relativeAgeToDate(updatedText) ?? new Date(0).toISOString()) : new Date(0).toISOString(),
    videoCount,
    coverUrl,
    videos: [],
  };
}

/** Map a /feed/playlists SSR response (real-shaped grid or promo skeleton). */
export function mapPlaylistsPage(response: unknown): { playlists: PlaylistDTO[]; loginRequired: boolean } {
  for (const promo of walkTree(response, "backgroundPromoRenderer")) {
    const cta = JSON.stringify(promo?.ctaButton ?? {});
    if (/accounts\.google\.com\/ServiceLogin/.test(cta)) {
      return { playlists: [], loginRequired: true };
    }
  }
  const playlists: PlaylistDTO[] = [];
  const seen = new Set<string>();
  for (const lockup of walkTree(response, "lockupViewModel")) {
    if (lockup?.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST") continue;
    const dto = mapPlaylistLockup(lockup);
    if (!dto || seen.has(dto.id)) continue;
    seen.add(dto.id);
    playlists.push(dto);
  }
  return { playlists, loginRequired: playlists.length === 0 && !hasSession() };
}

/**
 * The operator's playlists. Session-gated: public mode → the page answers a
 * near-empty skeleton (real public capture) → honest loginRequired empties.
 */
export async function getPlaylists(): Promise<{ playlists: PlaylistDTO[]; loginRequired: boolean }> {
  if (!hasSession()) {
    const response = await cached("yt:playlists:public", TTL.FEED_MS, () =>
      fetchYtInitialData("/feed/playlists", { cookies: null })
    );
    return mapPlaylistsPage(response);
  }
  const response = await cached("yt:playlists", TTL.FEED_MS, () =>
    fetchYtInitialData("/feed/playlists")
  );
  return mapPlaylistsPage(response);
}

// ---------------------------------------------------------------------------
// playlist items (browse VL<id> + continuations)
// ---------------------------------------------------------------------------

/** Playlist header from a VL browse / SSR playlist response. */
function playlistHeader(response: unknown, fallbackId: string): PlaylistDTO | null {
  // browse VL: header.pageHeaderRenderer (new) | header.playlistHeaderRenderer (classic)
  const pageHeader = walkTree(response, "pageHeaderRenderer")[0] ?? null;
  const classic = walkTree(response, "playlistHeaderRenderer")[0] ?? null;
  let title = "";
  let ownerName = "";
  let statsText = "";
  let thumbnailUrl: string | null = null;

  if (pageHeader) {
    title = pageHeader?.pageTitle ?? "";
    const rows =
      pageHeader?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel
        ?.metadataRows ?? [];
    const parts = rows.flatMap((r: any) => r?.metadataParts ?? []);
    ownerName = parts[0]?.text?.content ?? "";
    statsText = parts.slice(1).map((p: any) => p?.text?.content ?? "").join(" ");
    thumbnailUrl = null;
  } else if (classic) {
    title = runsText(classic?.title);
    ownerName = runsText(classic?.ownerText);
    statsText = [runsText(classic?.numVideosText), runsText(classic?.viewsText)]
      .filter(Boolean)
      .join(" ");
    const sources = classic?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail
      ?.thumbnails ?? [];
    thumbnailUrl = sources.length ? sources[sources.length - 1]?.url : null;
  }
  if (!title) return null;

  const countMatch = /(\d[\d,]*)\s+videos?/i.exec(statsText);
  const videoCount = countMatch ? (parseCompactCount(countMatch[1]) ?? 0) : 0;
  const id = fallbackId;
  return {
    id,
    title,
    visibility: "public", // public lists are what the no-auth path can read
    isWatchLater: id === "WL",
    createdAt: new Date(0).toISOString(),
    videoCount,
    coverUrl: thumbnailUrl,
    videos: [],
  };
}

/** Map a VL browse response (first page or continuation) or an SSR playlist page. */
export function mapPlaylistItemsPage(response: unknown, playlistId: string): PlaylistItemsPage {
  // upstream alerts: ERROR "The playlist does not exist." (WL/LL without a
  // session answer exactly this — the special lists exist only signed in)
  for (const alert of walkTree(response, "alertRenderer")) {
    if (alert?.type === "ERROR") {
      if (isSpecialPlaylistId(playlistId)) {
        return { playlist: null, videos: [], nextCursor: null, loginRequired: true, notFound: false };
      }
      return { playlist: null, videos: [], nextCursor: null, loginRequired: false, notFound: true };
    }
  }

  const videos: VideoDTO[] = [];
  const seen = new Set<string>();
  for (const lockup of walkTree(response, "lockupViewModel")) {
    const dto = mapLockupViewModel(lockup);
    if (!dto || seen.has(dto.id)) continue;
    seen.add(dto.id);
    videos.push(dto);
  }

  let nextCursor: string | null = null;
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) {
      nextCursor = token;
      break;
    }
  }
  if (!nextCursor) {
    for (const item of walkTree(response, "continuationItemViewModel")) {
      const token = item?.continuationCommand?.innertubeCommand?.continuationCommand?.token;
      if (typeof token === "string" && token) {
        nextCursor = token;
        break;
      }
    }
  }

  const playlist = playlistHeader(response, playlistId);
  if (!playlist && videos.length === 0 && isSpecialPlaylistId(playlistId) && !hasSession()) {
    // the SSR page for WL/LL answers an empty skeleton when signed out — the
    // special lists exist only for the signed-in operator
    return { playlist: null, videos: [], nextCursor: null, loginRequired: true, notFound: false };
  }
  return {
    playlist: playlist
      ? { ...playlist, videoCount: playlist.videoCount || videos.length }
      : null,
    videos,
    nextCursor,
    loginRequired: false,
    notFound: false,
  };
}

/**
 * One page of playlist items.
 *  - `browse VL<id>` is the mechanism (works for public playlists without
 *    auth — verified live); WL/LL need the operator session and answer the
 *    auth-gated "playlist does not exist" honestly in public mode.
 *  - `cursor` pages via browse {continuation}.
 *  - `source: "ssr"` reads the /playlist?list=<id> page instead (the public
 *    web shape — same lockup items; used as the SSR fallback path).
 */
export async function getPlaylistItems(
  playlistId: string,
  opts: { cursor?: string; source?: "browse" | "ssr" } = {}
): Promise<PlaylistItemsPage> {
  if (opts.cursor) {
    const response = await innertubeBrowse({ continuation: opts.cursor });
    return mapPlaylistItemsPage(response, playlistId);
  }
  if (opts.source === "ssr") {
    const response = await fetchYtInitialData(`/playlist?list=${encodeURIComponent(playlistId)}`);
    return mapPlaylistItemsPage(response, playlistId);
  }
  const response = await cached(`yt:playlist:${playlistId}`, TTL.FEED_MS, () =>
    innertubeBrowse({ browseId: playlistBrowseId(playlistId) })
  );
  return mapPlaylistItemsPage(response, playlistId);
}
