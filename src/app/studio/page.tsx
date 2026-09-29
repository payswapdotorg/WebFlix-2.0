"use client";

import Link from "next/link";
import { BarChart3, Eye, ThumbsUp, MessageSquare, Clapperboard } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatViews, formatRelativeDate, formatDuration } from "@/lib/format";
import type { StudioDTO } from "@/lib/types";

/**
 * Creator Studio (dashboard view) — real stats for YOUR channel.
 * The full studio (Analytics / Revenue / Comments / Moderation /
 * Experiments) is WFX2-U (Wave 2).
 */
export default function StudioPage() {
  const { data, loading, error } = useApi<StudioDTO>("/api/studio");

  return (
    <div className="pb-10">
      {error && (
        <div className="px-4 py-16 text-center sm:px-6" role="alert">
          <p className="text-lg font-medium">Studio unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      )}
      {loading && (
        <div className="space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}
      {data && (
        <>
          {/* channel header */}
          <div className="relative">
            <div className="h-28 w-full overflow-hidden bg-secondary sm:h-36">
              {data.channel.bannerUrl && (
                <img
                  src={data.channel.bannerUrl}
                  alt={`${data.channel.name} banner`}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <img
                src={data.channel.avatarUrl}
                alt={data.channel.name}
                className="size-14 rounded-full object-cover ring-2 ring-background"
              />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold sm:text-2xl">{data.channel.name}</h1>
                <p className="text-sm text-muted-foreground">
                  @/{data.channel.handle} · {formatCount(data.channel.subscriberCount)} subscribers
                </p>
              </div>
              <Link
                href="/upload"
                className="ml-auto hidden rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent sm:block"
              >
                Upload video
              </Link>
            </div>
          </div>

          <div className="px-4 sm:px-6">
            <h2 className="flex items-center gap-2 pb-3 text-lg font-semibold">
              <BarChart3 className="size-5" /> Channel dashboard
            </h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard icon={<Eye className="size-4" />} label="Total views" value={formatCount(data.totals.views)} />
              <StatCard icon={<Clapperboard className="size-4" />} label="Videos" value={String(data.totals.videos)} />
              <StatCard icon={<ThumbsUp className="size-4" />} label="Total likes" value={formatCount(data.totals.likes)} />
              <StatCard icon={<MessageSquare className="size-4" />} label="Comments" value={String(data.totals.comments)} />
            </div>

            <h2 className="pb-3 pt-8 text-lg font-semibold">Content</h2>
            <div className="overflow-hidden rounded-xl border border-border/60">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Video</th>
                      <th className="px-4 py-3 font-semibold">Visibility</th>
                      <th className="px-4 py-3 text-right font-semibold">Views</th>
                      <th className="px-4 py-3 text-right font-semibold">Likes</th>
                      <th className="px-4 py-3 text-right font-semibold">Comments</th>
                      <th className="px-4 py-3 text-right font-semibold">Published</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((v) => (
                      <tr key={v.id} className="border-b border-border/40 last:border-b-0 hover:bg-accent/30">
                        <td className="px-4 py-3">
                          <Link href={`/watch/${v.id}`} className="flex items-center gap-3">
                            <div className="relative aspect-video w-[72px] shrink-0 overflow-hidden rounded-md bg-secondary">
                              <img
                                src={v.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="line-clamp-1 font-medium">{v.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {v.category} · {formatDuration(v.durationSec)}
                                {v.isShort ? " · Short" : ""}
                                {v.isLive ? " · Live" : ""}
                              </p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{v.visibility}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatViews(v.views)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCount(v.likes)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{v.commentCount}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {v.createdAt ? formatRelativeDate(v.createdAt) : ""}
                        </td>
                      </tr>
                    ))}
                    {data.videos.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No videos yet — upload your first one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="pt-4 text-xs text-muted-foreground">
              Analytics, Revenue, Comments, Moderation and A/B Experiments ship with WFX2-U (Wave 2).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
