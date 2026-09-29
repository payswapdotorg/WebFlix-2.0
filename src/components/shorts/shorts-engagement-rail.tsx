"use client";

import Link from "next/link";
import { MessageCircle, Share2, ThumbsUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShortDTO } from "@/lib/youtube/shorts";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts engagement rail.
 *
 * YouTube-Shorts-style vertical action rail pinned to the player's bottom
 * right. Like / comments / share affordances:
 *   - Like is VISUAL ONLY in this lane (a slot for WFX2-D interactions —
 *     no like API exists for shorts yet; no fake toggling).
 *   - Comments opens the sheet (wired by the parent feed).
 *   - Share copies the internal /watch/{id} link (wired by the parent).
 *   - Subscribe is deliberately NOT rendered — A-W owns subscribe actions.
 *
 * All data (likes/comments counts, channel) comes through /api/shorts
 * (seed item or hydrated meta passed as `meta` by the feed).
 */

/** "2,457,856" / "768K" → "2.4M" / "768K" (compact rail label). */
function compactCount(text: string | null): string {
  if (!text) return "";
  const m = text.match(/([\d.,]+)/);
  if (!m) return text;
  const raw = m[1].replace(/,/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return text;
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return raw;
}

function RailAction({
  label,
  icon,
  count,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {icon}
      </button>
      {count ? (
        <span
          className="text-center text-xs font-medium leading-none text-white/90"
          aria-hidden="true"
        >
          {count}
        </span>
      ) : null}
      <span className="sr-only">{count ? `${label} (${count})` : label}</span>
    </div>
  );
}

export function ShortsEngagementRail({
  meta,
  onOpenComments,
  onShare,
}: {
  meta: ShortDTO | null;
  onOpenComments: () => void;
  onShare: () => void;
}) {
  const channel = meta?.channel ?? null;
  const likesLabel = meta?.likesText
    ? compactCount(meta.likesText) || meta.likesText
    : "";
  const commentsLabel = meta?.commentsCountText
    ? compactCount(meta.commentsCountText) || meta.commentsCountText
    : "";

  const channelChip =
    channel && (channel.name || channel.handle) ? (
      channel.handle ? (
        <Link
          href={`/channel/${channel.handle}`}
          aria-label={`Go to ${channel.name ?? channel.handle}`}
          className="flex flex-col items-center gap-1 rounded-full p-1 transition-transform duration-150 hover:scale-105"
        >
          <img
            src={channel.avatarUrl ?? ""}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-9 rounded-full bg-white/10 object-cover"
          />
          <span className="max-w-16 truncate text-[11px] font-medium leading-none text-white/90">
            {channel.name ?? channel.handle}
          </span>
        </Link>
      ) : (
        <div className="flex flex-col items-center gap-1 p-1">
          <img
            src={channel.avatarUrl ?? ""}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-9 rounded-full bg-white/10 object-cover"
          />
          <span className="max-w-16 truncate text-[11px] font-medium leading-none text-white/90">
            {channel.name}
          </span>
        </div>
      )
    ) : (
      <div className="flex flex-col items-center gap-1 p-1" aria-hidden="true">
        <Skeleton className="size-9 rounded-full bg-white/15" />
        <Skeleton className="h-2.5 w-12 rounded bg-white/15" />
      </div>
    );

  return (
    <div className="absolute bottom-16 right-2 z-20 flex flex-col items-center gap-4">
      {/* Like: display-only slot for WFX2-D interactions (no shorts like API yet). */}
      <RailAction
        label="Like this short"
        icon={<ThumbsUp className="size-5 fill-white/10" />}
        count={likesLabel}
      />
      <RailAction
        label="Open comments"
        icon={<MessageCircle className="size-5" />}
        count={commentsLabel}
        onClick={onOpenComments}
      />
      <RailAction
        label="Share this short"
        icon={<Share2 className="size-5" />}
        count="Share"
        onClick={onShare}
      />
      {channelChip}
    </div>
  );
}
