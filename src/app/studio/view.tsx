"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Eye,
  ThumbsUp,
  MessageSquare,
  Users,
  Clapperboard,
  Film,
  Paintbrush,
  UploadCloud,
  Info,
  RefreshCw,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCount, formatRelativeDate } from "@/lib/format";
import type { StudioPageDTO, StudioVideoDTO } from "@/lib/types";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

/** The real per-video Studio editor URL (pure — client-safe). */
function studioVideoEditUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

type StudioPayload = StudioPageDTO & { loginRequired?: boolean };

/**
 * Creator Studio — the single-tenant operator channel's real surface:
 * real analytics (Studio SSR when the session allows; honest empty states
 * otherwise — NEVER fake numbers), the real public videos with real public
 * stats, and the real channel branding — all with deep links out to the
 * authoritative studio.youtube.com pages.
 *
 * WFX2-P2-AU: guests get the youtube.com signed-out screen (the gate) —
 * the creator surface is account-gated like youtube.com's studio.
 */
export default function StudioPage() {
  return (
    <PersonalSurfaceGate surface="studio">
      <StudioContent />
    </PersonalSurfaceGate>
  );
}

function StudioContent() {
  const { data, loading, error, reload } = useApi<StudioPayload>("/api/studio");

  return (
    <div className="pb-10">
      {error && (
        <div className="px-4 py-16 text-center sm:px-6" role="alert">
          <p className="text-lg font-medium">Studio unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button onClick={reload} variant="outline" className="mt-4 rounded-full">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </div>
      )}
      {loading && <StudioSkeleton />}
      {data && <StudioSurface data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// skeleton / shell
// ---------------------------------------------------------------------------

function StudioSkeleton() {
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-2xl sm:h-36" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

function StudioSurface({ data }: { data: StudioPayload }) {
  const channel = data.channel;

  return (
    <>
      {/* channel header — real banner / avatar / handle */}
      <header className="relative">
        <div className="h-28 w-full overflow-hidden bg-secondary sm:h-36">
          {channel?.bannerUrl && (
            <img
              src={channel.bannerUrl}
              alt={`${channel.name} channel banner`}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          {channel ? (
            <img
              src={channel.avatarUrl}
              alt={`${channel.name} avatar`}
              className="size-14 rounded-full object-cover ring-2 ring-background"
            />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-secondary ring-2 ring-background">
              <Clapperboard className="size-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold sm:text-2xl">
              {channel ? channel.name : "Creator Studio"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {channel
                ? `${channel.handle} · ${channel.subscriberCountText ?? formatCount(channel.subscriberCount) + " subscribers"}`
                : "Your channel on YouTube"}
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Studio actions">
            <a
              href={data.deepLinks.studioRoot}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Open YouTube Studio <ExternalLink className="size-3.5" />
            </a>
            <Link
              href="/upload"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <UploadCloud className="size-4" /> Upload video
            </Link>
          </nav>
        </div>
      </header>

      {!channel && <ConnectSessionCard data={data} />}

      <Tabs defaultValue="analytics" className="px-4 sm:px-6">
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart3 className="size-4" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5">
            <Film className="size-4" /> Content
          </TabsTrigger>
          <TabsTrigger value="customization" className="gap-1.5">
            <Paintbrush className="size-4" /> Customization
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" id="studio-analytics">
          <AnalyticsTab data={data} />
        </TabsContent>
        <TabsContent value="content" id="studio-content">
          <ContentTab data={data} />
        </TabsContent>
        <TabsContent value="customization" id="studio-customization">
          <CustomizationTab data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The honest "connect the operator session" state (public / unresolved). */
function ConnectSessionCard({ data }: { data: StudioPayload }) {
  const session = data.session;
  return (
    <section className="mx-4 mt-4 rounded-xl border border-dashed border-border bg-secondary/30 p-6 sm:mx-6" aria-live="polite">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Info className="size-5 shrink-0" />
        {session ? "Operator channel unresolved" : "Connect the operator session"}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {session
          ? "This session's channel could not be resolved from YouTube right now. YouTube Studio itself resolves your channel via Google sign-in —"
          : "WebFlix runs in public mode (no YT_COOKIES configured), so your channel's surfaces can't load here. Sign-in happens on YouTube:"}{" "}
        <a
          href={data.deepLinks.studioRoot}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          open studio.youtube.com <ExternalLink className="inline size-3.5" />
        </a>{" "}
        for the full creator experience.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// analytics tab
// ---------------------------------------------------------------------------

function AnalyticsTab({ data }: { data: StudioPayload }) {
  const a = data.analytics;
  const t = data.totals;

  return (
    <section aria-label="Channel analytics" className="space-y-8">
      {/* studio-scope — real parsed metrics or the honest empty state */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Channel analytics</h2>
          <a
            href={data.deepLinks.analytics}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Full analytics on YouTube <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Read from YouTube Studio with the operator session (Studio scope).
        </p>

        {a.mode === "ok" && a.metrics ? (
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={<Eye className="size-4" />} label="Views" value={a.metrics.views} />
            <StatCard icon={<Users className="size-4" />} label="Subscribers gained" value={a.metrics.subscribersGained} />
            <StatCard icon={<BarChart3 className="size-4" />} label="Impressions" value={a.metrics.impressions} />
            <StatCard icon={<Clapperboard className="size-4" />} label="Watch time (min)" value={a.metrics.watchTimeMinutes} />
            <StatCard icon={<ThumbsUp className="size-4" />} label="Likes" value={a.metrics.likes} />
            <StatCard icon={<MessageSquare className="size-4" />} label="Comments" value={a.metrics.comments} />
            <StatCard icon={<BarChart3 className="size-4" />} label="Shares" value={a.metrics.shares} />
            <StatCard icon={<BarChart3 className="size-4" />} label="Est. revenue (USD)" value={a.metrics.estimatedRevenue} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-8 text-center" role="status">
            <p className="text-sm font-medium">Analytics unavailable here — nothing is shown that isn't real</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{a.note}</p>
          </div>
        )}
        {a.mode === "ok" && a.metrics && (
          <p className="mt-2 text-xs text-muted-foreground">{a.note}</p>
        )}
      </div>

      {/* public-scope — real numbers anyone can see on the channel */}
      <div>
        <h2 className="text-lg font-semibold">Public snapshot</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Real numbers as visible to anyone on YouTube (public scope) — computed from your
          public channel page and videos.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={<Users className="size-4" />} label="Subscribers" value={t.subscribers} text={t.subscriberCountText} />
          <StatCard icon={<Film className="size-4" />} label="Videos" value={t.videoCount} />
          <StatCard icon={<Eye className="size-4" />} label="Views (listed public videos)" value={t.views} />
          <StatCard
            icon={<ThumbsUp className="size-4" />}
            label={`Likes (first ${t.enrichedCount} rows)`}
            value={t.likes}
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// content tab
// ---------------------------------------------------------------------------

function ContentTab({ data }: { data: StudioPayload }) {
  const videos = data.videos;

  return (
    <section aria-label="Channel content">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Content</h2>
        <a
          href={data.deepLinks.content}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Manage all content on YouTube <ExternalLink className="size-3.5" />
        </a>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your public videos with real public stats (views from the channel page; likes and
        comments from each video's watch data — shown as "—" where not loaded). Private and
        unlisted videos are managed on YouTube.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <caption className="sr-only">The operator channel&apos;s public videos</caption>
            <thead>
              <tr className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-semibold">Video</th>
                <th scope="col" className="px-4 py-3 font-semibold">Visibility</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Views</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Likes</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Comments</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Published</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">On YouTube</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <VideoRow key={v.id} v={v} />
              ))}
              {videos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No public videos to list{data.session ? " for this channel" : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function VideoRow({ v }: { v: StudioVideoDTO }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0 hover:bg-accent/30">
      <td className="px-4 py-3">
        <Link href={`/watch/${v.id}`} className="flex items-center gap-3">
          <div className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-md bg-secondary">
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
              {v.isShort ? "Short" : "Video"}
              {v.isLive ? " · Live" : ""}
              {v.publishedText ? ` · ${v.publishedText}` : ""}
            </p>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-muted-foreground">Public</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {v.viewsText ?? formatCount(v.views)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <MaybeStat value={v.likes} label="likes" />
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <MaybeStat value={v.commentCount} label="comments" />
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {v.createdAt ? formatRelativeDate(v.createdAt) : (v.publishedText ?? "—")}
      </td>
      <td className="px-4 py-3 text-right">
        <a
          href={studioVideoEditUrl(v.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium hover:bg-accent"
          aria-label={`Edit ${v.title} in YouTube Studio`}
        >
          Edit <ExternalLink className="size-3" />
        </a>
      </td>
    </tr>
  );
}

/** "—" for null (not loaded) — never a fake zero. */
function MaybeStat({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground/70"
        title="Not loaded — open the video on YouTube for the current number"
      >
        —<span className="sr-only"> {label} not loaded</span>
      </span>
    );
  }
  return <>{formatCount(value)}</>;
}

// ---------------------------------------------------------------------------
// customization tab (read-only branding + deep link to the real editor)
// ---------------------------------------------------------------------------

function CustomizationTab({ data }: { data: StudioPageDTO }) {
  const c = data.channel;

  return (
    <section aria-label="Channel customization">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Channel customization</h2>
        <a
          href={data.deepLinks.customization}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Customize on YouTube <ExternalLink className="size-3.5" />
        </a>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your channel&apos;s real branding as it appears on YouTube right now (read from the
        channel page). Edits happen on YouTube — changes there are reflected here.
      </p>

      {!c ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-8 text-center" role="status">
          <p className="text-sm font-medium">Branding loads with the operator session</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect YT_COOKIES to read your channel&apos;s name, description, banner and
            links here.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          {/* banner + avatar preview */}
          <div className="space-y-4 lg:col-span-1">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Banner
              </p>
              <div className="aspect-[6.2/1] w-full overflow-hidden rounded-lg bg-secondary">
                {c.bannerUrl ? (
                  <img src={c.bannerUrl} alt={`${c.name} banner`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No banner set
                  </div>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Avatar
              </p>
              <div className="flex items-center gap-3">
                <img
                  src={c.avatarUrl}
                  alt={`${c.name} avatar`}
                  className="size-16 rounded-full object-cover"
                />
                <span className="text-sm text-muted-foreground">
                  {c.verified ? "Verified channel" : "Channel"}
                </span>
              </div>
            </div>
          </div>

          {/* editable-ready fields (read-only) */}
          <div className="space-y-4 lg:col-span-2">
            <div>
              <label htmlFor="cst-name" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Channel name
              </label>
              <input
                id="cst-name"
                readOnly
                value={c.name}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="cst-handle" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Handle
              </label>
              <input
                id="cst-handle"
                readOnly
                value={c.handle}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="cst-description" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </label>
              <textarea
                id="cst-description"
                readOnly
                rows={4}
                value={c.description ?? ""}
                placeholder="No description set"
                className="w-full resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Links</p>
              {c.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No links exposed on this channel&apos;s page data — the full list lives in
                  the About section on YouTube.
                </p>
              ) : (
                <ul className="space-y-1">
                  {c.links.map((l) => (
                    <li key={l.url} className="text-sm">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground underline underline-offset-2 hover:text-primary"
                      >
                        {l.title} <ExternalLink className="inline size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  text?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">
        {value === null ? (
          <span title="Not present in the parsed Studio data">—</span>
        ) : (
          <>
            {formatCount(value)}
            {text ? <span className="ml-2 text-xs font-normal text-muted-foreground">{text}</span> : null}
          </>
        )}
      </p>
    </div>
  );
}
