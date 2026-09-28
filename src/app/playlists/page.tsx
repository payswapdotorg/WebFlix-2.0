"use client";

import { useState } from "react";
import Link from "next/link";
import { ListVideo, Play, Plus, Lock, Globe, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDuration } from "@/lib/format";
import type { PlaylistDTO } from "@/lib/types";

/** Playlists — your playlists (real rows), watch later pinned first. */
export default function PlaylistsPage() {
  const { data, loading, error, reload } = useApi<PlaylistDTO[]>("/api/playlists");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [openPlaylist, setOpenPlaylist] = useState<PlaylistDTO | null>(null);

  async function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await postJson("/api/playlists", { title, visibility: "private" });
      toast.success(`Created “${title}”`);
      setNewTitle("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <ListVideo className="size-7 text-yt-red" /> Playlists
        </h1>
        <form onSubmit={createPlaylist} className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New playlist name"
            aria-label="New playlist name"
            maxLength={100}
            className="w-48 rounded-full"
          />
          <Button type="submit" disabled={!newTitle.trim() || creating} variant="secondary" className="rounded-full">
            <Plus className="mr-1 size-4" /> Create
          </Button>
        </form>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-6 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3" aria-hidden="true">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.length === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No playlists yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one above, or use “Save to playlist” in any video's menu.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-6 px-4 py-2 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 xl:grid-cols-4">
          {data.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => setOpenPlaylist(playlist)}
              className="group flex flex-col gap-3 text-left"
              aria-label={`Open playlist ${playlist.title}`}
            >
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
                {playlist.coverUrl ? (
                  <img
                    src={playlist.coverUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ListVideo className="size-10 text-muted-foreground/50" />
                  </div>
                )}
                <div className="absolute bottom-0 right-0 flex items-center gap-1 bg-foreground/90 px-2 py-1 text-xs font-medium text-background">
                  <Play className="size-3 fill-background" /> {playlist.videoCount}
                </div>
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
              </div>
              <div>
                <p className="truncate text-sm font-medium text-foreground">{playlist.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {playlist.isWatchLater && <span className="font-medium">Watch later ·</span>}
                  {playlist.visibility === "private" && (
                    <Lock className="size-3" aria-label="Private" />
                  )}
                  {playlist.visibility === "unlisted" && (
                    <EyeOff className="size-3" aria-label="Unlisted" />
                  )}
                  {playlist.visibility === "public" && (
                    <Globe className="size-3" aria-label="Public" />
                  )}
                  {playlist.visibility} playlist
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <PlaylistDetailsDialog
        playlist={openPlaylist}
        onClose={() => setOpenPlaylist(null)}
      />
    </div>
  );
}

function PlaylistDetailsDialog({
  playlist,
  onClose,
}: {
  playlist: PlaylistDTO | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!playlist} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-hidden p-0">
        {playlist && (
          <>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2">
                {playlist.isWatchLater && <span>Watch later</span>}
                {!playlist.isWatchLater && <span>{playlist.title}</span>}
              </DialogTitle>
              <DialogDescription>
                {playlist.videoCount} video{playlist.videoCount === 1 ? "" : "s"} ·{" "}
                {playlist.visibility}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] overflow-y-auto slim-scrollbar py-2">
              {playlist.videos.length === 0 && (
                <p className="px-6 py-6 text-center text-sm text-muted-foreground">
                  Empty playlist — add videos via the kebab menu on any card.
                </p>
              )}
              {playlist.videos.map((video, i) => (
                <Link
                  key={video.id}
                  href={`/watch/${video.id}`}
                  className="flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="relative aspect-video w-[90px] shrink-0 overflow-hidden rounded-md bg-secondary">
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {video.channel.name} · {formatDuration(video.durationSec)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
