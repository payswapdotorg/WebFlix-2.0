"use client";

/**
 * P100-TIKTOK-LIVE — the channel-page LIVE badge: rendered ONLY for a status
 * that is actually live (probing/offline/error render honest absence — a
 * badge that lies about liveness is worse than none). The Watch-live CTA
 * rides the in-app live surface, not TikTok.
 *
 * WFX2-M2 (f) — the stale-stamp law: the P102-R2 SWR layer serves
 * `stale: true` + `fetchedAt` while a refresh probe rides; a stale answer
 * must never read as current. The pill turns amber, drops the pulse, and a
 * "stale · as of <age>" note rides beside it. The shared note component is
 * exported so the in-app live view's stage pill carries the SAME stamp.
 */
import Link from "next/link";
import { Radio } from "lucide-react";

import { formatCount, formatRelativeDate } from "@/lib/format";
import type { TikTokLiveStatusDTO } from "@/lib/tiktok/live";
import { tiktokLiveHref } from "@/lib/tiktok/urls";

export function TikTokLiveStaleNote({ fetchedAt, testid }: { fetchedAt: string; testid: string }) {
  return (
    <span className="text-xs text-muted-foreground" data-testid={testid}>
      stale · as of {formatRelativeDate(fetchedAt)}
    </span>
  );
}

export function TikTokLiveBadge({ status }: { status: TikTokLiveStatusDTO | null }) {
  if (!status || status.live !== true) return null;
  const isStale = status.stale === true;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      data-testid="tiktok-live-badge"
      data-stale={isStale ? "true" : "false"}
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${
          isStale ? "bg-amber-600" : "bg-red-600"
        }`}
      >
        <Radio className={`size-3 ${isStale ? "" : "animate-pulse"}`} aria-hidden="true" />
        LIVE
      </span>
      {isStale ? (
        <TikTokLiveStaleNote fetchedAt={status.fetchedAt} testid="tiktok-live-badge-stale" />
      ) : null}
      {typeof status.room?.viewers === "number" ? (
        <span className="text-xs text-muted-foreground">
          {formatCount(status.room.viewers)} watching
        </span>
      ) : null}
      <Link
        href={tiktokLiveHref(status.handle)}
        data-testid="tiktok-live-watch-cta"
        className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Watch live
      </Link>
    </span>
  );
}
