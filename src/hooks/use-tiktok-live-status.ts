"use client";

/**
 * P100-TIKTOK-LIVE — the live-status polling hook. Polls /api/tiktok/live
 * while mounted: probing answers keep the fast cadence, real errors STOP
 * the polling (an honest degraded state, not a poll storm) and surface the
 * API's real error copy.
 */
import { useEffect, useState } from "react";

import type { TikTokLiveStatusDTO } from "@/lib/tiktok/live";

export function useTikTokLiveStatus(
  handle: string | null,
  pollMs = 45_000
): { status: TikTokLiveStatusDTO | null; error: string | null } {
  const [status, setStatus] = useState<TikTokLiveStatusDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the reset when the handle empties (the channel view unmounts its poller) — the established hydration idiom
      setStatus(null);
      setError(null);
      return;
    }
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/tiktok/live?handle=${encodeURIComponent(handle)}`);
        const body = (await res.json().catch(() => null)) as
          | { status?: TikTokLiveStatusDTO; error?: string }
          | null;
        if (dead) return;
        if (!res.ok) {
          // a real 4xx/5xx is a terminal state for the poller: surface it
          // verbatim and stop — hammering a broken lane helps nobody
          setError(body?.error ?? "The live status is unavailable right now.");
          return;
        }
        setError(null);
        setStatus(body?.status ?? null);
        timer = setTimeout(tick, pollMs);
      } catch {
        if (!dead) setError("The live status is unavailable right now.");
      }
    };

    void tick();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [handle, pollMs]);

  return { status, error };
}
