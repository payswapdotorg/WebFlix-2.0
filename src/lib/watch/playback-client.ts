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
import type { PlaybackDto } from "@/lib/watch/types";

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
