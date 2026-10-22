"use client";

/**
 * WFX2-W save dialog — Watch later + playlists list + create-new, via
 * /api/playlists (the per-user P36 lanes):
 *  - the local "Watch later" row (local:true — the WebFlix list; YouTube's
 *    own WL is a system playlist the official API cannot write) toggles
 *    through POST /api/playlists/watch-later, fully disclosed;
 *  - the user's REAL YouTube playlists toggle through
 *    POST /api/playlists/[id]/items — the official playlistItems lane on
 *    their own connected account;
 *  - create-new rides POST /api/playlists — the official playlists.insert
 *    lane on their own account;
 *  - connected:false → the inline connect prompt (the OAuth start link)
 *    instead of rows, and the create affordance is gated behind it.
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

/** The GET /api/playlists?videoId= envelope (the P36 per-user rows). */
type SaveDialogPayload = {
  playlists: PlaylistDto[];
  /** false → the inline connect prompt replaces the rows */
  connected?: boolean;
  /** the honest machine-stable kind when the connect is missing */
  kind?: string;
  /** the honest notice (connect ask, or a failed official read) */
  notice?: string;
  /** the OAuth start link (same-origin GET carrying the session cookie) */
  connectUrl?: string;
};

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
  const [data, setData] = useState<SaveDialogPayload | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false); // submission in flight
  const [newName, setNewName] = useState("");
  const [newVisibility, setNewVisibility] = useState<"private" | "public" | "unlisted">("private");
  const [busyId, setBusyId] = useState<string | null>(null);

  // conditionally mounted by the parent → fetch once on mount
  useEffect(() => {
    let alive = true;
    api<SaveDialogPayload>(`/api/playlists?videoId=${encodeURIComponent(videoId)}`)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((e) => {
        if (alive) setData({ playlists: [] }); // error → honest empty list + toast
        toast.error(e instanceof Error ? e.message : "Failed to load playlists");
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  const loading = data === null;
  const playlists = data?.playlists ?? [];
  const connected = data?.connected !== false;
  const connectUrl = data?.connectUrl ?? "/api/connection/youtube/oauth/start";

  /** Reconcile one row to the server's membership truth — flips the flag
   * (and adjusts the count) ONLY when the row isn't already there, so an
   * agreeing verdict never double-counts the optimistic delta. */
  const reconcileRow = (id: string, containsVideo: boolean) =>
    setData((d) =>
      d
        ? {
            ...d,
            playlists: (d.playlists ?? []).map((p) => {
              if (p.id !== id || p.containsVideo === containsVideo) return p;
              return {
                ...p,
                containsVideo,
                itemCount: Math.max(0, p.itemCount + (containsVideo ? 1 : -1)),
              };
            }),
          }
        : d,
    );

  const toggle = async (playlist: PlaylistDto) => {
    if (busyId) return;
    setBusyId(playlist.id);
    // optimistic
    reconcileRow(playlist.id, !playlist.containsVideo);
    try {
      if (playlist.local) {
        // the WebFlix-local Watch-later row — the honest local lane (the
        // response's .added is the local truth; the note discloses it)
        const result = await post<{ added: boolean; note?: string }>(
          "/api/playlists/watch-later",
          { videoId },
        );
        reconcileRow(playlist.id, result.added);
        onSavedChange?.(result.added);
        toast.success(result.added ? "Saved to Watch later" : "Removed from Watch later");
      } else {
        const result = await post<{ containsVideo: boolean }>(
          `/api/playlists/${playlist.id}/items`,
          { videoId },
        );
        reconcileRow(playlist.id, result.containsVideo);
        const watchLater = result.containsVideo && playlist.isWatchLater;
        onSavedChange?.(watchLater && result.containsVideo);
        toast.success(
          result.containsVideo ? `Saved to ${playlist.name}` : `Removed from ${playlist.name}`,
        );
      }
    } catch (e) {
      // reconcile with server truth
      reconcileRow(playlist.id, playlist.containsVideo);
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
      setData((d) => (d ? { ...d, playlists: [...(d.playlists ?? []), playlist] } : d));
      setNewName("");
      setShowCreateForm(false);
      toast.success(`Playlist "${playlist.name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create playlist");
    } finally {
      setCreating(false);
    }
  };

  const watchLater = playlists.find((p) => p.isWatchLater);

  // WFX2-P37 — the local Watch-later row, hoisted so it renders in BOTH
  // branches: it is the one save lane that works WITHOUT a YouTube
  // connection (the route now serves it in the not-connected envelope too);
  // the connect prompt stays for the YouTube-side rows only.
  const watchLaterRow = watchLater ? (
    <button
      key={watchLater.id}
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
        {watchLater.containsVideo && <span className="ml-1 text-muted-foreground">Added</span>}
      </span>
      <span className="text-xs text-muted-foreground">{watchLater.itemCount}</span>
    </button>
  ) : null;

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
        ) : !connected ? (
          // WFX2-P36 — no connected YouTube account: the honest connect
          // prompt for the YOUTUBE-side rows (never the operator's playlists).
          // WFX2-P37 — the WebFlix-local Watch-later row serves FIRST.
          <>
            {watchLaterRow}
            <div
              className="rounded-xl border border-border bg-secondary/40 p-4"
              data-testid="save-dialog-connect-prompt"
            >
              <p className="text-sm text-foreground">{data?.notice ?? "Connect your YouTube account to save to your YouTube playlists"}</p>
              <a
                href={connectUrl}
                className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Connect your YouTube account
              </a>
            </div>
          </>
        ) : (
          <>
            {data?.notice && (
              <p className="px-1 pb-1 text-xs leading-snug text-muted-foreground" role="note">
                {data.notice}
              </p>
            )}
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {watchLaterRow}

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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
