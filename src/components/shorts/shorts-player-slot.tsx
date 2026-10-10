"use client";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts player slot.
 *
 * P22-C — the wall-aware slot: the old raw `<iframe>` had NO wall detection,
 * so youtube.com's "Sign in to confirm you're not a bot" rendered inside the
 * 9:16 frame indefinitely (the operator's bug 2 on the shorts surface — the
 * watch page had a fallback ladder; shorts had nothing). Now the ACTIVE
 * short runs the same embed-health probe the watch player uses:
 *  - healthy → the plain embed iframe exactly as before (muted, looping);
 *  - walled  → the ladder swap (PlayerFallback: the streams `<video>` path,
 *              then the honest blocked card with what-to-try actions);
 *  - pending → the poster stands in (the wall never surfaces).
 *
 * The contract stays `{ videoId, active, posterUrl }`; inactive slides keep
 * the poster (the iframe mounts only for the active slide, as before).
 */

import { useEffect, useState } from "react";
import { probeEmbedHealth } from "@/components/watch/youtube-player";
import { PlayerFallback } from "@/components/player/player-fallback";

const YT_EMBED_BASE = "https://www.youtube.com/embed";

/** i.ytimg.com hotlink fallback (allowed Tier-3 image host). */
function posterFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function ShortsPlayerSlot({
  videoId,
  active,
  posterUrl,
}: {
  videoId: string;
  active: boolean;
  /** Hydrated ShortDTO.thumbnailUrl when the feed has one (optional). */
  posterUrl?: string | null;
}) {
  const poster = posterUrl || posterFor(videoId);
  // P22-C — per-videoId wall verdict for the ACTIVE slide only (inactive
  // slides never pay a probe; a verdict from a prior pass is superseded by
  // the videoId key). The verdict RESET is the guarded render-phase idiom
  // (setState in an effect body is the cascading anti-pattern); the probe
  // itself only arms when active (an effect subscribing to an external
  // system — the offscreen player — and reporting back asynchronously).
  // probeGen re-arms the probe on Retry embed (a retry must re-probe, not
  // just re-paint the pending cover).
  const [wallVerdict, setWallVerdict] = useState<"pending" | "healthy" | "walled">("pending");
  const [probeGen, setProbeGen] = useState(0);
  const [probedFor, setProbedFor] = useState<{ videoId: string; active: boolean } | null>(null);
  if (probedFor?.videoId !== videoId || probedFor.active !== active) {
    setProbedFor({ videoId, active });
    setWallVerdict("pending");
  }

  useEffect(() => {
    if (!active) return; // only the playing slide probes
    let alive = true;
    void probeEmbedHealth(videoId).then((healthy) => {
      if (!alive) return;
      setWallVerdict(healthy ? "healthy" : "walled");
    });
    return () => {
      alive = false;
    };
  }, [videoId, active, probeGen]);

  return (
    <div className="relative aspect-[9/16] h-full w-full max-h-full overflow-hidden rounded-2xl bg-black">
      {/* Poster UNDER the embed — visible while the embed boots or the wall
          verdict is pending (pointer-events-none, purely decorative). */}
      <img
        src={poster}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      {wallVerdict === "walled" ? (
        // P22-C — the ladder swap: same chain the watch player uses (native
        // proxied stream → the honest blocked card). The slot keeps its 9:16
        // geometry; the fallback fills it.
        <PlayerFallback
          videoId={videoId}
          startSec={null}
          posterUrl={poster}
          onRetryEmbed={() => {
            setWallVerdict("pending");
            setProbeGen((g) => g + 1); // a retry re-arms the probe
          }}
        />
      ) : active ? (
        <>
          <iframe
            key={active ? "on" : "off"}
            src={`${YT_EMBED_BASE}/${videoId}?playsinline=1&autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&rel=0`}
            title={videoId}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
          {/* P22-C — the wall cover: the active short's iframe mounts
              immediately (healthy shorts play with no added delay) but stays
              COVERED by the poster until the probe verdict — the wall text
              inside the iframe never surfaces on the shorts surface either. */}
          {wallVerdict === "pending" && (
            <div
              data-testid="shorts-wall-cover"
              role="status"
              aria-label="Starting playback…"
              className="absolute inset-0 z-20 bg-black"
            >
              <img
                src={poster}
                alt=""
                referrerPolicy="no-referrer"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
