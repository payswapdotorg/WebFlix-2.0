"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Radio } from "lucide-react";
import { toast } from "sonner";
import { postJson, useApi } from "@/hooks/use-api";
import { formatRelativeDate } from "@/lib/format";
import type { NotificationDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { effectiveRead, effectiveUnread, openNotification, useLocalRead } from "./local-read-store";

type CenterPayload = {
  items: NotificationDTO[];
  total: number;
  unread: number;
  loginRequired: boolean;
  pollIntervalMs: number | null;
  session: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/**
 * WFX2-P4-NC — the notification center: youtube.com's /notifications
 * parity over the honest center route. The bell's "See all" lands here.
 * Guests get the PersonalSurfaceGate signed-out screen (the AU law);
 * signed-in users get the full-item feed (video thumbnail, channel,
 * snippet, age), unread-first (server-ordered), per-item open-marks-read
 * (the session-local overlay + the menu re-read — documented in
 * local-read-store.ts), the poll cadence from the upstream's own
 * pollIntervalMs, and the honest empty/promo + error states.
 */
export default function NotificationsCenterPage() {
  return (
    <PersonalSurfaceGate surface="notifications">
      <NotificationsCenter />
    </PersonalSurfaceGate>
  );
}

function NotificationsCenter() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<CenterPayload>(
    `/api/notifications/center?page=${page}`
  );
  const readIds = useLocalRead((s) => s.readIds);
  const reconcile = useLocalRead((s) => s.reconcile);
  const resetOverlay = useLocalRead((s) => s.reset);

  // Fetched pages accumulate ("Show more" appends honest server slices).
  // Merging happens in the RENDER phase (the useApi guarded-state pattern —
  // no setState-in-effect); each arriving page also reconciles the overlay
  // against the upstream truth (external-store update — an effect).
  const [pages, setPages] = useState<Record<number, NotificationDTO[]>>({});
  if (data && pages[data.page] !== data.items) {
    setPages({ ...pages, [data.page]: data.items });
  }
  useEffect(() => {
    if (data?.items) reconcile(data.items);
  }, [data, reconcile]);

  // Poll on the upstream's own cadence (default 60s) + on focus — the
  // bell's own live-badge pattern.
  useEffect(() => {
    const interval = setInterval(reload, Math.max(30_000, data?.pollIntervalMs ?? 60_000));
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, data?.pollIntervalMs]);

  const items = Object.keys(pages)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((p) => pages[p]);
  const effectiveUnreadValue = effectiveUnread(data?.unread ?? 0, readIds);
  const empty = !data?.loginRequired && (data?.items ?? []).length === 0 && !error;

  async function markAllRead() {
    try {
      await postJson("/api/notifications/read", {});
      resetOverlay();
      reload();
      toast.success("All notifications marked as read");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark read");
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-xl font-semibold">
          Notifications
          {effectiveUnreadValue > 0 && (
            <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
              {effectiveUnreadValue} unread
            </span>
          )}
        </h1>
        {data && !data.loginRequired && items.length > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            data-testid="mark-all-read"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="divide-y divide-border">
        {error && (
          <div role="alert" data-testid="notifications-error" className="flex flex-col items-center gap-3 py-16 text-center">
            <Bell className="size-10 text-muted-foreground/60" aria-hidden="true" />
            <p className="font-medium">Couldn&apos;t load notifications</p>
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={reload}>
              Try again
            </Button>
          </div>
        )}

        {!error && data?.loginRequired && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Notifications are personal — sign in (configure the YouTube session) to read
            them. Empty is also valid when the account has none.
          </p>
        )}

        {empty && data && !data.loginRequired && (
          <div data-testid="notifications-empty-promo" className="flex flex-col items-center px-4 py-16 text-center sm:px-6">
            <div
              aria-hidden="true"
              className="flex h-[120px] w-[226px] items-center justify-center rounded-3xl border border-border bg-secondary/40"
            >
              <Bell className="size-16 text-muted-foreground/60" />
            </div>
            <h2 className="mt-6 text-lg font-medium">Your notifications live here</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Subscribe to your favorite channels to get notified about their latest
              videos.
            </p>
          </div>
        )}

        {!error && !data?.loginRequired && items.map((n) => (
          <CenterRow key={n.id} notification={n} read={effectiveRead(n, readIds)} />
        ))}

        {!error && !data && loading && (
          <div className="space-y-6 py-6" aria-busy="true" aria-label="Loading notifications">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-2">
                <Skeleton className="aspect-video w-[160px] shrink-0 rounded-xl sm:w-[246px]" />
                <div className="flex-1 space-y-2 pt-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {data?.hasMore && (
          <div className="flex justify-center py-6">
            <Button
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              disabled={loading}
              data-testid="notifications-show-more"
            >
              {loading ? "Loading…" : "Show more"}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

/** One full feed row — youtube.com's center rendering: the video thumbnail
 * (channel avatar for community posts), channel, snippet, age, unread dot. */
function CenterRow({ notification: n, read }: { notification: NotificationDTO; read: boolean }) {
  const href = n.videoId ? `/watch/${n.videoId}` : n.channel?.handle ? `/channel/${n.channel.handle}` : "#";
  const thumbnail = n.videoId ? n.videoThumbnailUrl : n.channel?.avatarUrl || n.videoThumbnailUrl;
  const channelName = n.channel?.name ?? "";
  const title = channelName ? n.title.replace(channelName, "").trim() : n.title;
  return (
    <Link
      href={href}
      onClick={() => openNotification(n.id)}
      data-testid="notification-center-row"
      className={cn(
        "flex gap-4 px-2 py-4 transition-colors hover:bg-accent/50 sm:px-4",
        !read && "bg-primary/[0.06]"
      )}
    >
      {n.videoId ? (
        <div className="relative aspect-video w-[160px] shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-[246px]">
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" className="size-full object-cover" />
          ) : null}
          {n.kind === "live" && (
            <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-yt-red px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
              <Radio className="size-2.5" /> Live
            </span>
          )}
        </div>
      ) : (
        <div className="relative size-12 shrink-0">
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" className="size-12 rounded-full object-cover" />
          ) : (
            <div className="size-12 rounded-full bg-secondary" aria-hidden="true" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1 pt-1">
        <p className="line-clamp-2 text-sm text-foreground">
          {channelName && <span className="font-medium">{channelName}</span>} {title}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.body}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRelativeDate(n.createdAt)}</p>
      </div>
      {!read && (
        <span
          data-testid="unread-dot"
          className="mt-3 size-2 shrink-0 rounded-full bg-primary"
          aria-label="unread"
        />
      )}
    </Link>
  );
}
