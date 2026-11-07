"use client";

/**
 * P102 — the live-board polling hook. Polls /api/tiktok/live/board while
 * mounted with the same honesty laws as the status hook: probing answers
 * keep the cadence, real errors STOP the polling (an honest degraded state,
 * not a poll storm) and surface the API's real error copy.
 */
import { useEffect, useState } from "react";

import type { TikTokLiveBoardDTO } from "@/lib/tiktok/live";

export function useTikTokLiveBoard(
  pollMs = 15_000
): { board: TikTokLiveBoardDTO | null; error: string | null } {
  const [board, setBoard] = useState<TikTokLiveBoardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/tiktok/live/board");
        const body = (await res.json().catch(() => null)) as
          | { board?: TikTokLiveBoardDTO; error?: string }
          | null;
        if (dead) return;
        if (!res.ok) {
          setError(body?.error ?? "The TikTok live board is unavailable right now.");
          return;
        }
        setError(null);
        setBoard(body?.board ?? null);
        timer = setTimeout(tick, pollMs);
      } catch {
        if (!dead) setError("The TikTok live board is unavailable right now.");
      }
    };

    void tick();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return { board, error };
}
