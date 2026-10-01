"use client";

/**
 * WFX2-W action row — like/dislike segmented control with live counts +
 * optimistic toggle (one like OR one dislike; swap allowed), Share, Save,
 * and the kebab (Report / Show transcript / Not interested).
 *
 * WFX2-P2-AU: WebFlix guests never fire the write actions — like/dislike
 * and Not interested route to /signin (redirect back to this watch page).
 * Share and Show transcript stay public (youtube.com parity).
 *
 * WFX2-P4-QT: Add to queue joins the row — the WL-backed queue append
 * (wired by watch-page: guest gate + the real watch-later write first).
 */
import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Flag,
  ListPlus,
  MoreVertical,
  Share2,
  ThumbsDown,
  ThumbsUp,
  FileText,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { post } from "@/lib/watch/client";
import { signInHref } from "@/lib/auth/client";
import { compactCount } from "@/lib/watch/format";
import type { LikeValue } from "@/lib/watch/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ActionRow({
  videoId,
  likes,
  dislikes,
  yourLike,
  savedWatchLater,
  guest = false,
  onLikeResult,
  onSavedChange,
  onShare,
  onSave,
  onToggleTranscript,
  onReport,
  onAddToQueue,
  queued = false,
}: {
  videoId: string;
  likes: number;
  dislikes: number;
  yourLike: LikeValue | null;
  savedWatchLater: boolean;
  /** WFX2-P2-AU: no WebFlix account → writes route to the sign-in prompt */
  guest?: boolean;
  onLikeResult: (r: { likes: number; dislikes: number; yourLike: LikeValue | null }) => void;
  onSavedChange?: (watchLater: boolean) => void;
  onShare: () => void;
  onSave: () => void;
  onToggleTranscript: () => void;
  onReport: () => void;
  /** WFX2-P4-QT: the WL-backed queue append (the guest gate + honest states
   * live in the watch-page wiring). */
  onAddToQueue: () => void;
  /** the video is already in the session queue → the pressed affordance */
  queued?: boolean;
}) {
  const [state, setState] = useState({ likes, dislikes, yourLike });
  const [synced, setSynced] = useState({ likes, dislikes, yourLike });
  const [saved, setSaved] = useState(savedWatchLater);
  const [busy, setBusy] = useState(false);

  // reconcile when server truth refreshes (adjust-state-during-render pattern)
  if (
    !busy &&
    (synced.likes !== likes || synced.dislikes !== dislikes || synced.yourLike !== yourLike)
  ) {
    setSynced({ likes, dislikes, yourLike });
    setState({ likes, dislikes, yourLike });
  }

  const toggleLike = async (value: LikeValue) => {
    if (busy) return;
    if (guest) {
      // WFX2-P2-AU: the account gate — never a guest write
      window.location.assign(signInHref(`/watch/${videoId}`));
      return;
    }
    setBusy(true);
    // optimistic: same → unset; other → swap; none → set
    const optimistic = { ...state };
    if (state.yourLike === value) {
      optimistic.yourLike = null;
      if (value === "like") optimistic.likes = state.likes - 1;
      else optimistic.dislikes = state.dislikes - 1;
    } else if (state.yourLike === null) {
      optimistic.yourLike = value;
      if (value === "like") optimistic.likes = state.likes + 1;
      else optimistic.dislikes = state.dislikes + 1;
    } else {
      optimistic.yourLike = value;
      if (value === "like") {
        optimistic.likes = state.likes + 1;
        optimistic.dislikes = state.dislikes - 1;
      } else {
        optimistic.likes = state.likes - 1;
        optimistic.dislikes = state.dislikes + 1;
      }
    }
    setState(optimistic);
    try {
      const result = await post<{ likes: number; dislikes: number; yourLike: LikeValue | null }>(
        `/api/videos/${videoId}/like`,
        {
          value,
          // the UI's current counts — keeps the response honest (WFX2-A-W)
          baseline: { likes: state.likes, dislikes: state.dislikes, yourLike: state.yourLike },
        }
      );
      // reconcile with server truth
      setState(result);
      onLikeResult(result);
    } catch (e) {
      setState({ likes, dislikes, yourLike });
      toast.error(e instanceof Error ? e.message : "Failed to update rating");
    } finally {
      setBusy(false);
    }
  };

  const notInterested = async () => {
    if (guest) {
      window.location.assign(signInHref(`/watch/${videoId}`));
      return;
    }
    try {
      await post(`/api/videos/${videoId}/not-interested`);
      toast.success("We won't recommend this video to you");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* like / dislike segmented pill */}
      <div
        className="flex h-9 items-center rounded-full bg-secondary sm:h-10"
        role="group"
        aria-label="Rate this video"
      >
        <button
          type="button"
          onClick={() => toggleLike("like")}
          aria-pressed={state.yourLike === "like"}
          aria-label={`Like this video along with ${compactCount(state.likes)} other people`}
          className="flex h-full items-center gap-2 rounded-l-full pl-3.5 pr-3 text-sm font-medium transition hover:bg-secondary/70 active:scale-[0.97] disabled:opacity-50"
          disabled={busy}
        >
          <ThumbsUp
            className={cn("size-5", state.yourLike === "like" && "fill-current text-[#f03]")}
            aria-hidden="true"
          />
          <span className="tabular-nums">{compactCount(state.likes)}</span>
        </button>
        <div className="h-6 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={() => toggleLike("dislike")}
          aria-pressed={state.yourLike === "dislike"}
          aria-label={`Dislike this video along with ${compactCount(state.dislikes)} other people`}
          title={`${compactCount(state.dislikes)} dislikes`}
          className="flex h-full items-center rounded-r-full px-3.5 transition hover:bg-secondary/70 active:scale-[0.97] disabled:opacity-50"
          disabled={busy}
        >
          <ThumbsDown
            className={cn("size-5", state.yourLike === "dislike" && "fill-current text-[#f03]")}
            aria-hidden="true"
          />
        </button>
      </div>

      <PillButton
        label="Share"
        icon={<Share2 className="size-5" aria-hidden="true" />}
        onClick={onShare}
      />
      <PillButton
        label="Save"
        icon={
          saved ? (
            <BookmarkCheck className="size-5" aria-hidden="true" />
          ) : (
            <Bookmark className="size-5" aria-hidden="true" />
          )
        }
        onClick={() => {
          setSaved((s) => !s);
          onSave();
        }}
        pressed={saved}
      />
      {/* WFX2-P4-QT: Add to queue — the WL-backed queue append */}
      <PillButton
        label="Add to queue"
        icon={<ListPlus className="size-5" aria-hidden="true" />}
        onClick={onAddToQueue}
        pressed={queued}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            className="flex h-9 items-center rounded-full bg-secondary px-3 text-sm font-medium transition hover:bg-secondary/70 active:scale-[0.97] sm:h-10"
          >
            <MoreVertical className="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={onToggleTranscript}
            className="cursor-pointer gap-3 py-2.5 text-sm"
          >
            <FileText className="size-4" aria-hidden="true" />
            Show transcript
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void notInterested();
            }}
            className="cursor-pointer gap-3 py-2.5 text-sm"
          >
            <Ban className="size-4" aria-hidden="true" />
            Not interested
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onReport} className="cursor-pointer gap-3 py-2.5 text-sm">
            <Flag className="size-4" aria-hidden="true" />
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PillButton({
  label,
  icon,
  onClick,
  pressed,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium transition hover:bg-secondary/70 active:scale-[0.97] sm:h-10"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
