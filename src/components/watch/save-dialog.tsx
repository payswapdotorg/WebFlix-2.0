"use client";

/**
 * WFX2-W save dialog — Watch later + playlists list + create-new, all real
 * via /api/playlists (toggle membership, create playlist).
 */
import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Check, Globe, Lock, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, post } from "@/lib/watch/client";
import type { PlaylistDto } from "@/lib/watch/types";

export function SaveDialog({
  open,
  onOpenChange,
  videoId,
  onSavedChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videoId: string;
  onSavedChange?: (watchLater: boolean) => void;
}) {
  const [playlists, setPlaylists] = useState<PlaylistDto[] | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false); // submission in flight
  const [newName, setNewName] = useState("");
  const [newVisibility, setNewVisibility] = useState<"private" | "public" | "unlisted">("private");
  const [busyId, setBusyId] = useState<string | null>(null);

  // conditionally mounted by the parent → fetch once on mount
  useEffect(() => {
    let alive = true;
    api<{ playlists: PlaylistDto[] }>(`/api/playlists?videoId=${encodeURIComponent(videoId)}`)
      .then((r) => {
        if (alive) setPlaylists(r.playlists);
      })
      .catch((e) => {
        if (alive) setPlaylists([]); // error → honest empty list + toast
        toast.error(e instanceof Error ? e.message : "Failed to load playlists");
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  const loading = playlists === null;

  const toggle = async (playlist: PlaylistDto) => {
    if (busyId) return;
    setBusyId(playlist.id);
    // optimistic
    setPlaylists((ps) =>
      (ps ?? []).map((p) => (p.id === playlist.id ? { ...p, containsVideo: !p.containsVideo, itemCount: p.itemCount + (p.containsVideo ? -1 : 1) } : p))
    );
    try {
      const result = await post<{ containsVideo: boolean }>(
        `/api/playlists/${playlist.id}/items`,
        { videoId }
      );
      setPlaylists((ps) =>
        (ps ?? []).map((p) =>
          p.id === playlist.id
            ? { ...p, containsVideo: result.containsVideo, itemCount: p.itemCount + (result.containsVideo ? 1 : -1) }
            : p
        )
      );
      const watchLater = result.containsVideo && playlist.isWatchLater;
      onSavedChange?.(watchLater && result.containsVideo);
      toast.success(
        result.containsVideo ? `Saved to ${playlist.name}` : `Removed from ${playlist.name}`
      );
    } catch (e) {
      // reconcile with server truth
      setPlaylists((ps) =>
        (ps ?? []).map((p) => (p.id === playlist.id ? { ...p, containsVideo: playlist.containsVideo, itemCount: playlist.itemCount } : p))
      );
      toast.error(e instanceof Error ? e.message : "Failed to update playlist");
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const { playlist } = await post<{ playlist: PlaylistDto }>("/api/playlists", {
        name: newName.trim(),
        visibility: newVisibility,
      });
      setPlaylists((ps) => [...(ps ?? []), playlist]);
      setNewName("");
      setShowCreateForm(false);
      toast.success(`Playlist "${playlist.name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create playlist");
    } finally {
      setCreating(false);
    }
  };

  const watchLater = playlists?.find((p) => p.isWatchLater);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save video to...</DialogTitle>
          <DialogDescription className="sr-only">
            Add this video to Watch later or a playlist
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-secondary" />
            ))}
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {watchLater && (
              <button
                type="button"
                onClick={() => toggle(watchLater)}
                disabled={busyId === watchLater.id}
                aria-pressed={watchLater.containsVideo}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-accent disabled:opacity-50"
              >
                {watchLater.containsVideo ? (
                  <BookmarkCheck className="size-5 text-foreground" aria-hidden="true" />
                ) : (
                  <Bookmark className="size-5 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="flex-1 text-sm font-medium">
                  Watch later
                  {watchLater.containsVideo && (
                    <span className="ml-1 text-muted-foreground">Added</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{watchLater.itemCount}</span>
              </button>
            )}

            {playlists
              ?.filter((p) => !p.isWatchLater)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p)}
                  disabled={busyId === p.id}
                  aria-pressed={p.containsVideo}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-accent disabled:opacity-50"
                >
                  <span
                    className={`flex size-5 items-center justify-center rounded border ${
                      p.containsVideo ? "border-foreground bg-foreground" : "border-muted-foreground/50"
                    }`}
                    aria-hidden="true"
                  >
                    {p.containsVideo && <Check className="size-3.5 text-background" />}
                  </span>
                  <span className="flex-1 truncate text-sm">{p.name}</span>
                  {p.visibility === "private" ? (
                    <Lock className="size-3.5 text-muted-foreground" aria-label="Private playlist" />
                  ) : (
                    <Globe className="size-3.5 text-muted-foreground" aria-label="Public playlist" />
                  )}
                  <span className="text-xs text-muted-foreground">{p.itemCount}</span>
                </button>
              ))}
          </div>
        )}

        {!showCreateForm ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            <Plus className="size-5" aria-hidden="true" />
            Create new playlist
          </button>
        ) : (
          <form
            className="space-y-3 rounded-xl border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Playlist name"
                aria-label="New playlist name"
                maxLength={150}
                className="h-9 border-none bg-transparent shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="size-4" aria-hidden="true" />
                <select
                  value={newVisibility}
                  onChange={(e) => setNewVisibility(e.target.value as "private" | "public" | "unlisted")}
                  aria-label="Playlist visibility"
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 rounded-full"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-9 rounded-full"
                  disabled={!newName.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
