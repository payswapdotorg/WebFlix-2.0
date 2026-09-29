"use client";

/**
 * WFX2-W seek bar — the YouTube progress bar:
 * played (red) + buffered (translucent) layers, chapter segments, scrubber,
 * hover time tooltip (+ chapter title), pointer drag scrubbing, click seek,
 * and keyboard-driven preview from the player.
 */
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import type { Chapter } from "@/lib/watch/chapters";

export interface SeekBarProps {
  duration: number;
  current: number;
  buffered: number;
  chapters: Chapter[];
  hidden?: boolean;
  disabled?: boolean;
  onSeek: (sec: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onPreview?: (sec: number | null) => void;
}

export function SeekBar({
  duration,
  current,
  buffered,
  chapters,
  hidden,
  disabled,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onPreview,
}: SeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const [hoverX, setHoverX] = useState(0);

  const pct = (sec: number) => (duration > 0 ? Math.min(100, Math.max(0, (sec / duration) * 100)) : 0);
  const shown = dragging ? dragValue : current;
  const playedPct = pct(shown);
  const bufferedPct = pct(buffered);

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const el = barRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  // chapter title at a time
  const chapterAt = useCallback(
    (sec: number): string | null => {
      if (!chapters.length) return null;
      if (sec < chapters[0].startSec) return null;
      let title = chapters[0].title;
      for (const ch of chapters) {
        if (ch.startSec <= sec) title = ch.title;
        else break;
      }
      return title;
    },
    [chapters]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || duration <= 0) return;
    e.preventDefault();
    barRef.current?.setPointerCapture(e.pointerId);
    const t = timeFromClientX(e.clientX);
    setDragging(true);
    setDragValue(t);
    onScrubStart?.();
    onPreview?.(t);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    const t = timeFromClientX(e.clientX);
    if (dragging) {
      setDragValue(t);
      onPreview?.(t);
    } else if (!disabled) {
      setHover(t);
      const rect = barRef.current?.getBoundingClientRect();
      if (rect) {
        setHoverX(Math.min(rect.width, Math.max(0, e.clientX - rect.left)));
        setBarWidth(rect.width);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    const t = timeFromClientX(e.clientX);
    setDragging(false);
    onSeek(t);
    onScrubEnd?.();
    onPreview?.(null);
    barRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleMouseLeave = () => {
    if (!dragging) {
      setHover(null);
      onPreview?.(null);
    }
  };

  // keep tooltip inside the bar (barWidth tracked from pointer events, not refs-in-render)
  const tooltipLeft = Math.min(Math.max(hoverX, 34), Math.max(68, barWidth - 34));

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Seek slider"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatDuration(shown)} of ${formatDuration(duration)}`}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        // Arrow seeking is owned by the player's global shortcuts; the slider
        // itself exposes Home/End jumps.
        if (e.key === "Home") {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onSeek(duration);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group relative flex h-4 w-full cursor-pointer touch-none items-center select-none outline-none",
        hidden && "pointer-events-none opacity-0",
        "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0 rounded"
      )}
    >
      {/* track */}
      <div
        className="relative h-[3px] w-full rounded-full bg-white/30 transition-[height] duration-100 group-hover:h-[5px]"
        aria-hidden="true"
      >
        {/* buffered */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/50"
          style={{ width: `${bufferedPct}%` }}
        />
        {/* played segments (red) split by chapters */}
        {chapters.length > 0 ? (
          <div className="absolute inset-0 flex items-stretch">
            {chapters.map((ch, i) => {
              const segStart = pct(ch.startSec);
              const segEnd = pct(ch.endSec ?? duration);
              const segPlayed = Math.min(Math.max(playedPct, segStart), segEnd);
              return (
                <div
                  key={i}
                  className="h-full overflow-hidden rounded-full"
                  style={{
                    marginLeft: i === 0 ? 0 : 2,
                    width: `calc(${segEnd - segStart}% - ${i === 0 ? 0 : 2}px)`,
                  }}
                >
                  <div
                    className="h-full rounded-full bg-[#f03]"
                    style={{ width: `${((segPlayed - segStart) / Math.max(0.0001, segEnd - segStart)) * 100}%` }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#f03]"
            style={{ width: `${playedPct}%` }}
          />
        )}
        {/* scrubber */}
        <div
          className={cn(
            "absolute top-1/2 size-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f03] transition-transform duration-100",
            "scale-0 group-hover:scale-100",
            dragging && "scale-100"
          )}
          style={{ left: `${playedPct}%` }}
        />
      </div>

      {/* hover / drag tooltip */}
      {(hover !== null || dragging) && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 max-w-[220px] -translate-x-1/2 rounded-md bg-black/90 px-2 py-1 text-center shadow-lg"
          style={{ left: `${tooltipLeft}px` }}
        >
          <div className="text-xs font-medium tabular-nums text-white">
            {formatDuration(dragging ? dragValue : (hover ?? 0))}
          </div>
          {chapterAt(dragging ? dragValue : (hover ?? 0)) && (
            <div className="truncate text-[10px] text-white/70">
              {chapterAt(dragging ? dragValue : (hover ?? 0))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
