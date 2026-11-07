import type { Metadata } from "next";

import { TikTokLiveView } from "./view";

export const metadata: Metadata = {
  title: { absolute: "TikTok LIVE on WebFlix" },
  description:
    "Watch and interact with a TikTok live session inside WebFlix — the room, the watch-party chat, and honest outbound links for anything that must happen on TikTok.",
};

/**
 * P100-TIKTOK-LIVE — the server shell for the in-app live surface. The
 * dynamic param arrives possibly double-encoded (the P95 law:
 * decodeURIComponent FIRST, with a safe fallback), and the view re-normalizes
 * through the G20 law.
 */
export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  let decoded = handle;
  try {
    decoded = decodeURIComponent(handle);
  } catch {
    /* the raw form rides */
  }
  return <TikTokLiveView rawHandle={decoded} />;
}
