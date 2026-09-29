/**
 * WFX2-B-W search parity — the extra result metadata the real search page
 * renders: spelling corrections (didYouMeanRenderer / showingResultsForRenderer),
 * the results count, and playlist results (lockupViewModel, the current
 * unified playlist renderer — verified live + recorded in
 * `tests/fixtures/yt/search_playlists_lofi.json`).
 *
 * Renderer ground truth (recorded in `tests/fixtures/yt/search_misspelled.json`):
 *   itemSectionRenderer.contents[0].showingResultsForRenderer {
 *     showingResultsFor: "Showing results for",
 *     correctedQuery: runs (correction, italics on the fixed part),
 *     correctedQueryEndpoint.searchEndpoint.query,
 *     searchInsteadFor: "Search instead for",
 *     originalQuery: simpleText,
 *     originalQueryEndpoint.searchEndpoint {query, params: "QgIIAQ=="} }
 *   didYouMeanRenderer (the "Did you mean" variant — same correctedQuery +
 *   correctedQueryEndpoint fields, no original block).
 */
import { walkTree, runsText, mapPlaylistRenderer } from "./mappers";
import type { PlaylistLiteDTO, SearchCorrection } from "@/lib/types";

/**
 * Map the spelling correction if the response carries one.
 * - `didYouMean` → "Did you mean <corrected>?" (results shown = original)
 * - `showingResultsFor` → "Showing results for <corrected>" + a
 *   "Search instead for <original>" link.
 */
export function mapSearchCorrection(response: unknown): SearchCorrection | null {
  // showingResultsForRenderer wins — it is the richer variant
  for (const r of walkTree(response, "showingResultsForRenderer")) {
    const correctedQuery = runsText(r?.correctedQuery)?.trim();
    if (!correctedQuery) continue;
    const original = runsText(r?.originalQuery)?.trim() || null;
    if (!original) continue;
    return {
      kind: "showingResultsFor",
      correctedQuery,
      originalQuery: original,
    };
  }
  for (const r of walkTree(response, "didYouMeanRenderer")) {
    const correctedQuery = runsText(r?.correctedQuery)?.trim();
    if (!correctedQuery) continue;
    return {
      kind: "didYouMean",
      correctedQuery,
      originalQuery: null,
    };
  }
  return null;
}

/**
 * The results-count text ("About 3,839,607 results"). The current responses
 * carry `estimatedResults` (a plain numeric string); the count text renders
 * from it — the number is YouTube's own estimate at request time.
 */
export function searchResultCountText(response: unknown): string | null {
  const estimated = (response as { estimatedResults?: unknown })?.estimatedResults;
  if (typeof estimated !== "string" || !/^\d+$/.test(estimated)) return null;
  const formatted = Number(estimated).toLocaleString("en-US");
  return `About ${formatted} results`;
}

const PLAYLIST_ID_RE = /^(?:PL|RD|OL|UU|FL|LL)[A-Za-z0-9_-]{4,}$/;

function playlistVideoCount(l: any): { count: number | null; text: string | null } {
  const overlays =
    l?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel
      ?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? []) {
      const text = badge?.thumbnailBadgeViewModel?.text ?? "";
      const m = /^(\d[\d.,]*)\s+videos?$/i.exec(text);
      if (m) return { count: Number(m[1].replace(/,/g, "")), text };
    }
  }
  return { count: null, text: null };
}

/**
 * lockupViewModel → PlaylistLiteDTO (the current playlist result renderer).
 * Identified by the collectionThumbnailViewModel stack + a PL/RD/… contentId.
 * Thumbnail: the collection's primary thumbnail (the playlist's first video).
 */
export function mapPlaylistLockupViewModel(l: any): PlaylistLiteDTO | null {
  const id = typeof l?.contentId === "string" ? l.contentId : "";
  if (!id || !PLAYLIST_ID_RE.test(id)) return null;
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const title = typeof lmv?.title?.content === "string" ? lmv.title.content : "";
  if (!title) return null;
  const collection = l?.contentImage?.collectionThumbnailViewModel;
  const sources = collection?.primaryThumbnail?.thumbnailViewModel?.image?.sources ?? [];
  const best = sources.reduce(
    (a: { width?: number }, b: { width?: number }) => ((b?.width ?? 0) >= (a?.width ?? 0) ? b : a),
    {} as { width?: number; url?: string }
  );
  const { count, text } = playlistVideoCount(l);
  // metadata rows: channel name first, then "Playlist", then stats
  const rows = lmv?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts: string[] = [];
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      const content = part?.text?.content ?? "";
      if (content && content !== "Playlist") parts.push(content);
    }
  }
  const channelName = parts.find((p) => !/^\d[\d.,]*\s*(videos?|views)/i.test(p) && !/ago$/i.test(p)) ?? "";
  const updatedText = parts.find((p) => /ago$/i.test(p)) ?? null;
  return {
    id,
    title,
    videoCount: count ?? 0,
    videoCountText: text,
    thumbnailUrl: typeof best?.url === "string" ? best.url : null,
    channelName,
    updatedText,
    isMix: id.startsWith("RD"),
  };
}

/**
 * Every playlist result in a search response, in document order:
 * lockupViewModel (current) + playlistRenderer (classic, A-B's mapper).
 */
export function mapSearchPlaylists(response: unknown, limit?: number): PlaylistLiteDTO[] {
  const seen = new Set<string>();
  const out: PlaylistLiteDTO[] = [];
  const push = (dto: PlaylistLiteDTO | null) => {
    if (!dto || !dto.id || !dto.title || seen.has(dto.id)) return;
    seen.add(dto.id);
    out.push(dto);
  };
  for (const l of walkTree(response, "lockupViewModel")) push(mapPlaylistLockupViewModel(l));
  for (const r of walkTree(response, "playlistRenderer")) {
    const mapped = mapPlaylistRenderer(r);
    if (!mapped) continue;
    push({
      id: mapped.id,
      title: mapped.title,
      videoCount: mapped.videoCount,
      videoCountText: mapped.videoCount > 0 ? `${mapped.videoCount} videos` : null,
      thumbnailUrl: mapped.thumbnailUrl,
      channelName: mapped.channelName,
      updatedText: mapped.updatedText,
      isMix: mapped.id.startsWith("RD"),
    });
  }
  return limit ? out.slice(0, limit) : out;
}
