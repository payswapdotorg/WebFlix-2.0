"use client";

import { useRouter } from "next/navigation";
import { Music2 } from "lucide-react";
import { shortsSourceHref, type ShortsSource } from "@/lib/shorts/feed-contracts";

/**
 * ADR 0013 — the shared source selector (the work order's product contract
 * §1): YouTube and TikTok chips inside /shorts; YouTube is the default; the
 * selection lives in URL state (`/shorts?source=tiktok`) so back, reload
 * and deep links all work. `router.replace` (scroll: false) — a source flip
 * is a view swap, not a history step of its own (back returns to the
 * previous PAGE, matching youtube.com's surface switches).
 */
export function ShortsSourceSelector({ source }: { source: ShortsSource }) {
  const router = useRouter();

  function select(next: ShortsSource) {
    if (next === source) return;
    router.replace(shortsSourceHref(next), { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Shorts source"
      className="flex shrink-0 items-center gap-2 px-4 pt-2 sm:px-6"
      data-testid="shorts-source-selector"
    >
      <button
        type="button"
        role="tab"
        aria-selected={source === "youtube"}
        onClick={() => select("youtube")}
        className={
          "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
          (source === "youtube"
            ? "bg-yt-red text-white"
            : "bg-secondary text-secondary-foreground hover:bg-accent")
        }
        data-testid="shorts-source-youtube"
      >
        YouTube
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={source === "tiktok"}
        onClick={() => select("tiktok")}
        className={
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors " +
          (source === "tiktok"
            ? "bg-foreground text-background"
            : "bg-secondary text-secondary-foreground hover:bg-accent")
        }
        data-testid="shorts-source-tiktok"
      >
        <Music2 className="size-3.5" aria-hidden="true" />
        TikTok
      </button>
    </div>
  );
}
