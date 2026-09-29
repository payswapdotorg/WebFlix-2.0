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
import { mapVideos, walkTree, findFirst } from "./mappers";
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

/** The public playlist page: header + videos (+ continuation cursor). */
export async function getPublicPlaylist(
  playlistId: string,
  cursor?: string
): Promise<PlaylistPageDTO | null> {
  const id = playlistId.trim();
  if (!PLAYLIST_ID_RE.test(id)) return null;

  const browseId = `VL${id}`;
  const response = await cached(`yt:playlist:${browseId}:${cursor ?? ""}`, TTL.FEED_MS, () =>
    cursor
      ? innertubeBrowse({ browseId, continuation: cursor })
      : innertubeBrowse({ browseId })
  );
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
