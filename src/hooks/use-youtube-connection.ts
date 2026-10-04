"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchYouTubeConnection,
  type YouTubeConnectionState,
} from "@/lib/watch/connection-client";

export type YouTubeConnection = {
  state: YouTubeConnectionState | null;
  loading: boolean;
  reload: () => void;
};

/**
 * WFX2 Task 4-b — the YouTube connection status hook (the useApi shape over
 * the connection client's SWR-style ~30s cache). loading is DERIVED (no data
 * yet — no setState-in-effect); the first mount rides the cache when warm,
 * and `reload` forces a fresh probe (the settings card's Retry button).
 */
export function useYouTubeConnection(): YouTubeConnection {
  const [state, setState] = useState<YouTubeConnectionState | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchYouTubeConnection({ force: tick > 0 })
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {
        /* fetchYouTubeConnection never rejects (honest disconnected) */
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  return { state, loading: state === null, reload };
}
