"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Flame, Globe } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { displayViews, displayPublished, formatDuration } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import {
  TRENDING_CATEGORIES,
} from "@/lib/youtube/trending-categories";
import {
  TRENDING_REGIONS,
  trendingRegionName,
} from "@/lib/youtube/trending-regions";
import {
  useTrendingRegion,
  useTrendingRegionHydration,
} from "./region-store";
import { cn } from "@/lib/utils";
import type { TrendingPageDTO } from "@/lib/types";

/**
 * Trending (WFX2-B-W) — the real youtube.com /feed/trending categories:
 * Now / Music / Gaming / Movies chips (URL-synced via ?category=), the
 * ranked rail. Data path: the SSR category page grid; in public mode (the
 * What-to-Watch nudge — probed live) a real search-backed popular-this-week
 * rail, honestly labeled by the response's `source`.
 *
 * P23-C (G7) — the REGION SWITCHER (2026-10-17): youtube.com's trending
 * carries the location control that re-shapes the feed; the switcher rides
 * the END of the chip row (the Globe control + the region's name) and lists
 * youtube.com's own Content-location countries (the static map — the list
 * itself is session-gated upstream, documented in trending-regions.ts). The
 * selection persists (wf-trending-region, the channel-prefs idiom) and
 * parameterizes BOTH read paths: the SSR page's ?gl= (measured — the
 * returned payload carries the requested gl) and the public-mode search
 * fallback's context.client.gl (measured — US/GB/JP reshape the ranked
 * set). The feed + category tabs reshape per region (every category read
 * carries the same region).
 */
export default function TrendingPage() {
  return (
    <Suspense fallback={<TrendingSkeleton />}>
      <TrendingContent />
    </Suspense>
  );
}

function TrendingContent() {
  const params = useSearchParams();
  const raw = params.get("category") ?? "Now";
  const category = TRENDING_CATEGORIES.some((c) => c.key === raw) ? raw : "Now";

  // P23-C: the persisted region (the store rehydrates after mount — the
  // sidebar idiom; the first paint reads the egress default, then the
  // selection applies and the region-shaped fetch replaces the rail)
  useTrendingRegionHydration();
  const region = useTrendingRegion((s) => s.region);
  const setRegion = useTrendingRegion((s) => s.setRegion);

  const query = `/api/trending?category=${encodeURIComponent(category)}${
    region ? `&region=${encodeURIComponent(region)}` : ""
  }`;
  const { data, loading, error } = useApi<TrendingPageDTO>(query);

  return (
    <div>
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Flame className="size-7 text-yt-red" aria-hidden /> Trending
      </h1>
      {data?.source === "search" && (
        <p className="px-4 pb-2 text-xs text-muted-foreground sm:px-6">
          Popular this week{region ? ` in ${trendingRegionName(region)}` : ""} —
          the live category grid needs the YouTube session (public mode).
        </p>
      )}
      <div className="flex items-start gap-2 px-4 pb-4 sm:px-6">
        <nav
          aria-label="Trending categories"
          className="no-scrollbar flex flex-1 gap-2 overflow-x-auto"
        >
          {TRENDING_CATEGORIES.map((cat) => {
            const active = cat.key === category;
            return (
              <Link
                key={cat.key}
                href={
                  cat.key === "Now"
                    ? "/trending"
                    : `/trending?category=${encodeURIComponent(cat.key)}`
                }
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground hover:bg-accent",
                )}
              >
                {cat.label}
              </Link>
            );
          })}
        </nav>

        {/* the region switcher — youtube.com's own trending location control
            (the end-of-chip-row placement; the Globe + the region's name,
            the country picker a scrollable list with the house scrollbar) */}
        <RegionSwitcher region={region} onSelect={setRegion} />
      </div>
      {loading && <TrendingSkeleton />}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.videos.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing trending in {category} right now
          {region ? ` for ${trendingRegionName(region)}` : ""}.
        </p>
      )}
      <ol className="px-4 sm:px-6">
        {(data?.videos ?? []).map((video, i) => (
          <li key={video.id} className="border-b border-border/40 last:border-b-0">
            <Link
              href={`/watch/${video.id}`}
              className="group flex gap-4 py-4 transition-colors sm:gap-6"
            >
              <span className="hidden w-8 shrink-0 pt-8 text-center text-xl font-semibold text-muted-foreground tabular-nums sm:block">
                {i + 1}
              </span>
              <div className="relative aspect-video w-[140px] shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-[240px]">
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {video.isLive ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
                    Live
                  </span>
                ) : (
                  <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                    {formatDuration(video.durationSec)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-base font-medium text-foreground sm:text-lg">
                  {video.title}
                </h2>
                <p className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
                  <span className="truncate">{video.channel.name}</span>
                  {video.channel.verified && <VerifiedBadge />}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {displayViews(video)} · {displayPublished(video)}
                  {video.category !== "All" && ` · ${video.category}`}
                </p>
                {video.isMembersOnly && (
                  <span className="mt-1 inline-block rounded-sm bg-yt-red/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Members only
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The location control — youtube.com's trending region switcher. The Globe +
 * the active region's name (or "Location" when unset — the egress default),
 * the picker a scrollable country list (the static map). Selecting the
 * active region again keeps it (a no-op); "Default" returns to the unset
 * egress region (the honest pre-selection state — WebFlix never guesses
 * which country the upstream egress sits in).
 */
function RegionSwitcher({
  region,
  onSelect,
}: {
  region: string | null;
  onSelect: (code: string | null) => void;
}) {
  return (
    <div className="shrink-0">
      <label className="sr-only" htmlFor="trending-region-switcher">
        Trending region
      </label>
      <div className="relative">
        <Globe
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <select
          id="trending-region-switcher"
          data-testid="trending-region-switcher"
          value={region ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onSelect(v === "" ? null : v);
          }}
          className="h-9 max-w-[190px] cursor-pointer appearance-none rounded-full border border-border bg-secondary py-1.5 pl-8 pr-7 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Location</option>
          {TRENDING_REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          ▾
        </span>
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading trending">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 sm:gap-6 sm:px-6">
          <Skeleton className="aspect-video w-[140px] shrink-0 rounded-xl sm:w-[240px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
