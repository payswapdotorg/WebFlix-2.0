"use client";

/**
 * WFX2-P23-A — the player's context menu (the Stats-for-nerds entry rung,
 * measured live on youtube.com 2026-10-17: the player's right-click menu —
 * Loop · Miniplayer · Copy video URL · Copy video URL at current time ·
 * Copy embed code · Copy debug info · Troubleshoot playback issue · Stats
 * for nerds).
 *
 * HONEST SCOPE: WebFlix's player is the cross-origin YouTube IFrame embed —
 * right-clicks over the LIVE iframe never reach this page (they open the
 * embed's own menu). This menu fires wherever the PAGE owns the player
 * pixels: the fallback native player, the wall/premiere covers, and the
 * container's chrome. The rungs served here are exactly the measured
 * youtube.com rungs WebFlix can honestly execute page-side: Copy video
 * URL, Copy video URL at current time, and Stats for nerds. (The
 * always-available entry over the live embed is the watch page's control
 * rung — see watch-page.tsx.)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatTimestampParam } from "@/lib/watch/share";
import { playerHost } from "@/lib/player/player-host";

export interface PlayerContextMenuState {
  x: number;
  y: number;
}

export function PlayerContextMenu({
  state,
  onClose,
  onStatsForNerds,
  videoId,
}: {
  state: PlayerContextMenuState;
  onClose: () => void;
  onStatsForNerds: () => void;
  videoId: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // dismiss: outside click / Escape (the house menu law)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error(`Could not copy — ${label.toLowerCase()} copy failed`);
    }
    onClose();
  }, [onClose]);

  const base = typeof window !== "undefined" ? window.location.origin : "";
  const videoUrl = `${base}/watch/${videoId}`;
  const now = playerHost.getPosition();
  const videoUrlAt = now > 0 ? `${videoUrl}?t=${formatTimestampParam(Math.floor(now))}` : videoUrl;

  const itemClass =
    "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm text-white/95 hover:bg-white/15 focus-visible:bg-white/15 focus-visible:outline-none";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Player context menu"
      data-testid="player-context-menu"
      className="fixed z-[80] min-w-56 rounded-md py-1 font-sans text-sm shadow-2xl"
      style={{
        left: state.x,
        top: state.y,
        backgroundColor: "rgba(28, 28, 28, 0.9)",
      }}
    >
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => void copy(videoUrl, "Video URL")}
        data-testid="context-copy-video-url"
      >
        Copy video URL
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => void copy(videoUrlAt, "Video URL at current time")}
        data-testid="context-copy-video-url-at"
      >
        Copy video URL at current time
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onClose();
          onStatsForNerds();
        }}
        data-testid="context-stats-for-nerds"
      >
        Stats for nerds
      </button>
    </div>
  );
}
