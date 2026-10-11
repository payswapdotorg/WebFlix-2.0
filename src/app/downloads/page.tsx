import type { Metadata } from "next";
import DownloadsView from "./view";

export const metadata: Metadata = {
  title: "Downloads",
  description:
    "WebFlix streams online only — there are no offline downloads. On youtube.com this page lists videos saved for offline watching (a YouTube Premium feature).",
};

/**
 * P22-B — the Downloads page (the You-section parity entry).
 *
 * youtube.com carries "Downloads" in the guide's You section and the page
 * lists videos saved for offline watching (a YouTube Premium feature, shown
 * with the Premium branding). WebFlix has NO offline tier — every video
 * streams from YouTube itself — so the honest page is the no-tier empty
 * state: what youtube.com shows here, what WebFlix offers instead, and
 * nothing fabricated (no download rows, no storage stats, no fake buttons).
 */
export default function DownloadsPage() {
  return <DownloadsView />;
}
