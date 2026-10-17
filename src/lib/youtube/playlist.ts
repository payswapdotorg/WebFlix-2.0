/**
 * WFX2-B-W public playlist page — browse a real YouTube playlist
 * (`browse {browseId: "VL<playlistId>"}` — verified live, recorded in
 * `tests/fixtures/yt/playlist_browse_lofi.json`).
 *
 * The response carries the title/owner/stats on pageHeaderRenderer and the
 * videos as lockupViewModel grid items (mapped by A-B's generic walker).
 */
import { innertubeBrowse } from "./innertube";
import { cached, TTL } from "./cache";
import { getPlaylistItems, isSpecialPlaylistId, type PlaylistItemsPage } from "./playlists";
import { mapVideos, walkTree, findFirst } from "./mappers";
import { mixSeedVideoId } from "./watch-queue";
import type { PlaylistPageDTO } from "@/lib/types";

const PLAYLIST_ID_RE = /^(?:PL|RD|OL|UU|FL|LL)[A-Za-z0-9_-]{4,}$/;

function playlistContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/** The playlist header (pageHeaderRenderer — the 2026 shape, verified live). */
function mapPlaylistHeader(response: unknown): {
  title: string;
  channelName: string;
  videoCountText: string | null;
  viewsText: string | null;
  description: string | null;
} {
  const phr = findFirst(response, "pageHeaderRenderer");
  const phv = phr?.content?.pageHeaderViewModel;
  const title = phv?.title?.dynamicTextViewModel?.text?.content ?? phr?.pageTitle ?? "";
  const rows = phv?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts: string[] = [];
  let avatarStackName = "";
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      // the owner row renders as an avatar stack — the name rides its text
      const stackName = part?.avatarStack?.avatarStackViewModel?.text?.content ?? "";
      if (stackName) {
        avatarStackName = stackName;
        continue;
      }
      const text = part?.text?.content ?? "";
      if (text && text !== "Playlist") parts.push(text);
    }
  }
  const channelName = avatarStackName
    || parts.find((p) => !/^\d[\d.,]*\s*(videos?|views)/i.test(p))
    || "";
  const videoCountText = parts.find((p) => /^\d[\d.,]*\s+videos?$/i.test(p)) ?? null;
  const viewsText = parts.find((p) => /^\d[\d.,]*\s+views$/i.test(p)) ?? null;
  const description = phv?.description?.descriptionPreviewViewModel?.description?.content ?? null;
  return { title, channelName, videoCountText, viewsText, description };
}

/** The public playlist page: header + videos (+ continuation cursor).
 *
 * P22-B: the SPECIAL lists (WL/LL — youtube.com's own guide links "Watch
 * later" to /playlist?list=WL) route through the special-list read
 * (getPlaylistItems — session semantics + the honest unavailable/login
 * states) instead of the public VL read, which rejects them. The mapped
 * PlaylistPageDTO carries the state flags so the page can degrade honestly
 * (never a login ask — the guest note explains the single-tenant session).
 *
 * REA-1 G19: a MIX list id (RD…) answers youtube.com's OWN honest verdict —
 * "This playlist type is unviewable." (measured live 2026-10-17 at both the
 * /playlist?list=RD… page and the browse VL<RD…> alert) — mapped onto the
 * `mixUnviewable` flag: the page renders youtube.com's wording + the
 * start-radio affordance (the watch route's queue) when the seed video is
 * derivable from the id (RD<videoId> / RDAMVM<videoId>).
 */
export async function getPublicPlaylist(
  playlistId: string,
  cursor?: string
): Promise<PlaylistPageDTO | null> {
  const id = playlistId.trim();
  if (!PLAYLIST_ID_RE.test(id)) {
    // the special lists exist only for the signed-in session — youtube.com's
    // own "Watch later" guide entry points at exactly this route
    if (isSpecialPlaylistId(id)) {
      const page = await getPlaylistItems(id, { cursor });
      return specialListToPage(id, page);
    }
    return null;
  }

  const browseId = `VL${id}`;
  const response = await cached(`yt:playlist:${browseId}:${cursor ?? ""}`, TTL.FEED_MS, () =>
    cursor
      ? innertubeBrowse({ browseId, continuation: cursor })
      : innertubeBrowse({ browseId })
  );
  // REA-1 G19 — the mix verdict: youtube.com will not render an RD… list as
  // a playlist page ("This playlist type is unviewable." — the measured
  // alertRenderer); the honest DTO says so (never a fabricated grid).
  if (isMixUnviewableAlert(response)) {
    return {
      playlist: {
        id,
        title: "Mix",
        channelName: "",
        videoCountText: null,
        viewsText: null,
        description: null,
      },
      videos: [],
      nextCursor: null,
      mixUnviewable: true,
      mixSeedVideoId: mixSeedVideoId(id),
    };
  }
  const header = mapPlaylistHeader(response);
  if (!header.title) return null;
  const videos = mapVideos(response, { dedupe: true, limit: 48 });
  return {
    playlist: {
      id,
      title: header.title,
      channelName: header.channelName,
      videoCountText: header.videoCountText,
      viewsText: header.viewsText,
      description: header.description,
    },
    videos,
    nextCursor: playlistContinuationToken(response),
  };
}

/** Map a special-list read (WL/LL) onto the public-playlist page DTO. */
function specialListToPage(id: string, page: PlaylistItemsPage): PlaylistPageDTO {
  const dto = page.playlist;
  const fallbackTitle = id === "WL" ? "Watch later" : "Liked videos";
  return {
    playlist: {
      id,
      title: dto?.title ?? fallbackTitle,
      // the special lists belong to the viewer — youtube.com labels the
      // owner row "You" on the Watch later page (measured live 2026-10-11)
      channelName: "You",
      videoCountText: dto ? `${dto.videoCount} videos` : null,
      viewsText: null,
      description: null,
    },
    videos: page.videos,
    nextCursor: page.nextCursor,
    special: true,
    loginRequired: page.loginRequired,
    unavailable: page.unavailable,
  };
}

/** REA-1 G19 — youtube.com's measured mix verdict on a browse VL<RD…> read. */
function isMixUnviewableAlert(response: unknown): boolean {
  for (const alert of walkTree(response, "alertRenderer")) {
    const text =
      alert?.text?.simpleText ??
      (Array.isArray(alert?.text?.runs) ? alert.text.runs.map((r: any) => r?.text ?? "").join("") : "");
    if (/this playlist type is unviewable/i.test(String(text))) return true;
  }
  return false;
}
