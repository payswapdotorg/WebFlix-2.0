"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 — Worker 4-c (UI lane): the discovery replay
 * shelf (GET /api/live/replays — the newest public ready replays on public
 * rooms, resolved host handles; the server already caps the list).
 *
 * Honest-state rendering: empty/404 renders NOTHING (a discovery shelf with
 * no replays is not a headline), other failures render one honest muted
 * line, and every card shows only server-derived facts — the room title,
 * host name (@handle), the readyAt date and the recorder-reported duration
 * labelled "(approx.)" (durationMs is advisory, never a billing fact).
 * Cards link to the room view; the visual language follows the /live
 * discovery tiles (rounded-xl border bg-card, hover ring).
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import { Clock, Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import type { LiveReplaySummaryDto } from "@/lib/live/types";

type ShelfState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "loaded"; replays: LiveReplaySummaryDto[] };

function ReplayCard({ replay }: { replay: LiveReplaySummaryDto }): JSX.Element {
  return (
    <Link
      href={`/live/${replay.roomId}`}
      data-testid="replay-card"
      className="block rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-ring/40 hover:bg-accent/40"
    >
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {replay.title}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {replay.hostName} · @{replay.hostHandle}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" aria-hidden />
        {replay.durationMs !== null
          ? `${formatDuration(replay.durationMs / 1000)} (approx.)`
          : "Duration unknown"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground/80">
        Ready {formatRelativeDate(replay.readyAt)}
      </p>
    </Link>
  );
}

export interface LiveReplayShelfProps {
  className?: string;
  /**
   * Client-side cap on rendered cards (the API already caps at
   * REPLAY_LIST_MAX); a cap that lands on zero renders nothing.
   */
  limit?: number;
}

export function LiveReplayShelf({
  className,
  limit,
}: LiveReplayShelfProps): JSX.Element | null {
  const [state, setState] = useState<ShelfState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/live/replays", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          setState({ kind: "empty" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          replays?: LiveReplaySummaryDto[];
        } | null;
        if (controller.signal.aborted) return;
        const replays = json?.replays;
        if (!Array.isArray(replays) || replays.length === 0) {
          setState({ kind: "empty" });
          return;
        }
        setState({ kind: "loaded", replays });
      } catch {
        if (controller.signal.aborted) return;
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (state.kind === "empty") return null;

  if (state.kind === "error") {
    return (
      <p
        role="alert"
        data-testid="replay-shelf-error"
        className={cn("text-sm text-muted-foreground", className)}
      >
        Replays couldn&apos;t be loaded right now.
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <section
        aria-label="Replays"
        data-testid="replay-shelf-loading"
        aria-busy="true"
        className={cn("min-w-0", className)}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  const replays =
    typeof limit === "number" ? state.replays.slice(0, Math.max(0, limit)) : state.replays;
  if (replays.length === 0) return null;

  return (
    <section
      aria-label="Replays"
      data-testid="live-replay-shelf"
      className={cn("min-w-0", className)}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Video className="size-4 text-muted-foreground" aria-hidden />
        Replays
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {replays.map((replay) => (
          <ReplayCard key={`${replay.roomId}-${replay.sessionId}`} replay={replay} />
        ))}
      </div>
    </section>
  );
}
