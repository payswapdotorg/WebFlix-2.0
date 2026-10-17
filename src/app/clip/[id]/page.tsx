import { ClipPageView } from "./view";
import { resolveClip } from "@/lib/clip/clip-service";

/**
 * WFX2-P23-A — the clip page route: /clip/<clipId> (WebFlix-local ids AND
 * youtube.com clip postIds — the resolve family handles both). youtube.com
 * never redirects /clip/<id> (measured 2026-10-17 — the URL stays and the
 * ranged player renders in place); WebFlix matches: this route renders,
 * never redirects to /watch.
 *
 * The page title mirrors youtube.com's clip page title (the SOURCE video's
 * title — measured: "Game Collecting - Scott The Woz - YouTube"). The
 * resolve here is the same cached read the view's API call rides, so the
 * double read costs one cache hit, and a failed read degrades to the
 * default title honestly (never a fabricated one).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await resolveClip(id).catch(() => null);
  if (result && "videoId" in result && result.videoTitle) {
    return { title: `${result.videoTitle} - WebFlix` };
  }
  if (result && "videoId" in result && result.title) {
    return { title: `${result.title} - WebFlix` };
  }
  return { title: "Clip - WebFlix" };
}

export default async function ClipRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key → fresh mount per clip (client state resets naturally)
  return <ClipPageView key={id} clipId={id} />;
}
