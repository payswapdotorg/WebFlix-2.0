"use client";

/**
 * REA-1 G16/G19 — the playlist queue panel (the watch page's secondary
 * column, youtube.com's placement — the queue panel renders ABOVE the
 * related rail).
 *
 * youtube.com's measured presentation (2026-10-17): the panel header (list
 * title + owner + the "N / M" position counter + the collapse chevron), the
 * ordered rows (thumbnail, title, channel, duration, the "▶"/"Now playing"
 * marker on the current row), lazy-loaded continuation for the infinite
 * family (mixes). The special lists (WL/LL) degrade with the honest P22-B
 * states. Clicking a row jumps within the SAME list context (the list +
 * shuffle params ride the href — the queue follows).
 */
import { useState } from "react";
import Link from "next/link";
import { AudioLines, ChevronDown, ChevronUp, Clock, Infinity as InfinityIcon, Loader2, ListVideo } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import type { WatchQueueDto } from "@/lib/youtube/watch-queue";

export interface PlaylistQueuePanelProps {
  queue: WatchQueueDto;
  /** the current watch page's video (the now-playing row locator). */
  videoId: string;
  /** the list context riding every row href (youtube.com's ?list= semantics). */
  listId: string;
  /** the deterministic shuffle seed riding the hrefs when the queue is shuffled. */
  shuffleSeed: number | null;
  /** the current position (the route's post-shuffle location of videoId). */
  currentIndex: number;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

/** The href that keeps the queue context (list + shuffle params). */
export function queueWatchHref(videoId: string, listId: string, shuffleSeed: number | null): string {
  const params = new URLSearchParams({ list: listId });
  if (shuffleSeed !== null) params.set("shuffle", String(shuffleSeed));
  return `/watch/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export function PlaylistQueuePanel({
  queue,
  videoId,
  listId,
  shuffleSeed,
  currentIndex,
  loadingMore,
  hasMore,
  onLoadMore,
}: PlaylistQueuePanelProps) {
  const [open, setOpen] = useState(true);
  const { playlist, items } = queue;

  // the honest special-list states (WL/LL — the P22-B wording family)
  if (queue.loginRequired) {
    return (
      <section
        aria-label="Playlist queue unavailable"
        data-testid="playlist-queue-no-session"
        className="overflow-hidden rounded-xl border border-border bg-card/40"
      >
        <PanelHeader
          title={playlist.title}
          ownerName={playlist.ownerName}
          position={null}
          total={null}
          isInfinite={false}
          open={false}
          onToggle={() => {}}
        />
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          This queue is personal to the YouTube account this WebFlix deployment rides (single-tenant
          live mode). No YouTube session is connected yet — your WebFlix sign-in is fine; the
          operator session (YT_COOKIES) needs to be connected.
        </p>
      </section>
    );
  }
  if (queue.unavailable) {
    return (
      <section
        aria-label="Playlist queue unavailable"
        data-testid="playlist-queue-unavailable"
        className="overflow-hidden rounded-xl border border-border bg-card/40"
      >
        <PanelHeader
          title={playlist.title}
          ownerName={playlist.ownerName}
          position={null}
          total={null}
          isInfinite={false}
          open={false}
          onToggle={() => {}}
        />
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          The YouTube session is connected, but it didn&apos;t return this list — it may be empty on
          YouTube, or YouTube didn&apos;t serve it to WebFlix.
        </p>
      </section>
    );
  }

  const position = currentIndex >= 0 ? currentIndex + 1 : null;

  return (
    <section
      aria-label="Queue"
      data-testid="playlist-queue-panel"
      className="overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <PanelHeader
        title={playlist.title}
        ownerName={playlist.ownerName}
        position={position}
        total={playlist.isInfinite ? null : items.length}
        isInfinite={playlist.isInfinite}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      {open && (
        <>
          <div
            className="max-h-96 overflow-y-auto px-2 py-2 slim-scrollbar"
            role="list"
            aria-label="Queue videos"
          >
            {items.map((item, i) => (
              <QueueRow
                key={`${item.videoId}-${i}`}
                item={item}
                index={i}
                playing={item.videoId === videoId}
                listId={listId}
                shuffleSeed={shuffleSeed}
              />
            ))}
          </div>
          {hasMore && (
            <div className="border-t border-border/60 px-2 py-2">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/70 disabled:opacity-60"
                aria-label="Load more queue videos"
                data-testid="playlist-queue-more"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PanelHeader({
  title,
  ownerName,
  position,
  total,
  isInfinite,
  open,
  onToggle,
}: {
  title: string;
  ownerName: string | null;
  position: number | null;
  total: number | null;
  isInfinite: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <header className="flex items-start gap-2 border-b border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
          {isInfinite ? (
            <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ListVideo className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="truncate" data-testid="playlist-queue-title">
            {title}
          </span>
        </h2>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {ownerName && <span className="truncate">{ownerName}</span>}
          {ownerName && " · "}
          {position !== null && (
            <span className="tabular-nums" data-testid="playlist-queue-position">
              {position}
              {total !== null ? ` / ${total}` : ""}
              {isInfinite && (
                <InfinityIcon className="ml-0.5 inline size-3 align-[-1px]" aria-label="infinite" />
              )}
            </span>
          )}
          {position === null && total !== null && (
            <span className="tabular-nums">
              {total} video{total === 1 ? "" : "s"}
            </span>
          )}
          {position === null && total === null && isInfinite && (
            <span className="inline-flex items-center gap-0.5">
              <InfinityIcon className="size-3" aria-hidden /> infinite
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Collapse queue" : "Expand queue"}
        className="flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-accent"
      >
        {open ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>
    </header>
  );
}

function QueueRow({
  item,
  index,
  playing,
  listId,
  shuffleSeed,
}: {
  item: WatchQueueDto["items"][number];
  index: number;
  playing: boolean;
  listId: string;
  shuffleSeed: number | null;
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
        href={queueWatchHref(item.videoId, listId, shuffleSeed)}
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
        <Link
          href={queueWatchHref(item.videoId, listId, shuffleSeed)}
          className="block"
          data-testid={playing ? "playlist-queue-now-playing" : undefined}
        >
          <p className={cn("line-clamp-2 text-sm font-medium leading-snug", playing && "text-primary")}>
            {item.title}
          </p>
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.channelName}
          {playing ? (
            <span className="ml-1.5 rounded-sm bg-foreground/10 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
              Now playing
            </span>
          ) : (
            <span className="ml-1.5 tabular-nums" aria-label={`Position ${index + 1}`}>
              {index + 1}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
