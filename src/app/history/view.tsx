"use client";

import { useState } from "react";
import Link from "next/link";
import { History as HistoryIcon, MoreVertical, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { watchProgress } from "@/lib/format";
import type { ContinueVideoDTO, HistoryGroupDTO } from "@/lib/types";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

type HistoryPayload = {
  groups: HistoryGroupDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  watchHistoryPaused: boolean | null;
  searchHistoryPaused: boolean | null;
  total: number;
  session: boolean;
};

/** History — the operator's REAL YouTube watch history (SSR /feed/history).
 * WFX2-P2-AU: guests get the youtube.com signed-out screen (the gate). */
export default function HistoryPage() {
  return (
    <PersonalSurfaceGate surface="history">
      <HistoryContent />
    </PersonalSurfaceGate>
  );
}

function HistoryContent() {
  const { data, loading, error, reload } = useApi<HistoryPayload>("/api/history");
  const [clearing, setClearing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [extraGroups, setExtraGroups] = useState<HistoryGroupDTO[]>([]);
  const [paging, setPaging] = useState<{ cursor: string | null; loading: boolean }>({
    cursor: null,
    loading: false,
  });

  const total = data?.total ?? 0;
  const paused = data?.watchHistoryPaused ?? null;

  async function clearHistory() {
    setClearing(true);
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Watch history cleared");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear history");
    } finally {
      setClearing(false);
    }
  }

  async function togglePause() {
    setPausing(true);
    try {
      const res = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !(paused ?? false), type: "watch" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; effect?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(body.effect === "paused" ? "Watch history paused" : "Watch history resumed");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle history");
    } finally {
      setPausing(false);
    }
  }

  async function removeFromHistory(videoId: string) {
    try {
      const res = await fetch(`/api/history?videoId=${encodeURIComponent(videoId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Removed from watch history");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  async function loadMore() {
    const cursor = paging.cursor ?? data?.nextCursor ?? null;
    if (!cursor) return;
    setPaging({ cursor, loading: true });
    try {
      const res = await fetch(`/api/history?cursor=${encodeURIComponent(cursor)}`);
      const body = (await res.json()) as HistoryPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // append (merge same-label day groups like the first page does)
      setExtraGroups((prev) => {
        const merged = prev.map((g) => ({ ...g, items: [...g.items] }));
        for (const g of body.groups) {
          const hit = merged.find((m) => m.label === g.label);
          if (hit) hit.items.push(...g.items);
          else merged.push({ ...g, items: [...g.items] });
        }
        return merged;
      });
      setPaging({ cursor: body.nextCursor, loading: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
      setPaging({ cursor, loading: false });
    }
  }

  const hasMore = Boolean(paging.cursor ?? data?.nextCursor);

  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <HistoryIcon className="size-7 text-yt-red" /> Watch history
        </h1>
        {total > 0 && (
          <div className="flex items-center gap-2">
            {paused !== null && (
              <Button
                variant="ghost"
                onClick={togglePause}
                disabled={pausing}
                className="rounded-full text-sm text-muted-foreground hover:text-foreground"
                aria-label={paused ? "Resume watch history" : "Pause watch history"}
              >
                {paused ? (
                  <Play className="mr-2 size-4" />
                ) : (
                  <Pause className="mr-2 size-4" />
                )}
                {paused ? "Resume history" : "Pause history"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={clearHistory}
              disabled={clearing}
              className="rounded-full text-sm text-muted-foreground hover:text-foreground"
              aria-label="Clear all watch history"
            >
              <Trash2 className="mr-2 size-4" /> Clear all
            </Button>
          </div>
        )}
      </div>

      {paused === true && total > 0 && (
        <p className="px-4 pb-2 text-xs text-muted-foreground sm:px-6" role="status">
          Watch history is paused — videos you watch won&apos;t be recorded until you resume.
        </p>
      )}

      {loading &&
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 sm:px-6" aria-hidden="true">
            <Skeleton className="aspect-video w-[160px] shrink-0 rounded-xl sm:w-[246px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          </div>
        ))}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.loginRequired && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Sign in to see your watch history</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch history is personal — it reads from the YouTube account this WebFlix
            session rides (single-tenant live mode). No session is configured right now.
          </p>
        </div>
      )}
      {data && !data.loginRequired && total === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No watch history yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Videos you watch are recorded by YouTube itself — watch something from{" "}
            <Link href="/" className="text-foreground underline underline-offset-2">
              the home feed
            </Link>{" "}
            and it lands here.
          </p>
        </div>
      )}

      {(data?.groups ?? []).map((group) => (
        <section key={group.label} aria-label={`${group.label} history`} className="mb-6">
          <h2 className="px-4 pb-2 pt-4 text-base font-semibold text-foreground sm:px-6">
            {group.label}
          </h2>
          <div className="space-y-2">
            {group.items.map((item: ContinueVideoDTO) => (
              <HistoryRow key={item.id} item={item} onRemove={() => removeFromHistory(item.id)} />
            ))}
          </div>
        </section>
      ))}

      {extraGroups.map((group) => (
        <section key={`more-${group.label}`} aria-label={`${group.label} history (earlier)`} className="mb-6">
          <h2 className="px-4 pb-2 pt-4 text-base font-semibold text-foreground sm:px-6">
            {group.label}
          </h2>
          <div className="space-y-2">
            {group.items.map((item: ContinueVideoDTO) => (
              <HistoryRow key={item.id} item={item} onRemove={() => removeFromHistory(item.id)} />
            ))}
          </div>
        </section>
      ))}

      {hasMore && (
        <div className="flex justify-center px-4 py-6 sm:px-6">
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={loadMore}
            disabled={paging.loading}
          >
            {paging.loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item, onRemove }: { item: ContinueVideoDTO; onRemove: () => void }) {
  const progress = watchProgress(item.watchedSec, item.durationSec ?? 0);
  const finished = progress >= 0.95;
  return (
    <div className="group/row px-4 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {finished
            ? "Watched"
            : `Stopped at ${Math.floor(item.watchedSec / 60)}:${String(item.watchedSec % 60).padStart(2, "0")}`}
        </p>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
                aria-label={`Actions for ${item.title}`}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onRemove}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" /> Remove from watch history
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <VideoCard video={item} />
    </div>
  );
}
