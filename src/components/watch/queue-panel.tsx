"use client";

/**
 * WFX2-P4-QT — the queue list panel.
 *
 * The session view of the WL-backed queue: ordered items, the count badge,
 * per-item remove-from-queue (the REAL WL remove — honest outcomes only),
 * and now-playing context for the current watch page's video. Reorder is
 * out of scope (per the lane contract). Placement: the watch page's primary
 * column (the miniplayer chrome itself is player-lane-owned — see the lane
 * report's seam request for the global mount).
 *
 * WFX2-P5-MQ (additive): currentVideoId widens to string | null — the
 * miniplayer queue drawer reuses this panel and passes the player host's
 * now-playing id (null while no player lives). Watch-page callers pass a
 * string exactly as before (the widening is backward-compatible); the
 * now-playing highlight simply matches nothing while it is null.
 */
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ListVideo, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQueueStore, type QueueItem } from "@/lib/queue/queue-store";
import { removeFromQueue } from "@/lib/queue/queue-actions";
import { formatDuration } from "@/lib/watch/format";

export function QueuePanel({ currentVideoId }: { currentVideoId: string | null }) {
  const items = useQueueStore((s) => s.items);
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const remove = async (videoId: string) => {
    if (busyId) return;
    setBusyId(videoId);
    try {
      const outcome = await removeFromQueue(videoId);
      // honest outcomes only — a failed WL remove keeps the item queued
      if (outcome.status === "removed") toast.success("Removed from queue");
      else if (outcome.status === "error") toast.error(outcome.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Queue"
      className="mt-3 overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ListVideo className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Queue</h2>
        {/* the badge/count */}
        <span
          aria-label="Videos in queue"
          className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground"
        >
          {items.length}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse queue" : "Expand queue"}
          className="ml-auto flex size-8 items-center justify-center rounded-full transition hover:bg-accent"
        >
          {open ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {open && (
        <div
          className="max-h-96 overflow-y-auto px-2 py-2"
          role="list"
          aria-label="Queue videos"
        >
          {items.map((item) => (
            <QueueRow
              key={item.videoId}
              item={item}
              playing={item.videoId === currentVideoId}
              busy={busyId === item.videoId}
              onRemove={() => {
                void remove(item.videoId);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function QueueRow({
  item,
  playing,
  busy,
  onRemove,
}: {
  item: QueueItem;
  playing: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        "flex items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-accent/60",
        playing && "bg-secondary/70"
      )}
    >
      <Link
        href={`/watch/${item.videoId}`}
        className="relative block w-28 shrink-0 overflow-hidden rounded-lg bg-secondary"
        aria-label={`Watch ${item.title}`}
      >
        <span className="block aspect-video w-full">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </span>
        {item.durationSec > 0 && (
          <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
            {formatDuration(item.durationSec)}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/watch/${item.videoId}`} className="block">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</p>
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.channelName}
          {playing && (
            <span className="ml-1.5 rounded-sm bg-foreground/10 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
              Now playing
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove ${item.title} from queue`}
        title="Remove from queue"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
