"use client";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts player slot.
 *
 * TODO CONTRACT @merge (A-W lane, wave A): this component is a SLOT for
 * A-W's `src/components/watch/youtube-player.tsx` (YouTube IFrame API).
 * At merge the lead should render A-W's player here instead of the plain
 * iframe fallback below. Contract for the swap:
 *   - Props stay `{ videoId: string; active: boolean }` (plus the optional
 *     `posterUrl` pass-through) — `active` maps to A-W's imperative
 *     play/pause (active slide plays, inactive pauses; muted start).
 *   - The slot (or its parent wrapper) owns the 9:16 geometry, rounded
 *     corners and overflow clipping — A-W's player only needs to fill it.
 *   - The fallback is ALWAYS MUTED (autoplay-safe, Tier-3 playback); A-W's
 *     player is expected to own the mute/unmute UX when it lands.
 *
 * Fallback (NOW): a plain YouTube embed iframe — the only youtube.com call
 * from the client (Tier-3 playback, allowed by the lane rules). The short's
 * thumbnail is layered UNDER the iframe as a poster for perceived
 * performance while the embed boots.
 */

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
  const src = `${YT_EMBED_BASE}/${videoId}?playsinline=1&autoplay=${active ? 1 : 0}&mute=1&controls=0&loop=1&playlist=${videoId}&rel=0`;
  const poster = posterUrl || posterFor(videoId);

  return (
    <div className="relative aspect-[9/16] h-full w-full max-h-full overflow-hidden rounded-2xl bg-black">
      {/* Poster UNDER the iframe — visible while the embed boots or if the
          embed is blocked (pointer-events-none, purely decorative). */}
      <img
        src={poster}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <iframe
        key={active ? "on" : "off"}
        src={src}
        title={videoId}
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
