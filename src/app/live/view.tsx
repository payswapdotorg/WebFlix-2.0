"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Eye, Link2, Radio, RefreshCw, TriangleAlert, Video } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { LiveEventsCard } from "@/components/live/live-events-card";
import { formatCount, formatRelativeDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LiveRoomDto } from "@/lib/live/types";

/**
 * WFX2-LIVE-PLATFORM-1 §7 Worker 2 — the FIRST-PARTY /live discovery surface.
 *
 * This is WebFlix's own live-rooms grid, NOT /explore/live (which stays the
 * YouTube live-search destination). Everything here is honest per work-order
 * principle #8: the LIVE badge appears only for a room whose transport
 * session is actually live, viewer counts are labelled approximate (the API
 * itself carries an estimated count), empty means empty, and errors surface
 * their real API error codes. Rooms carry no cover art in Phase 1, so tiles
 * render a stylised stage block instead of a fake thumbnail.
 *
 * Data is client-fetched (the repo's plain useApi fetch pattern) with a
 * 20-second freshness poll while results are on screen.
 */

/** Deterministic avatar hue from a handle (rooms carry no avatar asset yet). */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function HostInitial({ handle, className }: { handle: string; className?: string }) {
  const initial = (handle.trim()[0] ?? "W").toUpperCase();
  return (
    <span
      aria-hidden
      className={`flex select-none items-center justify-center rounded-full font-semibold text-white ${className ?? "size-8 text-sm"}`}
      style={{ backgroundColor: `hsl(${hueFromString(handle)} 45% 32%)` }}
    >
      {initial}
    </span>
  );
}

/** The real LIVE badge — only rendered when the session is transport-live. */
function LiveBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      data-testid="live-badge"
      className="inline-flex items-center gap-1.5 rounded-md bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />
      {compact ? "Live" : "LIVE"}
    </span>
  );
}

/** Honest transport-state chip for a live room whose session isn't fully up. */
function TransportChip({ label, tone }: { label: string; tone: "amber" | "muted" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
        tone === "amber"
          ? "bg-amber-500/15 text-amber-400"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      {tone === "amber" && <span className="size-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden />}
      {label}
    </span>
  );
}

/** The approximate-viewer pill — the count is an estimate, so it says so. */
function ApproxViewers({ count }: { count: number }) {
  return (
    <span
      title="Approximate viewer count — WebFlix live counts are estimates, not exact tallies."
      className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white"
    >
      <Eye className="size-3" aria-hidden />
      ≈ {formatCount(count)}
      <span className="sr-only">viewers (approximate)</span>
    </span>
  );
}

function RoomTile({ room }: { room: LiveRoomDto }) {
  const sessionLive = room.status === "live" && room.currentSession?.status === "live";
  const reconnecting = room.currentSession?.status === "reconnecting";
  return (
    <article className="group flex flex-col">
      <Link
        href={`/live/${room.id}`}
        aria-label={`Watch ${room.title}${room.hostHandle ? ` by ${room.hostHandle}` : ""} (live room)`}
        className="relative block overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-secondary/80 via-card to-background transition-colors group-hover:border-ring/40"
      >
        <div className="relative flex aspect-video w-full items-center justify-center">
          {/* stylised stage — rooms have no cover art, so no fake thumbnail */}
          <Radio className="absolute size-24 text-muted-foreground/10" aria-hidden />
          <div className="flex flex-col items-center gap-2">
            <HostInitial handle={room.hostHandle} className="size-12 text-lg" />
            <span className="max-w-[80%] truncate text-xs text-muted-foreground">
              {room.hostName || `@${room.hostHandle}`}
            </span>
          </div>
          <span className="absolute left-2 top-2">
            {sessionLive ? (
              <LiveBadge compact />
            ) : reconnecting ? (
              <TransportChip label="Reconnecting" tone="amber" />
            ) : (
              <TransportChip label="Starting…" tone="muted" />
            )}
          </span>
          <span className="absolute bottom-2 right-2">
            <ApproxViewers count={room.viewerCount} />
          </span>
        </div>
      </Link>
      <div className="mt-3 space-y-0.5">
        <Link href={`/live/${room.id}`} className="block">
          <h2 className="line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:text-foreground">
            {room.title}
          </h2>
        </Link>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="truncate">{room.hostName}</span>
          <span className="truncate">@{room.hostHandle}</span>
          {room.isHost === true && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] uppercase">
              You host
            </Badge>
          )}
        </p>
        <p className="text-[13px] text-muted-foreground">
          ≈ {formatCount(room.viewerCount)} watching (approx.)
        </p>
        <p className="text-xs text-muted-foreground/80">
          Created {formatRelativeDate(room.createdAt)}
        </p>
      </div>
    </article>
  );
}

function GridShell({ children, testId, busy }: { children: React.ReactNode; testId: string; busy?: boolean }) {
  return (
    <div
      data-testid={testId}
      aria-busy={busy || undefined}
      className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {children}
    </div>
  );
}

/** The honest error copy per API error code (502/429 are real possibilities). */
function DiscoveryError({ code, onRetry }: { code: string; onRetry: () => void }) {
  const copy =
    code === "rate-limited"
      ? "WebFlix LIVE is rate-limiting discovery requests right now — wait a moment and retry."
      : code === "provider-failed"
        ? "WebFlix LIVE couldn't reach its room service. This is an upstream failure, not an empty grid."
        : `WebFlix LIVE discovery failed (${code}).`;
  return (
    <Alert variant="destructive" className="max-w-xl" data-testid="live-discovery-error">
      <TriangleAlert aria-hidden />
      <AlertTitle>Couldn't load live rooms</AlertTitle>
      <AlertDescription>
        <p>{copy}</p>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw aria-hidden /> Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function LiveDiscoveryView() {
  const { data, loading, error, reload } = useApi<{ rooms: LiveRoomDto[] }>(
    "/api/live-rooms?status=live",
  );
  const { user } = useWebFlixSession();

  // Freshness poll: only while a result set is on screen (an error state
  // stays put — no error/loading flicker from a background refetch). The
  // interval is keyed on data PRESENCE, not identity, so each 20s poll
  // replacing the array doesn't tear down the next interval.
  const hasRoomsData = data !== null;
  useEffect(() => {
    if (!hasRoomsData) return;
    const t = setInterval(() => reload(), 20_000);
    return () => clearInterval(t);
  }, [hasRoomsData, reload]);

  const rooms = data?.rooms ?? [];

  return (
    <div className="mx-auto w-full max-w-[1754px] px-4 pb-10 pt-4 md:px-6 md:pt-6">
      {/* Header — explicitly first-party, distinct from /explore/live */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold sm:text-2xl">
            <span
              className="flex size-8 items-center justify-center rounded-lg bg-yt-red text-white"
              aria-hidden
            >
              <Radio className="size-5" />
            </span>
            WebFlix LIVE
            <Badge variant="outline" className="uppercase tracking-wide">
              First-party
            </Badge>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Real WebFlix-owned rooms broadcasting right now — join a room to watch the live
            program. Looking for YouTube live streams? That&apos;s still{" "}
            <Link href="/explore/live" className="underline underline-offset-4 hover:text-foreground">
              /explore/live
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Button variant="ghost" size="icon" onClick={reload} aria-label="Refresh live rooms">
              <RefreshCw aria-hidden />
            </Button>
          )}
          {/* Worker W3 builds the creator console at /studio/live — link only. */}
          <Button asChild>
            <Link href="/studio/live">
              <Video aria-hidden /> Go Live
            </Link>
          </Button>
        </div>
      </header>

      <main className="mt-6">
        <div className="mb-6">
          <LiveEventsCard signedIn={user !== null} />
        </div>

        {loading && (
          <GridShell testId="live-grid" busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </GridShell>
        )}

        {!loading && error && <DiscoveryError code={error} onRetry={reload} />}

        {!loading && !error && rooms.length === 0 && (
          <div
            data-testid="live-empty-state"
            className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-16 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-secondary" aria-hidden>
              <Radio className="size-6 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium">No one is live right now</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              When a WebFlix creator starts broadcasting, their room appears here — live badge,
              approximate viewers and all. Nothing is ever faked into this grid.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/studio/live">
                <Video aria-hidden /> Go Live
              </Link>
            </Button>
          </div>
        )}

        {!loading && !error && rooms.length > 0 && (
          <section aria-label="WebFlix rooms live now">
            <GridShell testId="live-grid">
              {rooms.map((room) => (
                <RoomTile key={room.id} room={room} />
              ))}
            </GridShell>
          </section>
        )}
      </main>

      <p className="mt-10 flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <Link2 className="size-3" aria-hidden /> Room links are shareable deep links — /live/&lt;roomId&gt;.
      </p>
    </div>
  );
}
