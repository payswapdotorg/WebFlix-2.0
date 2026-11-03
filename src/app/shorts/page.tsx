import type { Metadata } from "next";
import { ShortsFeed } from "@/components/shorts/shorts-feed";
import { TikTokShortsFeed } from "@/components/shorts/tiktok/tiktok-shorts-feed";
import { parseShortsSource } from "@/lib/shorts/feed-contracts";
import { isTikTokPostId } from "@/lib/tiktok/urls";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts page (thin server page).
 *
 * ADR 0013 (WFX2-TIKTOK-SHORTS-EXPERIENCE-1): ONE Shorts experience, two
 * source adapters. The source is URL state read SERVER-SIDE so back,
 * reload and deep links render the right adapter on first paint:
 *   /shorts                       → YouTube (the default)
 *   /shorts?source=tiktok         → the TikTok feed
 *   /shorts?source=tiktok&post=ID → the TikTok feed opened at that post
 * An invalid `post` id is honestly ignored (the feed renders normally).
 *
 * The page itself does NOT scroll — it fills the shell's main area height
 * (`h-full`) and the shared feed shell owns the snap scrolling internally.
 * The hourly ISR is dropped: the source contract makes the page
 * request-shaped; every datum still arrives client-fetched from
 * force-dynamic routes (the data law is unchanged).
 */

export const metadata: Metadata = {
  title: "Shorts",
};

export default async function ShortsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; post?: string }>;
}) {
  const params = await searchParams;
  const source = parseShortsSource(params.source);
  const post =
    source === "tiktok" && params.post && isTikTokPostId(params.post)
      ? params.post
      : null;

  return (
    <div className="h-full">
      {source === "tiktok" ? <TikTokShortsFeed post={post} /> : <ShortsFeed />}
    </div>
  );
}
