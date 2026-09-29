"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Bell, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApi, postJson } from "@/hooks/use-api";
import { formatRelativeDate } from "@/lib/format";
import type { NotificationDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

type NotificationsPayload = {
  unread: number;
  items: NotificationDTO[];
  pollIntervalMs?: number | null;
  loginRequired?: boolean;
  session?: boolean;
};

/** Notifications bell — live unread badge from the API, menu, mark-all-read. */
export function NotificationsBell() {
  const { data, reload } = useApi<NotificationsPayload>("/api/notifications");
  const unread = data?.unread ?? 0;

  // Live badge: poll on the upstream's own cadence (default 60s) + on focus.
  useEffect(() => {
    const interval = setInterval(reload, Math.max(30_000, data?.pollIntervalMs ?? 60_000));
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, data?.pollIntervalMs]);

  async function markAllRead() {
    try {
      await postJson("/api/notifications/read", {});
      reload();
      toast.success("All notifications marked as read");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark read");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ""}`}
          className="relative rounded-full"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-yt-red px-1 text-[11px] font-semibold leading-none text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] max-w-[92vw] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <DropdownMenuLabel className="p-0 text-base font-semibold">Notifications</DropdownMenuLabel>
          <button
            type="button"
            onClick={markAllRead}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            data-testid="mark-all-read"
          >
            Mark all as read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto slim-scrollbar">
          {data?.loginRequired && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Notifications are personal — sign in (configure the YouTube session) to read
              them. Empty is also valid when the account has none.
            </p>
          )}
          {!data?.loginRequired && (data?.items ?? []).length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          )}
          {(data?.items ?? []).map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
          {!data &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-3" aria-hidden="true">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-secondary" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-secondary" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-secondary" />
                </div>
              </div>
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ notification: n }: { notification: NotificationDTO }) {
  const href = n.videoId ? `/watch/${n.videoId}` : n.channel ? `/channel/${n.channel.handle}` : "#";
  return (
    <Link
      href={href}
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors hover:bg-accent/50",
        !n.read && "bg-primary/[0.06]"
      )}
    >
      <div className="relative shrink-0">
        <img
          src={n.channel.avatarUrl}
          alt=""
          loading="lazy"
          className="size-10 rounded-full object-cover"
        />
        {n.kind === "live" && (
          <span className="absolute -bottom-1 -right-1 flex items-center gap-0.5 rounded-full bg-yt-red px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            <Radio className="size-2.5" /> Live
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm text-foreground">
          <span className="font-medium">{n.channel.name}</span> {n.title.replace(n.channel.name, "").trim()}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.body}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRelativeDate(n.createdAt)}</p>
      </div>
      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="unread" />}
    </Link>
  );
}
