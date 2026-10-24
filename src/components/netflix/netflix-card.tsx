"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P42 — one Netflix title card. Netflix's own Top 10 site look: 16:9 boxart,
 * the big outlined rank numeral riding the card's left edge on Top-10 rails.
 * Cards link INTO the WebFlix hub (`/netflix/t/<id>`); the deep link to
 * Netflix's player lives on the title page + hand-off dialog (ADR 0002 §1).
 */
export function NetflixCard({
  title,
  rank,
  className,
}: {
  title: NetflixTitleDTO;
  /** 1-based rank for the Top-10 numeral (null hides it). */
  rank?: number | null;
  className?: string;
}) {
  const rankOf = rank ?? title.weeklyRank ?? title.allTimeRank ?? null;
  return (
    <Link
      href={`/netflix/t/${title.netflixId}`}
      aria-label={`${title.title}${rankOf ? ` — number ${rankOf}` : ""}`}
      className={cn(
        "group relative flex w-[220px] shrink-0 flex-col focus-visible:outline-none sm:w-[240px]",
        className
      )}
    >
      <div className="flex items-end gap-1">
        {rankOf !== null && (
          <span
            aria-hidden="true"
            className="-mr-3 select-none pb-1 text-[64px] font-black leading-[0.8] text-[#0b0b0f] [-webkit-text-stroke:2.5px_#5a5a66] group-hover:[-webkit-text-stroke:2.5px_#e50914]"
          >
            {rankOf}
          </span>
        )}
        <div
          data-thumb-anchor=""
          className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#1b1b22] ring-1 ring-white/10 transition-transform duration-200 group-hover:scale-[1.03] group-focus-visible:ring-2 group-focus-visible:ring-[#e50914]"
        >
          {title.posterUrl ? (
            <img
              src={title.posterUrl}
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
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          )}
          {title.maturityRating && (
            <span className="absolute right-1.5 top-1.5 rounded border border-white/30 bg-black/60 px-1 py-0.5 text-[10px] font-semibold uppercase text-white/90">
              {title.maturityRating}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 min-w-0">
        <p className="truncate text-sm font-medium text-white/95">{title.title}</p>
        <p className="truncate text-xs text-white/50">
          {[title.releaseYear, title.kind === "series" ? "Series" : "Film"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}
