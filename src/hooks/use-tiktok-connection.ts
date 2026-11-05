"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTikTokConnection,
  type TikTokConnectionState,
} from "@/lib/watch/tiktok-connection-client";

export type TikTokConnection = {
  state: TikTokConnectionState | null;
  loading: boolean;
  reload: () => void;
};

/**
 * P94-b — the TikTok connection status hook (the use-youtube-connection
 * shape over the TikTok connection client's SWR-style ~30s cache). loading
 * is DERIVED (no data yet — no setState-in-effect); the first mount rides
 * the cache when warm, and `reload` forces a fresh probe (the settings
 * card's Recheck button).
 */
export function useTikTokConnection(): TikTokConnection {
  const [state, setState] = useState<TikTokConnectionState | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchTikTokConnection({ force: tick > 0 })
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {
        /* fetchTikTokConnection never rejects (honest disconnected) */
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
