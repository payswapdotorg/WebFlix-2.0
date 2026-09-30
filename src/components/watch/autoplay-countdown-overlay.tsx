"use client";

/**
 * WFX2-C-S — the watch-next autoplay countdown overlay (youtube.com's
 * "Playing next in…" card shown over the player when a video ENDS).
 *
 * - 5s circular ring with the cancel (X) button in its center.
 * - "Playing next in N" + the next video's preview (thumbnail, title,
 *   channel) — clicking the preview advances immediately (FIRE).
 * - Keyboard: Escape / Space cancel the countdown (space is swallowed so
 *   the page does not scroll while the overlay is up).
 * - Wall-clock ticking (Date.now vs deadline) — a 250ms interval whose
 *   deadline math survives background-tab throttling (never trusts rAF);
 *   a visibilitychange listener re-syncs the moment the tab returns.
 * - The overlay only renders while the machine is "counting".
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  countdownRemaining,
  type AutoplayCountdownState,
  type CountdownEvent,
} from "@/lib/watch/autoplay-countdown";

const TICK_MS = 250;
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

export type CountdownNextVideo = {
  id: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
};

export function AutoplayCountdownOverlay({
  state,
  next,
  dispatch,
}: {
  state: AutoplayCountdownState;
  next: CountdownNextVideo | null;
  dispatch: (event: CountdownEvent) => void;
}) {
  const counting = state.status === "counting" && next !== null;
  const [now, setNow] = useState(() => Date.now());
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Wall-clock ticker: 250ms deadline MATH (Date.now vs endsAt) —
  // survives background-tab interval throttling; visibilitychange re-syncs.
  // The component is mounted by the watch page exactly while counting,
  // so the useState initializer is the arm-time `now`.
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [counting]);

  // Deadline reached → fire the wall-clock TICK (deadline MATH, not
  // accumulated intervals — throttled background tabs still advance).
  useEffect(() => {
    if (!counting || state.endsAt === null) return;
    if (now < state.endsAt) return;
    dispatch({ type: "TICK", now: Date.now() });
  }, [counting, now, state.endsAt, dispatch]);

  // Keyboard cancel (Escape / Space) + initial focus on the cancel button.
  useEffect(() => {
    if (!counting) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        dispatch({ type: "CANCEL" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [counting, dispatch]);

  if (!counting || !next) return null;

  const remainingMs = countdownRemaining(state, now);
  const progress = state.totalMs > 0 ? remainingMs / state.totalMs : 0;
  const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div
      role="alertdialog"
      aria-label="Autoplay next video countdown"
      className="absolute inset-0 z-20 flex animate-in fade-in-0 flex-col items-center justify-center gap-4 bg-black/70 p-4 backdrop-blur-sm duration-200"
    >
      {/* circular countdown ring with the cancel control in its center */}
      <button
        ref={cancelRef}
        type="button"
        onClick={() => dispatch({ type: "CANCEL" })}
        aria-label={`Cancel autoplay, playing next in ${secondsLeft} seconds`}
        title="Cancel (Esc)"
        className="relative size-14 rounded-full transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
      >
        <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle
            cx="28"
            cy="28"
            r={RING_R}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="3"
          />
          <circle
            cx="28"
            cy="28"
            r={RING_R}
            fill="none"
            stroke="var(--yt-red)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            className="transition-[stroke-dashoffset] ease-linear"
            style={{ transitionDuration: `${TICK_MS}ms` }}
          />
        </svg>
        <X className="absolute inset-0 m-auto size-5 text-white" aria-hidden="true" />
      </button>

      <p className="text-sm font-medium text-white">
        Playing next in <span className="tabular-nums">{secondsLeft}</span>
      </p>

      {/* next-title preview — click to advance now */}
      <button
        type="button"
        onClick={() => dispatch({ type: "FIRE" })}
        aria-label={`Play next video now: ${next.title}`}
        className={cn(
          "flex w-full max-w-sm items-center gap-3 rounded-xl bg-white/5 p-2 text-left",
          "transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        )}
      >
        {next.thumbnailUrl && (
          <img
            src={next.thumbnailUrl}
            alt=""
            className="h-14 w-24 shrink-0 rounded-lg object-cover"
            loading="lazy"
            draggable={false}
          />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">
            {next.title}
          </span>
          <span className="block truncate text-xs text-white/70">
            {next.channelName}
          </span>
        </span>
      </button>
    </div>
  );
}

export default AutoplayCountdownOverlay;
