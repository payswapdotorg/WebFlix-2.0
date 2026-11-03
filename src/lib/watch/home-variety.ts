/**
 * P81-b — the home variety signals (the session-local half of the
 * "always the same videos" fix).
 *
 * The purge-sweep law keeps LIVE READ ROUTES db-import-free (no seeded
 * inventory can render on a read surface), so the /api/home route derives
 * its variety inputs THROUGH this proxy module — the established
 * action-proxy pattern (/api/videos/[id] reads the viewer's Watch-Later the
 * same way). What is read here is the viewer's OWN WebFlix-local feedback
 * (VideoSignal rows written by /api/not-interested) plus the signaled
 * videos' channel mapping — NEVER inventory for rendering.
 *
 * Best-effort by law: ANY failure in here degrades to `{ seed }` (rotation
 * still applies, exclusion honestly absent) — a personalization miss can
 * never take the feed down.
 */
import { db } from "@/lib/db";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import type { HomeVariety } from "@/lib/youtube/feeds";

export async function resolveHomeVariety(
  seed: number,
  sessionUser: WebFlixSessionUser | null,
): Promise<HomeVariety> {
  if (!sessionUser) return { seed };
  try {
    const user = await ensureShadowUser(sessionUser);
    const signals = await db.videoSignal.findMany({
      where: { userId: user.id },
      select: { videoId: true, kind: true },
    });
    if (signals.length === 0) return { seed };
    const excludeVideoIds = new Set(signals.map((s) => s.videoId));
    const excludeChannelIds = new Set<string>();
    const channelSignalIds = signals
      .filter((s) => s.kind === "dont_recommend_channel")
      .map((s) => s.videoId);
    if (channelSignalIds.length > 0) {
      // the mapping read (signaled video → its channel) — the shadow rows
      // exist (ensureShadowVideo wrote them at signal time); never rendered
      const rows = await db.video.findMany({
        where: { id: { in: channelSignalIds } },
        select: { channelId: true },
      });
      for (const row of rows) excludeChannelIds.add(row.channelId);
    }
    return { seed, excludeVideoIds, excludeChannelIds };
  } catch {
    return { seed }; // the honest no-personalization degrade
  }
}
