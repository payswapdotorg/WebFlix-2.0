"use client";

import { useState } from "react";
import { Plus, Check } from "lucide-react";
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
import { postJson, useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref } from "@/lib/auth/client";
import type { PlaylistDTO } from "@/lib/types";

/** "Save to playlist" — the operator's real YouTube playlists + create-new
 * (list via the live /api/playlists read; adds via the broker write lane).
 * WFX2-P2-AU: WebFlix guests see the honest account gate — saving is a
 * personal write, so the dialog links /signin instead of a 401 toast. */
export function PlaylistSaveDialog({
  open,
  onOpenChange,
  videoId,
  videoTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  videoTitle: string;
}) {
  const session = useWebFlixSession();
  const authed = session.status === "authenticated";
  const { data, reload } = useApi<{ playlists: PlaylistDTO[]; loginRequired: boolean }>(
    open && authed ? "/api/playlists" : null
  );
  const playlists = data?.playlists ?? null;
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function addTo(playlistId: string, title: string) {
    try {
      const res = await postJson<{ added: boolean; reason?: string }>("/api/playlists/items", {
        playlistId,
        videoId,
      });
      toast.success(res.added ? `Saved to ${title}` : `Already in ${title}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function createAndAdd() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const created = await postJson<{ playlist: PlaylistDTO; note?: string }>('/api/playlists', {
        title,
        visibility: "private",
      });
      const newPlaylist = created.playlist;
      if (newPlaylist?.id) {
        await addTo(newPlaylist.id, title);
      } else {
        toast.info(`${title} created${created.note ? " (mirror — broker offline)" : ""}`);
      }
      setNewTitle("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save video to…</DialogTitle>
          <DialogDescription className="line-clamp-1">{videoTitle}</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-y-auto slim-scrollbar">
          {session.status === "unauthenticated" && (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Sign in to save videos to your playlists on WebFlix.
              </p>
              <Button asChild className="mt-3 rounded-full bg-yt-red text-white hover:bg-yt-red/90">
                <a href={signInHref(window.location.pathname)}>Sign in</a>
              </Button>
            </div>
          )}
          {(playlists ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addTo(p.id, p.title)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60"
            >
              {p.isWatchLater ? (
                <Check className="size-4 text-muted-foreground" />
              ) : (
                <span className="size-4" />
              )}
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-xs text-muted-foreground">{p.videoCount}</span>
            </button>
          ))}
          {playlists && playlists.length === 0 && !data?.loginRequired && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              No playlists yet — create one below.
            </p>
          )}
          {data?.loginRequired && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Sign in to see the account&apos;s playlists — saving still works through the
              action broker for Watch later.
            </p>
          )}
        </div>
        {authed && (
          <form
            className="flex gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createAndAdd();
            }}
          >
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New playlist name"
              aria-label="New playlist name"
              maxLength={100}
            />
            <Button type="submit" disabled={!newTitle.trim() || creating} variant="secondary">
              <Plus className="size-4" /> Create
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
