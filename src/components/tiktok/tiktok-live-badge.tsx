"use client";

/**
 * P100-TIKTOK-LIVE — the channel-page LIVE badge: rendered ONLY for a status
 * that is actually live (probing/offline/error render honest absence — a
 * badge that lies about liveness is worse than none). The Watch-live CTA
 * rides the in-app live surface, not TikTok.
 */
import Link from "next/link";
import { Radio } from "lucide-react";

import { formatCount } from "@/lib/format";
import type { TikTokLiveStatusDTO } from "@/lib/tiktok/live";
import { tiktokLiveHref } from "@/lib/tiktok/urls";

export function TikTokLiveBadge({ status }: { status: TikTokLiveStatusDTO | null }) {
  if (!status || status.live !== true) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="tiktok-live-badge">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">
        <Radio className="size-3 animate-pulse" aria-hidden="true" />
        LIVE
      </span>
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
