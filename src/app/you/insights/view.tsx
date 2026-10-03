"use client";

/**
 * WFX2-P7-AN — /you/insights: the viewer's real watch analytics. Every
 * number comes from the app's genuine rows (ViewEvent + WatchDailyStat via
 * /api/watch/insights) — totals, the zero-filled 28-day UTC series (real
 * zeros, never fabricated activity), and the top videos by watch time. The
 * honest note surfaces when the series is all-zero: nothing is backfilled.
 */
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { humanizeWatchSec } from "@/lib/watch/format";
import type { YouInsightsPayload } from "../sections";

export default function YouInsightsView() {
  return (
    <PersonalSurfaceGate surface="account" redirect="/you/insights">
      <InsightsContent />
    </PersonalSurfaceGate>
  );
}

function shortDay(day: string): string {
  // "2026-10-03" → "Oct 3"
  const d = new Date(`${day}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function InsightsContent() {
  const { data, loading, error } = useApi<YouInsightsPayload>("/api/watch/insights");

  if (loading) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading your watch insights">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold">Your watch insights</h1>
        <p className="mt-4 text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      </div>
    );
  }

  const totals = data?.totals;
  const series = data?.series28d ?? [];
  const topVideos = data?.topVideos ?? [];
  const hasActivity = series.some((p) => p.sec > 0);

  return (
    <div className="pb-10">
      <header className="px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-bold" data-testid="insights-title">
          Your watch insights
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The time you&apos;ve spent watching on WebFlix — charted from your real watch history,
          never estimated.
        </p>
      </header>

      {/* totals row */}
      <div className="grid grid-cols-2 gap-4 px-4 pt-6 sm:grid-cols-4 sm:px-6">
        <Card data-testid="insights-total-time">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Time watched all-time</p>
            <p className="mt-1 text-2xl font-semibold">{humanizeWatchSec(totals?.watchedSecAllTime ?? 0)}</p>
          </CardContent>
        </Card>
        <Card data-testid="insights-total-videos">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Videos watched</p>
            <p className="mt-1 text-2xl font-semibold">{(totals?.videosWatched ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card data-testid="insights-total-streak">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Current streak</p>
            <p className="mt-1 text-2xl font-semibold">{totals?.streakDays ?? 0} {(totals?.streakDays ?? 0) === 1 ? "day" : "days"}</p>
          </CardContent>
        </Card>
        <Card data-testid="insights-total-avg">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg per active day</p>
            <p className="mt-1 text-2xl font-semibold">{humanizeWatchSec(totals?.avgSecPerActiveDay ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* the 28-day series (the studio analytics chart idiom) */}
      <div className="px-4 pt-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Watch time — last 28 days</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {hasActivity ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d: string) => shortDay(d)}
                    minTickGap={28}
                    fontSize={11}
                  />
                  <YAxis
                    width={56}
                    fontSize={11}
                    tickFormatter={(s: number) => humanizeWatchSec(s)}
                  />
                  <Tooltip
                    labelFormatter={(d: string) => shortDay(d)}
                    formatter={(value: number | string) => [humanizeWatchSec(Number(value)), "Watched"]}
                  />
                  <Area type="monotone" dataKey="sec" stroke="#dc2626" fill="#fecaca" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  No watch time recorded in the last 28 days.
                </p>
                <p className="max-w-md text-xs text-muted-foreground" data-testid="insights-honest-note">
                  Watch insights begin from the moment this feature landed — nothing is backfilled.
                </p>
                <Link
                  href="/"
                  className="mt-1 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                >
                  Find something to watch
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* top videos rail */}
      <section aria-label="Top videos by watch time" className="pt-8">
        <h2 className="px-4 pb-3 text-lg font-bold sm:px-6">Top videos by watch time</h2>
        {topVideos.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground sm:px-6">
            Videos you watch will rank here.
          </p>
        ) : (
          <div className="flex flex-col gap-2 px-4 sm:px-6">
            {topVideos.map((v) => (
              <Link
                key={v.videoId}
                href={`/watch/${v.videoId}`}
                data-testid="insights-top-video"
                className="group flex gap-3 rounded-lg p-1 transition hover:bg-secondary/40"
              >
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-secondary">
                  <img
                    src={v.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 className="line-clamp-2 text-sm font-medium leading-tight">{v.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{v.channelName}</p>
                  <p className="text-xs text-muted-foreground" data-testid="insights-top-watched">
                    {humanizeWatchSec(v.watchedSec)} watched
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
