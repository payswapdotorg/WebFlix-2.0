"use client";

/**
 * WFX2-C-S — ambient mode: the watch-page player glow (youtube.com's
 * "ambient mode" — a soft light that bleeds from the video into the page).
 *
 * The honest implementation: a STATIC thumbnail driven backdrop — the
 * video's own thumbnail, heavily blurred + desaturated + darkened through
 * pure CSS (filter + radial mask), positioned behind the player and
 * extending past its edges. NO canvas frame-grabbing from the IFrame
 * player: the iframe is cross-origin (its pixels are unreadable), and
 * youtube.com's own ambient light derives from the video's dominant
 * colors — the static thumbnail is the closest derivable source. Light
 * and dark themes are honored (dark: stronger, light: softer).
 *
 * Decorative only (aria-hidden) — it never intercepts pointer events and
 * never causes layout shift (absolutely positioned).
 */
import { cn } from "@/lib/utils";

export function AmbientBackdrop({
  thumbnailUrl,
  className,
}: {
  thumbnailUrl: string | null | undefined;
  className?: string;
}) {
  if (!thumbnailUrl) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -inset-6 z-0 overflow-visible sm:-inset-10",
        className,
      )}
    >
      <img
        // keyed by src → a video change remounts the layer so the glow
        // cross-fades with the 200ms opacity transition instead of popping
        key={thumbnailUrl}
        src={thumbnailUrl}
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
        className={cn(
          "h-full w-full scale-110 rounded-2xl object-cover",
          "opacity-25 blur-[64px] saturate-50",
          "transition-opacity duration-200",
          "dark:opacity-40 dark:saturate-75",
        )}
        style={{
          maskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.35) 60%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.35) 60%, transparent 78%)",
        }}
      />
    </div>
  );
}

export default AmbientBackdrop;
