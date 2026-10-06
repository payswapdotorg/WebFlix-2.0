"use client";

import { useState } from "react";
import {
  Ban,
  BookmarkCheck,
  BookmarkPlus,
  Flag,
  Link2,
  MessageCircle,
  MoreVertical,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { post } from "@/lib/watch/client";
import { toastActionError } from "@/lib/watch/connection-client";
import { signInHref } from "@/lib/auth/client";
import type { LikeResultDto, LikeValue } from "@/lib/watch/types";
import type { ShortDTO } from "@/lib/youtube/shorts";

/**
 * P15-SHORTS — YouTube-parity shorts engagement rail.
 *
 * youtube.com measurements (2026-10-06, desktop 1280×900 + mobile 412×915,
 * signed-out): 48×48 round tonal buttons (bg rgba(0,0,0,0.3), 24px icons),
 * unit pitch 78px (button 48 + 4px + 18px label + 8px gap between units),
 * labels 12px/400. Like carries the count, Comments the count, Share the
 * word "Share"; Dislike NEVER carries a count (youtube.com hides it); the ⋯
 * has no label. The rail overlays the video's right edge (mobile layout —
 * desktop youtube.com moves it outside the player; this app keeps the
 * 9:16-slide right-edge anchoring) with a 12px inset, the last rail
 * element's bottom 64px above the player bottom.
 *
 * Rail actions — REAL seams only (the create-menu honest-absence precedent):
 * - Like / Dislike — LIVE via the watch page's seam: POST /api/videos/{id}/like
 *   {value, baseline} with the ActionRow idiom (optimistic set/swap/unset,
 *   aria-pressed + filled icon when pressed, honest revert on failure,
 *   guest gate → signInHref("/shorts"), broker-offline → toastActionError).
 *   Shorts ARE videos — the route serves a shorts videoId AS-IS. There is no
 *   per-user rating READ for shorts: the pressed state is session-local,
 *   keyed per short id (one rail instance per slide), starting unpressed.
 *   The like label keeps the real likesText (optimistic ±1 only while
 *   parseable; the response's DOM-observed count wins). Dislike shows no
 *   count — never a fabricated one.
 * - Comments opens the sheet (wired by the parent feed); Share copies the
 *   /watch/{id} link (the parent's handler).
 * - More (⋯) — the app's real actions: Report (the watch report dialog,
 *   read-only reuse), Save to Watch later (the broker's WL write of
 *   YouTube's own Watch later playlist, pressed state when saved), Copy
 *   link (the share handler), Not interested.
 *
 * HONEST ABSENCE (youtube.com ships these; this app has NO real seam —
 * never a fake affordance, per the create-menu precedent):
 * - Remix — no remix flow exists anywhere in src/ (/upload is the upload
 *   wizard, not a remix surface).
 * - The rotating sound disc — the shorts DTOs (src/lib/youtube/shorts.ts,
 *   lead-owned) carry no sound/music metadata and the app has no sound page
 *   to link; a spinning thumbnail disc with a dead link would be fake.
 * - Captions / Playback speed / Don't recommend channel in the ⋯ menu — the
 *   embed runs controls=0 and cannot honor them; no seams exist.
 */

/** "612" / "768K" / "2.4M" / "1,234 views" → 612 / 768000 / 2400000 / 1234 (null when unparseable). */
function parseCountLabel(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*(K|M|B)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult =
    { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

/** 612 → "612", 1500 → "1.5K", 768000 → "768K" (the youtube.com rail label format). */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** A count-ish text → its compact rail label (raw passthrough when unparseable). */
function compactCount(text: string | null): string {
  const n = parseCountLabel(text);
  return n === null ? (text ?? "") : formatCount(n);
}

/** The ActionRow's optimistic like-count delta (likes only — dislikes never display). */
function optimisticCount(
  prev: LikeValue | null,
  next: LikeValue | null,
  n: number,
): number {
  if (prev === next) return n;
  if (next === "like") return n + 1; // none→like, dislike→like (swap)
  if (prev === "like") return Math.max(0, n - 1); // like→dislike (swap), like→none (unset)
  return n; // none→dislike, dislike→none — the like count is untouched
}

function RailAction({
  label,
  icon,
  count,
  loading = false,
  pressed,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  /**
   * The label under the button (youtube.com: the count under Like/Comments,
   * "Share" under Share). `null` = no label slot at all (Dislike, ⋯);
   * `""` = the slot is reserved but empty (no fabricated content).
   */
  count: string | null;
  /** Meta hydration pending → a skeleton inside the reserved slot (no layout shift). */
  loading?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const showSkeleton = loading && !count;
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
      >
        {icon}
      </button>
      {count !== null ? (
        <span
          className="mt-1 flex h-[18px] w-12 items-center justify-center text-center text-xs font-normal leading-[18px] text-white/90"
          aria-hidden="true"
        >
          {showSkeleton ? (
            <Skeleton className="h-2.5 w-8 rounded bg-white/25" />
          ) : (
            count
          )}
        </span>
      ) : null}
      <span className="sr-only">
        {count && !showSkeleton ? `${label} (${count})` : label}
      </span>
    </div>
  );
}

export function ShortsEngagementRail({
  videoId,
  meta,
  metaLoading,
  guest,
  onOpenComments,
  onShare,
  onReport,
}: {
  videoId: string;
  meta: ShortDTO | null;
  /** true while /api/shorts/{id} hydration is pending (label skeletons). */
  metaLoading: boolean;
  /** WebFlix guests never fire writes — the watch gate idiom (signInHref). */
  guest: boolean;
  onOpenComments: () => void;
  onShare: () => void;
  onReport: () => void;
}) {
  // ---- session-local rating state (no per-user rating READ for shorts) ----
  const [yourLike, setYourLike] = useState<LikeValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [interacted, setInteracted] = useState(false);

  // ---- like-count label: the real likesText; ±1 only while parseable ------
  const likesText = meta?.likesText ?? null;
  const [count, setCount] = useState<number | null>(() => parseCountLabel(likesText));
  const [syncedText, setSyncedText] = useState(likesText);
  // reconcile while meta hydrates (adjust-state-during-render, the ActionRow
  // pattern); once a live response has landed, our count is the freshest truth
  if (!busy && !interacted && syncedText !== likesText) {
    setSyncedText(likesText);
    setCount(parseCountLabel(likesText));
  }

  // ---- Watch later pressed state (session-local, per short id) ------------
  const [saved, setSaved] = useState(false);
  const [wlBusy, setWlBusy] = useState(false);

  const gate = () => {
    // never a guest write — the watch page's account gate idiom
    window.location.assign(signInHref("/shorts"));
  };

  // ---- Like / Dislike — the watch seam, the ActionRow idiom ----------------
  const toggleLike = async (value: LikeValue) => {
    if (busy) return;
    if (guest) {
      gate();
      return;
    }
    setBusy(true);
    const prevLike = yourLike;
    const next: LikeValue | null = prevLike === value ? null : value; // set / swap / unset
    setYourLike(next);
    const prevCount = count;
    if (prevCount !== null) setCount(optimisticCount(prevLike, next, prevCount));
    try {
      const result = await post<LikeResultDto>(`/api/videos/${videoId}/like`, {
        value,
        baseline: {
          // the UI's current count keeps the response honest (WFX2-A-W);
          // unparseable labels send no number — the response's delta is
          // ignored for display (never a fabricated count)
          likes: prevCount ?? undefined,
          dislikes: 0, // youtube.com never shows a shorts dislike count
          yourLike: prevLike,
        },
      });
      setInteracted(true);
      setYourLike(result.yourLike);
      if (prevCount !== null && Number.isFinite(result.likes)) {
        setCount(result.likes); // the DOM-observed count wins
      }
    } catch (e) {
      setYourLike(prevLike); // honest revert
      if (prevCount !== null) setCount(prevCount);
      toastActionError(e, "Failed to update rating");
    } finally {
      setBusy(false);
    }
  };

  // ---- Save to Watch later — the broker's WL write (toggle) ----------------
  const toggleWatchLater = async () => {
    if (wlBusy) return;
    if (guest) {
      gate();
      return;
    }
    setWlBusy(true);
    const prev = saved;
    setSaved(!prev);
    try {
      const res = await post<{ added: boolean }>("/api/playlists/watch-later", {
        videoId,
      });
      setSaved(res.added);
      toast.success(res.added ? "Saved to Watch later" : "Removed from Watch later");
    } catch (e) {
      setSaved(prev); // honest revert
      toastActionError(e, "Failed to save");
    } finally {
      setWlBusy(false);
    }
  };

  // ---- Not interested — the real feed action (video stays visible) ---------
  const notInterested = async () => {
    if (guest) {
      gate();
      return;
    }
    try {
      await post(`/api/videos/${videoId}/not-interested`);
      toast.success("We won't recommend this video to you");
    } catch (e) {
      toastActionError(e, "Failed");
    }
  };

  const likeLabel =
    count !== null ? formatCount(count) : likesText ? compactCount(likesText) : "";
  const commentsLabel = meta?.commentsCountText
    ? compactCount(meta.commentsCountText)
    : "";

  return (
    <div className="absolute bottom-16 right-3 z-20 flex flex-col items-center gap-2">
      {/* Like — LIVE via the watch seam (was display-only; the seam landed). */}
      <RailAction
        label="Like this short"
        icon={
          <ThumbsUp
            className={cn("size-6", yourLike === "like" && "fill-current text-[#f03]")}
            aria-hidden="true"
          />
        }
        count={likeLabel}
        loading={metaLoading}
        pressed={yourLike === "like"}
        disabled={busy}
        onClick={() => void toggleLike("like")}
      />
      {/* Dislike — the same live seam; youtube.com shows NO dislike count. */}
      <RailAction
        label="Dislike this short"
        icon={
          <ThumbsDown
            className={cn(
              "size-6",
              yourLike === "dislike" && "fill-current text-[#f03]",
            )}
            aria-hidden="true"
          />
        }
        count={null}
        pressed={yourLike === "dislike"}
        disabled={busy}
        onClick={() => void toggleLike("dislike")}
      />
      <RailAction
        label="Open comments"
        icon={<MessageCircle className="size-6" aria-hidden="true" />}
        count={commentsLabel}
        loading={metaLoading}
        onClick={onOpenComments}
      />
      <RailAction
        label="Share this short"
        icon={<Share2 className="size-6" aria-hidden="true" />}
        count="Share"
        onClick={onShare}
      />
      {/* More (⋯) — the app's real actions only; honest absence otherwise. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <MoreVertical className="size-6" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-52">
          <DropdownMenuItem
            onClick={() => {
              if (guest) {
                gate(); // the report route is auth-gated — gate before the dialog
                return;
              }
              onReport();
            }}
            className="cursor-pointer gap-3 py-3 text-sm"
          >
            <Flag className="size-4" aria-hidden="true" />
            Report
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void toggleWatchLater()}
            className="cursor-pointer gap-3 py-3 text-sm"
          >
            {saved ? (
              <BookmarkCheck className="size-4" aria-hidden="true" />
            ) : (
              <BookmarkPlus className="size-4" aria-hidden="true" />
            )}
            Save to Watch later
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShare} className="cursor-pointer gap-3 py-3 text-sm">
            <Link2 className="size-4" aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void notInterested()}
            className="cursor-pointer gap-3 py-3 text-sm"
          >
            <Ban className="size-4" aria-hidden="true" />
            Not interested
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
