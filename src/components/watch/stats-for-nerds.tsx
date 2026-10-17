"use client";

/**
 * WFX2-P23-A — the "Stats for nerds" overlay (G2), youtube.com's player
 * technical panel REPRODUCED from the live 2026-10-17 measurement:
 *
 *  - the panel: `html5-video-info-panel ytp-sfn` — absolute at the player's
 *    top-left, z 64, bg rgba(28,28,28,.8), white 11px text (YouTube
 *    Noto/Roboto/Arial), the "[X]" close rung top-left, label weight 500 +
 *    value weight 400 rows (label block + value span, one line each).
 *  - the field set (measured, in order): Video ID / sCPN · Viewport /
 *    Frames · Current / Optimal Res · Volume / Normalized · Codecs ·
 *    Shader Info · Color · Connection Speed · Network Activity · Buffer
 *    Health · Mystery Text · Date.
 *
 *  HONESTY LAW (the work order's): the WebFlix player is the YouTube IFrame
 *  embed; the IFrame Player API exposes a SUBSET (getVideoData,
 *  getPlaybackQuality, getAvailableQualityLevels, getVideoLoadedFraction,
 *  getPlaybackRate, getVolume, state, current time). Every field below is
 *  either a REAL API signal, a page-side fact (the player element's
 *  viewport box, the current date), or REAL derived math (buffer health =
 *  loadedFraction × duration − currentTime), or an honest "–" for what the
 *  embed cannot supply (sCPN, dropped frames, optimal res, normalized
 *  volume, codecs, color, connection speed, network activity, mystery
 *  text). youtube.com HIDES non-applicable rows; this overlay keeps the
 *  full measured field set visible with "–" per the lane law.
 */
import { useEffect, useRef, useState } from "react";
import { playerHost } from "@/lib/player/player-host";
import type { YoutubePlayerStats } from "@/components/watch/youtube-player";

const DASH = "\u2013"; // the honest absent value

/** Poll cadence — youtube.com's own panel updates continuously (~1s reads). */
const POLL_MS = 1000;

function fmtBufferHealth(snap: YoutubePlayerStats): string {
  if (
    snap.loadedFraction === null ||
    snap.durationSec <= 0 ||
    !Number.isFinite(snap.loadedFraction)
  ) {
    return DASH;
  }
  const ahead = snap.loadedFraction * snap.durationSec - snap.currentTimeSec;
  return `${Math.max(0, ahead).toFixed(2)} s`;
}

export interface StatsRow {
  label: string;
  value: string;
}

/** Pure row builder (the tests pin the field set + the honest dashes). */
export function buildStatsRows(
  snap: YoutubePlayerStats | null,
  viewport: { w: number; h: number } | null,
  now: Date
): StatsRow[] {
  const s = snap;
  return [
    {
      label: "Video ID / sCPN",
      value:
        s?.videoId
          ? `${s.videoId} / ${DASH}`
          : DASH, // sCPN is the player's own nonce — not exposed by the embed API
    },
    {
      label: "Viewport / Frames",
      value: viewport ? `${viewport.w}x${viewport.h} / ${DASH}` : DASH, // dropped frames: not exposed
    },
    {
      label: "Current / Optimal Res",
      value: s?.playbackQuality ? `${s.playbackQuality} / ${DASH}` : DASH, // optimal: not exposed
    },
    {
      label: "Volume / Normalized",
      value:
        s?.volume !== null && s !== null && s.volume !== null
          ? `${Math.round(s.volume)}%${s.muted ? " (muted)" : ""} / ${DASH}`
          : DASH, // normalized volume: not exposed
    },
    { label: "Codecs", value: DASH }, // not exposed by the embed API
    { label: "Shader Info", value: DASH },
    { label: "Color", value: DASH },
    { label: "Connection Speed", value: DASH }, // cross-origin — unknowable
    { label: "Network Activity", value: DASH },
    {
      label: "Buffer Health",
      value: s ? fmtBufferHealth(s) : DASH, // REAL derived: loadedFraction × duration − currentTime
    },
    { label: "Mystery Text", value: DASH },
    { label: "Date", value: now.toString() }, // the measured format is Date#toString()
  ];
}

/**
 * The overlay. Mount INSIDE the player's container (absolute, top-left) —
 * it measures the container's box for the Viewport row (a real page-side
 * fact) and polls the player host's honest snapshot.
 */
export function StatsForNerds({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<YoutubePlayerStats | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  // the poll: the snapshot + the viewport box + the date (youtube.com's
  // panel is live; ~1s cadence matches the playhead's own granularity)
  useEffect(() => {
    const tick = () => {
      setSnap(playerHost.getStats());
      const el = rootRef.current?.parentElement;
      if (el) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) setViewport({ w: Math.round(b.width), h: Math.round(b.height) });
      }
      setNow(new Date());
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const rows = buildStatsRows(snap, viewport, now);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Stats for nerds"
      data-testid="stats-for-nerds"
      className="absolute left-2 top-2 z-[64] w-[min(500px,calc(100%-16px))] rounded-sm p-2 font-sans text-[11px] leading-5 text-white"
      style={{ backgroundColor: "rgba(28, 28, 28, 0.8)" }}
    >
      <button
        type="button"
        onClick={onClose}
        title="close"
        aria-label="Close stats for nerds"
        data-testid="stats-close"
        className="mb-1 rounded-sm px-1 py-0.5 text-[11px] font-medium text-white/90 hover:bg-white/15 hover:text-white"
      >
        [X]
      </button>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline gap-1" data-testid={`stats-row-${row.label.replace(/[^a-z]/gi, "-").toLowerCase()}`}>
          <span className="font-medium">{row.label}</span>
          <span className="min-w-0 break-all font-normal">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default StatsForNerds;
