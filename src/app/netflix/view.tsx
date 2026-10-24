"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { NetflixBillboard } from "@/components/netflix/netflix-hero";
import { NetflixRail } from "@/components/netflix/netflix-rail";
import { NetflixCard } from "@/components/netflix/netflix-card";
import { ContinueWatchingRail } from "@/components/netflix/continue-watching-rail";
import { cn } from "@/lib/utils";
import type { NetflixHomeDTO, NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P42 — the Netflix hub. Netflix's own public Top 10 + Most Popular data
 * (ADR 0002 §2), browsed WebFlix-natively.
 *
 * P45 — the Netflix-grade surface: the rotating billboard, the Top 10 rows
 * with the giant numerals, the hover-expand cards, and the Netflix-style
 * sub-nav (All / Movies / TV). Every Play enters the in-app watch lane
 * (/netflix/watch/<id> — the streamed Netflix player); Netflix Live stays
 * one click away.
 */

const COUNTRIES = [
  { id: "Global", label: "Global" },
  { id: "US", label: "United States" },
] as const;

const KIND_TABS = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV Shows" },
] as const;

type KindTab = (typeof KIND_TABS)[number]["id"];

interface MyListDTO {
  items: NetflixTitleDTO[];
}

function MyListRail() {
  const { data } = useApi<MyListDTO>("/api/netflix/my-list");
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label="My Netflix List" className="mt-7 sm:mt-9" data-testid="netflix-my-list-rail">
      <div className="flex items-baseline justify-between gap-3 px-4 sm:px-[4vw]">
        <h2 className="text-lg font-semibold text-white sm:text-xl">My List</h2>
        <span className="text-xs text-white/40">saved in WebFlix</span>
      </div>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4 py-4 sm:gap-3.5 sm:px-[4vw]">
        {items.map((title) => (
          <NetflixCard key={title.netflixId} title={title} />
        ))}
      </div>
    </section>
  );
}

function HubContent() {
  const [country, setCountry] = useState<string>("Global");
  const [kind, setKind] = useState<KindTab>("all");
  const { data, loading, error } = useApi<NetflixHomeDTO>(`/api/netflix?country=${country}`);

  const rails = useMemo(
    () => (data?.rails ?? []).filter((r) => (kind === "all" ? true : r.kind === kind)),
    [data, kind]
  );
  const billboardTitles = useMemo(
    () =>
      (data?.rails ?? [])
        .filter((r) => r.ranking === "weekly" && (kind === "all" || r.kind === kind))
        .flatMap((r) => r.titles)
        .sort((a, b) => (a.weeklyRank ?? 99) - (b.weeklyRank ?? 99))
        .slice(0, 5),
    [data, kind]
  );

  return (
    <div className="min-h-[70vh] bg-[#0a0a0c] pb-16 text-white">
      <h1 className="sr-only">Netflix on WebFlix</h1>
      {loading && (
        <div aria-busy="true" data-testid="netflix-hub-skeleton">
          <div className="px-0 pt-0">
            <Skeleton className="h-[380px] w-full rounded-none bg-white/5 sm:h-[480px]" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="mt-9 px-4 sm:px-6">
              <Skeleton className="h-6 w-56 bg-white/5" />
              <div className="mt-3 flex gap-4 overflow-hidden">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="aspect-video w-[240px] shrink-0 rounded-lg bg-white/5" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="px-4 py-16 text-center text-sm text-white/60 sm:px-6">
          {error} — the hub retries on reload.
        </p>
      )}

      {data?.unavailable && (
        <div className="mx-4 mt-6 rounded-xl border border-white/10 bg-white/5 p-6 text-center sm:mx-6" data-testid="netflix-unavailable">
          <p className="text-sm font-medium text-white/80">Netflix data is unavailable right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/50">{data.unavailableReason}</p>
          <p className="mt-3 text-xs text-white/40">
            WebFlix shows Netflix&apos;s own published Top 10 data — when Netflix&apos;s edge
            won&apos;t serve it, the hub stays empty rather than showing fake rows.
          </p>
        </div>
      )}

      {data && !data.unavailable && (
        <>
          {/* the billboard — full-bleed, no header box above it (Netflix's own landing) */}
          <NetflixBillboard titles={billboardTitles} />

          {/* the Netflix-style sub-nav (sticks just under the shell topbar) */}
          <div className="sticky top-14 z-30 border-b border-white/5 bg-[#0a0a0c]/90 px-4 backdrop-blur sm:px-[4vw]">
            <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <nav role="group" aria-label="Catalog filter" className="flex gap-1" data-testid="netflix-kind-tabs">
                {KIND_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={kind === t.id}
                    onClick={() => setKind(t.id)}
                    className={cn(
                      "h-8 rounded px-3.5 text-sm font-medium transition-colors",
                      kind === t.id
                        ? "bg-white text-black"
                        : "text-white/70 hover:text-white"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <div role="group" aria-label="Country view" className="flex gap-2" data-testid="netflix-country-chips">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={country === c.id}
                    onClick={() => setCountry(c.id)}
                    className={cn(
                      "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                      country === c.id
                        ? "bg-white/15 text-white ring-1 ring-white/40"
                        : "text-white/60 hover:text-white"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* P49 — Continue Watching rides FIRST (Netflix's own placement for
              the personalized rows), then My List */}
          <ContinueWatchingRail />

          <MyListRail />

          {/* the Netflix Live band — the real Netflix interface, streamed */}
          <section
            aria-label="Netflix Live"
            className="mx-4 mt-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-gradient-to-r from-[#e50914]/15 via-[#141418] to-[#101014] p-5 sm:mx-[4vw]"
            data-testid="netflix-live-band"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <span
                  aria-hidden="true"
                  className="flex h-6 items-center justify-center rounded bg-[#e50914] px-1.5 text-xs font-black"
                >
                  N
                </span>
                Netflix Live
                <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60">
                  full interface
                </span>
              </p>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/55 sm:text-sm">
                Open the actual Netflix — every row, search, and the real player — streamed live
                from your private cloud desktop inside WebFlix. Connect your Netflix session once,
                then it all plays here.
              </p>
            </div>
            <Link
              href="/netflix/watch/live"
              data-testid="netflix-live-open"
              className="flex h-11 shrink-0 items-center gap-2 rounded-md bg-[#e50914] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#c4080f]"
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              Browse Netflix Live
            </Link>
          </section>

          {rails.map((rail) => (
            <NetflixRail key={`${country}-${kind}-${rail.key}`} rail={rail} />
          ))}

          <p className="px-4 pt-8 text-center text-xs text-white/35 sm:px-6" data-testid="netflix-source-note">
            Data: Netflix&apos;s own public Top 10 &amp; Most Popular (Tudum) · {data.catalogSize} tracked titles ·
            playback streams Netflix&apos;s own player into WebFlix via your secure cloud desktop ·{" "}
            <Link href="/help" className="underline underline-offset-2 hover:text-white/60">why</Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function NetflixHubView() {
  return (
    <Suspense fallback={null}>
      <HubContent />
    </Suspense>
  );
}
