"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, X } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P49 — the hub's Continue Watching rail: Netflix's signature personalized
 * row, built from WebFlix's own honest-local play memory (ADR 0002 §5 — the
 * streamed player exposes no playback position, so there is playCount and a
 * last-played time, never a fabricated progress bar).
 *
 * Every card's Play goes STRAIGHT into the in-app watch lane
 * (/netflix/watch/<id>) and the X removes the title from the row (Netflix's
 * own "Remove From Row" affordance). Anonymous viewers and empty rows render
 * nothing — an honest absence, never a placeholder.
 */

export interface ContinueWatchingDTO {
  items: { title: NetflixTitleDTO; lastPlayedAt: string; playCount: number }[];
  source: string;
}

/** Pure relative-time label — pinned by the netflix-ui battery. */
export function lastPlayedLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((now - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

function ContinueCard({
  item,
  onRemoved,
}: {
  item: { title: NetflixTitleDTO; lastPlayedAt: string; playCount: number };
  onRemoved: (netflixId: number) => void;
}) {
  const { title, lastPlayedAt, playCount } = item;
  const [removing, setRemoving] = useState(false);
  const metaBits = [title.releaseYear, title.kind === "series" ? "Series" : "Film"].filter(Boolean);

  const remove = () => {
    if (removing) return;
    setRemoving(true);
    fetch(`/api/netflix/progress?netflixId=${title.netflixId}`, { method: "DELETE" })
      .then((res) => {
        if (res.ok) onRemoved(title.netflixId);
        else setRemoving(false);
      })
      .catch(() => setRemoving(false));
  };

  return (
    <div className="group relative flex w-[200px] shrink-0 flex-col sm:w-[232px]" data-testid="netflix-continue-card">
      <Link
        href={`/netflix/watch/${title.netflixId}`}
        aria-label={`Resume ${title.title} in WebFlix`}
        className="relative block aspect-video w-full overflow-hidden rounded-md bg-[#1b1b22] ring-1 ring-white/10 transition-all duration-200 group-hover:scale-[1.04] group-hover:ring-2 group-hover:ring-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e50914]"
      >
        {title.backdropUrl ?? title.posterUrl ? (
          <img
            src={(title.backdropUrl ?? title.posterUrl) ?? ""}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#1b1b22] to-[#101014] px-3 text-center">
            <span className="line-clamp-3 text-sm font-semibold text-white/80">{title.title}</span>
          </div>
        )}
        {title.logoUrl && (
          <div className="absolute inset-x-0 bottom-0 flex h-2/5 items-end justify-center bg-gradient-to-t from-black/80 to-transparent pb-2">
            <img src={title.logoUrl} alt="" className="max-h-10 w-auto max-w-[85%] object-contain" />
          </div>
        )}
        {/* the resume affordance — the round Play rides the center on hover */}
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-black/60 ring-2 ring-white">
            <Play className="size-4 fill-current text-white" />
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        aria-label={`Remove ${title.title} from Continue Watching`}
        data-testid="netflix-continue-remove"
        className={cn(
          "absolute right-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-sm border border-white/40 bg-black/70 text-white/80 opacity-0 transition-all hover:bg-black hover:text-white focus-visible:opacity-100 group-hover:opacity-100",
          removing && "opacity-100"
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
      <div className="mt-2 min-w-0">
        <p className="truncate text-sm font-medium text-white/95">{title.title}</p>
        <p className="truncate text-xs text-white/50" data-testid="netflix-continue-meta">
          {[
            `Last watched ${lastPlayedLabel(lastPlayedAt)}`,
            playCount > 1 ? `played ${playCount}×` : null,
            ...metaBits.map(String),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

export function ContinueWatchingRail() {
  const { data, reload } = useApi<ContinueWatchingDTO>("/api/netflix/progress");
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  // the row re-reads its own truth after a removal — the last card leaving
  // takes the whole rail with it (honest absence, no placeholder)
  const onRemoved = () => reload();

  return (
    <section aria-label="Continue Watching" className="mt-7 sm:mt-9" data-testid="netflix-continue-rail">
      <div className="flex items-baseline justify-between gap-3 px-4 sm:px-[4vw]">
        <h2 className="text-lg font-semibold text-white sm:text-xl">Continue Watching</h2>
        <span className="text-xs text-white/40">your plays, remembered here in WebFlix</span>
      </div>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4 py-4 sm:gap-3.5 sm:px-[4vw]">
        {items.map((item) => (
          <ContinueCard key={item.title.netflixId} item={item} onRemoved={onRemoved} />
        ))}
      </div>
    </section>
  );
}
