"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — Worker 2-d (UI lane): the heart reaction
 * rail.
 *
 * The frozen batching law, client side: taps coalesce in a 400ms window —
 * each tap increments a pending counter and spawns one floating heart
 * (plain CSS keyframes, capped at 24 concurrent floats); when the window
 * closes, ONE POST carries the whole batch with a clientBatchId. The
 * response's server-computed cumulative total REPLACES the display base —
 * the client never invents a count. Failures are honest: a dropped batch
 * is announced as "not counted", never silently merged into the number.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  LiveReactionTotalDto,
  SendLiveReactionBatchInput,
} from "@/lib/live/types";
import { liveFetch, toastLiveFailure } from "./use-live-stream";

/** The frozen batching window (work order §2: taps coalesce in 400ms). */
const BATCH_WINDOW_MS = 400;
/** Hard cap on concurrent floating hearts (reuse via keys, never piles). */
const MAX_FLOATS = 24;
/** Floats older than this are pruned even if their animation never ends. */
const FLOAT_LIFETIME_MS = 2_000;

interface FloatHeart {
  id: number;
  /** Horizontal offset (-24..24px), rise distance, rotation, duration. */
  dx: number;
  dy: number;
  rot: number;
  dur: number;
  born: number;
}

function floatStyle(h: FloatHeart): React.CSSProperties {
  return {
    "--float-dx": `${h.dx}px`,
    "--float-dy": `${h.dy}px`,
    "--float-rot": `${h.rot}deg`,
    "--float-dur": `${h.dur}ms`,
  } as unknown as React.CSSProperties;
}

export interface LiveReactionRailProps {
  roomId: string;
  sessionLive: boolean;
  reactionsEnabled: boolean;
  signedIn: boolean;
  /** The room's current heart total (from the room GET), when known. */
  initialTotal?: number;
  /**
   * The page-level stream's server-computed total (room-wide — includes
   * OTHER viewers' accepted batches). When present it is authoritative;
   * own-batch responses remain the fallback base.
   */
  streamReactionTotal?: number | null;
  className?: string;
}

export function LiveReactionRail({
  roomId,
  sessionLive,
  reactionsEnabled,
  signedIn,
  initialTotal = 0,
  streamReactionTotal = null,
  className,
}: LiveReactionRailProps) {
  const animName = `wf-live-float-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // serverTotal is the server's truth (replaced by every batch response);
  // pending = taps in the open window; inFlight = taps in the POST that is
  // on the wire. Display total = serverTotal + pending + inFlight — no
  // double counting, no dip while a batch is being confirmed.
  const [serverTotal, setServerTotal] = useState(initialTotal);
  const [pending, setPending] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [floats, setFloats] = useState<FloatHeart[]>([]);
  // Set when the server itself rejects a batch with "reactions-disabled".
  const [serverDisabled, setServerDisabled] = useState(false);

  const pendingRef = useRef(0);
  const windowOpenRef = useRef(false);
  const windowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatIdRef = useRef(0);

  // The host can re-enable reactions — the honest disabled state must lift.
  // (React-documented render-phase state adjustment, guarded by the
  // previous prop value — not an effect.)
  const [prevReactionsEnabled, setPrevReactionsEnabled] = useState(reactionsEnabled);
  if (reactionsEnabled !== prevReactionsEnabled) {
    setPrevReactionsEnabled(reactionsEnabled);
    if (reactionsEnabled) setServerDisabled(false);
  }

  useEffect(() => {
    return () => {
      if (windowTimerRef.current !== null) clearTimeout(windowTimerRef.current);
    };
  }, []);

  async function flushBatch(): Promise<void> {
    windowOpenRef.current = false;
    windowTimerRef.current = null;
    const count = pendingRef.current;
    if (count <= 0) return;
    // The batch leaves the pending counter and goes on the wire.
    pendingRef.current = 0;
    setPending(0);
    setInFlight(count);

    const payload: SendLiveReactionBatchInput = {
      clientBatchId: crypto.randomUUID(),
      count,
      kind: "heart",
    };
    const result = await liveFetch<{ total: LiveReactionTotalDto }>(
      `/api/live-rooms/${roomId}/reactions`,
      { body: payload },
    );
    setInFlight(0);
    if (result.ok) {
      // Server truth replaces the base — never merged with local guesses.
      setServerTotal(result.data.total.total);
      return;
    }
    if (result.failure.code === "forbidden" && result.failure.message === "reactions-disabled") {
      setServerDisabled(true);
      toast.error("The host disabled reactions");
      return;
    }
    if (result.failure.code === "rate-limited") {
      toast.error("You're reacting too fast", {
        description: "WebFlix rate-limited reactions — this batch was not counted.",
      });
      return;
    }
    toastLiveFailure(result.failure, "This batch of hearts was not counted.");
  }

  function tap(): void {
    pendingRef.current += 1;
    setPending(pendingRef.current);

    // Spawn a floating heart; prune stale ones; cap at MAX_FLOATS.
    // (The id comes from a ref bump OUTSIDE the updater — updaters must
    // stay pure; event handlers may mutate refs.)
    const now = Date.now();
    const freshId = (floatIdRef.current += 1);
    setFloats((prev) => {
      const alive = prev.filter((f) => now - f.born < FLOAT_LIFETIME_MS);
      const next = [
        ...alive,
        {
          id: freshId,
          dx: Math.round(Math.random() * 48 - 24),
          dy: -(60 + Math.round(Math.random() * 40)),
          rot: Math.round(Math.random() * 24 - 12),
          dur: 700 + Math.round(Math.random() * 400),
          born: now,
        },
      ];
      return next.length > MAX_FLOATS ? next.slice(next.length - MAX_FLOATS) : next;
    });

    // The batching window: opens on the first tap of a burst, flushes once.
    if (!windowOpenRef.current) {
      windowOpenRef.current = true;
      windowTimerRef.current = setTimeout(() => void flushBatch(), BATCH_WINDOW_MS);
    }
  }

  function removeFloat(id: number): void {
    setFloats((prev) => prev.filter((f) => f.id !== id));
  }

  const reactionsBlockedByPolicy = !reactionsEnabled || serverDisabled;
  const blockedCopy = !signedIn
    ? "Sign in to react"
    : !sessionLive
      ? "Reactions open when the broadcast is live"
      : "The host disabled reactions";
  const interactive = signedIn && sessionLive && !reactionsBlockedByPolicy;
  // Room-wide base: the stream total (includes everyone) wins when seen;
  // own-batch responses seed it before the first stream event lands.
  const baseTotal = streamReactionTotal ?? serverTotal;
  const displayTotal = baseTotal + pending + inFlight;

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <style>{`
        @keyframes ${animName}-rise {
          0% { opacity: 0; transform: translate(-50%, 0) rotate(0deg) scale(0.6); }
          15% { opacity: 0.95; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--float-dx)), var(--float-dy)) rotate(var(--float-rot)) scale(1.1); }
        }
        .${animName} {
          position: absolute;
          bottom: 0;
          left: 50%;
          pointer-events: none;
          animation: ${animName}-rise var(--float-dur) ease-out forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .${animName} { animation: none; opacity: 0; }
        }
      `}</style>

      <div className="relative">
        {signedIn ? (
          <span title={interactive ? "Send a heart" : blockedCopy}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={interactive ? "Send a heart reaction" : `Reactions — ${blockedCopy}`}
              disabled={!interactive}
              onClick={tap}
              className="size-12 rounded-full"
            >
              <Heart
                className="size-6 text-yt-red transition-transform"
                fill={pending > 0 ? "currentColor" : "none"}
              />
            </Button>
          </span>
        ) : (
          <span title="Sign in to react">
            <Button asChild variant="outline" size="icon" className="size-12 rounded-full">
              <Link
                href={`/signin?redirect=${encodeURIComponent(`/live/${roomId}`)}`}
                aria-label="Sign in to react"
              >
                <Heart className="size-6 text-yt-red" />
              </Link>
            </Button>
          </span>
        )}

        {/* Floating hearts — pure decoration, invisible to AT. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-full h-0">
          {floats.map((f) => (
            <span
              key={f.id}
              className={animName}
              style={floatStyle(f)}
              onAnimationEnd={() => removeFloat(f.id)}
            >
              <Heart className="size-5 text-yt-red" fill="currentColor" />
            </span>
          ))}
        </div>
      </div>

      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatCount(displayTotal)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {!signedIn
            ? "Sign in to react"
            : !sessionLive
              ? "Reactions open when live"
              : reactionsBlockedByPolicy
                ? "Reactions are off"
                : "hearts"}
        </span>
      </span>
      <span className="sr-only">
        {formatCount(displayTotal)} hearts so far — counts are server-computed totals.
      </span>
    </div>
  );
}
