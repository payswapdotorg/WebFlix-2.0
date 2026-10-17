import { WatchPage } from "@/components/watch/watch-page";
import { parseTimestampParam } from "@/lib/watch/share";
import { parseShuffleSeedParam } from "@/lib/playlist/shuffle";

/**
 * WFX2-W watch page — /watch/[id] (+ optional ?t= start timestamp, the
 * share-link behavior: the copied link seeks on load).
 *
 * REA-1 G16/G19 — the playlist context params (measured on youtube.com
 * 2026-10-17): `?list=<playlistId>` builds the queue panel + the autoplay
 * chain follows the list (Play all); `&shuffle=<seed>` is WebFlix's
 * deterministic-seed shuffle cue; `&start_radio=1` is youtube.com's own
 * mix/radio start cue (accepted and carried — for mixes the queue arrives
 * in YouTube's own shuffled order, so it implies the same playback shape).
 */
export default async function WatchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tRaw = typeof sp.t === "string" ? sp.t : null;
  const t = parseTimestampParam(tRaw);
  const listRaw = typeof sp.list === "string" ? sp.list : null;
  const listId = listRaw && /^(?:PL|RD|OL|UU|FL|LL|WL)[A-Za-z0-9_-]{0,}$/.test(listRaw) ? listRaw : null;
  const shuffleSeed = parseShuffleSeedParam(typeof sp.shuffle === "string" ? sp.shuffle : null);
  // key → fresh mount per video (client state resets naturally); the list
  // context rides the key too — a different list remounts the queue cleanly.
  return (
    <WatchPage
      key={`${id}:${listId ?? ""}:${shuffleSeed ?? ""}`}
      videoId={id}
      startAt={t}
      listId={listId}
      shuffleSeed={shuffleSeed}
    />
  );
}
