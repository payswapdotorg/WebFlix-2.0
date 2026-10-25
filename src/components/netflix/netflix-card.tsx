"use client";

import Link from "next/link";
import { Info, Play, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyListToggle } from "./my-list-button";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P45 — one Netflix title card, Netflix's own row look, with the direct
 * in-app play path built in.
 *
 * Structure: the art is a Link into the WebFlix title page; the hover
 * overlay's Play circle is a SIBLING Link into the in-app watch lane
 * (/netflix/watch/<id> — the streamed Netflix player) and the + circle is a
 * sibling button (sibling-overlay pattern — no nested anchors). Hover/focus
 * expands the card in place with the info sheet beneath the buttons.
 *
 * `ranked`: the Top-10 shape — portrait art (the 1200×675 backdrop,
 * center-cropped) with the giant outlined rank numeral riding the card's
 * left edge, exactly the silhouette Netflix's Top 10 rows have.
 */
export function NetflixCard({
  title,
  rank,
  variant = "default",
  className,
  onListChanged,
}: {
  title: NetflixTitleDTO;
  /** 1-based rank for the Top-10 numeral (null hides it). */
  rank?: number | null;
  variant?: "default" | "ranked";
  className?: string;
  /** P51-AUDIT (S3): fired after a save/unsave so hosting rails can re-read
   * their truth (My List removes the card; Continue Watching reorders). */
  onListChanged?: (next: boolean) => void;
}) {
  const rankOf = rank ?? title.weeklyRank ?? title.allTimeRank ?? null;
  const ranked = variant === "ranked" && rankOf !== null;
  const metaBits = [title.releaseYear, title.maturityRating ?? undefined].filter(Boolean);

  return (
    <div
      className={cn(
        "group relative flex shrink-0 flex-col",
        ranked ? "w-[150px] sm:w-[170px]" : "w-[200px] sm:w-[232px]",
        className
      )}
      data-testid="netflix-card"
    >
      <div className={cn("flex items-end", ranked ? "gap-0" : "gap-1")}>
        {ranked && (
          <span
            aria-hidden="true"
            className="-mr-4 z-10 select-none text-[96px] font-black leading-[0.78] text-[#0a0a0c] [-webkit-text-stroke:3px_#575760] sm:text-[110px] group-hover:[-webkit-text-stroke:3px_#e50914]"
          >
            {rankOf}
          </span>
        )}
        <Link
          href={`/netflix/t/${title.netflixId}`}
          aria-label={`${title.title} — details${rankOf ? `, number ${rankOf} today` : ""}`}
          className={cn(
            "relative block overflow-hidden rounded-md bg-[#1b1b22] ring-1 ring-white/10 transition-all duration-200 group-hover:ring-2 group-hover:ring-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e50914]",
            ranked ? "aspect-[2/3] w-full" : "aspect-video w-full",
            !ranked && "group-hover:scale-[1.08] group-focus-within:scale-[1.08]"
          )}
        >
          {(ranked ? title.backdropUrl ?? title.posterUrl : title.posterUrl) ? (
            <img
              // P51-AUDIT (S5): the src must ride the SAME fallback the
              // condition above checks — a ranked card with poster-but-no-
              // backdrop used to render src=""
              src={(ranked ? title.backdropUrl ?? title.posterUrl : title.posterUrl) ?? ""}
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
          {title.maturityRating && (
            <span className="absolute right-1.5 top-1.5 rounded border border-white/30 bg-black/60 px-1 py-0.5 text-[10px] font-semibold uppercase text-white/90">
              {title.maturityRating}
            </span>
          )}
        </Link>
      </div>

      {/* the hover overlay — a sibling of the art link (no nested anchors):
          the white Play circle enters the in-app watch lane directly */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-2 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
        style={{ paddingBottom: ranked ? "0.625rem" : undefined }}
      >
        <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2.5 pt-8">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/netflix/watch/${title.netflixId}`}
              data-testid="netflix-card-play"
              aria-label={`Play ${title.title} in WebFlix`}
              className="pointer-events-auto flex size-7 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Play className="size-3.5 fill-current" aria-hidden="true" />
            </Link>
            <MyListPlus netflixId={title.netflixId} titleName={title.title} onChanged={onListChanged} />
            <span
              aria-hidden="true"
              className="ml-auto flex size-7 items-center justify-center rounded-full border border-white/40 text-white/90"
            >
              <Info className="size-3.5" />
            </span>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/75">
            {/* P51-AUDIT (S6): the badge answers the title's own provenance —
                an all-time Most-Popular title is not a "Top 10" row this week,
                and a mirror-only row with neither rank stays silent */}
            {(title.weeklyRank !== null || title.allTimeRank !== null) && (
              <span className="font-semibold text-[#46d369]">
                {title.weeklyRank !== null ? "Top 10" : "Most Popular"}
              </span>
            )}
            {metaBits.length > 0 && <span className="truncate">{metaBits.join(" · ")}</span>}
          </p>
          {title.synopsis && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/70">
              {title.synopsis}
            </p>
          )}
        </div>
      </div>

      {!ranked && (
        <div className="mt-2 min-w-0">
          <p className="truncate text-sm font-medium text-white/95">{title.title}</p>
          <p className="truncate text-xs text-white/50">
            {[title.releaseYear, title.kind === "series" ? "Series" : "Film"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {ranked && (
        <p className="mt-2 min-w-0 truncate text-center text-xs font-medium text-white/90">
          {title.title}
        </p>
      )}
    </div>
  );
}

/**
 * The + circle on the hover sheet — the shared My-List toggle behavior in a
 * compact visual. Kept separate from MyListButton (the full-size buttons
 * carry their own labels and layouts).
 */
function MyListPlus({
  netflixId,
  titleName,
  onChanged,
}: {
  netflixId: number;
  titleName: string;
  onChanged?: (next: boolean) => void;
}) {
  const { saved, busy, toggle } = useMyListToggle(netflixId, titleName, { onChanged });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${titleName} from My List` : `Add ${titleName} to My List`}
      data-testid="netflix-card-add"
      className={cn(
        "pointer-events-auto flex size-7 items-center justify-center rounded-full border bg-black/60 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60",
        saved ? "border-white text-white" : "border-white/40 text-white/90"
      )}
    >
      {saved ? <span aria-hidden="true" className="text-xs font-black">✓</span> : <Plus className="size-3.5" />}
    </button>
  );
}
