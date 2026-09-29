"use client";

import { useState } from "react";
import Link from "next/link";
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { watchProgress } from "@/lib/format";
import type { ContinueVideoDTO, HistoryGroupDTO } from "@/lib/types";

/** History — your ViewEvents, latest-per-video, grouped by day (real DB). */
export default function HistoryPage() {
  const { data, loading, error, reload } = useApi<HistoryGroupDTO[]>("/api/history");
  const [clearing, setClearing] = useState(false);

  async function clearHistory() {
    setClearing(true);
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Watch history cleared");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear history");
    } finally {
      setClearing(false);
    }
  }

  const total = (data ?? []).reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <HistoryIcon className="size-7 text-yt-red" /> Watch history
        </h1>
        {total > 0 && (
          <Button
            variant="ghost"
            onClick={clearHistory}
            disabled={clearing}
            className="rounded-full text-sm text-muted-foreground hover:text-foreground"
            aria-label="Clear all watch history"
          >
            <Trash2 className="mr-2 size-4" /> Clear all
          </Button>
        )}
      </div>

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
      {data && total === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No watch history yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Videos you watch are tracked in the database — watch something from{" "}
            <Link href="/" className="text-foreground underline underline-offset-2">
              the home feed
            </Link>
            .
          </p>
        </div>
      )}

      {(data ?? []).map((group) => (
        <section key={group.label} aria-label={`${group.label} history`} className="mb-6">
          <h2 className="px-4 pb-2 pt-4 text-base font-semibold text-foreground sm:px-6">
            {group.label}
          </h2>
          <div className="space-y-2">
            {group.items.map((item: ContinueVideoDTO) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoryRow({ item }: { item: ContinueVideoDTO }) {
  const progress = watchProgress(item.watchedSec, item.durationSec);
  const finished = progress >= 0.95;
  return (
    <div className="px-4 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {finished
            ? "Watched"
            : `Stopped at ${Math.floor(item.watchedSec / 60)}:${String(item.watchedSec % 60).padStart(2, "0")}`}
        </p>
      </div>
      <VideoCard video={item} />
    </div>
  );
}
