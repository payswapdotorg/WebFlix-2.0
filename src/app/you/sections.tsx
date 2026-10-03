"use client";

/**
 * WFX2-P5-YA — the /you hub sections. Real data only, through the payloads
 * the view passes in (the existing read seams: /api/history,
 * /api/playlists, /api/studio). Every seam without data gets its honest
 * state — empty copy, a degradation note, or a link without a count — never
 * a fabricated number.
 */
import Link from "next/link";
import {
  Clock,
  Clapperboard,
  Crown,
  History as HistoryIcon,
  ListVideo,
  Play,
  SquarePlay,
  ThumbsUp,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { humanizeWatchSec } from "@/lib/watch/format";
import type { ApiState } from "@/hooks/use-api";
import type { ContinueVideoDTO, PlaylistDTO, StudioPageDTO } from "@/lib/types";

// ---- the payload shapes of the existing seams (mirrored from the views) ----

export type YouHistoryPayload = {
  groups: { label: string; items: ContinueVideoDTO[] }[];
  nextCursor: string | null;
  loginRequired: boolean;
  watchHistoryPaused: boolean | null;
  searchHistoryPaused: boolean | null;
  total: number;
  session: boolean;
};

export type YouPlaylistsPayload = {
  playlists: PlaylistDTO[];
  loginRequired: boolean;
  session: boolean;
};

/** /api/studio?enrich=0 — the channel + public uploads, no enrichment. */
export type YouStudioPayload = StudioPageDTO & { loginRequired: boolean };

/** /api/watch/insights — the watch analytics seam (WFX2-P7-AN, mirrored from
 *  the insights service payload: totals + the zero-filled 28-day series +
 *  the top videos by lifetime watchedSec). */
export type YouInsightsPayload = {
  totals: {
    watchedSecAllTime: number;
    videosWatched: number;
    activeDays: number;
    avgSecPerActiveDay: number;
    streakDays: number;
  };
  series28d: { day: string; sec: number }[];
  topVideos: {
    videoId: string;
    title: string;
    channelName: string;
    thumbnailUrl: string;
    watchedSec: number;
    lastWatchedAt: string;
  }[];
};

// ---- shared bits ----

function SectionHeader({
  icon: Icon,
  title,
  seeAllHref,
  seeAllLabel = "View all",
}: {
  icon: LucideIcon;
  title: string;
  seeAllHref?: string;
  seeAllLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 sm:px-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Icon className="size-5" aria-hidden="true" /> {title}
      </h2>
      {seeAllHref ? (
        <Link
          href={seeAllHref}
          className="rounded-full text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {seeAllLabel}
        </Link>
      ) : null}
    </div>
  );
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4 overflow-x-auto px-4 pb-2 pt-3 slim-scrollbar sm:px-6">
      {children}
    </div>
  );
}

function RailSkeleton() {
  return (
    <Rail>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex w-[240px] shrink-0 flex-col gap-2" aria-hidden="true">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </Rail>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">{children}</p>;
}

function EmptyNote({ text, linkHref, linkLabel }: { text: string; linkHref: string; linkLabel: string }) {
  return (
    <div className="px-4 py-6 sm:px-6">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Link
        href={linkHref}
        className="mt-2 inline-block text-sm font-medium text-foreground underline underline-offset-2"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

function SpecialCard({
  href,
  testId,
  icon: Icon,
  title,
  meta,
}: {
  href: string;
  testId: string;
  icon: LucideIcon;
  title: string;
  meta: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex items-center gap-4 rounded-xl border border-border p-4 transition-colors hover:bg-accent/50"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
    </Link>
  );
}

// ---- History ----

export function HistorySection({ state }: { state: ApiState<YouHistoryPayload> }) {
  const total = state.data?.total ?? 0;
  const recent = (state.data?.groups ?? []).flatMap((group) => group.items).slice(0, 12);

  return (
    <section aria-label="History" data-testid="you-history">
      <SectionHeader icon={HistoryIcon} title="History" seeAllHref="/history" />
      {state.loading && <RailSkeleton />}
      {state.error && (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6" role="alert">
          {state.error}
        </p>
      )}
      {state.data && state.data.loginRequired && (
        <SectionNote>
          History is personal to the YouTube account this WebFlix session rides — connect
          the operator session (YT_COOKIES) to read it.
        </SectionNote>
      )}
      {state.data && !state.data.loginRequired && recent.length === 0 && (
        <EmptyNote
          text="Videos you watch will show up here."
          linkHref="/"
          linkLabel="Find something to watch"
        />
      )}
      {state.data && !state.data.loginRequired && recent.length > 0 && (
        <>
          {total > 0 && (
            <p
              className="px-4 pb-1 pt-3 text-sm text-muted-foreground sm:px-6"
              data-testid="you-history-count"
            >
              {total.toLocaleString()} {total === 1 ? "video" : "videos"} watched
            </p>
          )}
          <Rail>
            {recent.map((video) => (
              <VideoCard key={video.id} video={video} variant="rail" watchedSec={video.watchedSec} />
            ))}
          </Rail>
        </>
      )}
    </section>
  );
}

// ---- Watch insights (WFX2-P7-AN) ----

export function WatchInsightsSection({ state }: { state: ApiState<YouInsightsPayload> }) {
  // defensive optionals: a degraded/empty payload renders the honest neutral
  // card, never a crash (the payload shape law holds on the real API)
  const streak = state.data?.totals?.streakDays ?? 0;
  const weekSec = (state.data?.series28d ?? []).slice(-7).reduce((acc, p) => acc + p.sec, 0);

  return (
    <section aria-label="Watch insights" data-testid="you-watch-insights">
      <SectionHeader
        icon={TrendingUp}
        title="Watch insights"
        seeAllHref="/you/insights"
        seeAllLabel="See all"
      />
      {state.loading && (
        <div className="px-4 py-4 sm:px-6">
          <Skeleton className="h-[76px] w-full rounded-xl" />
        </div>
      )}
      {state.error && (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6" role="alert">
          {state.error}
        </p>
      )}
      {state.data && (
        <div className="px-4 py-4 sm:px-6">
          <SpecialCard
            href="/you/insights"
            testId="you-watch-insights-card"
            icon={TrendingUp}
            title="Watch insights"
            meta={
              weekSec > 0
                ? `${humanizeWatchSec(weekSec)} watched this week${streak > 0 ? ` · ${streak}-day streak` : ""}`
                : streak > 0
                  ? `${streak}-day watching streak`
                  : "Your watch time, honestly charted"
            }
          />
        </div>
      )}
    </section>
  );
}

// ---- Playlists ----

function PlaylistCard({ playlist }: { playlist: PlaylistDTO }) {
  return (
    <Link
      href={`/playlist/${playlist.id}`}
      aria-label={`Open playlist ${playlist.title}`}
      data-testid="you-playlist-card"
      className="group flex w-[240px] shrink-0 flex-col gap-2"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ListVideo className="size-8 text-muted-foreground/50" aria-hidden="true" />
          </div>
        )}
        <div className="absolute bottom-0 right-0 flex items-center gap-1 bg-foreground/90 px-2 py-1 text-xs font-medium text-background">
          <Play className="size-3 fill-background" aria-hidden="true" /> {playlist.videoCount}
        </div>
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
      </div>
      <p className="truncate text-sm font-medium">{playlist.title}</p>
      <p className="text-xs capitalize text-muted-foreground">{playlist.visibility} playlist</p>
    </Link>
  );
}

export function PlaylistsSection({ state }: { state: ApiState<YouPlaylistsPayload> }) {
  // the created library: WL (isWatchLater) and LL stay in their own cards
  const created = (state.data?.playlists ?? []).filter(
    (playlist) => !playlist.isWatchLater && playlist.id !== "LL"
  );

  return (
    <section aria-label="Playlists" data-testid="you-playlists">
      <SectionHeader icon={ListVideo} title="Playlists" seeAllHref="/playlists" />
      {state.loading && <RailSkeleton />}
      {state.error && (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6" role="alert">
          {state.error}
        </p>
      )}
      {state.data && state.data.loginRequired && (
        <SectionNote>
          Playlists are personal to the YouTube account this WebFlix session rides —
          connect the operator session (YT_COOKIES) to read them.
        </SectionNote>
      )}
      {state.data && !state.data.loginRequired && created.length === 0 && (
        <EmptyNote
          text="Playlists you create will show up here."
          linkHref="/playlists"
          linkLabel="Create a playlist"
        />
      )}
      {created.length > 0 && (
        <Rail>
          {created.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </Rail>
      )}
    </section>
  );
}

// ---- Your videos (the operator channel's public uploads) ----

export function YourVideosSection({ state }: { state: ApiState<YouStudioPayload> }) {
  const videos = state.data?.videos ?? [];
  const channel = state.data?.channel ?? null;

  return (
    <section aria-label="Your videos" data-testid="you-videos">
      <SectionHeader
        icon={SquarePlay}
        title="Your videos"
        seeAllHref="/studio"
        seeAllLabel="Manage in Creator Studio"
      />
      {state.loading && <RailSkeleton />}
      {state.error && (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6" role="alert">
          {state.error}
        </p>
      )}
      {state.data && videos.length === 0 && (
        <EmptyNote
          text={
            channel
              ? "No public uploads on the operator channel yet — videos you upload will appear here."
              : "The operator YouTube session isn't connected — your channel's public uploads will appear here once it is."
          }
          linkHref="/studio"
          linkLabel="Open Creator Studio"
        />
      )}
      {videos.length > 0 && (
        <Rail>
          {videos.map((video) => (
            <Link
              key={video.id}
              href={`/watch/${video.id}`}
              data-testid="you-upload-card"
              className="group flex w-[240px] shrink-0 flex-col gap-2"
            >
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
              </div>
              <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">
                {video.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {video.viewsText ?? `${video.views.toLocaleString()} views`}
              </p>
            </Link>
          ))}
        </Rail>
      )}
    </section>
  );
}

// ---- Watch later + Liked (the special lists) ----

export function WatchLaterCard({ state }: { state: ApiState<YouPlaylistsPayload> }) {
  const watchLater = (state.data?.playlists ?? []).find(
    (playlist) => playlist.isWatchLater || playlist.id === "WL"
  );

  return (
    <section aria-label="Watch later">
      <SpecialCard
        href="/playlist/WL"
        testId="you-watch-later"
        icon={Clock}
        title="Watch later"
        meta={
          state.loading ? (
            <Skeleton className="h-3 w-16" />
          ) : watchLater ? (
            `${watchLater.videoCount.toLocaleString()} ${watchLater.videoCount === 1 ? "video" : "videos"}`
          ) : (
            "Videos you save for later"
          )
        }
      />
    </section>
  );
}

export function LikedCard({ state }: { state: ApiState<YouPlaylistsPayload> }) {
  const liked = (state.data?.playlists ?? []).find((playlist) => playlist.id === "LL");

  return (
    <section aria-label="Liked videos">
      <SpecialCard
        href="/liked"
        testId="you-liked"
        icon={ThumbsUp}
        title="Liked videos"
        meta={
          state.loading ? (
            <Skeleton className="h-3 w-16" />
          ) : liked ? (
            `${liked.videoCount.toLocaleString()} ${liked.videoCount === 1 ? "video" : "videos"}`
          ) : (
            "Videos you like"
          )
        }
      />
    </section>
  );
}

// ---- More from WebFlix (the rail) ----

export function MoreFromRail() {
  // href-only links: SS owns the /premium page (P5-SS lane — never an import)
  return (
    <section aria-label="More from WebFlix" data-testid="you-more-from">
      <SectionHeader icon={Crown} title="More from WebFlix" />
      <div className="grid gap-4 px-4 sm:grid-cols-2 sm:px-6">
        <SpecialCard
          href="/studio"
          testId="you-more-studio"
          icon={Clapperboard}
          title="Creator Studio"
          meta="Manage your channel — opens WebFlix Studio"
        />
        <SpecialCard
          href="/premium"
          testId="you-more-premium"
          icon={Crown}
          title="WebFlix Premium"
          meta="Learn about WebFlix Premium"
        />
      </div>
    </section>
  );
}
