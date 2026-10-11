"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ListVideo, Play, MoreVertical, ChevronUp, ChevronDown, Loader2, Clock, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlaylistPageDTO, VideoDTO } from "@/lib/types";

/**
 * The public playlist page (WFX2-B-W) — browse VL<id> (real YouTube
 * playlist): title, owner, stats, the video grid, Play all (first video).
 * Playlist-result cards from search link here.
 *
 * WFX2-P4-PE: per-item ⋯ menu with Move up / Move down (the broker's
 * playlist-reorder drive, mapped to fromIndex/toIndex calls). Optimistic
 * local reorder; toast on the broker verdicts; honest degradation when the
 * broker is offline/unauthorized (the toast surfaces the error). The
 * affordance is hidden when the playlist is read-only (the broker's
 * playlist-drag-handle-not-found honest failure shape — the operator may not
 * own the playlist).
 *
 * P22-B — the special lists (WL/LL) ride this page too (youtube.com's own
 * guide links "Watch later" to /playlist?list=WL). Three laws:
 *   - guests get the personal-surface gate (the lists are personal — the
 *     signed-out ask is legitimate, exactly like /liked for a guest);
 *   - signed-in viewers NEVER get a login ask: `loginRequired` (no YouTube
 *     session configured) and `unavailable` (a session IS configured but the
 *     read was not served — the production deploy answers the "playlist does
 *     not exist" alert for LL WITH the operator session, measured live) are
 *     two different states and the page says which one it is;
 *   - the reorder ⋯ menu is hidden for the special lists (the reorder route
 *     honestly 400s — "YouTube's own lists" — so the UI never offers it).
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

/** The honest unavailable state (P22-B): a session IS configured but the
 *  read was not served — NEVER a login ask (the viewer is signed in; the
 *  WebFlix session cannot fix the YouTube session's read). */
function SpecialListUnavailableNote({ list }: { list: "WL" | "LL" }) {
  const label = list === "WL" ? "Watch later" : "Liked videos";
  return (
    <div className="px-4 py-16 text-center sm:px-6" role="status" data-testid="playlist-special-unavailable">
      <p className="text-lg font-medium">{label} is unavailable right now</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The YouTube session is connected, but it didn&apos;t return your {label.toLowerCase()} list — it may
        be empty on YouTube, or YouTube didn&apos;t serve it to WebFlix. Open it on youtube.com to check.
      </p>
    </div>
  );
}

/** The honest no-session state (P22-B): no login ask — the WebFlix sign-in
 *  is fine; what's missing is the deployment's YouTube session, which no
 *  WebFlix sign-in can fix. */
function SpecialListNoSessionNote({ list }: { list: "WL" | "LL" }) {
  const label = list === "WL" ? "Watch later" : "Liked videos";
  return (
    <div className="px-4 py-16 text-center sm:px-6" role="status" data-testid="playlist-special-no-session">
      <p className="text-lg font-medium">{label} is unavailable right now</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {label} is personal to the YouTube account this WebFlix deployment rides (single-tenant live
        mode). No YouTube session is connected to this deployment yet — your WebFlix sign-in is fine;
        the operator session (YT_COOKIES) needs to be connected.
      </p>
    </div>
  );
}

/** The honest served-empty state — the read came back; the list is empty. */
function SpecialListEmptyNote({ list }: { list: "WL" | "LL" }) {
  return (
    <div className="px-4 py-16 text-center sm:px-6" data-testid="playlist-special-empty">
      <p className="text-lg font-medium">
        {list === "WL" ? "No videos in Watch later yet" : "No liked videos here yet"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {list === "WL"
          ? "Videos you save with the Save button on a watch page show up here."
          : "Videos you like on YouTube show up here — this page reads the same list as /liked."}
      </p>
    </div>
  );
}

function PlaylistContent({ id, special }: { id: string; special: boolean }) {
  const { data, loading, error, reload } = useApi<PlaylistPageDTO>(
    id ? `/api/playlist/${encodeURIComponent(id)}` : null
  );

  // optimistic local reorder (the broker's intended effect)
  const [order, setOrder] = useState<VideoDTO[] | null>(null);
  const [reordering, setReordering] = useState<number | null>(null);

  const listedVideos = order ?? data?.videos ?? [];
  // the special lists cannot be reordered (YouTube's own lists — the reorder
  // route honestly 400s); the ⋯ menu is never offered for them
  const canReorder = !special;

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
  const unavailable = specialList ? data?.unavailable === true : false;
  const noSession = specialList ? data?.loginRequired === true && !unavailable : false;
  const servedEmpty =
    specialList !== null && data && !unavailable && !noSession && listedVideos.length === 0;

  return (
    <div className="pb-10">
      {loading && (
        <div className="space-y-4 px-4 py-6 sm:px-6" aria-busy="true">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 pt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {specialList === "WL" ? (
                  <Clock className="size-4" aria-hidden />
                ) : specialList === "LL" ? (
                  <ThumbsUp className="size-4" aria-hidden />
                ) : (
                  <ListVideo className="size-4" aria-hidden />
                )}
                {data.playlist.id.startsWith("RD") ? "Mix" : "Playlist"}
              </p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl" data-testid="playlist-title">
                {data.playlist.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground" data-testid="playlist-meta">
                {data.playlist.channelName}
                {data.playlist.videoCountText ? ` · ${data.playlist.videoCountText}` : ""}
                {data.playlist.viewsText ? ` · ${data.playlist.viewsText}` : ""}
              </p>
              {data.playlist.description && (
                <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted-foreground">
                  {data.playlist.description}
                </p>
              )}
            </div>
            {data.videos.length > 0 && (
              <Button asChild className="w-fit gap-2 rounded-full">
                <Link href={`/watch/${data.videos[0].id}`}>
                  <Play className="size-4" aria-hidden />
                  {data.videos.length > 1 ? "Play all" : "Play"}
                </Link>
              </Button>
            )}
          </div>
          {specialList && unavailable && <SpecialListUnavailableNote list={specialList} />}
          {specialList && noSession && <SpecialListNoSessionNote list={specialList} />}
          {servedEmpty && specialList && <SpecialListEmptyNote list={specialList} />}
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
            {listedVideos.map((video, i) => (
              <div key={video.id} className="relative">
                <span className="absolute -left-1 -top-1 z-10 hidden text-xs font-semibold tabular-nums text-muted-foreground lg:block" aria-hidden>
                  {i + 1}
                </span>
                <div className="relative">
                  <VideoCard video={video} />
                  {/* the per-item ⋯ menu (Move up / Move down — the broker's
                      playlist-reorder drive); NEVER offered for the special
                      lists (the route honestly 400s — YouTube's own lists) */}
                  {canReorder && (
                    <div className="absolute right-1 top-1 z-20 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="size-7 rounded-full p-0 shadow"
                            disabled={reordering !== null}
                            aria-label={`Actions for ${video.title}`}
                          >
                            {reordering === i ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <MoreVertical className="size-3.5" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={i === 0 || reordering !== null}
                            onClick={() => moveItem(i, i - 1)}
                          >
                            <ChevronUp className="mr-2 size-3.5" /> Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={i === listedVideos.length - 1 || reordering !== null}
                            onClick={() => moveItem(i, i + 1)}
                          >
                            <ChevronDown className="mr-2 size-3.5" /> Move down
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
