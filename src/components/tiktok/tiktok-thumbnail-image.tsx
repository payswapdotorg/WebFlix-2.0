"use client";

import { useState, type ReactNode } from "react";

/**
 * R5 + R6 (docs/research/2026-11-04-tiktok-thumbnail-hover-play-research.md
 * §5) — the ONE thumbnail `<img>` every TikTok surface renders:
 *
 * - R5: `referrerPolicy="no-referrer"` always — request-level hygiene against
 *   referer-gated CDN edges (the feed player's poster already shipped this;
 *   this component makes it the single law instead of a per-surface habit).
 * - R6: an `onError` drops a broken image and renders the honest fallback —
 *   TikTok thumbnails ride SIGNED CDN URLs that expire, so a cached
 *   `thumbnailUrl` can 404 later in a session; the fallback tile (or nothing,
 *   for decorative posters) is the honest answer, never a broken-image glyph.
 *
 * A src change resets the broken flag in render (the house render-phase
 * reset — the TikTokFeedPlayer law): a re-hydrated URL gets a fresh chance.
 */
export function TikTokThumbnailImage({
  src,
  alt,
  className,
  testId,
  fallback = null,
}: {
  src: string | null;
  alt: string;
  className?: string;
  testId?: string;
  /** Rendered in the img's place when src is absent or the image broke. */
  fallback?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setBroken(false);
  }

  if (!src || broken) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-testid={testId}
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
