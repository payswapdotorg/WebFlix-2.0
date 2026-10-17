/**
 * REA-1 G16/G19 — the watch-page playlist queue read.
 *
 * The measured seam (live 2026-10-17, docs/research/
 * 2026-10-17-rea1-measurements.md): youtube.com's watch page builds the
 * queue panel from `POST /youtubei/v1/next {videoId, playlistId}` — the
 * response carries `contents.twoColumnWatchNextResults.playlist.playlist`
 * (title, shortBylineText/ownerName, isInfinite, currentIndex, playlistId,
 * `playlistPanelVideoRenderer` items + continuation tokens). The same seam
 * serves a regular playlist in list order AND a mix (RD…) in YouTube's own
 * shuffled order with the infinite autoload; `/playlist?list=RD…` itself
 * answers "This playlist type is unviewable." — mixes are watch constructs.
 *
 * The special lists (WL/LL) answer no panel on `next` without the session
 * (measured), so they ride the existing special-list read
 * (getPlaylistItems — the P22-B honest states).
 *
 * No shuffle happens at this layer — the deterministic seeded shuffle is
 * applied by the route over the fetched items (src/lib/playlist/shuffle.ts).
 */
import { innertubeNext } from "./innertube";
import { cached, TTL } from "./cache";
import { getPlaylistItems, isSpecialPlaylistId } from "./playlists";
import { runsText, walkTree, videoThumbnailUrl } from "./mappers";
import type { PlaylistItemsPage } from "./playlists";

/** One queue row — the panel's own fields (playlistPanelVideoRenderer). */
export interface WatchQueueItemDto {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  /** 0 → unknown/live (the panel hides the duration badge). */
  durationSec: number;
}

export interface WatchQueueDto {
  playlist: {
    id: string;
    title: string;
    ownerName: string | null;
    /** youtube.com's mix marker — the panel's infinite/radio presentation. */
    isMix: boolean;
    /** the panel's isInfinite — the "load more forever" family (mixes, radios). */
    isInfinite: boolean;
  };
  items: WatchQueueItemDto[];
  /** the now-playing position within items (-1 when the video is not in the list). */
  currentIndex: number;
  /** the next page's continuation token (null = the loaded chain honestly ended). */
  nextCursor: string | null;
  /** the honest special-list states (WL/LL only — the P22-B family). */
  loginRequired?: boolean;
  unavailable?: boolean;
}

/** "3:34" | "1:02:03" → seconds (0 when unparseable — the honest absent). */
function parseLengthText(text: string | null | undefined): number {
  if (typeof text !== "string" || !text) return 0;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return 0;
  if (m[3] !== undefined) {
    return parseInt(m[1] ?? "0", 10) * 3600 + parseInt(m[2] ?? "0", 10) * 60 + parseInt(m[3], 10);
  }
  return parseInt(m[1] ?? "0", 10) * 60 + parseInt(m[2] ?? "0", 10);
}

/** The best thumbnail from a playlistPanelVideoRenderer thumbnail stack. */
function panelThumbnail(r: any): string | null {
  const thumbs = Array.isArray(r?.thumbnail?.thumbnails) ? r.thumbnail.thumbnails : [];
  if (!thumbs.length) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

/**
 * REA-1 G19 — the TRUE mix/radio families: the ids that carry their seed
 * video (RD<videoId>, RDAMVM<videoId> — measured). youtube.com's own click
 * on these is start_radio (the panel arrives in YouTube's own shuffled
 * order — no local shuffle). Curated RD… music lists (RDCLAK…) render as
 * ORDINARY playlists on youtube.com (measured — the RDCLAK playlist page
 * browses fine) and shuffle server-side on a Shuffle click → WebFlix's
 * local seeded shuffle applies there.
 */
export function isMixListId(listId: string): boolean {
  return mixSeedVideoId(listId) !== null;
}

/**
 * Pure mapper: a `next` response → the queue DTO (null when the response
 * carries no playlist panel — the honest "no queue for this list" answer).
 */
export function mapWatchQueueResponse(
  listId: string,
  response: unknown
): WatchQueueDto | null {
  const panel = (response as any)?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
  if (!panel || typeof panel !== "object") return null;

  const items: WatchQueueItemDto[] = [];
  const seen = new Set<string>();
  for (const wrapper of Array.isArray(panel.contents) ? panel.contents : []) {
    const r = wrapper?.playlistPanelVideoRenderer;
    if (!r || typeof r.videoId !== "string" || !r.videoId) continue;
    if (seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    items.push({
      videoId: r.videoId,
      title: r.title?.simpleText ?? runsText(r?.title) ?? "",
      channelName: runsText(r?.shortBylineText) || runsText(r?.longBylineText) || "",
      thumbnailUrl: panelThumbnail(r) ?? videoThumbnailUrl(r.videoId),
      durationSec: parseLengthText(r?.lengthText?.simpleText ?? runsText(r?.lengthText)),
    });
  }

  let nextCursor: string | null = null;
  for (const item of walkTree(panel, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) {
      nextCursor = token;
      break;
    }
  }

  // the panel's own now-playing: the selected row (indexText "▶"); -1 when
  // the response marks none (the route locates the caller's videoId itself)
  const currentVideoId = currentVideoIdOf(panel);
  const currentIndex = currentVideoId ? items.findIndex((it) => it.videoId === currentVideoId) : -1;

  const isMix = isMixListId(listId);
  return {
    playlist: {
      id: typeof panel.playlistId === "string" ? panel.playlistId : listId,
      title: panel.title?.simpleText ?? runsText(panel?.titleText) ?? panel.title ?? "",
      ownerName: runsText(panel?.shortBylineText) || runsText(panel?.longBylineText)
        || (typeof panel.ownerName === "string" ? panel.ownerName : null),
      isMix,
      isInfinite: panel.isInfinite === true,
    },
    items,
    currentIndex,
    nextCursor,
  };
}

/** The selected row's videoId (the "▶" row) — the panel's own now-playing. */
function currentVideoIdOf(panel: any): string | null {
  for (const wrapper of Array.isArray(panel.contents) ? panel.contents : []) {
    const r = wrapper?.playlistPanelVideoRenderer;
    if (r?.selected === true && typeof r.videoId === "string") return r.videoId;
  }
  return null;
}

/** Map a special-list page (WL/LL) onto the queue DTO (the honest states). */
function specialListToQueue(listId: "WL" | "LL", page: PlaylistItemsPage): WatchQueueDto {
  const fallbackTitle = listId === "WL" ? "Watch later" : "Liked videos";
  return {
    playlist: {
      id: listId,
      title: page.playlist?.title ?? fallbackTitle,
      ownerName: "You",
      isMix: false,
      isInfinite: false,
    },
    items: page.videos.map((v) => ({
      videoId: v.id,
      title: v.title,
      channelName: v.channel?.name ?? "",
      thumbnailUrl: v.thumbnailUrl ?? null,
      durationSec: v.durationSec ?? 0,
    })),
    currentIndex: -1, // the caller's videoId locates the row (route-level)
    nextCursor: page.nextCursor,
    loginRequired: page.loginRequired,
    unavailable: page.unavailable,
  };
}

/**
 * The watch-page queue for a list param. Regular playlists + mixes ride the
 * measured `next` seam (cached); the special lists ride the session read.
 * `cursor` pages the infinite autoload (browse-style `{continuation}` POST —
 * the same token family the panel itself carries).
 */
export async function getWatchQueue(
  videoId: string,
  listId: string,
  cursor?: string
): Promise<WatchQueueDto | null> {
  const id = listId.trim();
  if (isSpecialPlaylistId(id)) {
    const page = await getPlaylistItems(id, { cursor });
    return specialListToQueue(id as "WL" | "LL", page);
  }
  const response = await cached(`yt:watchqueue:${id}:${videoId}:${cursor ?? ""}`, TTL.WATCH_MS, () =>
    cursor
      ? innertubeNext({ videoId, playlistId: id, continuation: cursor })
      : innertubeNext({ videoId, playlistId: id, params: "wAEB" })
  );
  return mapWatchQueueResponse(id, response);
}

/**
 * REA-1 G19 — the seed video derivable from a mix list id, honestly.
 * `RD<videoId>` (the radio family) and `RDAMVM<videoId>` carry the seed in
 * the id itself (measured: RDn61ULEU7CO0 ↔ watch?v=n61ULEU7CO0). Opaque mix
 * ids (RDAT…, RDMM blobs, curated RDCLAK…) derive nothing → null.
 */
export function mixSeedVideoId(listId: string): string | null {
  if (/^RD[A-Za-z0-9_-]{11}$/.test(listId)) return listId.slice(2);
  if (/^RDAMVM[A-Za-z0-9_-]{11}$/.test(listId)) return listId.slice(6);
  return null;
}
