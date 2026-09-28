"use client";

import { useCallback, useEffect, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Minimal typed fetch hook for the WebFlix API routes.
 * - loading is DERIVED (no data & no error yet) — no setState-in-effect
 * - url changes reset state in the render phase (React docs pattern)
 */
export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [prevUrl, setPrevUrl] = useState(url);

  // Adjust state when the url changes (guarded render-phase reset).
  if (url !== prevUrl) {
    setPrevUrl(url);
    setData(null);
    setError(null);
  }

  const loading = url !== null && data === null && error === null;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setData(json);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      });
    return () => controller.abort();
  }, [url, tick]);

  const reload = useCallback(() => {
    setError(null);
    setTick((t) => t + 1);
  }, []);

  return { data, loading, error, reload };
}

/** POST JSON helper with typed response. */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
