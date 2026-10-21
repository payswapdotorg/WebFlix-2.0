"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ListVideo,
  Play,
  MoreVertical,
  ChevronUp,
  ChevronDown,
  Loader2,
  Clock,
  ThumbsUp,
  Shuffle,
  UserRound,
  AudioLines,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { makeShuffleSeed, seededShuffle } from "@/lib/playlist/shuffle";
import { PlaylistSaveDialog } from "@/components/video/playlist-save-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlaylistPageDTO, VideoDTO } from "@/lib/types";

/** WFX2-P36 — the page's fetch payload: the route's PlaylistPageDTO, with
 * `playlist: null` + `notice` on the special-list (WL/LL) honest envelope. */
type PlaylistPagePayload = PlaylistPageDTO & {
  playlist: PlaylistPageDTO["playlist"] | null;
  /** the honest per-user notice (the WL/LL no-API handoff) */
  notice?: string;
};

/**
 * The playlist page (WFX2-B-W) — youtube.com's own /playlist layout
 * (2026-10-16 operator pass, the Watch later UX report):
 *
 *  - TWO COLUMNS — the playlist CARD panel on the left (thumbnail, title,
 *    owner, count, Play all + Shuffle — youtube.com's sticky gradient card)
 *    and the compact ROW LIST on the right (index · 160px thumbnail ·
 *    title/channel text block — exactly youtube.com's playlist rows, never
 *    the wide home-grid cards);
 *  - WFX2-P36: the special lists (WL watch later / LL liked) render the
 *    HONEST per-user notice instead — YouTube's own lists have no official
 *    read API, and the pre-P36 session read served the OPERATOR's list to
 *    every signed-in user (the cross-user leak the P36 work order closes);
 *    the WebFlix-local save button owns Watch later, YouTube's own page has
 *    the rest;
 *  - reorder (Move up/down) stays public-playlist-only; Load more pages
 *    the browse continuation;
 *  - REA-3 F3 (pre-P36): the special-list row actions are retired with the
 *    special-list rows themselves — Download is honestly absent either way
 *    (no seam — the parity-debt ledger), and YouTube's own lists can never
 *    be reordered (the route honestly 400s).
 */
function isSpecialListId(id: string | undefined): id is "WL" | "LL" {
  return id === "WL" || id === "LL";
}

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const raw = typeof id === "string" ? id : "";
  const special = isSpecialListId(raw);

  // the special lists are personal surfaces — guests get the honest ask
  // (youtube.com redirects signed-out viewers to sign-in for /playlist?list=WL);
  // public playlists stay ungated (they are public content)
  if (special) {
    return (
      <PersonalSurfaceGate surface="playlists" redirect={`/playlist/${raw}`}>
        <PlaylistContent id={raw} special />
      </PersonalSurfaceGate>
    );
  }
  return <PlaylistContent id={raw} special={false} />;
}

/** WFX2-P36 — the special lists' honest notice state: no official read API
 * for YouTube's own Watch Later / Liked lists, and the pre-P36 session read
 * served the OPERATOR's list to every signed-in user (the cross-user leak
 * the P36 work order closes). The notice hands Watch later off to the
 * WebFlix-local save button and the rest to YouTube's own pages — never the
 * operator's rows, never a fake empty that implies a read happened. */
function SpecialListNotice({ list }: { list: "WL" | "LL" }) {
  const label = list === "WL" ? "Watch later" : "Liked videos";
  return (
    <div className="py-16 text-center" role="status" data-testid="playlist-special-notice">
      <p className="text-lg font-medium">{label} lives outside WebFlix&apos;s reach</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        YouTube&apos;s Watch Later / Liked lists have no official API — your WebFlix Watch later lives
        in the save button (local), and YouTube&apos;s own page has the rest.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button asChild className="gap-2 rounded-full" data-testid="playlist-special-find">
          <Link href="/">Find videos to watch</Link>
        </Button>
        <a
          href={
            list === "WL"
              ? "https://www.youtube.com/feed/playlists"
              : "https://www.youtube.com/feed/liked"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-foreground underline underline-offset-2"
        >
          Open {label.toLowerCase()} on YouTube
        </a>
      </div>
    </div>
  );
}

/**
 * REA-1 G19 — youtube.com's OWN verdict for a mix list id, measured live
 * 2026-10-17: /playlist?list=RD… renders exactly "This playlist type is
 * unviewable." Mixes are watch-page constructs — the start-radio affordance
 * (the watch route's queue, youtube.com's /watch?v=<seed>&list=RD…&start_radio=1
 * cue) opens the mix where the seed video is derivable from the id itself.
 */
function MixUnviewableNote({ listId, seedVideoId }: { listId: string; seedVideoId: string | null }) {
  return (
    <div className="py-16 text-center" role="status" data-testid="playlist-mix-unviewable">
      <p className="text-lg font-medium">This playlist type is unviewable.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Mixes play in the watch page&apos;s queue, not as a playlist page — that&apos;s
        YouTube&apos;s own behavior for this list.
      </p>
      {seedVideoId && (
        <Button asChild className="mt-4 gap-2 rounded-full" data-testid="playlist-mix-start-radio">
          <Link href={`/watch/${seedVideoId}?list=${encodeURIComponent(listId)}&start_radio=1`}>
            <AudioLines className="size-4" aria-hidden />
            Start radio
          </Link>
        </Button>
      )}
    </div>
  );
}

function PlaylistContent({ id, special }: { id: string; special: boolean }) {
  const router = useRouter();
  const { data, loading, error, reload } = useApi<PlaylistPagePayload>(
    id ? `/api/playlist/${encodeURIComponent(id)}` : null
  );

  // optimistic local reorder (the intended server effect)
  const [order, setOrder] = useState<VideoDTO[] | null>(null);
  const [reordering, setReordering] = useState<number | null>(null);
  // cursor pagination (youtube.com's playlist page grows the list on demand)
  const [extraVideos, setExtraVideos] = useState<VideoDTO[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [pagingMore, setPagingMore] = useState(false);

  const listedVideos = order ?? [...(data?.videos ?? []), ...extraVideos];
  // the special lists render the honest P36 notice (no rows, no reordering);
  // public playlists keep the reorder affordance
  const canReorder = !special;

  async function loadMore() {
    const cursor = moreCursor ?? data?.nextCursor ?? null;
    if (!cursor || pagingMore) return;
    setPagingMore(true);
    try {
      const res = await fetch(
        `/api/playlist/${encodeURIComponent(id)}?cursor=${encodeURIComponent(cursor)}`
      );
      const body = (await res.json().catch(() => ({}))) as PlaylistPagePayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setExtraVideos((prev) => {
        const seen = new Set([...listedVideos.map((v) => v.id), ...prev.map((v) => v.id)]);
        return [...prev, ...(body.videos ?? []).filter((v) => !seen.has(v.id))];
      });
      setMoreCursor(body.nextCursor ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setPagingMore(false);
    }
  }

  async function moveItem(fromIndex: number, toIndex: number) {
    if (!id || !data) return;
    if (toIndex < 0 || toIndex >= listedVideos.length) return;
    if (fromIndex === toIndex) return;
    const moved = listedVideos[fromIndex];
    if (!moved) return;
    // optimistic local reorder (mirrors the broker's intended effect)
    const optimistic = [...listedVideos];
    optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, moved);
    setOrder(optimistic);
    setReordering(fromIndex);
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIndex, toIndex, videoId: moved.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        verified?: boolean;
        error?: string;
        unverifiedNote?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.verified) {
        toast.success(`Moved “${moved.title}” to position ${toIndex + 1}`);
      } else if (body.unverifiedNote) {
        toast.info(`Move submitted — the broker could not confirm the new order yet`);
      } else {
        toast.success(`Move submitted`);
      }
      // reload the canonical order from the server (clears the optimistic state)
      reload();
      setOrder(null);
    } catch (err) {
      // revert the optimistic reorder on failure
      setOrder(null);
      toast.error(err instanceof Error ? err.message : "Failed to reorder playlist");
    } finally {
      setReordering(null);
    }
  }

  if (error) {
    return (
      <div className="px-4 py-16 text-center sm:px-6" role="alert">
        <p className="text-lg font-medium">Playlist not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
          Back to home
        </Link>
      </div>
    );
  }

  const specialList = id === "WL" || id === "LL" ? (id as "WL" | "LL") : null;
  const hasMore = Boolean(moreCursor ?? data?.nextCursor);
  const mixUnviewable = data?.mixUnviewable === true;

  // REA-1 G16 — youtube.com's Play all (measured): /watch?v=<first>&list=<id>
  // — the watch page's queue panel follows the list.
  const playAllHref =
    !mixUnviewable && listedVideos.length > 0
      ? `/watch/${listedVideos[0].id}?list=${encodeURIComponent(id)}`
      : null;

  // REA-1 G16 — the deterministic Shuffle (the work order's contract):
  // a fresh seed per click; the seeded Fisher–Yates order over the
  // ALREADY-FETCHED list (local playback-order logic, no YouTube write);
  // navigation starts at the shuffled head carrying the seed in the URL so
  // the watch route rebuilds the exact same queue (shareable/reloadable).
  function shufflePlay() {
    if (listedVideos.length === 0) return;
    const seed = makeShuffleSeed();
    const shuffled = seededShuffle(listedVideos, seed);
    const first = shuffled[0];
    if (!first) return;
    router.push(`/watch/${first.id}?list=${encodeURIComponent(id)}&shuffle=${seed}`);
  }

  return (
    <div className="pb-10">
      {loading && (
        <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" aria-busy="true">
          <div className="space-y-3">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="aspect-video w-[160px] shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* WFX2-P36 — the special lists answer the honest notice envelope
          (playlist: null, no rows): the notice replaces the two-column
          layout entirely — never the operator's list, never a fake read */}
      {data && specialList && <SpecialListNotice list={specialList} />}
      {data && !specialList && data.playlist && (
        <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {/* -------- the playlist card panel (youtube.com's left column) ---- */}
          <aside
            aria-label="Playlist details"
            className="lg:sticky lg:top-4 lg:self-start"
          >
            <div className="overflow-hidden rounded-xl border border-border/60 bg-secondary/40">
              <div className="relative aspect-video w-full overflow-hidden bg-secondary">
                {listedVideos[0]?.thumbnailUrl ? (
                      <img
                    src={listedVideos[0].thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    {specialList === "WL" ? (
                      <Clock className="size-10" aria-hidden />
                    ) : specialList === "LL" ? (
                      <ThumbsUp className="size-10" aria-hidden />
                    ) : (
                      <ListVideo className="size-10" aria-hidden />
                    )}
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {specialList === "WL" ? (
                    <Clock className="size-4" aria-hidden />
                  ) : specialList === "LL" ? (
                    <ThumbsUp className="size-4" aria-hidden />
                  ) : mixUnviewable ? (
                    <AudioLines className="size-4" aria-hidden />
                  ) : (
                    <ListVideo className="size-4" aria-hidden />
                  )}
                  {specialList === "WL"
                    ? "Watch later"
                    : specialList === "LL"
                      ? "Liked videos"
                      : mixUnviewable
                        ? "Mix"
                        : data.playlist.id.startsWith("RD")
                          ? "Mix"
                          : "Playlist"}
                </p>
                <h1 className="mt-1 text-xl font-bold" data-testid="playlist-title">
                  {specialList === "WL"
                    ? "Watch later"
                    : specialList === "LL"
                      ? "Liked videos"
                      : data.playlist.title}
                </h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="playlist-meta">
                  {specialList ? (
                    <>
                      <UserRound className="size-4" aria-hidden /> You
                    </>
                  ) : (
                    data.playlist.channelName
                  )}
                  {(specialList || data.playlist.channelName) && " · "}
                  {specialList
                    ? // REA-3 F3 — the special lists count the LIVE list (the
                      // optimistic removal updates it, exactly youtube.com's
                      // own header count behavior; the DTO's captured text
                      // would go stale the moment a row leaves)
                      `${listedVideos.length} video${listedVideos.length === 1 ? "" : "s"}`
                    : (data.playlist.videoCountText ??
                      `${listedVideos.length} video${listedVideos.length === 1 ? "" : "s"}`)}
                  {!specialList && data.playlist.viewsText ? ` · ${data.playlist.viewsText}` : ""}
                </p>
                {!specialList && data.playlist.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {data.playlist.description}
                  </p>
                ) : null}
                <div className="mt-4 flex items-center gap-2">
                  {playAllHref ? (
                    <Button asChild className="gap-2 rounded-full">
                      <Link href={playAllHref} data-testid="playlist-play-all">
                        <Play className="size-4" aria-hidden />
                        {listedVideos.length > 1 ? "Play all" : "Play"}
                      </Link>
                    </Button>
                  ) : null}
                  {!mixUnviewable && listedVideos.length > 1 ? (
                    <Button
                      variant="secondary"
                      className="gap-2 rounded-full"
                      onClick={shufflePlay}
                      data-testid="playlist-shuffle"
                    >
                      <Shuffle className="size-4" aria-hidden />
                      Shuffle
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>

          {/* -------- the row list (youtube.com's right column) -------------- */}
          <div className="min-w-0">
            {mixUnviewable && <MixUnviewableNote listId={id} seedVideoId={data.mixSeedVideoId ?? null} />}
            <ol className="space-y-1">
              {listedVideos.map((video, i) => (
                <PlaylistRow
                  key={video.id}
                  video={video}
                  index={i}
                  canReorder={canReorder}
                  specialList={specialList}
                  reordering={reordering === i}
                  disableUp={i === 0 || reordering !== null}
                  disableDown={i === listedVideos.length - 1 || reordering !== null}
                  onMoveUp={() => moveItem(i, i - 1)}
                  onMoveDown={() => moveItem(i, i + 1)}
                  onRemove={null}
                />
              ))}
            </ol>
            {hasMore && (
              <div className="flex justify-center py-6">
                <Button
                  variant="secondary"
                  className="rounded-full"
                  onClick={loadMore}
                  disabled={pagingMore}
                >
                  {pagingMore ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Loading…
                    </>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One playlist ROW — youtube.com's playlist lockup: the index (tabular,
 * muted), a 160px 16:9 thumbnail with the duration chip, and the compact
 * title/channel text block. The ⋯ menu: reorder (Move up/down) on public
 * playlists; youtube.com's own row actions on the special lists (remove
 * from the list / Save to playlist / Share — REA-3 F3).
 */
function PlaylistRow({
  video,
  index,
  canReorder,
  specialList,
  reordering,
  disableUp,
  disableDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  video: VideoDTO;
  index: number;
  canReorder: boolean;
  specialList: "WL" | "LL" | null;
  reordering: boolean;
  disableUp: boolean;
  disableDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: (() => void) | null;
}) {
  // the Save-to-playlist dialog state (youtube.com's WL/LL row menu item —
  // the house PlaylistSaveDialog, existing seams only)
  const [saveOpen, setSaveOpen] = useState(false);

  async function copyLink() {
    const link = `${window.location.origin}/watch/${video.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(`Copy manually: ${link}`);
    }
  }

  return (
    <li className="group/row relative">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
        <span
          className="hidden w-5 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground sm:block"
          aria-label={`Video ${index + 1}`}
        >
          {index + 1}
        </span>
        <Link
          href={`/watch/${video.id}`}
          className="relative block w-[100px] shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-[160px]"
          aria-label={`Watch ${video.title}`}
        >
          <div className="aspect-video w-full">
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          {video.durationSec ? (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
              {Math.floor(video.durationSec / 60)}:
              {String(video.durationSec % 60).padStart(2, "0")}
            </span>
          ) : video.isLive ? (
            <span className="absolute bottom-1 right-1 rounded bg-yt-red px-1 py-0.5 text-[10px] font-bold uppercase text-white">
              Live
            </span>
          ) : null}
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/watch/${video.id}`}
            className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
          >
            {video.title}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {video.channel?.name ?? ""}
            {video.channel?.verified ? " ✓" : ""}
            {video.viewsText ? ` · ${video.viewsText}` : ""}
          </p>
        </div>
        {(canReorder || onRemove) && (
          <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-muted-foreground"
                  disabled={reordering}
                  aria-label={`Actions for ${video.title}`}
                >
                  {reordering ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MoreVertical className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canReorder && (
                  <>
                    <DropdownMenuItem disabled={disableUp} onClick={onMoveUp}>
                      <ChevronUp className="mr-2 size-3.5" /> Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={disableDown} onClick={onMoveDown}>
                      <ChevronDown className="mr-2 size-3.5" /> Move down
                    </DropdownMenuItem>
                  </>
                )}
                {onRemove && (
                  <DropdownMenuItem onClick={onRemove} data-testid="playlist-row-remove">
                    <X className="mr-2 size-3.5" />
                    {specialList === "WL" ? "Remove from Watch later" : "Remove from Liked videos"}
                  </DropdownMenuItem>
                )}
                {onRemove && (
                  <DropdownMenuItem onClick={() => setSaveOpen(true)}>
                    <ListVideo className="mr-2 size-3.5" /> Save to playlist
                  </DropdownMenuItem>
                )}
                {(canReorder || onRemove) && (
                  <DropdownMenuItem onClick={copyLink}>
                    <Share2 className="mr-2 size-3.5" /> Share
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {onRemove && (
        <PlaylistSaveDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          videoId={video.id}
          videoTitle={video.title}
        />
      )}
    </li>
  );
}
