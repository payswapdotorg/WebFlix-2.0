"use client";

/**
 * P90 — the Shorts mute control (the operator's report: "the mute on/off
 * button on shorts/tiktok is not available"). One preference, both sources:
 *
 * - THE STORE: a module-level boolean (default MUTED — the autoplay laws
 *   start silent) persisted in localStorage (`webflix:shorts:muted`) so the
 *   preference survives slide changes and reloads. SSR and the first client
 *   render agree on `true` (no hydration mismatch); the stored value
 *   hydrates on the first subscription (post-mount, the effect-safe lane).
 *
 * - THE YOUTUBE TRANSPORT: the official IFrame API command envelope
 *   (`{"event":"command","func":…}` as a JSON string) through the narrowest
 *   targetOrigin (`https://www.youtube.com`) — the TikTok command law's
 *   mirror (sendTikTokCommand). The embed is mounted with `enablejsapi=1`
 *   so the plain iframe accepts the commands; no API script is loaded (the
 *   watch page's full YT.Player lane stays the watch page's).
 *
 * - THE TIKTOK TRANSPORT: the Embed Player documents NO mute command (the
 *   protocol carries play/pause only — tiktok-feed-player.tsx), so the
 *   player re-mounts with the documented `force_muted` param flipped. The
 *   click is the user gesture, so the unmuted re-mount may play with sound;
 *   the restart is the honest cost (the feed player documents it).
 *
 * - THE BUTTON: rides BOTH engagement rails' top slot (the same round
 *   geometry), mirrors the store, and never fabricates a state it cannot
 *   know (the player's native controls stay usable alongside).
 */

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

const STORAGE_KEY = "webflix:shorts:muted";

/** The narrowest valid targetOrigin for YouTube IFrame API commands. */
export const YT_PLAYER_ORIGIN = "https://www.youtube.com";

const listeners = new Set<(muted: boolean) => void>();
let muted = true; // SSR + first client render agree (the autoplay law)
let hydrated = false;

function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === "0") muted = false;
  } catch {
    // storage refused (private mode) — the default stands
  }
}

/** The current preference (read at mount time; the subscription corrects). */
export function getShortsMuted(): boolean {
  return muted;
}

/** Flip the preference: persist + notify every mounted mirror. */
export function setShortsMuted(next: boolean): void {
  muted = next;
  hydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // storage refused — the in-memory preference still flips
  }
  for (const listener of listeners) listener(next);
}

/**
 * Subscribe to the preference. The first subscription hydrates the stored
 * value ASYNC (never synchronously inside render — the cascading-render
 * law), so a stored "unmuted" reaches the mounted players right after mount.
 */
export function subscribeShortsMuted(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  void Promise.resolve().then(() => {
    ensureHydrated();
    if (listeners.has(listener)) listener(muted);
  });
  return () => {
    listeners.delete(listener);
  };
}

/** The React mirror: `[muted, setMuted]`. */
export function useShortsMuted(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(muted);
  useEffect(() => subscribeShortsMuted(setValue), []);
  return [value, setShortsMuted];
}

/**
 * The official IFrame API command envelope for a plain (API-script-less)
 * embed iframe — exported for the protocol unit tests: the JSON-string
 * envelope and the narrowest targetOrigin are pinned law.
 */
export function sendYouTubePlayerCommand(
  iframe: HTMLIFrameElement | null,
  func: string,
  args: unknown[] = [],
): boolean {
  const win = iframe?.contentWindow;
  if (!win) return false;
  win.postMessage(JSON.stringify({ event: "command", func, args }), YT_PLAYER_ORIGIN);
  return true;
}

/**
 * The shared mute button — the top slot of BOTH shorts engagement rails
 * (YouTube + TikTok; the same round geometry). Toggling flips the shared
 * preference; each mounted player translates it through its own transport.
 */
export function ShortsMuteButton() {
  const [isMuted, setMuted] = useShortsMuted();
  return (
    <button
      type="button"
      data-testid="shorts-mute-button"
      aria-label={isMuted ? "Unmute" : "Mute"}
      aria-pressed={!isMuted}
      title={isMuted ? "Unmute" : "Mute"}
      onClick={() => setMuted(!isMuted)}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none motion-reduce:hover:scale-100"
    >
      {isMuted ? (
        <VolumeX className="size-full" aria-hidden="true" />
      ) : (
        <Volume2 className="size-full" aria-hidden="true" />
      )}
    </button>
  );
}
