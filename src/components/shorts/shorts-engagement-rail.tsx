"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  BookmarkCheck,
  BookmarkPlus,
  Disc3,
  Flag,
  Link2,
  MessageCircle,
  MoreVertical,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserX,
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
import { soundTokenToKeyLink } from "@/lib/youtube/sound-key";

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
 *   link (the share handler), Not interested, Don't recommend channel
 *   (P24-SEND G12 — the seam landed: the broker's home-feed kebab drive,
 *   the not-interested sibling) + the feedback-toast UNDO affordance on
 *   both feedback writes (youtube.com's own family: the toast carries an
 *   Undo button while its window is live; the drive clicks youtube.com's
 *   own toast button — an expired window surfaces the honest failure,
 *   never a fake restoration).
 *
 * HONEST ABSENCE (youtube.com ships these; this app has NO real seam —
 * never a fake affordance, per the create-menu precedent):
 * - Captions / Playback speed in the ⋯ menu — the embed runs controls=0
 *   and cannot honor them; no seams exist. (P24-SEND G12 note: "Don't
 *   recommend channel" LEFT this list — its write seam is real now; the
 *   login-scoped menu family rides the operator tab like Not
 *   interested, per the station's measured evidence pack.)
 *
 * P23-C (G5, 2026-10-17) — the SOUND DISC (real, measured live — see
 * evidence/wfx2p23c/DISCOVERY.md): youtube.com's rail carries the pivot
 * disc as its LAST slot (40×40 on mobile, spinning while the short plays,
 * contentDescription "See more videos using this sound"). The reel
 * sequence's entries carry the sound (pivotButtonViewModel: the title + the
 * disc artwork + the audio-pivot browse continuation) — the DTO now maps it
 * (soundId/soundTitle/soundImageUrl) and the disc links /sound/<key> (the
 * browse continuation read — youtube.com's own sound-surface mechanism).
 * Bare entries carry NO sound → the disc hides (honest absence, never a
 * dead link). Desktop 2026 opens the audio-pivot side panel on click; the
 * mobile web navigates (measured: the pivot renders as
 * <a href="/source/…">) — WebFlix ships the PAGE form per the work order;
 * navigating unmounts the feed (the pause-equivalent). The exact rotation
 * duration could NOT be measured from this egress (the player never boots
 * there) — 4s linear implemented per the audit description, documented.
 *
 * P23-C (G6, 2026-10-17) — REMIX (measured live): youtube.com's rail carries
 * Remix between Share and the disc (iconName REMIX_FILLED, accessibilityId
 * id.reel_remix_button), and for videos that cannot be remixed youtube.com
 * ITSELF honest-degrades: state BUTTON_VIEW_MODEL_STATE_DISABLED (DOM
 * aria-disabled="true") with an addToToastAction toast — "Feature not
 * available for this video". WebFlix has NO shorts-creation flow at all
 * (the upload wizard is long-form only; the broker registry carries no
 * remix/shorts-creation kind — verified), so the WebFlix Remix rides in
 * youtube.com's own disabled form: rendered, aria-disabled, never faking
 * work, with the honest note "Shorts creation is not available in WebFlix"
 * (youtube.com's own honest-toast pattern, mirrored).
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
  ariaDisabled,
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
  /**
   * youtube.com's own disabled form (measured on the Remix entry:
   * aria-disabled="true" — the button stays focusable, the honest toast
   * still answers a click). `disabled` (below) removes it from the flow.
   */
  ariaDisabled?: boolean;
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
        aria-disabled={ariaDisabled || disabled || undefined}
        disabled={disabled}
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50",
          ariaDisabled && "opacity-60 hover:scale-100",
        )}
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
  playing,
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
  /** true while this slide IS the active one — gates the disc's rotation. */
  playing: boolean;
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

  // ---- Not interested — the real feed action (video stays visible) -----
  // P24-SEND (G12): youtube.com's own family — the feedback toast carries
  // the UNDO affordance while its window is live (the drive clicks
  // youtube.com's own toast button); the video itself stays on the slide.
  const undoFeedback = async (undoUrl: string) => {
    try {
      await post(undoUrl);
      toast.success("Recommendations restored");
    } catch (e) {
      toastActionError(
        e,
        "Undo is no longer available — YouTube's undo window has closed",
      );
    }
  };

  const notInterested = async () => {
    if (guest) {
      gate();
      return;
    }
    try {
      await post(`/api/videos/${videoId}/not-interested`);
      toast("Video removed", {
        action: {
          label: "Undo",
          onClick: () => void undoFeedback("/api/not-interested/undo"),
        },
      });
    } catch (e) {
      toastActionError(e, "Failed");
    }
  };

  // ---- Don't recommend channel (P24-SEND G12 — the seam landed) ---------
  // The not-interested sibling: the channel this short carries is the one
  // youtube.com stops recommending (the broker's home-feed kebab drive by
  // text anchor — the station's measured evidence: the item is login-scoped
  // on youtube.com, so the write rides the logged-in operator tab).
  const dontRecommendChannel = async () => {
    if (guest) {
      gate();
      return;
    }
    try {
      await post("/api/dont-recommend-channel", { videoId });
      toast("We won't recommend this channel anymore", {
        action: {
          label: "Undo",
          onClick: () => void undoFeedback("/api/dont-recommend-channel/undo"),
        },
      });
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
      {/* Remix (P23-C G6) — youtube.com's own rail slot (between Share and
          the disc, measured). WebFlix has no shorts-creation flow: the entry
          renders in youtube.com's own DISABLED honest form — aria-disabled,
          never faking work; the click surfaces the honest note (youtube.com's
          own addToToastAction pattern for non-remixable videos). */}
      <RailAction
        label="Remix"
        icon={<Disc3 className="size-6" aria-hidden="true" />}
        count="Remix"
        ariaDisabled
        onClick={() => {
          // youtube.com's own honest toast family, mirrored for WebFlix's
          // honest absence: the affordance cannot work and never pretends to
          toast.info("Shorts creation is not available in WebFlix");
        }}
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
          <DropdownMenuItem
            onClick={() => void dontRecommendChannel()}
            className="cursor-pointer gap-3 py-3 text-sm"
          >
            <UserX className="size-4" aria-hidden="true" />
            Don&apos;t recommend channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The sound disc (P23-C G5) — youtube.com's own rail-end slot (the
          pivot; measured). The disc artwork + the sound's page token ride the
          sequence DTO (soundId/soundTitle/soundImageUrl); when the feed's own
          data carries no sound for this entry the disc hides entirely —
          honest absence, never a dead link. Rotates while this slide plays
          (CSS keyframes, globals.css); the label under it is the sound title
          (youtube.com's pivot carries the attribution there). */}
      {meta?.soundId ? (
        <Link
          href={soundTokenToKeyLink(meta.soundId)}
          aria-label={`See more videos using this sound${meta.soundTitle ? `: ${meta.soundTitle}` : ""}`}
          className="group mt-1 flex flex-col items-center"
        >
          <span
            data-testid="shorts-sound-disc"
            data-paused={playing ? undefined : "true"}
            className="wfx-sound-disc flex size-10 items-center justify-center overflow-hidden rounded-full bg-black/30 ring-1 ring-white/20 backdrop-blur transition-transform duration-150 group-hover:scale-105 group-focus-visible:scale-105"
          >
            {meta.soundImageUrl ? (
              <img
                src={meta.soundImageUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <Disc3 className="size-5 text-white" aria-hidden="true" />
            )}
          </span>
          <span
            className="mt-1 max-w-12 truncate text-center text-[10px] font-normal leading-[18px] text-white/90"
            aria-hidden="true"
          >
            {meta.soundTitle ?? ""}
          </span>
        </Link>
      ) : null}
    </div>
  );
}
