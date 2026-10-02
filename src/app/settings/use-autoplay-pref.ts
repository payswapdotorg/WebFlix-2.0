"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * WFX2-P5-SS — the REAL autoplay preference, the Wave-1 key.
 *
 * This is the exact persisted pref the watch page's Autoplay switch writes
 * (watch-page.tsx) and the queue engine reads (queue-engine.ts):
 *   localStorage["wfx2-autoplay"] = "1" (on) | "0" (off) | absent → on.
 * The Settings switch writes the same key with the same value shape — never
 * a parallel preference that nothing reads.
 */
const AUTOPLAY_KEY = "wfx2-autoplay";

export function readAutoplayPreference(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "0";
  } catch {
    return true; // storage blocked → the player default (on)
  }
}

export function writeAutoplayPreference(on: boolean): void {
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the player falls back to its default */
  }
}

export function useAutoplayPreference(): {
  autoplay: boolean;
  setAutoplayPref: (on: boolean) => void;
} {
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of a persisted pref (SSR renders the default) — the watch-page idiom
      setAutoplay(localStorage.getItem(AUTOPLAY_KEY) !== "0");
    } catch {
      /* private mode */
    }
  }, []);

  const setAutoplayPref = useCallback((on: boolean) => {
    setAutoplay(on);
    writeAutoplayPreference(on);
  }, []);

  return { autoplay, setAutoplayPref };
}
