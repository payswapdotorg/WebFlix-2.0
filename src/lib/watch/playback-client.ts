"use client";

/**
 * Task 2-c — the client-side accessor for /api/videos/[id]/playback
 * (the server-side player-response chain; see src/lib/youtube/streams.ts).
 *
 * A per-session Map dedupes fetches (the watch page's fallback player and
 * the hover preview both hit it) and remembers failures so a walled egress
 * doesn't refetch per hover. Resolves null on any error — callers degrade
 * (blocked card / zoom-pan thumbnail).
 */
import type { PlaybackDto, StreamFormatDto } from "@/lib/watch/types";

const cache = new Map<string, Promise<PlaybackDto | null>>();

export function fetchPlayback(videoId: string): Promise<PlaybackDto | null> {
  let entry = cache.get(videoId);
  if (!entry) {
    entry = fetch(`/api/videos/${encodeURIComponent(videoId)}/playback`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as PlaybackDto | null;
        if (!data || !Array.isArray(data.streamFormats) || !Array.isArray(data.storyboards)) {
          return null;
        }
        return data;
      })
      .catch(() => null);
    cache.set(videoId, entry);
  }
  return entry;
}

/**
 * P26-HPV — the hover preview's NATIVE-lane format picker (pure).
 *
 * The preview box renders at the card's thumbnail size (≤ ~480px wide);
 * youtube.com's own home-grid hover previews run ~360p, so the ranking is
 * DISTANCE FROM 360P, not tallest-wins:
 *
 *   score = -|height - 360| × 1000 + (hasAudio ? 500 : 0) - bitrate / 1e9
 *
 *  - a muted preview needs no audio track — video-only adaptive entries
 *    (hasAudio:false) are first-class fuel here, while the watch page's
 *    pickStreamFormat keeps requiring muxed;
 *  - a 1080p adaptive stream through the server-side /api/stream proxy
 *    would waste bandwidth for a 320px box — nearest-360p wins;
 *  - muxed entries win only exact height ties (+500), and the tiny bitrate
 *    term breaks remaining ties toward the cheaper stream (deterministic);
 *  - entries with no height (null → 0) sit at distance 360 — they rank
 *    behind every entry within ±360px of the target.
 *
 * Empty input → null (the preview's honest storyboard floor).
 */
export function pickPreviewStreamFormat(
  formats: StreamFormatDto[]
): StreamFormatDto | null {
  if (formats.length === 0) return null;
  const score = (f: StreamFormatDto): number =>
    -Math.abs((f.height ?? 0) - 360) * 1000 + (f.hasAudio ? 500 : 0) - (f.bitrate ?? 0) / 1e9;
  return formats.reduce((best, f) => (score(f) > score(best) ? f : best));
}

/** The storyboard URL for sheet k of a level (template $N → M<k>). */
export function storyboardSheetUrl(templateUrl: string, sheet: number): string {
  return templateUrl.replace("$N", `M${sheet}`);
}

/** Which animatable storyboard level a preview should use (fewest sheets with readable frames). */
export function pickStoryboardLevel(
  levels: PlaybackDto["storyboards"]
): PlaybackDto["storyboards"][number] | null {
  const usable = levels.filter((l) => l.frameCount > 1 && l.cols > 0 && l.rows > 0);
  if (usable.length === 0) return null;
  const readable = usable.filter((l) => l.frameWidth >= 120);
  const pool = readable.length > 0 ? readable : usable;
  return pool.reduce((best, l) => (l.sheetCount < best.sheetCount ? l : best));
}
