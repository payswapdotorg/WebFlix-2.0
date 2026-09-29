import type { Metadata } from "next";
import { ShortsFeed } from "@/components/shorts/shorts-feed";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts page (thin server page).
 *
 * The old demo page (useApi + db-backed shorts + <video> playback) is fully
 * replaced by the live YouTube-backed vertical feed. The page itself does
 * NOT scroll — it fills the shell's main area height (`h-full`) and the
 * ShortsFeed owns the snap scrolling internally.
 */

export const metadata: Metadata = {
  title: "Shorts",
};

export default function ShortsPage() {
  return (
    <div className="h-full">
      <ShortsFeed />
    </div>
  );
}
