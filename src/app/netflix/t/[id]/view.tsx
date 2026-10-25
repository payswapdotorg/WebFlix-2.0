"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Play } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayHandoffDialog } from "@/components/netflix/play-handoff";
import { MyListButton } from "@/components/netflix/my-list-button";
import { NetflixCard } from "@/components/netflix/netflix-card";
import { SearchVideoCard } from "@/components/search/search-video-card";
import type { NetflixTitlePageDTO } from "@/lib/netflix/types";
import type { SearchPageDTO } from "@/lib/types";

/**
 * P42 — the Netflix title page: metadata (Netflix's own published data), the
 * play hand-off (ADR 0002 §1), the WebFlix-local My List toggle, the in-app
 * trailer through the EXISTING YouTube lane (WebFlix's own player — the only
 * kind of in-app Netflix-adjacent playback that is honest), where-it-ranks,
 * and same-pool "More like this".
 */
export default function NetflixTitleView() {
  const params = useParams<{ id: string }>();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const netflixId = Number(rawId);
  const valid = Number.isInteger(netflixId) && netflixId > 0;

  const { data, loading, error } = useApi<NetflixTitlePageDTO>(
    valid ? `/api/netflix/title/${netflixId}` : null
  );
  const [handoffOpen, setHandoffOpen] = useState(false);
  // P51-AUDIT (S6): one broken-art flag used to hide BOTH the backdrop and a
  // healthy logo — they degrade independently now.
  const [backdropBroken, setBackdropBroken] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  const title = data?.title ?? null;
  const trailerQuery = title
    ? `${title.title}${title.releaseYear ? ` ${title.releaseYear}` : ""} official trailer`
    : null;
  const { data: trailerData } = useApi<SearchPageDTO>(
    trailerQuery ? `/api/search?q=${encodeURIComponent(trailerQuery)}&type=video` : null
  );
  const trailer = trailerData?.videos?.filter((v) => !v.isShort)?.[0] ?? null;

  if (!valid || error) {
    return (
      <div className="min-h-[60vh] bg-[#0a0a0c] px-4 py-24 text-center text-white sm:px-6">
        <p className="text-lg font-semibold">{error ?? "Invalid Netflix title id"}</p>
        <p className="mt-2 text-sm text-white/50">
          {error && /not in the tracked|not found|404/i.test(error)
            ? "This title is not in Netflix's currently tracked Top 10 universe — the hub only carries what Netflix itself publishes."
            : "The title could not be loaded."}
        </p>
        <Link
          href="/netflix"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-5 text-sm font-semibold hover:bg-[#c4080f]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the Netflix hub
        </Link>
      </div>
    );
  }

  if (loading || !data || !title) {
    return (
      <div aria-busy="true" className="min-h-[60vh] bg-[#0a0a0c] px-4 py-6 sm:px-6" data-testid="netflix-title-skeleton">
        <Skeleton className="h-[320px] w-full rounded-2xl bg-white/5 sm:h-[420px]" />
        <Skeleton className="mt-6 h-8 w-2/3 max-w-xl bg-white/5" />
        <Skeleton className="mt-3 h-5 w-1/3 bg-white/5" />
        <Skeleton className="mt-6 h-20 w-full max-w-2xl bg-white/5" />
      </div>
    );
  }

  const metaBits = [
    title.releaseYear ? String(title.releaseYear) : null,
    title.kind === "series" ? "Series" : "Film",
    title.maturityRating,
    title.weeksInTop10
      ? `${title.weeksInTop10} ${title.weeksInTop10 === 1 ? "week" : "weeks"} in the Top 10`
      : null,
    title.weeklyHoursViewed ? `${(title.weeklyHoursViewed / 1_000_000).toFixed(1)}M hours viewed this week` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-[70vh] bg-[#0a0a0c] pb-16 text-white">
      {/* the backdrop hero */}
      <div className="relative mx-4 mt-4 overflow-hidden rounded-2xl sm:mx-6" data-testid="netflix-title-hero">
        <div className="relative min-h-[300px] bg-gradient-to-br from-[#1b1b22] to-[#101014] sm:min-h-[420px]">
          {title.backdropUrl && !backdropBroken && (
            <img
              src={title.backdropUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setBackdropBroken(true)}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/50 to-transparent" />
          <div className="relative flex h-full flex-col justify-end gap-3 p-5 sm:p-8">
            <Link
              href="/netflix"
              className="flex w-fit items-center gap-1.5 text-xs text-white/60 hover:text-white"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Netflix hub
            </Link>
            {title.logoUrl && !logoBroken ? (
              <img
                src={title.logoUrl}
                alt={title.title}
                className="max-h-16 w-auto max-w-[70%] object-contain drop-shadow-lg"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <h1 className="text-2xl font-black drop-shadow sm:text-4xl">{title.title}</h1>
            )}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/75">
              {metaBits.map((bit) => (
                <span key={bit}>{bit}</span>
              ))}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={`/netflix/watch/${title.netflixId}`}
                data-testid="netflix-title-play"
                className="flex h-11 items-center gap-2 rounded-md bg-[#e50914] px-6 text-sm font-semibold transition-colors hover:bg-[#c4080f]"
              >
                <Play className="size-4 fill-current" aria-hidden="true" />
                Play
              </Link>
              <button
                type="button"
                onClick={() => setHandoffOpen(true)}
                data-testid="netflix-title-handoff"
                className="flex h-11 items-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium text-white/85 transition-colors hover:bg-white/5"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open on netflix.com
              </button>
              <MyListButton
                netflixId={title.netflixId}
                titleName={title.title}
                initial={data.myList}
                variant="hero"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {title.synopsis && (
          <p className="pt-6 text-sm leading-relaxed text-white/85 sm:text-base">{title.synopsis}</p>
        )}

        {/* where it ranks — the honest per-country truth the pools carry */}
        {data.countryRanks.length > 0 && (
          <section className="pt-6" aria-label="Where it ranks">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">Where it ranks</h2>
            <div className="mt-3 flex flex-wrap gap-2" data-testid="netflix-country-ranks">
              {data.countryRanks.slice(0, 18).map(({ countryId, rank }) => (
                <span
                  key={countryId}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    rank === 1 ? "bg-[#e50914] text-white" : "bg-white/10 text-white/75"
                  }`}
                >
                  {countryId} #{rank}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* the in-app trailer — WebFlix's own YouTube player lane */}
        <section className="pt-8" aria-label="Trailer">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
            Watch the trailer right here
          </h2>
          {trailer ? (
            <div className="mt-3 max-w-2xl" data-testid="netflix-trailer-card">
              <SearchVideoCard video={trailer} />
              <p className="mt-2 text-xs text-white/40">
                Official trailers ride WebFlix&apos;s YouTube player — full playback stays
                with Netflix.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/50">
              No trailer surfaced for this title yet — the YouTube lane answers only with
              real results.
            </p>
          )}
        </section>

        {/* more like this — same pool neighbors */}
        {data.relatedTitles.length > 0 && (
          <section className="pt-8" aria-label="More like this">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">More like this</h2>
            <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pb-2">
              {data.relatedTitles.map((rel) => (
                <NetflixCard key={rel.netflixId} title={rel} />
              ))}
            </div>
          </section>
        )}
      </div>

      <PlayHandoffDialog title={title} open={handoffOpen} onOpenChange={setHandoffOpen} />
    </div>
  );
}
